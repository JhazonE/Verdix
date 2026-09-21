import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/mysql';
import { getFiscalYearRange, getCurrentFiscalYear, formatFiscalYear, toLocalYmd } from '@/lib/fiscal-utils';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const settingsResult = await query("SELECT fiscal_year_start_month FROM pos_settings LIMIT 1") as any[];
    const startMonth = settingsResult[0]?.fiscal_year_start_month || 1;

    const currentFiscalYear = getCurrentFiscalYear(startMonth);
    const requestedFy = parseInt(searchParams.get('fiscalYear') || '', 10);
    const fiscalYear = Number.isFinite(requestedFy) ? requestedFy : currentFiscalYear;

    const { startDate, endDate } = getFiscalYearRange(fiscalYear, startMonth);
    const startStr = toLocalYmd(startDate);
    const endStr = toLocalYmd(endDate);

    // Available fiscal years from earliest paid sale through current FY.
    const [firstSaleRow] = await query(
      "SELECT MIN(invoice_date) AS first_date FROM sales_transactions WHERE status = 'Paid'"
    ) as any[];
    const availableFiscalYears: number[] = [];
    if (firstSaleRow?.first_date) {
      const firstFy = getCurrentFiscalYear(startMonth, new Date(firstSaleRow.first_date));
      for (let y = firstFy; y <= currentFiscalYear; y++) availableFiscalYears.push(y);
    } else {
      availableFiscalYears.push(currentFiscalYear);
    }

    // Fiscal-year summary (revenue + transactions from transactions; profit from items).
    const [summaryRow] = await query(
      `SELECT
         COALESCE(SUM(st.total), 0) AS revenue,
         COUNT(*) AS transactions
       FROM sales_transactions st
       WHERE st.status = 'Paid' AND st.invoice_date >= ? AND st.invoice_date <= ?`,
      [startStr, endStr]
    ) as any[];

    // cost_at_sale is per selling unit sold. p.cost (the fallback, used when
    // batch costing hasn't run for a line) is per BASE unit, so it must be
    // scaled by the line's selling_unit_factor — NULL means base unit (1).
    const [costRow] = await query(
      `SELECT COALESCE(SUM(si.quantity * COALESCE(si.cost_at_sale, p.cost * COALESCE(si.selling_unit_factor, 1), 0)), 0) AS cost
       FROM sale_items si
       JOIN sales_transactions st ON si.sale_id = st.id
       JOIN products p ON si.product_id = p.id
       WHERE st.status = 'Paid' AND st.invoice_date >= ? AND st.invoice_date <= ?`,
      [startStr, endStr]
    ) as any[];

    const revenue = parseFloat(summaryRow.revenue);
    const transactions = parseInt(summaryRow.transactions);
    const profit = revenue - parseFloat(costRow.cost);

    // Per-calendar-month revenue/transactions.
    const monthlyRevRows = await query(
      `SELECT DATE_FORMAT(st.invoice_date, '%Y-%m') AS ym,
              COALESCE(SUM(st.total), 0) AS revenue,
              COUNT(*) AS transactions
       FROM sales_transactions st
       WHERE st.status = 'Paid' AND st.invoice_date >= ? AND st.invoice_date <= ?
       GROUP BY DATE_FORMAT(st.invoice_date, '%Y-%m')`,
      [startStr, endStr]
    ) as any[];

    // Per-calendar-month cost (profit = that month's revenue - cost).
    const monthlyCostRows = await query(
      `SELECT DATE_FORMAT(st.invoice_date, '%Y-%m') AS ym,
              COALESCE(SUM(si.quantity * COALESCE(si.cost_at_sale, p.cost * COALESCE(si.selling_unit_factor, 1), 0)), 0) AS cost
       FROM sale_items si
       JOIN sales_transactions st ON si.sale_id = st.id
       JOIN products p ON si.product_id = p.id
       WHERE st.status = 'Paid' AND st.invoice_date >= ? AND st.invoice_date <= ?
       GROUP BY DATE_FORMAT(st.invoice_date, '%Y-%m')`,
      [startStr, endStr]
    ) as any[];

    const revByYm = new Map<string, { revenue: number; transactions: number }>();
    for (const r of monthlyRevRows) revByYm.set(r.ym, { revenue: parseFloat(r.revenue), transactions: parseInt(r.transactions) });
    const costByYm = new Map<string, number>();
    for (const r of monthlyCostRows) costByYm.set(r.ym, parseFloat(r.cost));

    // Build 12 fiscal periods in order, each mapped to its actual calendar month.
    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const months = [];
    for (let period = 0; period < 12; period++) {
      const d = new Date(fiscalYear, (startMonth - 1) + period, 1);
      const y = d.getFullYear();
      const m = d.getMonth(); // 0-11
      const ym = `${y}-${String(m + 1).padStart(2, '0')}`;
      const rev = revByYm.get(ym) || { revenue: 0, transactions: 0 };
      months.push({
        period: period + 1,
        monthLabel: `${MONTHS[m]} ${y}`,
        revenue: rev.revenue,
        transactions: rev.transactions,
        profit: rev.revenue - (costByYm.get(ym) || 0),
      });
    }

    return NextResponse.json({
      success: true,
      fiscalYear,
      fiscalStartMonth: startMonth,
      label: formatFiscalYear(fiscalYear, startMonth),
      availableFiscalYears,
      summary: {
        revenue,
        transactions,
        profit,
        avgTransaction: transactions > 0 ? revenue / transactions : 0,
      },
      months,
    });
  } catch (error: any) {
    console.error('Error fetching fiscal year report:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch fiscal year report' }, { status: 500 });
  }
}
