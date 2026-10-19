import { NextRequest, NextResponse } from 'next/server';

import { query } from '@/lib/mysql';

/**
 * Returns one adjustment TRANSACTION with its item lines, for the View Details
 * dialog in Inventory → History.
 *
 * `kind` decides how the id is resolved, because the three shapes live in
 * different places and cannot share a lookup:
 *
 *   batch    → `stock_adjustments` rows sharing a `batch_id` (migration 141)
 *   single   → one `stock_adjustments` row, by its own id
 *   transfer → `inventory_transfers` header + `inventory_transfer_items`
 *
 * Figures come from what was recorded at the time, never from the product's
 * stock today: `new_stock` is the stock after that adjustment, and the stock
 * before it is derived from the signed quantity. A transfer never recorded
 * source stock, so it reports null for both and the UI omits those columns.
 */

// The transfer tables are utf8mb4_unicode_ci (migration 074) while the rest of
// the schema is utf8mb4_0900_ai_ci; joining across needs the key cast or MySQL
// raises ER_CANT_AGGREGATE_2COLLATIONS.
const COLL = 'utf8mb4_0900_ai_ci';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const kind = searchParams.get('kind') || 'batch';

    if (!id) {
      return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 });
    }

    if (kind === 'transfer') {
      const headerRows: any = await query(
        `SELECT t.id, t.transfer_date, t.reference, t.notes, t.status,
                src.name AS source_name, dst.name AS target_name
         FROM inventory_transfers t
         LEFT JOIN warehouses src ON src.id = t.source_warehouse_id COLLATE ${COLL}
         LEFT JOIN warehouses dst ON dst.id = t.target_warehouse_id COLLATE ${COLL}
         WHERE t.id = ?`,
        [id]
      );
      const header = headerRows?.[0];
      if (!header) {
        return NextResponse.json({ success: false, error: 'Transfer not found' }, { status: 404 });
      }

      const itemRows: any = await query(
        `SELECT ti.product_name, ti.quantity, ti.unit_of_measure,
                su.barcode AS base_unit_barcode, p.barcode
         FROM inventory_transfer_items ti
         LEFT JOIN products p ON p.id = ti.product_id COLLATE ${COLL}
         LEFT JOIN product_selling_units su ON su.product_id = p.id AND su.is_base = 1
         WHERE ti.transfer_id = ?`,
        [id]
      );

      return NextResponse.json({
        success: true,
        data: {
          id: header.id,
          kind: 'transfer',
          mode: 'transfer',
          transactionDate: header.transfer_date,
          referenceNo: header.reference || null,
          notes: header.notes || null,
          warehouseName: header.source_name || null,
          targetWarehouseName: header.target_name || null,
          supplierName: null,
          // Source stock at the time was never recorded for transfers.
          hasStockFigures: false,
          items: (itemRows || []).map((r: any) => ({
            productName: r.product_name,
            barcode: r.base_unit_barcode || r.barcode || null,
            unitOfMeasure: r.unit_of_measure || null,
            quantity: Number(r.quantity) || 0,
            previousStock: null,
            newStock: null,
            reason: null,
          })),
        },
      });
    }

    const where = kind === 'single' ? 'sa.id = ?' : 'sa.batch_id = ?';

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
      [id]
    );

    if (!rows || rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Transaction not found' }, { status: 404 });
    }

    const first = rows[0];

    return NextResponse.json({
      success: true,
      data: {
        id,
        kind,
        mode: first.adj_type || 'add',
        transactionDate: first.created_at,
        referenceNo: first.reference_no || null,
        notes: first.note || null,
        warehouseName: first.warehouse_name || null,
        targetWarehouseName: first.target_warehouse_name || null,
        supplierName: first.supplier_name || null,
        hasStockFigures: true,
        items: rows.map((r: any) => {
          const qty = Number(r.quantity) || 0;
          const newStock = Number(r.new_stock) || 0;
          return {
            productName: r.product_name || 'Unknown product',
            barcode: r.base_unit_barcode || r.barcode || null,
            unitOfMeasure: r.unit_of_measure || null,
            // Signed in the DB (negative for a removal); the UI shows the
            // direction from `mode`, so the magnitude is what it needs.
            quantity: Math.abs(qty),
            previousStock: newStock - qty,
            newStock,
            // Bulk rows carry the batch memo in `reason`, which the dialog
            // already shows once in its Notes block; only a genuinely
            // per-item reason is worth repeating on the line.
            reason: r.reason && r.reason !== r.note ? r.reason : null,
          };
        }),
      },
    });
  } catch (error: any) {
    console.error('Failed to load adjustment transaction:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to load transaction' },
      { status: 500 }
    );
  }
}
