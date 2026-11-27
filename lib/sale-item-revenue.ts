/**
 * Revenue of one sale_items row, as SQL.
 *
 * sale_items.price is the discounted price PER UNIT rounded to two decimals,
 * so `price * quantity` multiplies that rounding by the quantity and drifts a
 * few centavos from what the line actually charged (and so from Sales by Date
 * and the Z-reading, which read the sale header). `line_total` is the charged
 * amount itself (migration 159). It is NULL only on a row no writer or
 * backfill could attribute, where price × quantity is still the best figure.
 *
 * Use this anywhere a report sums revenue from sale_items — never a bare
 * `si.price * si.quantity`.
 */
export function saleItemRevenueSql(alias: string): string {
  return `COALESCE(${alias}.line_total, ${alias}.price * ${alias}.quantity)`;
}
