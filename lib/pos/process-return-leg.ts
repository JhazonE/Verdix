import mysql from 'mysql2/promise';
import { baseQuantity, getBaseUnit } from '../selling-units';
import { updateStockAndRecordMovement } from '../stock-movements';
import { applyRegistrationToTaxType } from '../tax-utils';

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
  /**
   * Tax bucket of the ORIGINAL sale line, so the return reverses exactly what
   * the sale booked; falls back to the store's registration when there is no
   * original line to copy. Callers MUST write it to pos_transaction_items:
   * left out, the column default ('VAT') made a return of a NON_VAT line book
   * negative VAT that the sale never charged, driving VAT negative on the
   * readings and the Sales by Tax Type report.
   */
  taxType: string;
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
        `SELECT selling_unit_id, selling_unit_name, selling_unit_factor, cost_at_sale,
                (SELECT pti.tax_type FROM pos_transaction_items pti
                  WHERE pti.sale_item_id = sale_items.id LIMIT 1) AS tax_type
         FROM sale_items
         WHERE sale_id = ? AND product_id = ? AND quantity > 0
           AND selling_unit_id = ?
         ORDER BY created_at ASC`,
        [saleId, item.productId, unitId]
      )
    : await connection.query(
        `SELECT selling_unit_id, selling_unit_name, selling_unit_factor, cost_at_sale,
                (SELECT pti.tax_type FROM pos_transaction_items pti
                  WHERE pti.sale_item_id = sale_items.id LIMIT 1) AS tax_type
         FROM sale_items
         WHERE sale_id = ? AND product_id = ? AND quantity > 0
         ORDER BY created_at ASC`,
        [saleId, item.productId]
      );

  // The original line's cost snapshot, already per SELLING unit. A return must
  // reverse the cost the sale recorded: left NULL, reports fall back to today's
  // products.cost, so a cost change between the sale and the return would make
  // the return reverse a different amount than the sale booked and skew profit.
  // NULL (an old line with no snapshot) keeps the existing fallback.
  let costAtSale: number | null = null;
  let taxType: string | null = null;

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
    costAtSale = line.cost_at_sale != null ? Number(line.cost_at_sale) : null;
    taxType = line.tax_type ?? null;
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
      selling_unit_id, selling_unit_name, selling_unit_factor, cost_at_sale, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
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
    costAtSale,
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

  // No original line to copy from (or it predates tax_type): resolve the way
  // checkout would for an ordinary line, so a NON_VAT store never books VAT.
  if (!taxType) {
    const [settings]: any = await connection.query(
      'SELECT vat_registration FROM pos_settings LIMIT 1'
    );
    taxType = applyRegistrationToTaxType('VAT', settings?.[0]?.vat_registration || 'VAT');
  }

  return { saleItemId, unitId, unitName, factor, taxType };
}
