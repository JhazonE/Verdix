import { format, startOfHour, subHours } from 'date-fns';
import { query } from '@/lib/mysql';
import { buildHourlySalesPayload } from './hourly-payload';
import { sendSales } from './client';
import { loadStaLuciaConfig } from './send-z-reading';
import type { HourlySalesTotals } from './types';

export const HOURLY_TRANSACTION_TYPE = 'STA_LUCIA_HOURLY_SALES';

export interface SendHourlySalesResult {
  success: boolean;
  error?: string;
  skipped?: boolean;
  hourStart: string;
  payload?: unknown;
  response?: unknown;
}

/** Claim-table staleness threshold — same value and reasoning as CLAIM_STALE_MINUTES in send-z-reading.ts. */
const CLAIM_STALE_MINUTES = 15;
const RETRY_BACKOFF_MINUTES = 15;

async function ensureHourlyClaimsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS sta_lucia_hourly_submissions (
      hour_start VARCHAR(19) PRIMARY KEY,
      claimed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      succeeded  TINYINT(1) NOT NULL DEFAULT 0
    )
  `);
}

type ClaimOutcome =
  | { claimed: true }
  | { claimed: false; result: SendHourlySalesResult };

/**
 * Atomically claim an hour for submission. Identical logic to
 * claimZReading() in send-z-reading.ts — see that function's comments for
 * why the takeover must be a single conditional UPDATE rather than a
 * SELECT-then-UPDATE, and why a stale claim is taken over rather than left
 * permanently stuck.
 */
async function claimHour(hourKey: string): Promise<ClaimOutcome> {
  try {
    await query(`INSERT INTO sta_lucia_hourly_submissions (hour_start) VALUES (?)`, [hourKey]);
    return { claimed: true };
  } catch (err: any) {
    if (err?.code !== 'ER_DUP_ENTRY') throw err;

    const takeover = await query(
      `UPDATE sta_lucia_hourly_submissions
          SET claimed_at = NOW()
        WHERE hour_start = ?
          AND succeeded = 0
          AND claimed_at < NOW() - INTERVAL ${CLAIM_STALE_MINUTES} MINUTE`,
      [hourKey],
    ) as any;
    if (takeover?.affectedRows === 1) {
      return { claimed: true };
    }

    const rows = await query(
      `SELECT succeeded FROM sta_lucia_hourly_submissions WHERE hour_start = ?`,
      [hourKey],
    ) as any[];
    const existing = rows?.[0];

    if (!existing) return claimHour(hourKey);

    return { claimed: false, result: { success: true, skipped: true, hourStart: hourKey } };
  }
}

/**
 * Fold one submission attempt into the row that already exists for this
 * hour, rather than always inserting. Same dedupe reasoning as writeLog() in
 * send-z-reading.ts: an always-INSERT logger leaves an immediately-due row
 * behind on every failed sweep pass.
 */
async function writeHourlyLog(entry: {
  hourKey: string; endpoint: string; payload: unknown;
  response: unknown; status: string; errorMessage?: string | null;
}) {
  const payloadJson = JSON.stringify(entry.payload);
  const responseJson = entry.response == null ? null : JSON.stringify(entry.response);

  const existing = await query(
    `SELECT id FROM external_api_logs
      WHERE transaction_type = ? AND transaction_id = ? AND status <> 'success'
      ORDER BY created_at DESC LIMIT 1`,
    [HOURLY_TRANSACTION_TYPE, entry.hourKey],
  ) as any[];

  const existingId = existing?.[0]?.id as string | undefined;

  if (existingId) {
    if (entry.status === 'success') {
      await query(
        `UPDATE external_api_logs
            SET endpoint = ?, payload = ?, response = ?, status = 'success',
                error_message = NULL, last_retry_at = NOW(), next_retry_at = NULL
          WHERE id = ?`,
        [entry.endpoint, payloadJson, responseJson, existingId],
      );
    } else {
      await query(
        `UPDATE external_api_logs
            SET endpoint = ?, payload = ?, response = ?, status = ?,
                error_message = ?, retry_count = retry_count + 1,
                last_retry_at = NOW(),
                next_retry_at = NOW() + INTERVAL ${RETRY_BACKOFF_MINUTES} MINUTE
          WHERE id = ?`,
        [
          entry.endpoint, payloadJson, responseJson, entry.status,
          entry.errorMessage ?? null, existingId,
        ],
      );
    }
    return existingId;
  }

  const id = `log_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  await query(
    `INSERT INTO external_api_logs
      (id, transaction_type, transaction_id, endpoint, payload, response, status, error_message, retry_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [
      id, HOURLY_TRANSACTION_TYPE, entry.hourKey, entry.endpoint,
      payloadJson, responseJson,
      entry.status, entry.errorMessage ?? null,
    ],
  );
  return id;
}

/**
 * Aggregate store-wide sales totals for [hourStart, hourEnd), applying the
 * same exclusions as the Z-reading report (training rows, void/cancelled/
 * returned sales) but with NO terminal_id filter — hourly submissions are
 * store-wide, unlike the per-terminal Z-reading.
 */
async function aggregateHour(hourStart: Date, hourEnd: Date): Promise<HourlySalesTotals> {
  const startStr = format(hourStart, 'yyyy-MM-dd HH:mm:ss');
  const endStr = format(hourEnd, 'yyyy-MM-dd HH:mm:ss');

  const salesSql = `
    SELECT SUM(st.total) as gross_sales, SUM(pt.discount_amount) as total_discounts
    FROM sales_transactions st
    JOIN pos_transactions pt ON st.id = pt.sale_id
    WHERE st.status NOT IN ('Void', 'Voided', 'Cancelled', 'Returned')
      AND pt.is_training = 0
      AND st.created_at >= ? AND st.created_at < ?
  `;
  const [salesResult] = await query(salesSql, [startStr, endStr]) as any[];

  const paymentSql = `
    SELECT st.payment_method, SUM(st.total) as amount
    FROM sales_transactions st
    JOIN pos_transactions pt ON st.id = pt.sale_id
    WHERE st.status NOT IN ('Void', 'Voided', 'Cancelled', 'Returned')
      AND pt.is_training = 0
      AND st.created_at >= ? AND st.created_at < ?
    GROUP BY st.payment_method
  `;
  const paymentResults = await query(paymentSql, [startStr, endStr]) as any[];

  const vatSql = `
    SELECT
      pti.tax_type,
      SUM(pti.line_total) as total_amount,
      SUM(CASE
        WHEN pti.tax_type = 'VAT' THEN pti.line_total - (pti.line_total / 1.12)
        ELSE 0
      END) as vat_amount
    FROM pos_transaction_items pti
    JOIN pos_transactions pt ON pti.pos_transaction_id = pt.id
    JOIN sales_transactions st ON pt.sale_id = st.id
    WHERE st.status NOT IN ('Void', 'Voided', 'Cancelled', 'Returned')
      AND pt.is_training = 0
      AND pt.created_at >= ? AND pt.created_at < ?
    GROUP BY pti.tax_type
  `;
  const vatResults = await query(vatSql, [startStr, endStr]) as any[];

  const vatRow = vatResults.find((v: any) => v.tax_type === 'VAT');
  const vatTotalAmount = parseFloat(vatRow?.total_amount || 0);
  const vatAmount = parseFloat(vatRow?.vat_amount || 0);
  const vatSales = vatTotalAmount - vatAmount;
  const vatExempt = parseFloat(vatResults.find((v: any) => v.tax_type === 'VAT_EXEMPT')?.total_amount || 0);
  const nonVat = parseFloat(vatResults.find((v: any) => v.tax_type === 'NON_VAT')?.total_amount || 0);

  const paymentMethods = paymentResults.map((p: any) => ({
    name: p.payment_method || 'Unknown',
    amount: parseFloat(p.amount) || 0,
  }));
  const cashSalesObj = paymentResults.find((p: any) => p.payment_method?.toUpperCase() === 'CASH');
  const cashSales = parseFloat(cashSalesObj?.amount || 0);

  return {
    hourStart: startStr,
    grossSales: parseFloat(salesResult?.gross_sales || 0),
    discounts: parseFloat(salesResult?.total_discounts || 0),
    vatSales,
    vatAmount,
    vatExempt,
    nonVat,
    cashSales,
    paymentMethods,
  };
}

/**
 * Submit one hour's store-wide sales to Sta. Lucia. Defaults to the most
 * recently CLOSED hour (floor(now, 1h) - 1h) when hourStart is omitted —
 * the cron always submits the hour that just ended, never the in-progress
 * one.
 *
 * Same fast-path-then-claim structure as sendZReadingToStaLucia(): a
 * successful log for this hour skips the send outright; otherwise the hour
 * is atomically claimed via sta_lucia_hourly_submissions before sending, so
 * two concurrent callers (the :05 cron and a catch-up pass landing in the
 * same window) can't both submit the same hour.
 */
export async function sendHourlyStaLuciaSales(
  hourStart?: Date,
  apiId?: string,
): Promise<SendHourlySalesResult> {
  const cfg = await loadStaLuciaConfig(apiId);
  if (!cfg) return { success: false, error: 'No enabled Sta Lucia API is configured', hourStart: '' };

  const resolvedStart = hourStart ? startOfHour(hourStart) : subHours(startOfHour(new Date()), 1);
  const resolvedEnd = new Date(resolvedStart.getTime() + 60 * 60 * 1000);
  const hourKey = format(resolvedStart, 'yyyy-MM-dd HH:mm:ss');

  const done = await query(
    `SELECT id FROM external_api_logs
     WHERE transaction_type = ? AND transaction_id = ? AND status = 'success' LIMIT 1`,
    [HOURLY_TRANSACTION_TYPE, hourKey],
  ) as any[];
  if (done?.length) {
    return { success: true, skipped: true, hourStart: hourKey };
  }

  await ensureHourlyClaimsTable();
  const claim = await claimHour(hourKey);
  if (!claim.claimed) {
    return claim.result;
  }

  let sendSucceeded = false;

  try {
    const totals = await aggregateHour(resolvedStart, resolvedEnd);
    const payload = buildHourlySalesPayload(totals);
    const endpoint = `${cfg.apiEndpoint.replace(/\/+$/, '')}/api/get-sales`;
    const result = await sendSales(cfg, payload);
    sendSucceeded = result.success;

    if (result.success) {
      await query(`UPDATE sta_lucia_hourly_submissions SET succeeded = 1 WHERE hour_start = ?`, [hourKey]);
    } else {
      await query(`DELETE FROM sta_lucia_hourly_submissions WHERE hour_start = ?`, [hourKey]);
    }

    try {
      await writeHourlyLog({
        hourKey,
        endpoint,
        payload,
        response: result.response ?? null,
        status: result.success ? 'success' : 'failed',
        errorMessage: result.success ? null : result.error,
      });
    } catch (logError) {
      console.error('Sta Lucia hourly: failed to write sync log for', hourKey, logError);
    }

    return {
      success: result.success,
      error: result.error,
      hourStart: hourKey,
      payload,
      response: result.response,
    };
  } catch (error) {
    if (!sendSucceeded) {
      await query(`DELETE FROM sta_lucia_hourly_submissions WHERE hour_start = ?`, [hourKey]).catch(() => {});
    }
    throw error;
  }
}
