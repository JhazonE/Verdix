import { format } from 'date-fns';
import type { StaLuciaSalesPayload, ZReadingLike } from './types';

/** Money rounded to 2dp without floating-point tails (0.1 + 0.2 -> 0.3). */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Discounts as a string percentage of gross sales, e.g. "12.5%".
 *
 * The external field is called `total_discounts` but its type is a percentage
 * string, not an amount — that is their contract, not a mistake here.
 * A Z-reading with no sales would divide by zero, so it yields "0%".
 */
function discountPercent(discounts: number, grossSales: number): string {
  if (!grossSales) return '0%';
  const pct = round2((discounts / grossSales) * 100);
  return `${pct}%`;
}

/**
 * Convert a Verdix Z-reading into the Sta. Lucia sales payload.
 *
 * `credit` is non-cash tender and `debit` is cash tender. Note that in Verdix
 * these sum to NET sales, not gross: tender is recorded after discounts, since
 * the customer never hands over the undiscounted amount. The source PDF's
 * example has them summing to gross. Sending true tender is the only figure
 * Verdix can state honestly; confirm the expectation with MediaOne before
 * production cutover. If they want gross reconciliation, change it here.
 */
export function buildSalesPayload(z: ZReadingLike): StaLuciaSalesPayload {
  const nonCash = z.paymentMethods
    .filter(pm => String(pm.name).toUpperCase() !== 'CASH')
    .reduce((sum, pm) => sum + (Number(pm.amount) || 0), 0);

  return {
    credit: round2(nonCash),
    debit: round2(z.cashSales),
    gross_sales: round2(z.grossSales),
    date_time: format(new Date(z.reportDate), 'yyyy-MM-dd HH:mm:ss'),
    total_discounts: discountPercent(z.discounts, z.grossSales),
    vat_exempt_sales: round2(z.vatExempt),
    vat_sales: round2(z.vatSales),
    non_vat_sales: round2(z.nonVat),
    vat_amount: round2(z.vatAmount),
    other_taxes: 0,
    net_sales: round2(z.netSales),
    number_of_transactions: Math.trunc(z.transactionCount) || 0,
  };
}
