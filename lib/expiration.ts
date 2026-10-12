import type mysql from 'mysql2/promise';

import { query } from './mysql';

// The pure date helpers live in ./expiration-date so client components can
// import them without pulling the MySQL driver into the browser bundle. They are
// re-exported here so existing server-side importers keep their import path.
export { normalizeExpirationDate } from './expiration-date';

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
