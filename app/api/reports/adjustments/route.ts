import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/mysql';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '10');
    const offset = (page - 1) * limit;

    let baseSql = `
      FROM stock_adjustments sa
      LEFT JOIN products p ON sa.product_id = p.id
    `;

    const conditions = [];
    const params = [];

    if (startDate) {
      conditions.push('DATE(sa.created_at) >= ?');
      params.push(startDate);
    }

    if (endDate) {
      conditions.push('DATE(sa.created_at) <= ?');
      params.push(endDate);
    }

    if (conditions.length > 0) {
      baseSql += ' WHERE ' + conditions.join(' AND ');
    }

    // Pagination Count
    const countSql = `SELECT COUNT(*) as total ${baseSql}`;
    const [countResult] = await query(countSql, params);
    const totalItems = countResult.total;
    const totalPages = Math.ceil(totalItems / limit);

    let sql = `
      SELECT 
        sa.id,
        sa.product_id,
        sa.quantity,
        sa.reason,
        sa.new_stock,
        sa.created_at,
        p.name as product_name,
        p.barcode,
        p.unit_of_measure
      ${baseSql}
      ORDER BY sa.created_at DESC
      LIMIT ? OFFSET ?
    `;

    const adjustments = await query(sql, [...params, limit, offset]);

    return NextResponse.json({
      success: true,
      data: adjustments,
      pagination: {
        page,
        limit,
        totalItems,
        totalPages
      }
    });

  } catch (error: any) {
    console.error('Error fetching adjustments report:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch adjustments report' },
      { status: 500 }
    );
  }
}
