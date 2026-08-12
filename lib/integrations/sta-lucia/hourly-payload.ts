import { format } from 'date-fns';
import type { StaLuciaSalesPayload, HourlySalesTotals } from './types';

/** Money rounded to 2dp without floating-point tails (0.1 + 0.2 -> 0.3). */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Discounts as a string percentage of gross sales, e.g. "10%". */
function discountPercent(discounts: number, grossSales: number): string {
  if (!grossSales) return '0%';
  const pct = round2((discounts / grossSales) * 100);
  return `${pct}%`;
}

/**
 * Convert one hour's pre-aggregated store totals into the Sta. Lucia sales
 * payload for an hourly submission (sale_type: true).
 *
 * `credit`/`debit` follow the same convention as the EOD mapper in
 * payload.ts: debit is cash tender, credit is every non-cash tender summed.
 * `net_sales` is gross minus discounts — hourly totals already exclude
 * void/returned/training rows at the query level (see
 * send-hourly-sales.ts), so there is no separate adjustment bucket to
 * subtract the way the Z-reading report has one.
 */
export function buildHourlySalesPayload(totals: HourlySalesTotals): StaLuciaSalesPayload {
  const nonCash = totals.paymentMethods
    .filter(pm => String(pm.name).toUpperCase() !== 'CASH')
    .reduce((sum, pm) => sum + (Number(pm.amount) || 0), 0);

  return {
    credit: round2(nonCash),
    debit: round2(totals.cashSales),
    gross_sales: round2(totals.grossSales),
    date_time: format(new Date(totals.hourStart), 'yyyy-MM-dd HH:mm:ss'),
    total_discounts: discountPercent(totals.discounts, totals.grossSales),
    vat_exempt_sales: round2(totals.vatExempt),
    vat_sales: round2(totals.vatSales),
    non_vat_sales: round2(totals.nonVat),
    vat_amount: round2(totals.vatAmount),
    other_taxes: 0,
    net_sales: round2(totals.grossSales - totals.discounts),
    sale_type: true,
  };
}
