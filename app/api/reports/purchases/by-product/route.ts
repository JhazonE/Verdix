import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/mysql';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const search = searchParams.get('search');

    // NOTE: the inventory_batches join below is by (purchase_order_id, product_id) only —
    // inventory_batches has no selling_unit_id column, so a PO with TWO lines for the same
    // product (a Piece line and a Case line) will fan this join out to both batch rows for
    // every poi row, inflating totalCost/avgCost. This is a pre-existing limitation of this
    // report unrelated to the unit-mixing fix below (fixing it needs a schema change to add
    // selling_unit_id to inventory_batches) and is out of scope for this fix wave.
    let sql = `
      SELECT
        poi.product_id as productId,
        poi.product_name as productName,
        su.barcode as baseUnitBarcode,
        p.barcode,
        p.category,
        p.brand,
        p.unit_of_measure as uom,
        -- poi.quantity is in the LINE's own unit (e.g. Cases); convert to base-unit
        -- pieces before summing so a Case line and a Piece line for the same product
        -- don't get added together as if they were the same unit.
        SUM(poi.quantity * COALESCE(poi.selling_unit_factor, 1)) as totalQuantity,
        -- ib.unit_cost is already per-piece (its contract, per Task 3/processPurchaseOrderReceipt),
        -- so it needs no factor adjustment. poi.cost, used only as a fallback when no batch
        -- row exists yet (e.g. a Pending PO never received), is per-LINE-unit (e.g. per-Case)
        -- and must be divided by the factor to become per-piece before multiplying by the
        -- now-per-piece totalQuantity — otherwise a Case line's total is inflated by the factor.
        SUM(
          poi.quantity * COALESCE(poi.selling_unit_factor, 1)
          * COALESCE(ib.unit_cost, poi.cost / COALESCE(poi.selling_unit_factor, 1))
        ) as totalCost,
        AVG(COALESCE(ib.unit_cost, poi.cost / COALESCE(poi.selling_unit_factor, 1))) as avgCost
      FROM purchase_order_items poi
      JOIN purchase_orders po ON poi.purchase_order_id = po.id
      LEFT JOIN inventory_batches ib ON poi.purchase_order_id = ib.purchase_order_id AND poi.product_id = ib.product_id
      LEFT JOIN products p ON poi.product_id = p.id
      LEFT JOIN product_selling_units su ON su.product_id = p.id AND su.is_base = 1
      WHERE 1=1
    `;
    const params: any[] = [];

    if (startDate) {
      sql += ' AND po.date >= ?';
      params.push(startDate);
    }

    if (endDate) {
      sql += ' AND po.date <= ?';
      params.push(`${endDate} 23:59:59`);
    }

    if (search) {
      sql += ' AND (poi.product_name LIKE ? OR su.barcode LIKE ? OR p.barcode LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    sql += ' GROUP BY poi.product_id, poi.product_name, su.barcode, p.barcode, p.category, p.brand, p.unit_of_measure';
    sql += ' ORDER BY totalQuantity DESC';

    const results = await query(sql, params);

    return NextResponse.json({
      success: true,
      data: results.map((row: any) => ({
        ...row,
        totalQuantity: parseInt(row.totalQuantity || '0'),
        totalCost: parseFloat(row.totalCost || '0'),
        avgCost: parseFloat(row.avgCost || '0'),
      }))
    });

  } catch (error) {
    console.error('Error fetching Purchases by Product report:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch report data' },
      { status: 500 }
    );
  }
}
