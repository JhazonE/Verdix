import { query } from '@/lib/mysql';
import { lineCostExpr } from '@/lib/cost-of-sale';
import { lineDateExpr } from '@/lib/profit';
import { backofficeInvoiceSql } from '@/lib/backoffice-sales';
import { posSaleSql } from '@/lib/pos-sales';
import { saleItemRevenueSql } from '@/lib/sale-item-revenue';
import type { SalesSourceFilter } from '@/lib/sales-source';

/**
 * Sales, cost of goods sold and transaction count per calendar DAY or MONTH.
 *
 * Shared by the Fiscal Year report (monthly) and the Sales, COGS & Gross Profit
 * Monitoring report (daily) so the two can never disagree about a period: the
 * daily rows of a month always sum to that month's Fiscal Year figure.
 *
 * The definitions are the ones every profit report uses:
 *  - POS sales: `sales_transactions.total` dated by `invoice_date`, filtered by
 *    `posSaleSql` (Charge sales count, training and voids do not).
 *  - Returns: NEGATIVE `sale_items` lines under the original sale. The header
 *    total does not shrink when one is added, so the returned value is taken
 *    off sales on the day it was RETURNED; the same lines reduce cost through
 *    `lineDateExpr`, so profit is net of returns on both sides.
 *  - Cost: `lineCostExpr` (cost_at_sale snapshot first, scaled products.cost as
 *    fallback), see lib/cost-of-sale.ts.
 *  - Back-office invoices (`backofficeInvoiceSql`): revenue, one transaction
 *    each, and cost from `sales_invoice_items.cost_at_sale`. They have no returns.
 *
 * Keys are formatted by MySQL (`DATE_FORMAT`), never via a JS Date, so a day can
 * not be shifted by `toISOString()` at UTC+8.
 */
export type SalesPeriod = 'day' | 'month';

export interface PeriodSalesCost {
  /** Net sales: POS totals + back-office invoices − returns. */
  revenue: number;
  /** Cost of goods sold, net of returned goods. */
  cost: number;
  /** POS sales + back-office invoices (returns are not transactions). */
  transactions: number;
}

const FORMATS: Record<SalesPeriod, string> = { day: '%Y-%m-%d', month: '%Y-%m' };

/**
 * @param startStr inclusive start date, 'YYYY-MM-DD'
 * @param endStr   inclusive end date, 'YYYY-MM-DD'
 */
export async function salesCostByPeriod(opts: {
  startStr: string;
  endStr: string;
  source: SalesSourceFilter;
  period: SalesPeriod;
}): Promise<Map<string, PeriodSalesCost>> {
  const { startStr, endStr, source, period } = opts;
  const fmt = FORMATS[period];
  // A filtered-out source is switched off with 1=0 so no query changes shape.
  const posWhere = `${posSaleSql('st')}${source === 'backoffice' ? ' AND 1=0' : ''}`;
  const boWhere = `${backofficeInvoiceSql('sinv')}${source === 'pos' ? ' AND 1=0' : ''} AND sinv.invoice_date >= ? AND sinv.invoice_date <= ?`;
  const saleDate = lineDateExpr('si', 'st.invoice_date');
  const range = [startStr, endStr];

  const [posRev, posCost, returns, boRev, boCost] = (await Promise.all([
    query(
      `SELECT DATE_FORMAT(st.invoice_date, '${fmt}') AS k,
              COALESCE(SUM(st.total), 0) AS revenue,
              COUNT(*) AS transactions
       FROM sales_transactions st
       WHERE ${posWhere} AND st.invoice_date >= ? AND st.invoice_date <= ?
       GROUP BY k`,
      range
    ),
    query(
      `SELECT DATE_FORMAT(${saleDate}, '${fmt}') AS k,
              COALESCE(SUM(${lineCostExpr('si', 'p', { hasCostAtSale: true })}), 0) AS cost
       FROM sale_items si
       JOIN sales_transactions st ON si.sale_id = st.id
       JOIN products p ON si.product_id = p.id
       WHERE ${posWhere} AND DATE(${saleDate}) >= ? AND DATE(${saleDate}) <= ?
       GROUP BY k`,
      range
    ),
    query(
      `SELECT DATE_FORMAT(si.created_at, '${fmt}') AS k,
              COALESCE(SUM(${saleItemRevenueSql('si')}), 0) AS returned
       FROM sale_items si
       JOIN sales_transactions st ON si.sale_id = st.id
       WHERE ${posWhere} AND si.quantity < 0
         AND DATE(si.created_at) >= ? AND DATE(si.created_at) <= ?
       GROUP BY k`,
      range
    ),
    query(
      `SELECT DATE_FORMAT(sinv.invoice_date, '${fmt}') AS k,
              COALESCE(SUM(sinv.total), 0) AS revenue,
              COUNT(*) AS transactions
       FROM sales_invoices sinv
       WHERE ${boWhere}
       GROUP BY k`,
      range
    ),
    query(
      `SELECT DATE_FORMAT(sinv.invoice_date, '${fmt}') AS k,
              COALESCE(SUM(${lineCostExpr('sii', 'p', { hasCostAtSale: true })}), 0) AS cost
       FROM sales_invoice_items sii
       JOIN sales_invoices sinv ON sii.sales_invoice_id = sinv.id
       JOIN products p ON sii.product_id = p.id
       WHERE ${boWhere}
       GROUP BY k`,
      range
    ),
  ])) as any[][];

  const out = new Map<string, PeriodSalesCost>();
  const at = (k: string) => {
    let row = out.get(k);
    if (!row) {
      row = { revenue: 0, cost: 0, transactions: 0 };
      out.set(k, row);
    }
    return row;
  };
  for (const r of posRev) {
    at(r.k).revenue += parseFloat(r.revenue);
    at(r.k).transactions += parseInt(r.transactions);
  }
  for (const r of boRev) {
    at(r.k).revenue += parseFloat(r.revenue);
    at(r.k).transactions += parseInt(r.transactions);
  }
  for (const r of returns) at(r.k).revenue += parseFloat(r.returned);
  for (const r of posCost) at(r.k).cost += parseFloat(r.cost);
  for (const r of boCost) at(r.k).cost += parseFloat(r.cost);
  return out;
}
