import mysql from 'mysql2/promise';
import { baseQuantity, getBaseUnit, type SellingUnit } from '../selling-units';
import { updateStockAndRecordMovement } from '../stock-movements';
import { deductFromBatches } from '../batch-deduction';
import { isService } from '../product-type';

export interface SaleLegItem {
  id: string;
  name: string;
  quantity: number;
  price: number;
  discount?: number;
  sellingUnitId?: string | null;
  sellingUnitName?: string | null;
  sellingUnitFactor?: number | null;
  /**
   * The price level a cashier deliberately picked for this line in the POS
   * Edit Price dialog. Absent on an ordinary line, which is priced by the
   * cart-wide level or a quantity tier.
   *
   * The NAME is carried alongside the id and stored denormalised, exactly as
   * `sellingUnitName` is: a level later renamed or deleted must not change
   * what a filed receipt meant.
   */
  priceLevelId?: string | null;
  priceLevelName?: string | null;
}

export interface SaleLegResult {
  itemId: string;
  unitId: string | null;
  unitName: string | null;
  factor: number;
  costAtSale: number | null;
  batchSource: string | null;
  isServiceItem: boolean;
}

/**
 * Sells one line: resolves its selling unit, runs FIFO batch costing, writes
 * the sale_items row, and deducts stock.
 *
 * Extracted from app/api/pos/checkout/route.ts's per-item loop so
 * /api/sales/exchanges can sell the replacement item through the exact same
 * batch-costing path as a normal checkout. Deliberately excludes loyalty
 * points accrual — checkout/route.ts still owns that separately, since the
 * exchange's sale leg must not earn points (spec: no loyalty on exchange v1).
 */
export async function processSaleLeg(
  connection: mysql.PoolConnection,
  params: {
    item: SaleLegItem;
    saleId: string;
    itemIndex: number;
    oversellBlock: boolean;
    /**
     * Rows a caller selling a whole cart has already fetched in bulk, so this
     * function doesn't repeat a round trip per line. Both are optional and
     * purely a latency optimisation: when a map is absent, or simply has no
     * entry for this product, the per-item query below runs exactly as before.
     * Callers selling a single line (exchanges) pass neither.
     */
    prefetched?: {
      products?: Map<string, any>;
      baseUnits?: Map<string, SellingUnit>;
    };
  }
): Promise<SaleLegResult> {
  const { item, saleId, itemIndex, oversellBlock, prefetched } = params;
  const itemId = `${saleId}-ITEM-${itemIndex + 1}`;

  let soldProd = prefetched?.products?.get(String(item.id));
  if (!soldProd) {
    const [soldProdResult]: any = await connection.query(`
      SELECT
        p.id, p.parent_id, p.unit_of_measure, p.name, p.stock, p.type, p.cost,
        c.markup_percentage, p.category, p.earns_points
      FROM products p
      LEFT JOIN categories c ON p.category = c.name
      WHERE p.id = ?
    `, [item.id]);
    soldProd = soldProdResult?.[0];
  }
  const itemIsService = soldProd ? isService(soldProd) : false;

  let unitId: string | null = item.sellingUnitId ?? null;
  let unitName: string | null = item.sellingUnitName ?? null;
  let factor = Number(item.sellingUnitFactor ?? 0);

  if (soldProd && !itemIsService) {
    if (!unitId || !Number.isFinite(factor) || factor <= 0) {
      // A prefetched miss is NOT proof of absence (the caller may simply not
      // have asked for this product), so fall back to the single-row lookup
      // before concluding the product has no base unit — that conclusion
      // throws and must never be reached on a cache miss alone.
      const base =
        prefetched?.baseUnits?.get(String(soldProd.id)) ??
        (await getBaseUnit(soldProd.id, connection));
      if (!base) {
        throw new Error(
          `Product ${soldProd.id} has no base selling unit — cannot record this sale.`
        );
      }
      unitId = base.id;
      unitName = base.name;
      factor = base.factor;
    }
  } else if (!Number.isFinite(factor) || factor <= 0) {
    unitId = unitId ?? null;
    unitName = unitName ?? null;
    factor = 1;
  }

  const soldQty = Number(item.quantity);
  if (!Number.isFinite(soldQty)) {
    throw new Error(`Invalid quantity for product ${item.id}: ${item.quantity}`);
  }
  const qtyInBase = baseQuantity(soldQty, factor);

  let costAtSale: number | null = null;
  let batchSource: string | null = null;

  if (itemIsService) {
    costAtSale = soldProd?.cost != null ? parseFloat(soldProd.cost) : 0;
    batchSource = null;
  } else {
    try {
      const deduction = await deductFromBatches(item.id, qtyInBase, oversellBlock, connection as any);
      costAtSale = deduction.weightedAvgCost * factor;
      batchSource = JSON.stringify(deduction.splits);
    } catch (batchErr: any) {
      if (batchErr.message && batchErr.message.startsWith('Batch stock exhausted')) {
        throw batchErr;
      }
      console.warn('[BatchCosting] Could not deduct batch (migration pending?):', batchErr.message);
    }
  }

  await connection.query(`
    INSERT INTO sale_items (
      id, sale_id, product_id, product_name, quantity, price, cost_at_sale, batch_source,
      selling_unit_id, selling_unit_name, selling_unit_factor,
      price_level_id, price_level_name, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
  `, [
    itemId,
    saleId,
    item.id,
    item.name,
    item.quantity,
    item.price * (1 - (item.discount || 0) / 100),
    costAtSale,
    batchSource,
    unitId,
    unitName,
    factor,
    // NULL on an ordinary line. An id with no resolvable name still writes
    // the id rather than failing the sale — a half-known record beats a lost
    // one, and the sale must never fail over a label.
    item.priceLevelId ?? null,
    item.priceLevelName ?? null,
  ]);

  if (soldProd && !itemIsService) {
    await updateStockAndRecordMovement(
      soldProd.id,
      -qtyInBase,
      'sale',
      saleId,
      'sale',
      `POS Sale: ${saleId}${factor !== 1 ? ` (${soldQty} × ${unitName})` : ''}`,
      connection
    );
  }

  return { itemId, unitId, unitName, factor, costAtSale, batchSource, isServiceItem: itemIsService };
}
