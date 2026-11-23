import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/mysql';

// Stock value = stock × cost, the same basis as /api/reports/cost-vs-retail
// (which the Inventory report page now reads). This used to take the
// remaining-batch value when a product had batches, so the two reports put a
// different value on the same stock.
const COST_VALUE_EXPR = `(p.stock * COALESCE(p.cost, 0))`;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');
    const lowStock = searchParams.get('lowStock');
    const search = searchParams.get('search');

    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '10');
    const offset = (page - 1) * limit;

    let baseSql = `
      FROM products p
    `;

    const conditions = [];
    const params = [];

    // Services are excluded: they have no stock, so they would otherwise appear
    // permanently out-of-stock and drag inventory valuation totals to zero.
    conditions.push("p.type = 'standard'");

    if (category && category !== 'all') {
      conditions.push('p.category = ?');
      params.push(category);
    }

    if (lowStock === 'true') {
      conditions.push('p.stock > 0 AND (p.stock < p.reorder_point OR p.stock < (SELECT COALESCE(low_stock_threshold, 0) FROM pos_settings LIMIT 1))');
    }

    if (search) {
      conditions.push('(p.name LIKE ? OR p.barcode LIKE ?)');
      const searchVal = `%${search}%`;
      params.push(searchVal, searchVal);
    }

    if (conditions.length > 0) {
      baseSql += ' WHERE ' + conditions.join(' AND ');
    }

    // Get Total Count for Pagination
    const countSql = `SELECT COUNT(*) as total ${baseSql}`;
    const [countResult] = await query(countSql, params);
    const totalItems = countResult.total;
    const totalPages = Math.ceil(totalItems / limit);

    // Get Data with Pagination
    let sql = `
      SELECT
        p.id,
        p.name,
        p.barcode,
        p.category,
        p.brand,
        -- Each warehouse keeps its own row for the same item, so the
        -- warehouse is what tells two same-named, same-barcode rows apart.
        (SELECT w.name FROM warehouses w WHERE w.id = p.warehouse_id) AS warehouse_name,
        p.stock,
        p.unit_of_measure,
        p.cost,
        p.price,
        p.reorder_point,
        ${COST_VALUE_EXPR} as total_value
      ${baseSql}
      ORDER BY p.name ASC
      LIMIT ? OFFSET ?
    `;

    const products = await query(sql, [...params, limit, offset]);

    // Calculate Global Totals (need separate query without pagination if we want accurate totals for ALL items, not just current page)
    // However, usually detailed reports want totals for EVERYTHING.
    // So we effectively need to run a sum query over the filtered set.
    
    let sumSql = `
      SELECT 
        COUNT(*) as totalItems,
        SUM(p.stock) as totalStock,
        SUM(
          ${COST_VALUE_EXPR}
        ) as totalValue
      ${baseSql}
    `;
    const [summaryResult] = await query(sumSql, params);
    
    return NextResponse.json({
      success: true,
      data: products,
      pagination: {
        page,
        limit,
        totalItems,
        totalPages
      },
      summary: {
        totalItems: summaryResult.totalItems || 0,
        totalStock: Number(summaryResult.totalStock) || 0,
        totalValue: Number(summaryResult.totalValue) || 0
      }
    });

  } catch (error: any) {
    console.error('Error fetching inventory report:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch inventory report' },
      { status: 500 }
    );
  }
}
