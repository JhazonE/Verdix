/**
 * lib/batch-deduction.ts
 *
 * FIFO Batch Deduction Utility
 *
 * Deducts sold quantity from inventory_batches in oldest-first (FIFO) order.
 * Returns the batch split breakdown and the weighted average cost for the sale.
 *
 * Behaviour is controlled by two pos_settings:
 *   batch_costing_oversell_block:
 *     0 (default) → If batches are exhausted before qty is filled, use products.cost as fallback
 *     1           → Throw an error and block the sale
 */

import mysql from 'mysql2/promise';

export interface BatchSplit {
  batchId: string;
  qty: number;
  unitCost: number;
  type: 'batch' | 'fallback';
}

export interface DeductionResult {
  splits: BatchSplit[];
  weightedAvgCost: number;
  /**
   * True when NO cost could be established for any part of this deduction —
   * no batch carried a cost and `products.cost` was NULL/absent.
   *
   * This is NOT the same as a weighted average of 0. A product deliberately
   * costed at 0 is a known cost; an unknown cost is missing data. The caller
   * must store NULL rather than 0 for the latter, or the sale permanently
   * snapshots "this was free" and no later correction can ever reach it.
   */
  costUnknown: boolean;
}

/**
 * Deducts `quantity` units from the FIFO batch queue for `productId`.
 * Updates `quantity_remaining` for each consumed batch row.
 *
 * @param productId       The product whose batches to deduct from
 * @param quantity        Number of units sold
 * @param oversellBlock   If true, throw when batches run out. If false, use fallback.
 * @param connection      Active DB connection (must be inside a transaction)
 * @returns               Split breakdown + weighted average cost
 */
export async function deductFromBatches(
  productId: string,
  quantity: number,
  oversellBlock: boolean,
  connection: mysql.PoolConnection | mysql.Connection
): Promise<DeductionResult> {
  // 1. Load available batches FIFO (oldest received_date first)
  const [batches]: any = await connection.query(
    `SELECT id, quantity_remaining, unit_cost, source_type
     FROM inventory_batches
     WHERE product_id = ? AND quantity_remaining > 0
     ORDER BY received_date ASC, created_at ASC`,
    [productId]
  );

  const splits: BatchSplit[] = [];
  let remaining = quantity;
  // True once any split is priced by a cost we actually know.
  let anyKnownCost = false;

  // products.cost, read at most once. NaN = no cost on record.
  let productCost: number | undefined;
  const readProductCost = async (): Promise<number> => {
    if (productCost === undefined) {
      const [prodRows]: any = await connection.query(
        'SELECT cost FROM products WHERE id = ?',
        [productId]
      );
      // `cost || 0` would collapse NULL and 0 into the same number, and the
      // caller could no longer tell "costed at zero" from "no cost on record".
      // Keep them apart: NULL (or a non-numeric) means unknown.
      const rawCost = prodRows?.[0]?.cost;
      productCost = rawCost == null ? NaN : parseFloat(rawCost);
    }
    return productCost;
  };

  // 2. FIFO consumption
  for (const batch of batches) {
    if (remaining <= 0) break;

    const available = parseFloat(batch.quantity_remaining);
    const take = Math.min(available, remaining);

    // Deduct from this batch
    await connection.query(
      'UPDATE inventory_batches SET quantity_remaining = quantity_remaining - ?, updated_at = NOW() WHERE id = ?',
      [take, batch.id]
    );

    // A non-purchase batch at cost 0 is stock that was entered while the
    // product's cost was still blank: the "Initial Stock" batch on product
    // create, a stock adjustment, an import. Those writers have no NULL to
    // store (unit_cost is NOT NULL), so they write 0 — which does not mean
    // "this stock was free", it means "nobody said". Charging that 0 made the
    // sale snapshot cost_at_sale = 0 forever even after the cost was filled
    // in. Price such stock at the product's current cost instead.
    //
    // A PURCHASE batch at 0 is different: it was received against a PO line
    // at 0 (a supplier freebie) and is a real, deliberate cost.
    const batchCost = parseFloat(batch.unit_cost);
    const uncosted = (!Number.isFinite(batchCost) || batchCost === 0)
      && batch.source_type !== 'purchase';

    let unitCost = Number.isFinite(batchCost) ? batchCost : 0;
    if (uncosted) {
      const pc = await readProductCost();
      if (Number.isFinite(pc)) {
        unitCost = pc;
        anyKnownCost = true;
      }
    } else {
      anyKnownCost = true;
    }

    splits.push({
      batchId: batch.id,
      qty: take,
      unitCost,
      type: 'batch',
    });

    remaining -= take;
  }

  // 3. Handle oversell (remaining > 0 after all batches exhausted)
  if (remaining > 0) {
    if (oversellBlock) {
      // Throw — POS/backoffice caller will catch and reject the sale
      throw new Error(
        `Batch stock exhausted for product ${productId}. ` +
        `Batch records cover ${quantity - remaining} unit(s) but ${quantity} were requested. ` +
        `Please receive a new purchase order or disable "Block sale if batch stock exhausted" in POS Settings.`
      );
    }

    // Fallback: use current product cost from products table
    const parsed = await readProductCost();
    const fallbackKnown = Number.isFinite(parsed);
    if (fallbackKnown) anyKnownCost = true;

    splits.push({
      batchId: 'fallback',
      qty: remaining,
      unitCost: fallbackKnown ? parsed : 0,
      type: 'fallback',
    });
  }

  // 4. Compute weighted average cost across all splits
  const totalUnits = splits.reduce((s, x) => s + x.qty, 0);
  const totalCostValue = splits.reduce((s, x) => s + x.qty * x.unitCost, 0);
  const weightedAvgCost = totalUnits > 0 ? totalCostValue / totalUnits : 0;

  // Unknown only when NOTHING priced this deduction with a known cost: no
  // costed batch, and products.cost was empty both for the fallback and for
  // any uncosted batch. If anything did, the weighted average is a genuine
  // figure and must be snapshotted as-is.
  const costUnknown = splits.length > 0 && !anyKnownCost;

  return { splits, weightedAvgCost, costUnknown };
}

/**
 * Reads the two batch costing settings from pos_settings.
 * Returns safe defaults if the row/columns don't exist yet.
 */
export async function getBatchCostingSettings(
  connection: mysql.PoolConnection | mysql.Connection
): Promise<{ repackInherit: boolean; oversellBlock: boolean }> {
  try {
    const [rows]: any = await connection.query(
      `SELECT batch_costing_repack_inherit, batch_costing_oversell_block
       FROM pos_settings LIMIT 1`
    );
    if (!rows || rows.length === 0) return { repackInherit: true, oversellBlock: false };
    return {
      repackInherit: rows[0].batch_costing_repack_inherit !== 0,
      oversellBlock: rows[0].batch_costing_oversell_block === 1,
    };
  } catch {
    // Columns may not exist yet on first boot before migration runs
    return { repackInherit: true, oversellBlock: false };
  }
}
