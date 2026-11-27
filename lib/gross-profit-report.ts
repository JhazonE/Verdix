import { profitOf, marginPct } from './profit';

/**
 * Sales, Cost of Goods Sold & Gross Profit Monitoring — one row per day of a
 * month. Pure (no DB) so the arithmetic is unit-testable; the figures come from
 * lib/sales-cost-by-period.ts.
 *
 *   Gross Profit        = Sales − COGS              (lib/profit.ts)
 *   Gross Profit Margin = Gross Profit ÷ Sales      (what the store keeps per peso sold)
 *   Markup on Cost      = Gross Profit ÷ COGS       (what was added on top of cost)
 *
 * Client-safe: imported by the report page for its types.
 */

export interface GrossProfitDay {
  /** 'YYYY-MM-DD' */
  date: string;
  sales: number;
  cost: number;
  grossProfit: number;
  marginPct: number;
  markupPct: number;
  transactions: number;
}

export interface GrossProfitReport {
  /** 'YYYY-MM' */
  month: string;
  days: GrossProfitDay[];
  totals: Omit<GrossProfitDay, 'date'>;
  /**
   * Days that had any sale or cost. "Average per Day" divides by this, not by
   * the days in the month: a month still in progress, or a day the store was
   * closed, must not drag the daily average down.
   */
  sellingDays: number;
  averagePerDay: { sales: number; cost: number; grossProfit: number };
}

/** Markup on cost in percent; 0 when there was no cost (nothing to mark up). */
export const markupPct = (sales: number, cost: number): number =>
  cost > 0 ? (profitOf(sales, cost) / cost) * 100 : 0;

/** 'YYYY-MM' → { year, month } (1-12), or null if malformed. */
export function parseMonth(raw: string | null | undefined): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(String(raw ?? '').trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** First and last day of a month as 'YYYY-MM-DD', built from parts (no UTC shift). */
export function monthRange(year: number, month: number): { startStr: string; endStr: string; daysInMonth: number } {
  const daysInMonth = new Date(year, month, 0).getDate();
  return {
    startStr: `${year}-${pad(month)}-01`,
    endStr: `${year}-${pad(month)}-${pad(daysInMonth)}`,
    daysInMonth,
  };
}

/**
 * Builds every day of the month, filling days with no sales as zero rows (the
 * report lists the whole month, as the paper monitoring sheet does).
 */
export function buildGrossProfitReport(
  year: number,
  month: number,
  byDay: Map<string, { revenue: number; cost: number; transactions: number }>
): GrossProfitReport {
  const { daysInMonth } = monthRange(year, month);
  const days: GrossProfitDay[] = [];
  let sales = 0;
  let cost = 0;
  let transactions = 0;
  let sellingDays = 0;

  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${year}-${pad(month)}-${pad(d)}`;
    const p = byDay.get(date) || { revenue: 0, cost: 0, transactions: 0 };
    if (p.revenue !== 0 || p.cost !== 0 || p.transactions !== 0) sellingDays++;
    sales += p.revenue;
    cost += p.cost;
    transactions += p.transactions;
    days.push({
      date,
      sales: p.revenue,
      cost: p.cost,
      grossProfit: profitOf(p.revenue, p.cost),
      marginPct: marginPct(p.revenue, p.cost),
      markupPct: markupPct(p.revenue, p.cost),
      transactions: p.transactions,
    });
  }

  const grossProfit = profitOf(sales, cost);
  const per = (v: number) => (sellingDays > 0 ? v / sellingDays : 0);
  return {
    month: `${year}-${pad(month)}`,
    days,
    totals: {
      sales,
      cost,
      grossProfit,
      // Ratios of the month's totals, not an average of the daily ratios: a
      // slow day must not weigh as much as a busy one.
      marginPct: marginPct(sales, cost),
      markupPct: markupPct(sales, cost),
      transactions,
    },
    sellingDays,
    averagePerDay: { sales: per(sales), cost: per(cost), grossProfit: per(grossProfit) },
  };
}
