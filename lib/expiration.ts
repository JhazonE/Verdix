import type mysql from 'mysql2/promise';

import { query } from './mysql';

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * Returns true if year/month/day form a real calendar date (month 1-12,
 * day valid for that month, accounting for leap years on February).
 */
function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12) return false;
  if (day < 1) return false;

  if (month === 2) {
    const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return day <= (isLeap ? 29 : 28);
  }

  return day <= DAYS_IN_MONTH[month - 1];
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Normalizes a user-supplied expiration date to a MySQL DATE literal.
 *
 * Returns null for blank/absent input — expiry is always optional, so "no date"
 * is a valid answer, not an error. Returns null for unparseable input too: the
 * UI uses a native date picker, so a malformed value can only arrive from a
 * direct API call, and silently dropping it is safer than writing garbage into
 * a column the expiring-soon report reads.
 *
 * Timezone-safe by construction: the calendar date is extracted from the string
 * as written (never round-tripped through `Date#toISOString`, which converts to
 * UTC and can shift local-midnight timestamps to the previous day in UTC+8).
 *
 * Mirrors the normalization already used for purchase orders
 * (app/api/purchase-orders/[id]/route.ts:158).
 */
export function normalizeExpirationDate(input?: string | null): string | null {
  if (input === null || input === undefined) return null;
  const trimmed = String(input).trim();
  if (trimmed === '') return null;

  let year: number;
  let month: number;
  let day: number;

  // Primary path: bare YYYY-MM-DD (also matches the date portion of an ISO
  // string with a time component, or "YYYY-MM-DD HH:mm:ss") — read the
  // calendar date directly out of the string, no Date parsing involved.
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/);
  if (isoMatch) {
    year = Number(isoMatch[1]);
    month = Number(isoMatch[2]);
    day = Number(isoMatch[3]);
  } else {
    // Fallback: non-ISO formats like "07/22/2026". Use Date only to split the
    // string into components, then read getFullYear/getMonth/getDate — these
    // reflect the local calendar date as parsed (no UTC conversion), unlike
    // toISOString which converts to UTC and can shift the day.
    const parsed = new Date(trimmed);
    if (isNaN(parsed.getTime())) return null;

    year = parsed.getFullYear();
    month = parsed.getMonth() + 1;
    day = parsed.getDate();
  }

  if (!isValidCalendarDate(year, month, day)) return null;

  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/**
 * Recomputes products.expiration_date as the soonest expiry still in stock.
 *
 * products.expiration_date is a denormalized cache — inventory_batches is the
 * source of truth. Only batches with stock remaining count, so a fully depleted
 * batch stops driving the product's displayed expiry.
 *
 * Never throws: a stale cache must not fail the adjustment that triggered it.
 */
export async function refreshProductExpirationCache(
  productId: string,
  connection?: mysql.PoolConnection | mysql.Pool
): Promise<void> {
  const sql = `
    UPDATE products p
    SET p.expiration_date = (
      SELECT MIN(b.expiration_date)
      FROM inventory_batches b
      WHERE b.product_id = p.id
        AND b.quantity_remaining > 0
        AND b.expiration_date IS NOT NULL
    )
    WHERE p.id = ?
  `;

  try {
    if (connection) {
      await connection.query(sql, [productId]);
    } else {
      await query(sql, [productId]);
    }
  } catch (err) {
    console.warn('[Expiration] Could not refresh product expiration cache:', err);
  }
}
