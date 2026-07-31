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

/**
 * A stale claim (older than this) is assumed to be from a dead process and
 * may be retaken. Kept as the one source of truth for the threshold — it is
 * interpolated directly into the takeover SQL below, so the query and any
 * message about it can never drift apart.
 */
const CLAIM_STALE_MINUTES = 15;

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
 * On a duplicate key, a succeeded claim or a fresh (< CLAIM_STALE_MINUTES)
 * in-flight claim is left alone and the caller is told to skip. A claim
 * older than that is assumed abandoned by a crashed or killed process and is
 * taken over — without this escape hatch a crash between claim and
 * completion would permanently block that Z-reading from ever being
 * submitted again, with no way out but manual SQL.
 *
 * The takeover itself is a single conditional UPDATE, not a SELECT followed
 * by a separate UPDATE. That matters: if two callers both read the same
 * >15-minute-old abandoned claim and then each unconditionally UPDATE, both
 * would believe they won and both would send — reintroducing the exact
 * double-submission bug this table exists to prevent. Folding the staleness
 * check into the UPDATE's WHERE clause means the database evaluates
 * "is this row still eligible" and "claim it" as one atomic step; MySQL's
 * row lock ensures only one of two concurrent UPDATEs against the same row
 * can match, so the decision comes from `affectedRows`, never from a value
 * read in a separate statement.
 */
async function claimZReading(resolvedId: string): Promise<ClaimOutcome> {
  try {
    await query(`INSERT INTO sta_lucia_submissions (z_reading_id) VALUES (?)`, [resolvedId]);
    return { claimed: true };
  } catch (err: any) {
    if (err?.code !== 'ER_DUP_ENTRY') throw err;

    const takeover = await query(
      `UPDATE sta_lucia_submissions
          SET claimed_at = NOW()
        WHERE z_reading_id = ?
          AND succeeded = 0
          AND claimed_at < NOW() - INTERVAL ${CLAIM_STALE_MINUTES} MINUTE`,
      [resolvedId],
    ) as any;
    if (takeover?.affectedRows === 1) {
      return { claimed: true };
    }

    // We did not win the takeover: either the claim is fresh, it already
    // succeeded, or another caller's UPDATE won the race a moment ago. Read
    // the row only to report why — this SELECT does not decide anything.
    const rows = await query(
      `SELECT succeeded FROM sta_lucia_submissions WHERE z_reading_id = ?`,
      [resolvedId],
    ) as any[];
    const existing = rows?.[0];

    // The row that caused the duplicate-key error was removed (e.g. its
    // failure-path DELETE ran) between our INSERT and now. Retake it.
    if (!existing) return claimZReading(resolvedId);

    return { claimed: false, result: { success: true, skipped: true, zReadingId: resolvedId } };
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

  // Captured the moment the send result is known, and checked in the catch
  // below. This — not "did we reach the claim UPDATE/DELETE" — is what
  // decides whether the claim may ever be released, because the UPDATE that
  // persists `succeeded = 1` can itself throw (transient DB error, lock wait
  // timeout, connection drop) after the mall has already accepted the sale.
  let sendSucceeded = false;

  try {
    const payload = buildSalesPayload(rowToZReading(row));
    const endpoint = `${cfg.apiEndpoint.replace(/\/+$/, '')}/api/get-sales`;
    const result = await sendSales(cfg, payload);
    sendSucceeded = result.success;

    // Resolve the claim's terminal state from the send result FIRST, before
    // touching external_api_logs. The send to the mall is the irreversible
    // step; once `sendSales` reports success the claim must never be
    // released again for this Z-reading, no matter what happens next — so
    // `succeeded = 1` lands before the log write gets any chance to fail and
    // reach a catch block that deletes the claim. (This UPDATE can itself
    // throw, which is exactly why `sendSucceeded` above — not "we got past
    // this line" — is the thing the catch block trusts.)
    if (result.success) {
      await query(`UPDATE sta_lucia_submissions SET succeeded = 1 WHERE z_reading_id = ?`, [resolvedId]);
    } else {
      await query(`DELETE FROM sta_lucia_submissions WHERE z_reading_id = ?`, [resolvedId]);
    }

    // The log write is audit trail, not the source of truth for whether the
    // send happened — its failure must not undo the claim decision just made
    // above, nor turn an accepted mall submission into a 500 for the caller.
    try {
      await writeLog({
        transactionId: resolvedId,
        endpoint,
        payload,
        response: result.response ?? null,
        status: result.success ? 'success' : 'failed',
        errorMessage: result.success ? null : result.error,
      });
    } catch (logError) {
      console.error('Sta Lucia: failed to write sync log for', resolvedId, logError);
    }

    return {
      success: result.success,
      error: result.error,
      zReadingId: resolvedId,
      payload,
      response: result.response,
    };
  } catch (error) {
    // Only release the claim if the mall never accepted the sale. This is
    // reachable from buildSalesPayload throwing, sendSales throwing
    // (client.ts catches internally so this shouldn't happen, but don't rely
    // on that) — both cases where `sendSucceeded` is still false — but also
    // from the `succeeded = 1` UPDATE above throwing AFTER a successful send.
    // In that last case the mall already accepted the sale, so deleting the
    // claim here would let a retry resend sales that are already recorded on
    // their side — the exact double-report this table exists to prevent.
    // `sendSucceeded` is what distinguishes the two, not "we reached here."
    if (!sendSucceeded) {
      await query(`DELETE FROM sta_lucia_submissions WHERE z_reading_id = ?`, [resolvedId]).catch(() => {});
    }
    throw error;
  }
}
