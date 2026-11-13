import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/mysql';
import { backofficeInvoiceSql } from '@/lib/backoffice-sales';
import { posSaleSql } from '@/lib/pos-sales';
import { lineDateExpr } from '@/lib/profit';

export const dynamic = 'force-dynamic';

/**
 * This month's sales by product category.
 *
 * Same scope as the other sales reports, so the slices add up to this month's
 * revenue on the dashboard and Sales by Date: POS sale_items under non-void,
 * non-training sales, RETURN lines netted in the month they were returned,
 * plus back-office invoices by invoice_date.
 *
 * This used to read sales_invoices whole with `status != 'Voided'`. The POS
 * mirror rows there are never voided or reduced by a return, so voided sales
 * showed as revenue and returns were ignored.
 */
export async function GET(_request: NextRequest) {
  try {
    const lineDate = lineDateExpr('si', 'st.invoice_date');
    const thisMonth = (expr: string) =>
      `${expr} >= DATE_FORMAT(CURDATE(), '%Y-%m-01') AND ${expr} < DATE_FORMAT(CURDATE(), '%Y-%m-01') + INTERVAL 1 MONTH`;

    const sql = `
      SELECT category, SUM(sales) AS total_sales FROM (
        SELECT COALESCE(NULLIF(p.category, ''), 'Uncategorized') AS category, si.quantity * si.price AS sales
        FROM sale_items si
        JOIN sales_transactions st ON si.sale_id = st.id
        JOIN products p ON si.product_id = p.id
        WHERE ${posSaleSql('st')} AND ${thisMonth(`DATE(${lineDate})`)}
        UNION ALL
        SELECT COALESCE(NULLIF(p.category, ''), 'Uncategorized'), sii.quantity * sii.price
        FROM sales_invoice_items sii
        JOIN sales_invoices sinv ON sii.sales_invoice_id = sinv.id
        JOIN products p ON sii.product_id = p.id
        WHERE ${backofficeInvoiceSql('sinv')} AND ${thisMonth('DATE(sinv.invoice_date)')}
      ) c
      GROUP BY category
      ORDER BY total_sales DESC
    `;

    const rows = await query(sql);

    const data = rows.map((row: any, index: number) => ({
      category: row.category,
      sales: parseFloat(row.total_sales),
      fill: `var(--chart-${(index % 5) + 1})`,
    }));

    return NextResponse.json({
      success: true,
      data: data,
    });
  } catch (error) {
    console.error('Error fetching monthly sales by category:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch monthly sales data' },
      { status: 500 }
    );
  }
}
