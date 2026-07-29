import { PoolConnection } from 'mysql2/promise';

/** DECIMAL(15,4) rounding slack. Differences below this are not real. */
const EPSILON = 0.0001;

export type BaselineInput = {
  /** Stock recorded when the count was created. */
  snapshotQuantity: number;
  /** What the counter physically found. */
  countedQuantity: number;
  /** products.stock right now, at completion time. */
  liveStock: number;
  /** Net stock_movements from snapshot until the line was counted. */
  netMovementToCount: number;
  /** Net stock_movements from snapshot until now. */
  netMovementToNow: number;
};

export type BaselineResult = {
  /** Delta to apply to live stock. Zero means nothing to do. */
  variance: number;
  /** What the system believed was on hand when the line was counted. */
  baseline: number;
  /** True when the movement log was incomplete and live stock was used instead. */
  usedFallback: boolean;
};

/**
 * Variance of a counted line against what the system believed was on hand at the
 * moment it was counted, rather than against the stale snapshot.
 *
 * Movements recorded AFTER the line was counted are intentionally ignored: they
 * are already reflected in live stock, and the caller applies `variance` as a
 * delta rather than setting an absolute value.
 */
export function computeTrueVariance(input: BaselineInput): BaselineResult {
  const { snapshotQuantity, countedQuantity, liveStock, netMovementToCount, netMovementToNow } = input;

  // If the log is complete, snapshot + everything since must equal live stock.
  // When it doesn't, a write bypassed recordStockMovement and the baseline is
  // untrustworthy — fall back to live stock, which is what the old code
  // effectively compared against once its delta was applied.
  const reconstructedNow = snapshotQuantity + netMovementToNow;
  const usedFallback = Math.abs(reconstructedNow - liveStock) > EPSILON;

  const baseline = usedFallback ? liveStock : snapshotQuantity + netMovementToCount;
  const rawVariance = countedQuantity - baseline;
  const variance = Math.abs(rawVariance) <= EPSILON ? 0 : rawVariance;

  return { variance, baseline, usedFallback };
}

/**
 * Net stock movement for a product within a window.
 *
 * Queries the product's OWN product_id, not the family root: addFamilyStock and
 * deductFamilyStock recurse and write a movement row per node, so each product's
 * movements are complete under its own id.
 *
 * Movements referencing the stock count itself are excluded so that a count
 * completed twice (or retried after a partial failure) cannot fold its own
 * adjustments into the baseline.
 */
export async function getNetMovementSince(
  productId: string,
  from: Date,
  to: Date,
  excludeReferenceId: string,
  connection: PoolConnection
): Promise<number> {
  const [rows]: any = await connection.query(
    `SELECT COALESCE(SUM(quantity_change), 0) AS net
     FROM stock_movements
     WHERE product_id = ?
       AND created_at > ?
       AND created_at <= ?
       AND (reference_id IS NULL OR reference_id <> ?)`,
    [productId, from, to, excludeReferenceId]
  );
  return Number(rows?.[0]?.net ?? 0);
}
