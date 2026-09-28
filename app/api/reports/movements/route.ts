import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/mysql';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const type = searchParams.get('type');
    const productId = searchParams.get('productId');

    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '10');
    const offset = (page - 1) * limit;

    let baseSql = `
      FROM stock_movements sm
      LEFT JOIN products p ON sm.product_id = p.id
    `;

    const conditions = [];
    const params = [];

    if (startDate) {
      conditions.push('DATE(sm.created_at) >= ?');
      params.push(startDate);
    }

    if (endDate) {
      conditions.push('DATE(sm.created_at) <= ?');
      params.push(endDate);
    }

    if (type && type !== 'all') {
      conditions.push('sm.movement_type = ?');
      params.push(type);
    }

    if (productId) {
      conditions.push('sm.product_id = ?');
      params.push(productId);
    }

    if (conditions.length > 0) {
      baseSql += ' WHERE ' + conditions.join(' AND ');
    }
    
    // Get Total Count for Pagination
    const countSql = `SELECT COUNT(*) as total ${baseSql}`;
    const [countResult] = await query(countSql, params);
    const totalItems = countResult.total;
    const totalPages = Math.ceil(totalItems / limit);

    // Get Data
    let sql = `
      SELECT 
        sm.id,
        sm.product_id,
        sm.product_name,
        sm.movement_type,
        sm.quantity_change,
        sm.previous_stock,
        sm.new_stock,
        sm.reference_id,
        sm.reference_type,
        sm.notes,
        sm.created_at,
        p.barcode,
        p.unit_of_measure
      ${baseSql}
      ORDER BY sm.created_at DESC 
      LIMIT ? OFFSET ?
    `;

    const movements = await query(sql, [...params, limit, offset]);

    return NextResponse.json({
      success: true,
      data: movements,
      pagination: {
        page,
        limit,
        totalItems,
        totalPages
      }
    });

  } catch (error: any) {
    console.error('Error fetching stock movements:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch stock movements' },
      { status: 500 }
    );
  }
}
