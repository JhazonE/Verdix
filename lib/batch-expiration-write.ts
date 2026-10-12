import type mysql from 'mysql2/promise';

import { generateBatchId } from './batch-utils';
import type { ResolvedExpirationEdits } from './batch-expiration-edit';
import { refreshProductExpirationCache } from './expiration';

/**
 * Applies a resolved expiration plan to the database.
 *
 * Server-only (imports ./expiration, which reaches ./mysql). The planning half
 * lives in ./batch-expiration-edit and is client-safe; this is the write half,
 * split out so it can be tested against real tables independently of the route.
 *
 * Writes ONLY inventory_batches.expiration_date and, when the plan calls for it,
 * one new batch row. products.stock is never modified — not even when an opening
 * batch is created, because that registers stock already counted in
 * products.stock into the batch ledger rather than adding any.
 *
 * No stock_movements row is written either: there is no quantity change to
 * record, and a movement would misreport this as stock entering the business.
 *
 * The caller supplies the connection so the whole plan commits atomically with
 * whatever else the caller is doing.
 */
export async function applyExpirationEdits(
  connection: mysql.PoolConnection,
  {
    productId,
    plan,
    unitCost,
    sellingPrice,
  }: {
    productId: string;
    plan: ResolvedExpirationEdits;
    unitCost: number;
    sellingPrice: number;
  }
): Promise<{ updated: number; openingBatchId: string | null }> {
  for (const update of plan.batchUpdates) {
    // product_id is in the predicate as defence in depth: the plan already
    // refused foreign batch ids, so this can only ever be redundant — but a
    // batch id that leaked through must not be able to touch another product.
    await connection.query(
      'UPDATE inventory_batches SET expiration_date = ? WHERE id = ? AND product_id = ?',
      [update.expirationDate, update.batchId, productId]
    );
  }

  let openingBatchId: string | null = null;
  if (plan.openingBatch) {
    openingBatchId = generateBatchId();
    // quantity_in equals quantity_remaining: this stock is already on hand and
    // none of it has been consumed through this batch.
    await connection.query(
      `INSERT INTO inventory_batches
         (id, product_id, received_date, quantity_in, quantity_remaining,
          unit_cost, selling_price, source_type, notes, expiration_date)
       VALUES (?, ?, CURDATE(), ?, ?, ?, ?, 'opening', ?, ?)`,
      [
        openingBatchId,
        productId,
        plan.openingBatch.quantity,
        plan.openingBatch.quantity,
        unitCost,
        sellingPrice,
        'Opening batch for existing stock, created to record an expiration date',
        plan.openingBatch.expirationDate,
      ]
    );
  }

  // products.expiration_date is a cache, never written directly — this derives
  // it from whichever batches now hold stock, so clearing the soonest date
  // promotes the next one instead of leaving a stale value behind.
  await refreshProductExpirationCache(productId, connection);

  return { updated: plan.batchUpdates.length, openingBatchId };
}
