import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/mysql';
import { backofficeInvoiceSql } from '@/lib/backoffice-sales';
import { posSaleSql } from '@/lib/pos-sales';
import { lineDateExpr } from '@/lib/profit';

export const dynamic = 'force-dynamic';

/**
 * Sales per hour for one day (defaults to today).
 *
 * Same definition of a sale as every other sales report, so the chart adds up
 * to the day's figure on Sales by Date and the dashboard:
 *   - POS: sale_items under a non-void, non-training sale (lib/pos-sales.ts),
 *     a RETURN line counted at the hour it was returned (lib/profit.ts);
 *   - back-office invoices (lib/backoffice-sales.ts), at the hour keyed in.
 *
 * This used to read sales_invoices whole. That table also holds the POS mirror
 * of each sale, which is never voided or reduced by a return, so the chart
 * showed a voided sale as revenue and ignored returns.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const dateParam = searchParams.get('date'); // YYYY-MM-DD, optional
    const day = dateParam ? '?' : 'CURDATE()';
    const lineTime = lineDateExpr('si', 'st.created_at');

    const sql = `
      SELECT hour, SUM(sales) AS sales, SUM(is_sale) AS count FROM (
        SELECT HOUR(${lineTime}) AS hour,
               si.price * si.quantity AS sales,
               0 AS is_sale
        FROM sale_items si
        JOIN sales_transactions st ON si.sale_id = st.id
        WHERE ${posSaleSql('st')} AND DATE(${lineTime}) = ${day}
        UNION ALL
        SELECT HOUR(st.created_at), 0, 1
        FROM sales_transactions st
        WHERE ${posSaleSql('st')} AND DATE(st.created_at) = ${day}
        UNION ALL
        SELECT HOUR(sinv.created_at), sinv.total, 1
        FROM sales_invoices sinv
        WHERE ${backofficeInvoiceSql('sinv')} AND DATE(sinv.invoice_date) = ${day}
      ) h
      GROUP BY hour
      ORDER BY hour ASC
    `;
    const params = dateParam ? [dateParam, dateParam, dateParam] : [];
    const rows = await query(sql, params);

    // Fill in missing hours with 0
    const hours = Array.from({ length: 24 }, (_, i) => i);
    const chartData = hours.map((hour) => {
      const found = rows.find((row: any) => Number(row.hour) === hour);
      return {
        hour: `${hour.toString().padStart(2, '0')}:00`,
        sales: found ? parseFloat(found.sales) : 0,
        count: found ? parseInt(found.count) : 0,
      };
    });

    return NextResponse.json({
      success: true,
      data: chartData,
    });
  } catch (error) {
    console.error('Error fetching hourly sales:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch hourly sales' },
      { status: 500 }
    );
  }
}
