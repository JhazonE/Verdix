import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/mysql';
import { posSaleSql } from '@/lib/pos-sales';
import { backofficeInvoiceSql } from '@/lib/backoffice-sales';
import { lineDateExpr } from '@/lib/profit';
import { saleItemRevenueSql } from '@/lib/sale-item-revenue';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate'); // Default to last 30 days
    const endDate = searchParams.get('endDate');
    const type = searchParams.get('type'); // 'fast' or 'slow'
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '10');
    const offset = (page - 1) * limit;

    // Every sold line in the window, in BASE units (total_sold is ranked
    // against p.stock, which is in base units), from both places a sale lives:
    //  * POS: sale_items under a sales_transactions row that is a real sale
    //    (posSaleSql: not void/cancelled/returned, not training). A return is a
    //    negative line under the original sale, dated by when it was returned
    //    (lineDateExpr), the same as every other sales report.
    //  * Back office: sales_invoice_items of a back-office invoice
    //    (backofficeInvoiceSql). These write no sales_transactions row, so this
    //    report used to miss them entirely and list an item sold only by
    //    invoice as "not moving".
    // Revenue is quantity × price per SELLING unit; scaling it by the factor
    // would multiply a case price by the pieces in the case.
    const params: any[] = [];
    const posDate: string[] = [];
    const boDate: string[] = [];
    const posParams: any[] = [];
    const boParams: any[] = [];
    if (startDate) {
      posDate.push(`DATE(${lineDateExpr('si', 'st.created_at')}) >= ?`);
      posParams.push(startDate);
      boDate.push('DATE(sinv.invoice_date) >= ?');
      boParams.push(startDate);
    }
    if (endDate) {
      posDate.push(`DATE(${lineDateExpr('si', 'st.created_at')}) <= ?`);
      posParams.push(endDate);
      boDate.push('DATE(sinv.invoice_date) <= ?');
      boParams.push(endDate);
    }
    const soldLines = `
      SELECT si.product_id,
             si.quantity * COALESCE(si.selling_unit_factor, 1) AS base_qty,
             ${saleItemRevenueSql('si')} AS revenue
        FROM sale_items si
        JOIN sales_transactions st ON si.sale_id = st.id
       WHERE ${[posSaleSql('st'), ...posDate].join(' AND ')}
      UNION ALL
      SELECT sii.product_id,
             sii.quantity * COALESCE(sii.selling_unit_factor, 1) AS base_qty,
             sii.quantity * sii.price AS revenue
        FROM sales_invoice_items sii
        JOIN sales_invoices sinv ON sii.sales_invoice_id = sinv.id
       WHERE ${[backofficeInvoiceSql('sinv'), ...boDate].join(' AND ')}
    `;
    const soldParams = [...posParams, ...boParams];

    let baseSql = '';
    let sqlSelect = '';

    if (type === 'none') {
      baseSql = `
        FROM products p
        -- Services carry no stock, so they are never "not moving" stock.
        WHERE p.type = 'standard'
          AND p.id NOT IN (SELECT sold.product_id FROM ( ${soldLines} ) AS sold)
      `;
      params.push(...soldParams);
      sqlSelect = `
        SELECT
          p.id,
          p.name,
          p.barcode,
          p.category,
          (SELECT w.name FROM warehouses w WHERE w.id = p.warehouse_id) AS warehouse_name,
          p.stock,
          0 as total_sold,
          0 as total_revenue
      `;
    } else {
      // Fast/slow rank products that SOLD (an inner join to the sold lines);
      // unsold ones are the None tab. Services carry no stock to move.
      baseSql = `
        FROM products p
        JOIN ( ${soldLines} ) AS sold ON sold.product_id = p.id
        WHERE p.type = 'standard'
      `;
      params.push(...soldParams);
      sqlSelect = `
        SELECT
          p.id,
          p.name,
          p.barcode,
          p.category,
          (SELECT w.name FROM warehouses w WHERE w.id = p.warehouse_id) AS warehouse_name,
          p.stock,
          COALESCE(SUM(sold.base_qty), 0) as total_sold,
          COALESCE(SUM(sold.revenue), 0) as total_revenue
      `;
    }

    const countSql = `SELECT COUNT(DISTINCT p.id) as total ${baseSql}`;
    const [countResult] = await query(countSql, params);
    const totalItems = countResult.total;
    const totalPages = Math.ceil(totalItems / limit);

    let sql = `
      ${sqlSelect}
      ${baseSql}
      GROUP BY p.id, p.name, p.barcode, p.category, p.stock
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
