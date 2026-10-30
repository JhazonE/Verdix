/**
 * The one place that knows how to cost a SOLD line.
 *
 * A product has ONE stock figure and ONE `products.cost`, both in BASE units.
 * A line item, however, is priced and quantified in its SELLING unit: selling a
 * "Case" of 24 records quantity 1 at the case price, with
 * `selling_unit_factor = 24`. So `quantity * p.cost` costs one case as if it
 * were one bottle, and the profit reports built on it reported a ~96% margin on
 * a product that actually earns ~4%.
 *
 * Two correct sources exist, in order of preference:
 *
 *  1. `cost_at_sale` — the weighted average batch cost captured at sale time by
 *     `lib/pos/process-sale-leg.ts`, already PER SELLING UNIT (it writes
 *     `weightedAvgCost * factor`). Use it as-is; scaling it again double-counts.
 *  2. `p.cost * selling_unit_factor` — the fallback for lines that predate
 *     batch costing, or whose table never had a cost column. `p.cost` is per
 *     BASE unit, so it MUST be scaled.
 *
 * `selling_unit_factor` is NULL on rows written before selling units existed;
 * NULL means the base unit, i.e. factor 1.
 *
 * This mirrors the expression `app/api/reports/fiscal-year/route.ts` already
 * used correctly, which is why that report's profit never showed the bug.
 */

/** A line's selling-unit factor, defaulting to 1 (base unit) when NULL. */
export const factorExpr = (item: string): string =>
  `COALESCE(${item}.selling_unit_factor, 1)`;

/**
 * Cost of ONE selling unit of a line.
 *
 * @param item    alias of the line-item table (e.g. `si`, `pti`)
 * @param product alias of the joined `products` table (e.g. `p`)
 * @param opts.hasCostAtSale whether `item` has a `cost_at_sale` column.
 *        `sale_items` and `sales_invoice_items` do; `pos_transaction_items`
 *        and `sales_order_items` do not, and must use the scaled fallback.
 */
export const unitCostExpr = (
  item: string,
  product: string,
  opts: { hasCostAtSale: boolean }
): string => {
  const fallback = `${product}.cost * ${factorExpr(item)}`;
  if (!opts.hasCostAtSale) return `COALESCE(${fallback}, 0)`;
  // The snapshot WINS whenever one exists, including a deliberate 0. A filed
  // sale must keep meaning what it meant on the day it was filed, so editing a
  // product's cost today can never move yesterday's reported profit.
  //
  // `products.cost` is only a fallback for lines that have NO snapshot at all
  // (NULL), i.e. rows written before batch costing existed. Those are the only
  // rows that can still shift when a cost is edited, and there is nothing
  // better to cost them with.
  return `COALESCE(${item}.cost_at_sale, ${fallback}, 0)`;
};

/** Total cost of a line: quantity (in selling units) × cost per selling unit. */
export const lineCostExpr = (
  item: string,
  product: string,
  opts: { hasCostAtSale: boolean }
): string => `(${item}.quantity * ${unitCostExpr(item, product, opts)})`;

/** `SUM(...)` of {@link lineCostExpr}, for grouped report queries. */
export const sumLineCostExpr = (
  item: string,
  product: string,
  opts: { hasCostAtSale: boolean }
): string => `SUM(${lineCostExpr(item, product, opts)})`;
