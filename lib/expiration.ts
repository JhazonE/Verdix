import type mysql from 'mysql2/promise';

import { query } from './mysql';

/**
 * Normalizes a user-supplied expiration date to a MySQL DATE literal.
 *
 * Returns null for blank/absent input — expiry is always optional, so "no date"
 * is a valid answer, not an error. Returns null for unparseable input too: the
 * UI uses a native date picker, so a malformed value can only arrive from a
 * direct API call, and silently dropping it is safer than writing garbage into
 * a column the expiring-soon report reads.
 *
 * Mirrors the normalization already used for purchase orders
 * (app/api/purchase-orders/[id]/route.ts:158).
 */
export function normalizeExpirationDate(input?: string | null): string | null {
  if (input === null || input === undefined) return null;
  const trimmed = String(input).trim();
  if (trimmed === '') return null;

  const parsed = new Date(trimmed);
  if (isNaN(parsed.getTime())) return null;

  return parsed.toISOString().slice(0, 10);
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
