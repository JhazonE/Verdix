/**
 * The one definition of profit used by every sales report.
 *
 *     profit = sales − cost
 *
 * where `sales` is what the customer was actually charged (after discounts, as
 * billed — VAT is NOT taken out) and `cost` is the cost of goods sold from
 * `lib/cost-of-sale.ts` (the batch cost captured at sale time).
 *
 * Why this exists: before it, profit was computed five different ways across
 * the reports. Sales Transactions and Sales by Date also subtracted VAT, and
 * Sales by Date additionally costed the goods at TODAY's `products.cost`, so the
 * same ten sales showed a profit anywhere from ₱1,764.69 to ₱4,497.00 depending
 * on which report you opened. Keep every report on this function so they cannot
 * drift apart again.
 */
export const profitOf = (sales: number, cost: number): number => sales - cost;

/**
 * Profit is NET OF RETURNS: a return reduces both sales and cost, and counts
 * on the day it was returned (not the day of the original sale), the same way
 * the X/Z readings and Sales Transactions place it.
 *
 * A return is stored as a NEGATIVE `sale_items` row (quantity = −N) under the
 * ORIGINAL sale, stamped with `created_at` = the moment of the return.
 * `sales_transactions.invoice_date` is the original sale's date, so a report
 * built from sale_items must pick the date by sign or a return gets filed
 * against the wrong period (and two reports with a range ending between the
 * sale and the return disagree).
 *
 * @param item     alias of the sale_items table
 * @param saleDate SQL expression for the original sale's date
 */
export const lineDateExpr = (item: string, saleDate: string): string =>
  `CASE WHEN ${item}.quantity < 0 THEN ${item}.created_at ELSE ${saleDate} END`;

/** Profit as a percentage of sales; 0 when there were no sales. */
export const marginPct = (sales: number, cost: number): number =>
  sales > 0 ? (profitOf(sales, cost) / sales) * 100 : 0;
