'use server';

import { v4 as uuidv4 } from 'uuid';

import { checkApprovalRequired, submitToApprovalQueue } from '@/lib/approvals';
import { query, withTransaction } from '@/lib/mysql';
import { updateStockAndRecordMovement } from '@/lib/stock-movements';
import { repackOutcome } from '@/lib/unit-quantity';

export type RepackagingLog = {
  id: string;
  sourceProductId: string;
  sourceProductName: string;
  sourceBarcode: string | null;
  sourceQty: number;
  targetProductId: string;
  targetProductName: string;
  targetBarcode: string | null;
  targetQtyProduced: number;
  factor: number;
  status: string;
  approvalQueueId: string | null;
  notes: string | null;
  direction: 'break' | 'consolidate';
  createdBy: string | null;
  createdAt: string;
  // Set for repackaging done inside one product (selling unit to selling unit).
  // Null on rows from the older two-product flow.
  sourceUnitName: string | null;
  targetUnitName: string | null;
  shortfallBaseQty: number | null;
};

export async function getRepackagingHistory(limit: number = 50, offset: number = 0): Promise<RepackagingLog[]> {
  try {
    const rows: any = await query(
      `SELECT
        rl.*,
        COALESCE(spu.barcode, sp.barcode) AS source_barcode,
        COALESCE(tpu.barcode, tp.barcode) AS target_barcode
       FROM repackaging_logs rl
       LEFT JOIN products sp ON rl.source_product_id = sp.id
       LEFT JOIN products tp ON rl.target_product_id = tp.id
       LEFT JOIN product_selling_units spu ON spu.product_id = sp.id AND spu.is_base = 1
       LEFT JOIN product_selling_units tpu ON tpu.product_id = tp.id AND tpu.is_base = 1
       ORDER BY rl.created_at DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    return (rows || []).map((r: any) => ({
      id: r.id,
      sourceProductId: r.source_product_id,
      sourceProductName: r.source_product_name,
      sourceBarcode: r.source_barcode,
      sourceQty: parseFloat(r.source_qty),
      targetProductId: r.target_product_id,
      targetProductName: r.target_product_name,
      targetBarcode: r.target_barcode,
      targetQtyProduced: parseFloat(r.target_qty_produced),
      factor: parseFloat(r.factor),
      status: r.status,
      approvalQueueId: r.approval_queue_id,
      notes: r.notes,
      direction: r.notes === 'consolidate' ? 'consolidate' : 'break',
      createdBy: r.created_by,
      createdAt: r.created_at,
      sourceUnitName: r.source_selling_unit_name ?? null,
      targetUnitName: r.target_selling_unit_name ?? null,
      shortfallBaseQty:
        r.shortfall_base_qty === null || r.shortfall_base_qty === undefined
          ? null
          : parseFloat(r.shortfall_base_qty),
    }));
  } catch (error) {
    console.error('Error fetching repackaging history:', error);
    return [];
  }
}

export async function getRepackagingHistoryCount(): Promise<number> {
  try {
    const result: any = await query('SELECT COUNT(*) as count FROM repackaging_logs');
    return result[0]?.count || 0;
  } catch (error) {
    return 0;
  }
}

export type RepackSellingUnitsInput = {
  productId: string;
  fromUnitId: string;
  toUnitId: string;
  quantity: number;
  /** Target-unit quantity actually obtained; omit to accept the conversion's prediction. */
  actualProduced?: number | null;
};

export type RepackSellingUnitsResult = {
  success: boolean;
  message: string;
  pendingApproval?: boolean;
};

/**
 * Repackage inside one product: open 2 Case into 48 Piece, or merge pieces back
 * into cases. Stock is one base-unit figure shared by every selling unit, so the
 * conversion itself moves nothing. It is recorded for the audit trail, honours
 * the REPACKAGING approval setting, and writes off any shortfall (fewer units
 * came out than the factors predict) as an adjustment with a stock movement.
 */
export async function repackSellingUnits(
  input: RepackSellingUnitsInput,
  userId: string = 'system',
  isInternalFinalization: boolean = false,
): Promise<RepackSellingUnitsResult> {
  try {
    const { productId, fromUnitId, toUnitId, quantity } = input;
    if (fromUnitId === toUnitId) {
      return { success: false, message: 'Choose two different units to repackage between.' };
    }

    const loadContext = async (run: (sql: string, params: any[]) => Promise<any[]>) => {
      const productRows = await run(
        'SELECT id, name, stock, warehouse_id FROM products WHERE id = ?',
        [productId],
      );
      const product = productRows[0];
      if (!product) throw new Error('Product not found.');
      const unitRows = await run(
        'SELECT id, name, factor FROM product_selling_units WHERE product_id = ? AND id IN (?, ?)',
        [productId, fromUnitId, toUnitId],
      );
      const from = unitRows.find((u: any) => u.id === fromUnitId);
      const to = unitRows.find((u: any) => u.id === toUnitId);
      if (!from || !to) throw new Error('Selling unit not found for this product.');
      const outcome = repackOutcome({
        quantity,
        fromFactor: Number(from.factor),
        toFactor: Number(to.factor),
        actualProduced: input.actualProduced,
      });
      return { product, from, to, outcome };
    };

    if (!isInternalFinalization) {
      const ctx = await loadContext(async (sql, params) => (await query(sql, params)) as any[]);
      if (Number(ctx.product.stock) < ctx.outcome.baseUsed) {
        return {
          success: false,
          message: `Insufficient stock of ${ctx.product.name}. Available: ${ctx.product.stock}`,
        };
      }

      if (await checkApprovalRequired('REPACKAGING')) {
        const { product, from, to, outcome } = ctx;
        const { pendingApproval } = await submitToApprovalQueue('REPACKAGING', {
          kind: 'selling_unit_repack',
          productId,
          fromUnitId,
          toUnitId,
          repackQuantity: quantity,
          actualProduced: input.actualProduced ?? null,
          // Display fields the approvals card already reads for REPACKAGING.
          sourceProductName: `${product.name} (${from.name})`,
          targetProductName: `${product.name} (${to.name})`,
          sourceUnit: from.name,
          currentStock: product.stock,
          quantity: `${quantity} ${from.name} → ${outcome.actualProduced} ${to.name}`,
          warehouseName: 'N/A',
          reason: 'Repackaging',
          items: [
            { productId, productName: product.name, sku: '', barcode: '', price: 0, cost: 0, quantity: -quantity, unit: from.name },
            { productId, productName: product.name, sku: '', barcode: '', price: 0, cost: 0, quantity: outcome.actualProduced, unit: to.name },
          ],
        }, userId);
        if (pendingApproval) {
          return { success: true, pendingApproval: true, message: 'Repackaging request submitted for approval.' };
        }
        // Every approval step auto-skipped: fall through and execute now.
      }
    }

    return await withTransaction(async (connection) => {
      const { product, from, to, outcome } = await loadContext(async (sql, params) => {
        const [rows]: any = await connection.query(sql, params);
        return rows;
      });
      if (Number(product.stock) < outcome.baseUsed) {
        throw new Error(`Insufficient stock of ${product.name}. Available: ${product.stock}`);
      }

      const logId = `rpkg_${uuidv4()}`;
      const consolidating = Number(to.factor) > Number(from.factor);
      await connection.query(
        `INSERT INTO repackaging_logs (
           id, source_product_id, source_product_name, source_qty,
           target_product_id, target_product_name, target_qty_produced, factor,
           status, notes, created_by,
           source_selling_unit_id, source_selling_unit_name, source_selling_unit_factor,
           target_selling_unit_id, target_selling_unit_name, target_selling_unit_factor,
           shortfall_base_qty
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          logId, productId, product.name, input.quantity,
          productId, product.name, outcome.actualProduced, Number(from.factor) / Number(to.factor),
          consolidating ? 'consolidate' : null, userId,
          from.id, from.name, Number(from.factor),
          to.id, to.name, Number(to.factor),
          outcome.shortfallBase,
        ],
      );

      if (outcome.shortfallBase > 0) {
        await updateStockAndRecordMovement(
          productId,
          -outcome.shortfallBase,
          'adjustment',
          logId,
          'adjustment',
          `Repackaging shortfall: ${input.quantity} ${from.name} yielded ${outcome.actualProduced} ${to.name} (expected ${outcome.expectedProduced})`,
          connection as any,
        );
      }

      const lossNote = outcome.shortfallBase > 0 ? ` ${outcome.shortfallBase} base unit(s) written off as shortfall.` : '';
      return {
        success: true,
        message: `Repackaged ${input.quantity} ${from.name} into ${outcome.actualProduced} ${to.name}.${lossNote}`,
      };
    });
  } catch (error: any) {
    console.error('Error in repackSellingUnits:', error);
    return { success: false, message: error.message || 'Failed to repackage.' };
  }
}
