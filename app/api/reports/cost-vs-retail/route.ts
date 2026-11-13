import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/mysql';

import { profitOf, marginPct as marginPctOf } from '@/lib/profit';

// Cost of the stock on hand = stock × cost, for EVERY product. This used to
// take the remaining-batch value when a product had any batch rows
// and stock × cost otherwise, so products on the same screen were costed on two
// different bases (₱2,695 apart on the live data, and a batch's remaining qty
// can disagree with products.stock, e.g. after a return). Profit here is simply
// retail − cost.
const COST_VALUE_EXPR = `(p.stock * COALESCE(p.cost, 0))`;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');

    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '10');
    const offset = (page - 1) * limit;

    let baseSql = `
      FROM products p
    `;

    const conditions: string[] = [];
    const params: any[] = [];

    // Services are excluded: they carry no stock, so they would otherwise pad
    // this valuation report with zero-value rows and inflate totalItems.
    conditions.push("p.type = 'standard'");

    if (category && category !== 'all') {
      conditions.push('p.category = ?');
      params.push(category);
    }

    if (conditions.length > 0) {
      baseSql += ' WHERE ' + conditions.join(' AND ');
    }

    // Total count for pagination
    const countSql = `SELECT COUNT(*) as total ${baseSql}`;
    const [countResult] = await query(countSql, params);
    const totalItems = countResult.total;
    const totalPages = Math.ceil(totalItems / limit);

    // Paginated rows
    const sql = `
      SELECT
        p.id, p.name, p.barcode, p.category, p.brand,
        p.stock, p.unit_of_measure, p.cost, p.price,
        ${COST_VALUE_EXPR} as cost_value,
        (p.stock * COALESCE(p.price, 0)) as retail_value,
        (p.stock * COALESCE(p.price, 0)) - ${COST_VALUE_EXPR} as profit
      ${baseSql}
      ORDER BY p.name ASC
      LIMIT ? OFFSET ?
    `;
    const products = await query(sql, [...params, limit, offset]);

    // Grand totals over the whole filtered set
    const sumSql = `
      SELECT
        COUNT(*) as totalItems,
        SUM(${COST_VALUE_EXPR}) as totalCostValue,
        SUM(p.stock * COALESCE(p.price, 0)) as totalRetailValue
      ${baseSql}
    `;
    const [summaryResult] = await query(sumSql, params);

    const totalCostValue = Number(summaryResult.totalCostValue) || 0;
    const totalRetailValue = Number(summaryResult.totalRetailValue) || 0;
    const totalProfit = profitOf(totalRetailValue, totalCostValue);
    const marginPct = marginPctOf(totalRetailValue, totalCostValue);

    return NextResponse.json({
      success: true,
      data: products,
      pagination: { page, limit, totalItems, totalPages },
      summary: {
        totalItems: summaryResult.totalItems || 0,
        totalCostValue,
        totalRetailValue,
        totalProfit,
        marginPct,
      },
    });
  } catch (error: any) {
    console.error('Error fetching cost vs retail report:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch cost vs retail report' },
      { status: 500 }
    );
  }
}
