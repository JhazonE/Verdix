/**
 * Low-stock alert selection for the notification bell.
 *
 * This is the SQL-side counterpart to `getStockStatus` in
 * `app/(app)/inventory/use-stock-status.ts`, which is the app's canonical
 * definition of "low stock" for the badge, the products filter and the report.
 * Both must agree, so the rule is spelled out in one place here and asserted
 * against that definition in `tests/unit/low-stock-alerts.test.ts`:
 *
 *   effective threshold = max(reorder point, global low-stock threshold)
 *   low stock           = stock > 0 AND stock < effective threshold
 *
 * The `stock > 0` half is the part that matters most. A product with no stock
 * at all is OUT of stock, not low on it, and a bulk-imported catalogue is
 * mostly never-stocked rows: on the catalogue that exposed this, the previous
 * `stock < reorder_point OR stock < threshold` matched 15,982 of 15,987
 * products — 15,919 of them simply zero — and the bell's server action tried to
 * return all of them to the browser every 30 seconds.
 */

/**
 * Hard cap on alerts returned to the client. The bell renders a short popover
 * list, so there is no reading of a longer one; the cap exists so that no
 * catalogue size or misconfigured threshold can turn this into a multi-megabyte
 * server-action payload again.
 */
export const LOW_STOCK_ALERT_LIMIT = 50;

/** The store-wide floor used when `pos_settings.low_stock_threshold` is unusable. */
export const DEFAULT_LOW_STOCK_THRESHOLD = 10;

/** Coerces a settings value that may be null, a string, or NaN into a usable number. */
export function normalizeThreshold(globalThreshold: number | null | undefined): number {
  const n = Number(globalThreshold);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_LOW_STOCK_THRESHOLD;
}

/**
 * Mirrors `getStockStatus`'s low-stock branch. Kept as a plain predicate so the
 * rule can be asserted directly in tests without a database.
 */
export function isLowStock(
  stock: number,
  reorderPoint: number | null | undefined,
  globalThreshold: number | null | undefined,
): boolean {
  if (!(stock > 0)) return false; // zero (or unknown) stock is out-of-stock
  const effectiveThreshold = Math.max(Number(reorderPoint) || 0, normalizeThreshold(globalThreshold));
  return stock < effectiveThreshold;
}

/**
 * Builds the bounded alert query. `GREATEST` is the SQL form of the
 * `Math.max` above; ordering by the shortfall puts the most urgent items in the
 * capped window rather than letting an arbitrary slice of the catalogue win.
 */
export function buildLowStockAlertQuery(globalThreshold: number | null | undefined): {
  sql: string;
  params: number[];
} {
  const threshold = normalizeThreshold(globalThreshold);
  const sql = `
      SELECT id, name, stock, reorder_point
      FROM products
      WHERE type = 'standard'
        AND stock > 0
        AND stock < GREATEST(COALESCE(reorder_point, 0), ?)
      ORDER BY (GREATEST(COALESCE(reorder_point, 0), ?) - stock) DESC
      LIMIT ?
    `;
  return { sql, params: [threshold, threshold, LOW_STOCK_ALERT_LIMIT] };
}
