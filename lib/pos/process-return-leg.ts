import mysql from 'mysql2/promise';
import { baseQuantity, getBaseUnit } from '../selling-units';
import { updateStockAndRecordMovement } from '../stock-movements';

export interface ReturnLegItem {
  productId: string;
  productName: string;
  quantity: number;
  price: number;
  sellingUnitId?: string | null;
  sellingUnitName?: string | null;
  sellingUnitFactor?: number | null;
}

export interface ReturnLegResult {
  saleItemId: string;
  unitId: string | null;
  unitName: string | null;
  factor: number;
}

/**
 * Restores one returned line to stock: resolves the selling unit it was
 * originally sold in, writes the negative sale_items row, and adds the
 * quantity back via updateStockAndRecordMovement.
 *
 * Extracted from app/api/sales/returns/route.ts so /api/sales/exchanges can
 * reuse the exact same selling-unit resolution rules without a second copy
 * drifting from this one. Behavior must stay identical to the original
 * inline loop this replaced.
 */
export async function processReturnLeg(
  connection: mysql.PoolConnection,
  params: {
    saleId: string;
    item: ReturnLegItem;
    posTransId: string;
    itemIndex: number;
  }
): Promise<ReturnLegResult> {
  const { saleId, item, posTransId, itemIndex } = params;
  const saleItemId = `${posTransId}-ITEM-${itemIndex + 1}`;

  const returnedQty = Number(item.quantity);
  if (!Number.isFinite(returnedQty)) {
    throw new Error(`Invalid return quantity for product ${item.productId}: ${item.quantity}`);
  }

  let unitId: string | null = item.sellingUnitId ?? null;
  let unitName: string | null = item.sellingUnitName ?? null;
  let factor = Number(item.sellingUnitFactor ?? 0);

  const [originalLines]: any = unitId
    ? await connection.query(
        `SELECT selling_unit_id, selling_unit_name, selling_unit_factor
         FROM sale_items
         WHERE sale_id = ? AND product_id = ? AND quantity > 0
           AND selling_unit_id = ?
         ORDER BY created_at ASC`,
        [saleId, item.productId, unitId]
      )
    : await connection.query(
        `SELECT selling_unit_id, selling_unit_name, selling_unit_factor
         FROM sale_items
         WHERE sale_id = ? AND product_id = ? AND quantity > 0
         ORDER BY created_at ASC`,
        [saleId, item.productId]
      );

  if (originalLines && originalLines.length > 0) {
    if (!unitId) {
      const distinctFactors = Array.from(
        new Set(originalLines.map((r: any) => Number(r.selling_unit_factor ?? 1)))
      );
      if (distinctFactors.length > 1) {
        console.warn(
          `[Returns] Ambiguous selling unit for product ${item.productId} on sale ${saleId}: ` +
          `the sale has lines in ${distinctFactors.length} different units (factors ` +
          `${distinctFactors.join(', ')}). No sellingUnitId was supplied, so the OLDEST line ` +
          `(factor ${Number(originalLines[0].selling_unit_factor ?? 1)}) was used to restore stock. ` +
          `Supply sellingUnitId on the return line to choose explicitly.`
        );
      }
    }

    const line = originalLines[0];
    const recordedFactor = Number(line.selling_unit_factor ?? 1);
    if (Number.isFinite(recordedFactor) && recordedFactor > 0) {
      unitId = line.selling_unit_id ?? unitId;
      unitName = line.selling_unit_name ?? unitName;
      factor = recordedFactor;
    }
  }

  if ((!Number.isFinite(factor) || factor <= 0) && unitId) {
    const [namedUnit]: any = await connection.query(
      'SELECT id, name, factor FROM product_selling_units WHERE id = ? AND product_id = ? LIMIT 1',
      [unitId, item.productId]
    );
    if (namedUnit && namedUnit.length > 0) {
      const namedFactor = Number(namedUnit[0].factor);
      if (Number.isFinite(namedFactor) && namedFactor > 0) {
        unitName = namedUnit[0].name ?? unitName;
        factor = namedFactor;
      }
    } else {
      throw new Error(
        `Unknown selling unit ${unitId} for product ${item.productId} on return for sale ${saleId}`
      );
    }
  }

  if (!Number.isFinite(factor) || factor <= 0) {
    const base = await getBaseUnit(item.productId, connection);
    if (base) {
      unitId = base.id;
      unitName = base.name;
      factor = base.factor;
    } else {
      unitId = unitId ?? null;
      unitName = unitName ?? null;
      factor = 1;
    }
  }

  const insertSaleItemSql = `
    INSERT INTO sale_items (
      id, sale_id, product_id, product_name, quantity, price,
      selling_unit_id, selling_unit_name, selling_unit_factor, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
  `;
  await connection.query(insertSaleItemSql, [
    saleItemId,
    saleId,
    item.productId,
    item.productName,
    -returnedQty,
    item.price,
    unitId,
    unitName,
    factor,
  ]);

  const [soldProdResult]: any = await connection.query(
    'SELECT id, name FROM products WHERE id = ?',
    [item.productId]
  );

  if (soldProdResult && soldProdResult.length > 0) {
    const soldProd = soldProdResult[0];
    await updateStockAndRecordMovement(
      soldProd.id,
      baseQuantity(returnedQty, factor),
      'return',
      posTransId,
      'return',
      `Return for Sale: ${saleId}${factor !== 1 ? ` (${returnedQty} × ${unitName})` : ''}`,
      connection
    );
  }

  return { saleItemId, unitId, unitName, factor };
}
