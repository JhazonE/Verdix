import { query } from '@/lib/mysql';
import { buildSalesPayload } from './payload';
import { sendSales, type StaLuciaApiConfig } from './client';
import type { ZReadingLike } from './types';

export const TRANSACTION_TYPE = 'STA_LUCIA_SALES';

export interface SendZReadingResult {
  success: boolean;
  error?: string;
  skipped?: boolean;
  zReadingId?: string;
  payload?: unknown;
  response?: unknown;
}

/** Load a specific Sta Lucia config by id, or the single enabled one. */
export async function loadStaLuciaConfig(apiId?: string): Promise<StaLuciaApiConfig | null> {
  const rows = apiId
    ? await query(`SELECT * FROM external_apis WHERE id = ? AND provider = 'sta_lucia'`, [apiId]) as any[]
    : await query(
        `SELECT * FROM external_apis WHERE provider = 'sta_lucia' AND enabled = 1
         ORDER BY created_at ASC LIMIT 1`, []) as any[];

  const row = rows?.[0];
  if (!row) return null;

  return {
    id: row.id,
    apiEndpoint: row.api_endpoint,
    loginEmail: row.login_email ?? '',
    loginPassword: row.login_password ?? '',
    timeout: row.timeout ?? 30000,
    onErrorAction: row.on_error_action ?? 'log_only',
  };
}

/**
 * Map a z_readings row onto the shape the pure mapper expects.
 *
 * NOTE: the table carries BOTH `vat_sales` and `vatable_sales`. Only
 * `vatable_sales` is written by the Z-reading INSERT; `vat_sales` is a legacy
 * column that is left at its default. Reading the wrong one silently reports
 * zero VAT-able sales to the mall.
 */
function rowToZReading(row: any): ZReadingLike {
  let paymentMethods: Array<{ name: string; amount: number }> = [];
  try {
    const parsed = typeof row.payment_methods === 'string'
      ? JSON.parse(row.payment_methods)
      : row.payment_methods;
    if (Array.isArray(parsed)) paymentMethods = parsed;
  } catch {
    paymentMethods = [];
  }

  const num = (v: any) => parseFloat(v) || 0;

  return {
    id: String(row.reading_number),
    reportDate: row.report_date,
    grossSales: num(row.gross_sales),
    netSales: num(row.net_sales),
    discounts: num(row.discounts),
    vatSales: num(row.vatable_sales),
    vatAmount: num(row.vat_amount),
    vatExempt: num(row.vat_exempt),
    nonVat: num(row.non_vat),
    transactionCount: parseInt(row.transaction_count) || 0,
    cashSales: num(row.cash_sales),
    paymentMethods,
  };
}

async function writeLog(entry: {
  transactionId: string; endpoint: string; payload: unknown;
  response: unknown; status: string; errorMessage?: string | null;
}) {
  const id = `log_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  await query(
    `INSERT INTO external_api_logs
      (id, transaction_type, transaction_id, endpoint, payload, response, status, error_message, retry_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [
      id, TRANSACTION_TYPE, entry.transactionId, entry.endpoint,
      JSON.stringify(entry.payload),
      entry.response == null ? null : JSON.stringify(entry.response),
      entry.status, entry.errorMessage ?? null,
    ],
  );
  return id;
}

/** A stale claim (older than this) is assumed to be from a dead process and may be retaken. */
const CLAIM_STALE_MS = 15 * 60 * 1000;

/**
 * Defensive guard so existing installs self-heal without a migration run —
 * same pattern used by the external-api routes (see e.g.
 * app/api/external-api/logs/route.ts's ensureTables()).
 *
 * `external_api_logs` deliberately allows duplicate success rows (see
 * 095_dedupe_external_api_logs), so it cannot be a concurrency guard on its
 * own: a SELECT-then-INSERT check against that table is check-then-act and
 * two concurrent sends for the same Z-reading can both pass it before either
 * writes its row. This table's PRIMARY KEY on z_reading_id makes the claim
 * below atomic — only one concurrent INSERT can win.
 */
