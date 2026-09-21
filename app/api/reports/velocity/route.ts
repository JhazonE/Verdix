import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/mysql';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate'); // Default to last 30 days
    const endDate = searchParams.get('endDate');
    const type = searchParams.get('type'); // 'fast' or 'slow'
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '10');
    const offset = (page - 1) * limit;

    let baseSql = '';
    const params: any[] = [];
    let sqlSelect = '';

    if (type === 'none') {
      const subConditions = ["st.status != 'voided'", "st.status != 'returned'"];
      if (startDate) {
        subConditions.push('DATE(st.created_at) >= ?');
        params.push(startDate);
      }
      if (endDate) {
        subConditions.push('DATE(st.created_at) <= ?');
        params.push(endDate);
      }
      baseSql = `
        FROM products p
        WHERE p.id NOT IN (
          SELECT si.product_id
          FROM sale_items si
          JOIN sales_transactions st ON si.sale_id = st.id
          WHERE ${subConditions.join(' AND ')}
        )
      `;
      sqlSelect = `
        SELECT 
          p.id,
          p.name,
          p.sku,
          p.barcode,
          p.category,
          p.stock,
          0 as total_sold,
          0 as total_revenue
      `;
    } else {
      baseSql = `
        FROM products p
        LEFT JOIN sale_items si ON p.id = si.product_id
        LEFT JOIN sales_transactions st ON si.sale_id = st.id
      `;
      const conditions = [];
      conditions.push("st.status != 'voided'");
      conditions.push("st.status != 'returned'");
      if (startDate) {
        conditions.push('DATE(st.created_at) >= ?');
        params.push(startDate);
      }
      if (endDate) {
        conditions.push('DATE(st.created_at) <= ?');
        params.push(endDate);
      }
      if (conditions.length > 0) {
        baseSql += ' WHERE ' + conditions.join(' AND ');
      }
      // total_sold is compared against p.stock (base units) to rank fast/slow
      // movers, so it must be in base units too — scale si.quantity (whatever
      // selling unit was sold) by its factor. NULL factor means base unit (1).
      sqlSelect = `
        SELECT
          p.id,
          p.name,
          p.sku,
          p.barcode,
          p.category,
          p.stock,
          COALESCE(SUM(si.quantity * COALESCE(si.selling_unit_factor, 1)), 0) as total_sold,
          COALESCE(SUM(si.quantity * si.price), 0) as total_revenue
      `;
    }

    const countSql = `SELECT COUNT(DISTINCT p.id) as total ${baseSql}`;
    const [countResult] = await query(countSql, params);
    const totalItems = countResult.total;
    const totalPages = Math.ceil(totalItems / limit);

    let sql = `
      ${sqlSelect}
      ${baseSql}
      GROUP BY p.id, p.name, p.sku, p.barcode, p.category, p.stock
    `;

    // Sort based on type
    if (type === 'none') {
      sql += ' ORDER BY p.name ASC';
    } else if (type === 'slow') {
      sql += ' ORDER BY total_sold ASC';
    } else {
      // Default fast
      sql += ' ORDER BY total_sold DESC';
    }

    sql += ' LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const products = await query(sql, params);

    return NextResponse.json({
      success: true,
      data: products,
      pagination: {
        page,
        limit,
        totalItems,
        totalPages
      }
    });

  } catch (error: any) {
    console.error('Error fetching velocity report:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch velocity report' },
      { status: 500 }
    );
  }
}
