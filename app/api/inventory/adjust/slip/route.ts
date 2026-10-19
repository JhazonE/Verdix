import { NextRequest, NextResponse } from 'next/server';

import { query } from '@/lib/mysql';

/**
 * Rebuilds the printable slip for an ALREADY-COMMITTED bulk stock adjustment,
 * so a transaction can be reprinted long after the screen that created it is
 * gone.
 *
 * Two kinds of batch reach this route, because the two modes are stored
 * differently and always have been:
 *
 *  - `batchId`    — an add/remove batch, grouped by `stock_adjustments.batch_id`
 *                   (migration 141).
 *  - `transferId` — a transfer, grouped by the `inventory_transfers` header and
 *                   its `inventory_transfer_items` rows, which already modelled
 *                   a batch correctly before this feature existed.
 *
 * Also accepts `adjustmentId` for a single row, which is how adjustments made
 * before migration 141 (and every single-item adjustment path) are reprinted:
 * they have no batch to belong to.
 *
 * The figures come from what was RECORDED, never from the product's stock
 * today. `stock_adjustments.new_stock` is the stock as it stood after that
 * adjustment, so a slip reprinted months later still shows the transaction as
 * it happened rather than re-deriving it from a figure that has since moved.
 */

interface SlipItemRow {
  productName: string;
  barcode: string | null;
  unitOfMeasure: string | null;
  quantity: number;
  previousStock: number;
  reason: string | null;
  expirationDate: string | null;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const batchId = searchParams.get('batchId');
    const transferId = searchParams.get('transferId');
    const adjustmentId = searchParams.get('adjustmentId');

    if (!batchId && !transferId && !adjustmentId) {
      return NextResponse.json(
        { success: false, error: 'One of batchId, transferId or adjustmentId is required' },
        { status: 400 }
      );
    }

    // The transfer tables were created utf8mb4_unicode_ci (migration 074)
    // while warehouses/products are utf8mb4_0900_ai_ci, so joining across that
    // boundary raises ER_CANT_AGGREGATE_2COLLATIONS unless the join key is
    // cast. See the same note in the batches route.
    const COLL = 'utf8mb4_0900_ai_ci';

    // ---- Transfer: header + items already model the batch ----
    if (transferId) {
      const headerRows: any = await query(
        `SELECT t.id, t.transfer_date, t.reference, t.notes,
                src.name AS source_name, dst.name AS target_name
         FROM inventory_transfers t
         LEFT JOIN warehouses src ON src.id = t.source_warehouse_id COLLATE ${COLL}
         LEFT JOIN warehouses dst ON dst.id = t.target_warehouse_id COLLATE ${COLL}
         WHERE t.id = ?`,
        [transferId]
      );
      const header = headerRows?.[0];
      if (!header) {
        return NextResponse.json({ success: false, error: 'Transfer not found' }, { status: 404 });
      }

      const itemRows: any = await query(
        `SELECT ti.product_name, ti.quantity, ti.unit_of_measure,
                p.stock AS current_stock, su.barcode AS base_unit_barcode, p.barcode
         FROM inventory_transfer_items ti
         LEFT JOIN products p ON p.id = ti.product_id COLLATE ${COLL}
         LEFT JOIN product_selling_units su ON su.product_id = p.id AND su.is_base = 1
         WHERE ti.transfer_id = ?`,
        [transferId]
      );

      // A transfer never recorded the source stock at the time, so there is no
      // honest "previous stock" to print. Showing today's figure would date the
      // document wrongly, so both stock columns are omitted for transfers.
      const items: SlipItemRow[] = (itemRows || []).map((r: any) => ({
        productName: r.product_name,
        barcode: r.base_unit_barcode || r.barcode || null,
        unitOfMeasure: r.unit_of_measure || null,
        quantity: Number(r.quantity) || 0,
        previousStock: NaN,
        reason: null,
        expirationDate: null,
      }));

      return NextResponse.json({
        success: true,
        data: {
          mode: 'transfer',
          referenceNo: header.reference || null,
          warehouseName: header.source_name || null,
          targetWarehouseName: header.target_name || null,
          supplierName: null,
          notes: header.notes || null,
          transactionDate: header.transfer_date,
          omitStockColumns: true,
          items,
        },
      });
    }

    // ---- Add / Remove: grouped by batch_id, or one row by its own id ----
    const where = batchId ? 'sa.batch_id = ?' : 'sa.id = ?';
    const param = batchId || adjustmentId;

    const rows: any = await query(
      `SELECT sa.id, sa.quantity, sa.reason, sa.new_stock, sa.reference_no,
              sa.note, sa.adj_type, sa.created_at,
              p.name AS product_name, p.unit_of_measure,
              su.barcode AS base_unit_barcode, p.barcode,
              wh.name AS warehouse_name, twh.name AS target_warehouse_name,
              s.name AS supplier_name
       FROM stock_adjustments sa
       LEFT JOIN products p ON p.id = sa.product_id
       LEFT JOIN product_selling_units su ON su.product_id = p.id AND su.is_base = 1
       LEFT JOIN warehouses wh ON wh.id = sa.warehouse_id
       LEFT JOIN warehouses twh ON twh.id = sa.target_warehouse_id
       LEFT JOIN suppliers s ON s.id = sa.supplier_id
       WHERE ${where}
       ORDER BY sa.created_at ASC`,
      [param]
    );

    if (!rows || rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Adjustment not found' }, { status: 404 });
    }

    const first = rows[0];

    const items: SlipItemRow[] = rows.map((r: any) => {
      const qty = Number(r.quantity) || 0;
      const newStock = Number(r.new_stock) || 0;
      return {
        productName: r.product_name || 'Unknown product',
        barcode: r.base_unit_barcode || r.barcode || null,
        unitOfMeasure: r.unit_of_measure || null,
        quantity: Math.abs(qty),
        // quantity is stored signed (negative for a removal), and new_stock is
        // the figure AFTER it was applied — so the stock before it is simply
        // the difference. Reconstructed rather than stored, which keeps this
        // correct for rows written before this feature existed.
        previousStock: newStock - qty,
        reason: r.reason || null,
        expirationDate: null,
      };
    });

    return NextResponse.json({
      success: true,
      data: {
        mode: first.adj_type || 'add',
        referenceNo: first.reference_no || null,
        warehouseName: first.warehouse_name || null,
        targetWarehouseName: first.target_warehouse_name || null,
        supplierName: first.supplier_name || null,
        notes: first.note || null,
        transactionDate: first.created_at,
        items,
      },
    });
  } catch (error: any) {
    console.error('Failed to build adjustment slip:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to build adjustment slip' },
      { status: 500 }
    );
  }
}
