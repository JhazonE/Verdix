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
        s.id as supplierId,
        s.name as supplierName,
        COUNT(po.id) as totalOrders,
        SUM(po.total) as totalSpent,
        MAX(po.date) as lastPurchaseDate
      FROM suppliers s
      JOIN purchase_orders po ON s.id = po.supplier_id
      -- A cancelled PO was never bought, so it is neither spend nor an order.
      WHERE COALESCE(po.status, '') <> 'Cancelled'
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
      sql += ' AND s.name LIKE ?';
      params.push(`%${search}%`);
    }

    sql += ' GROUP BY s.id, s.name';
    sql += ' ORDER BY totalSpent DESC';

    const results = await query(sql, params);

    return NextResponse.json({
      success: true,
      data: results.map((row: any) => ({
        ...row,
        contactPerson: null,
        totalSpent: parseFloat(row.totalSpent || '0'),
        totalOrders: parseInt(row.totalOrders || '0'),
      }))
    });

  } catch (error) {
    console.error('Error fetching Purchases by Supplier report:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch report data' },
      { status: 500 }
    );
  }
}
