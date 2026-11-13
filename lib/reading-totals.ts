/**
 * Gross and net sales for a reading (Z-reading, Overall Reading).
 *
 *   gross = everything rung up        = sales + discounts + voids
 *   net   = gross − discounts − voids − returns
 *         = sales − returns
 *
 * `sales` is SUM(st.total) of the period's non-void sales (already after
 * discounts). `voids` is the value of sales voided in the period — they were
 * rung up, so they are part of gross and then deducted. `returns` is the money
 * refunded in the period (from the return rows themselves), which is a
 * deduction from gross, NOT part of it.
 *
 * Before this, both readings set gross = sales + discounts + RETURNS + voids
 * and net = sales: a refund inflated gross and never reduced net, so the
 * readings' net disagreed with BIR Summary, Sales by Tax Type and every other
 * sales report for any period holding a return (Nov 1–13: 7,785 vs 7,620).
 *
 * Applies to readings filed from this change on; filed z_readings rows are
 * left as filed.
 */
export function readingTotals(input: {
  sales: number;
  discounts: number;
  voids: number;
  returns: number;
}): { gross: number; net: number } {
  const n = (v: number) => (Number.isFinite(v) ? v : 0);
  const sales = n(input.sales);
  const gross = sales + n(input.discounts) + n(input.voids);
  const net = sales - n(input.returns);
  return { gross, net };
}
