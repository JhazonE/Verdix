import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/mysql';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const search = searchParams.get('search');

    let sql = `
      SELECT 
        poi.product_id as productId,
        poi.product_name as productName,
        su.barcode as baseUnitBarcode,
        p.barcode,
        p.category,
        p.brand,
        p.unit_of_measure as uom,
        SUM(poi.quantity) as totalQuantity,
        SUM(poi.quantity * COALESCE(ib.unit_cost, poi.cost)) as totalCost,
        AVG(COALESCE(ib.unit_cost, poi.cost)) as avgCost
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
