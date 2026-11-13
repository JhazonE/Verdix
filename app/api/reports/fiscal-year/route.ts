import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/mysql';
import { getFiscalYearRange, getCurrentFiscalYear, formatFiscalYear, toLocalYmd } from '@/lib/fiscal-utils';
import { lineCostExpr } from '@/lib/cost-of-sale';
import { profitOf, lineDateExpr } from '@/lib/profit';
import { backofficeInvoiceSql } from '@/lib/backoffice-sales';
import { posSaleSql } from '@/lib/pos-sales';

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
    // Back-office sales invoices count too: they write sales_invoices only, so
    // a business whose earliest sale was an invoice would otherwise get no
    // fiscal year for it. See lib/backoffice-sales.ts.
    const [firstSaleRow] = await query(
      `SELECT MIN(d) AS first_date FROM (
         SELECT MIN(st.invoice_date) AS d FROM sales_transactions st WHERE ${posSaleSql('st')}
         UNION ALL
         SELECT MIN(sinv.invoice_date) FROM sales_invoices sinv WHERE ${backofficeInvoiceSql('sinv')}
       ) firsts`
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
       WHERE ${posSaleSql('st')} AND st.invoice_date >= ? AND st.invoice_date <= ?`,
      [startStr, endStr]
    ) as any[];

    // Returns: stored as NEGATIVE sale_items lines under the original sale, and
    // st.total does not shrink when one is added. Profit is net of returns (see
    // lib/profit.ts), so the returned value is taken off revenue here, on the
    // day it was returned, and the same negative lines reduce cost below. Without
    // this, revenue ignored a return while cost netted it, overstating profit.
    const [returnRow] = await query(
      `SELECT COALESCE(SUM(si.price * si.quantity), 0) AS returned
       FROM sale_items si
       JOIN sales_transactions st ON si.sale_id = st.id
       WHERE ${posSaleSql('st')} AND si.quantity < 0
         AND DATE(si.created_at) >= ? AND DATE(si.created_at) <= ?`,
      [startStr, endStr]
    ) as any[];

    // Cost resolution (snapshot first, scaled products.cost as fallback, and a
    // snapshot of 0 treated as "none recorded") lives in lib/cost-of-sale.ts.
    const saleDate = lineDateExpr('si', 'st.invoice_date');
    const [costRow] = await query(
      `SELECT COALESCE(SUM(${lineCostExpr('si', 'p', { hasCostAtSale: true })}), 0) AS cost
       FROM sale_items si
       JOIN sales_transactions st ON si.sale_id = st.id
       JOIN products p ON si.product_id = p.id
       WHERE ${posSaleSql('st')} AND DATE(${saleDate}) >= ? AND DATE(${saleDate}) <= ?`,
      [startStr, endStr]
    ) as any[];

    // BACK-OFFICE INVOICES. Sales invoices keyed in on Sales > Invoices live in
    // sales_invoices, not sales_transactions, so every query above is blind to
    // them. They add revenue, a transaction each, and cost (cost_at_sale from
    // sales_invoice_items, the same per-selling-unit snapshot the POS lines
    // use). They have no returns. A Pending invoice counts: it is a sale from
    // the day it is issued. Dated by invoice_date, as the POS lines are.
    const boWhere = `${backofficeInvoiceSql('sinv')} AND sinv.invoice_date >= ? AND sinv.invoice_date <= ?`;
    const [boSummary] = await query(
      `SELECT COALESCE(SUM(sinv.total), 0) AS revenue, COUNT(*) AS transactions
       FROM sales_invoices sinv WHERE ${boWhere}`,
      [startStr, endStr]
    ) as any[];
    const [boCost] = await query(
      `SELECT COALESCE(SUM(${lineCostExpr('sii', 'p', { hasCostAtSale: true })}), 0) AS cost
       FROM sales_invoice_items sii
       JOIN sales_invoices sinv ON sii.sales_invoice_id = sinv.id
       JOIN products p ON sii.product_id = p.id
       WHERE ${boWhere}`,
      [startStr, endStr]
    ) as any[];

    const transactions = parseInt(summaryRow.transactions) + parseInt(boSummary.transactions);
    const revenue = parseFloat(summaryRow.revenue) + parseFloat(returnRow.returned) + parseFloat(boSummary.revenue);
    const profit = profitOf(revenue, parseFloat(costRow.cost) + parseFloat(boCost.cost));

    // Per-calendar-month revenue/transactions.
    const monthlyRevRows = await query(
      `SELECT DATE_FORMAT(st.invoice_date, '%Y-%m') AS ym,
              COALESCE(SUM(st.total), 0) AS revenue,
              COUNT(*) AS transactions
       FROM sales_transactions st
       WHERE ${posSaleSql('st')} AND st.invoice_date >= ? AND st.invoice_date <= ?
       GROUP BY DATE_FORMAT(st.invoice_date, '%Y-%m')`,
      [startStr, endStr]
    ) as any[];

    // Per-calendar-month cost (profit = that month's revenue - cost).
    const monthlyCostRows = await query(
      `SELECT DATE_FORMAT(${saleDate}, '%Y-%m') AS ym,
              COALESCE(SUM(${lineCostExpr('si', 'p', { hasCostAtSale: true })}), 0) AS cost
       FROM sale_items si
       JOIN sales_transactions st ON si.sale_id = st.id
       JOIN products p ON si.product_id = p.id
       WHERE ${posSaleSql('st')} AND DATE(${saleDate}) >= ? AND DATE(${saleDate}) <= ?
       GROUP BY DATE_FORMAT(${saleDate}, '%Y-%m')`,
      [startStr, endStr]
    ) as any[];

    // Per-calendar-month returned value (negative), by the month it was returned.
    const monthlyReturnRows = await query(
      `SELECT DATE_FORMAT(si.created_at, '%Y-%m') AS ym,
              COALESCE(SUM(si.price * si.quantity), 0) AS returned
       FROM sale_items si
       JOIN sales_transactions st ON si.sale_id = st.id
       WHERE ${posSaleSql('st')} AND si.quantity < 0
         AND DATE(si.created_at) >= ? AND DATE(si.created_at) <= ?
       GROUP BY DATE_FORMAT(si.created_at, '%Y-%m')`,
      [startStr, endStr]
    ) as any[];

    // Back-office invoices per calendar month: revenue/count, and cost.
    const monthlyBoRevRows = await query(
      `SELECT DATE_FORMAT(sinv.invoice_date, '%Y-%m') AS ym,
              COALESCE(SUM(sinv.total), 0) AS revenue,
              COUNT(*) AS transactions
       FROM sales_invoices sinv
       WHERE ${boWhere}
       GROUP BY DATE_FORMAT(sinv.invoice_date, '%Y-%m')`,
      [startStr, endStr]
    ) as any[];
    const monthlyBoCostRows = await query(
      `SELECT DATE_FORMAT(sinv.invoice_date, '%Y-%m') AS ym,
              COALESCE(SUM(${lineCostExpr('sii', 'p', { hasCostAtSale: true })}), 0) AS cost
       FROM sales_invoice_items sii
       JOIN sales_invoices sinv ON sii.sales_invoice_id = sinv.id
       JOIN products p ON sii.product_id = p.id
       WHERE ${boWhere}
       GROUP BY DATE_FORMAT(sinv.invoice_date, '%Y-%m')`,
      [startStr, endStr]
    ) as any[];

    const returnedByYm = new Map<string, number>();
    for (const r of monthlyReturnRows) returnedByYm.set(r.ym, parseFloat(r.returned));

    const revByYm = new Map<string, { revenue: number; transactions: number }>();
    for (const r of monthlyRevRows) revByYm.set(r.ym, { revenue: parseFloat(r.revenue), transactions: parseInt(r.transactions) });
    for (const r of monthlyBoRevRows) {
      const prev = revByYm.get(r.ym) || { revenue: 0, transactions: 0 };
      revByYm.set(r.ym, { revenue: prev.revenue + parseFloat(r.revenue), transactions: prev.transactions + parseInt(r.transactions) });
    }
    const costByYm = new Map<string, number>();
    for (const r of monthlyCostRows) costByYm.set(r.ym, parseFloat(r.cost));
    for (const r of monthlyBoCostRows) costByYm.set(r.ym, (costByYm.get(r.ym) || 0) + parseFloat(r.cost));

    // Build 12 fiscal periods in order, each mapped to its actual calendar month.
    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const months = [];
    for (let period = 0; period < 12; period++) {
      const d = new Date(fiscalYear, (startMonth - 1) + period, 1);
      const y = d.getFullYear();
      const m = d.getMonth(); // 0-11
      const ym = `${y}-${String(m + 1).padStart(2, '0')}`;
      const rev = revByYm.get(ym) || { revenue: 0, transactions: 0 };
      const netRevenue = rev.revenue + (returnedByYm.get(ym) || 0);
      months.push({
        period: period + 1,
        monthLabel: `${MONTHS[m]} ${y}`,
        revenue: netRevenue,
        transactions: rev.transactions,
        profit: profitOf(netRevenue, costByYm.get(ym) || 0),
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
