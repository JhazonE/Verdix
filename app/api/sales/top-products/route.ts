import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/mysql';
import { backofficeInvoiceSql } from '@/lib/backoffice-sales';
import { posSaleSql } from '@/lib/pos-sales';

export const dynamic = 'force-dynamic';

/**
 * Top products by quantity sold (all time).
 *
 * POS sales come from sale_items under a non-void, non-training sale, and
 * RETURN lines (negative quantity) net against them; back-office invoices are
 * added from sales_invoice_items. Same scope as Sales by Product.
 *
 * This used to read sales_invoices whole with `status != 'Voided'`. The POS
 * mirror rows in that table are never voided or reduced by a return, so the
 * chart counted voided sales and ignored returns.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '5');

    const sql = `
      SELECT product_id, MAX(name) AS name, SUM(quantity) AS quantity, SUM(revenue) AS total_revenue
      FROM (
        SELECT si.product_id, si.product_name AS name, si.quantity, si.quantity * si.price AS revenue
        FROM sale_items si
        JOIN sales_transactions st ON si.sale_id = st.id
        WHERE ${posSaleSql('st')}
        UNION ALL
        SELECT sii.product_id, sii.product_name, sii.quantity, sii.quantity * sii.price
        FROM sales_invoice_items sii
        JOIN sales_invoices sinv ON sii.sales_invoice_id = sinv.id
        WHERE ${backofficeInvoiceSql('sinv')}
      ) sold
      GROUP BY product_id
      HAVING SUM(quantity) > 0
      ORDER BY quantity DESC
      LIMIT ?
    `;

    const rows = await query(sql, [limit]);

    // Assign colors dynamically for the chart
    const data = rows.map((row: any, index: number) => ({
      name: row.name,
      quantity: parseFloat(row.quantity),
      totalRevenue: parseFloat(row.total_revenue),
      fill: `var(--chart-${index + 1})`, // cycle through chart-1 to chart-5
    }));

    return NextResponse.json({
      success: true,
      data: data,
    });
  } catch (error) {
    console.error('Error fetching top products:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch top products' },
      { status: 500 }
    );
  }
}