async function ensureClaimsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS sta_lucia_submissions (
      z_reading_id VARCHAR(50) PRIMARY KEY,
      claimed_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      succeeded    TINYINT(1) NOT NULL DEFAULT 0
    )
  `);
}

type ClaimOutcome =
  | { claimed: true }
  | { claimed: false; result: SendZReadingResult };

/**
 * Atomically claim a Z-reading for submission via the table's PRIMARY KEY.
 *
 * On a duplicate key the existing claim is inspected: a succeeded claim or a
 * fresh (< 15 min) in-flight claim is left alone and the caller is told to
 * skip. A claim older than 15 minutes is assumed abandoned by a crashed or
 * killed process and is taken over — without this escape hatch a crash
 * between claim and completion would permanently block that Z-reading from
 * ever being submitted again, with no way out but manual SQL.
 */
async function claimZReading(resolvedId: string): Promise<ClaimOutcome> {
  try {
    await query(`INSERT INTO sta_lucia_submissions (z_reading_id) VALUES (?)`, [resolvedId]);
    return { claimed: true };
  } catch (err: any) {
    if (err?.code !== 'ER_DUP_ENTRY') throw err;

    const rows = await query(
      `SELECT succeeded, claimed_at FROM sta_lucia_submissions WHERE z_reading_id = ?`,
      [resolvedId],
    ) as any[];
    const existing = rows?.[0];

    // The row that caused the duplicate-key error was removed (e.g. its
    // failure-path DELETE ran) between our INSERT and this SELECT. Retake it.
    if (!existing) return claimZReading(resolvedId);

    if (existing.succeeded) {
      return { claimed: false, result: { success: true, skipped: true, zReadingId: resolvedId } };
    }

    const ageMs = Date.now() - new Date(existing.claimed_at).getTime();
    if (ageMs < CLAIM_STALE_MS) {
      return { claimed: false, result: { success: true, skipped: true, zReadingId: resolvedId } };
    }

    await query(`UPDATE sta_lucia_submissions SET claimed_at = NOW() WHERE z_reading_id = ?`, [resolvedId]);
    return { claimed: true };
  }
}

/**
 * Build and submit one Z-reading. Omit `zReadingId` to submit the latest.
 *
 * Idempotent under concurrency: a Z-reading that already has a successful log
 * for this transaction type is skipped (fast path), and beyond that an
 * atomic claim in `sta_lucia_submissions` ensures only one of two concurrent
 * callers (e.g. the finalize hook and a manual "Send Z-Reading" click landing
 * in the same window) actually sends — the other gets `skipped: true`. A
 * failed send releases the claim so a retry sweep or another manual click can
 * try again.
 */
export async function sendZReadingToStaLucia(
  zReadingId?: string,
  apiId?: string,
): Promise<SendZReadingResult> {
  const cfg = await loadStaLuciaConfig(apiId);
  if (!cfg) return { success: false, error: 'No enabled Sta Lucia API is configured' };

  const rows = zReadingId
    ? await query('SELECT * FROM z_readings WHERE reading_number = ? LIMIT 1', [zReadingId]) as any[]
    : await query('SELECT * FROM z_readings ORDER BY id DESC LIMIT 1', []) as any[];

  if (!rows?.length) {
    return {
      success: false,
      error: zReadingId ? `Z-reading ${zReadingId} not found` : 'No Z-readings have been saved yet',
    };
  }

  const row = rows[0];
  const resolvedId = String(row.reading_number);

  // Fast path: kept even with the claim table below in case that table is
  // ever lost or reset — the log survives and still prevents a resend.
  const done = await query(
    `SELECT id FROM external_api_logs
     WHERE transaction_type = ? AND transaction_id = ? AND status = 'success' LIMIT 1`,
    [TRANSACTION_TYPE, resolvedId],
  ) as any[];
  if (done?.length) {
    return { success: true, skipped: true, zReadingId: resolvedId };
  }

  await ensureClaimsTable();
  const claim = await claimZReading(resolvedId);
  if (!claim.claimed) {
    return claim.result;
  }

  try {
    const payload = buildSalesPayload(rowToZReading(row));
    const endpoint = `${cfg.apiEndpoint.replace(/\/+$/, '')}/api/get-sales`;
    const result = await sendSales(cfg, payload);

    await writeLog({
      transactionId: resolvedId,
      endpoint,
      payload,
      response: result.response ?? null,
      status: result.success ? 'success' : 'failed',
      errorMessage: result.success ? null : result.error,
    });

    if (result.success) {
      await query(`UPDATE sta_lucia_submissions SET succeeded = 1 WHERE z_reading_id = ?`, [resolvedId]);
    } else {
      await query(`DELETE FROM sta_lucia_submissions WHERE z_reading_id = ?`, [resolvedId]);
    }

    return {
      success: result.success,
      error: result.error,
      zReadingId: resolvedId,
      payload,
      response: result.response,
    };
  } catch (error) {
    // Release the claim on a thrown error too — otherwise the failure sits
    // stranded behind the 15-minute staleness window before it can be retried.
    await query(`DELETE FROM sta_lucia_submissions WHERE z_reading_id = ?`, [resolvedId]).catch(() => {});
    throw error;
  }
}
