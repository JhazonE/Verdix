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
 * Build and submit one Z-reading. Omit `zReadingId` to submit the latest.
 *
 * Idempotent: a Z-reading that already has a successful log for this
 * transaction type is skipped, so a retry sweep, a double-click, or a
 * re-finalize can never submit the same day's sales twice.
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

  const done = await query(
    `SELECT id FROM external_api_logs
     WHERE transaction_type = ? AND transaction_id = ? AND status = 'success' LIMIT 1`,
    [TRANSACTION_TYPE, resolvedId],
  ) as any[];
  if (done?.length) {
    return { success: true, skipped: true, zReadingId: resolvedId };
  }

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

  return {
    success: result.success,
    error: result.error,
    zReadingId: resolvedId,
    payload,
    response: result.response,
  };
}
