import type { RefundRow } from './refund-amount';

/**
 * Every sale_items row of one sale, in insertion order, as refund-amount.ts
 * reads them. `amount` is what the row charged (or refunded, negative):
 * line_total when recorded (migration 159), else the per-unit price × qty.
 *
 * Line ids are `${saleId}-ITEM-<n>`; ordering by length first keeps ITEM-10
 * after ITEM-2, so "the oldest line" means the first one rung up.
 */
export const REFUND_ROWS_SQL = `
  SELECT product_id, selling_unit_id, quantity,
         COALESCE(line_total, price * quantity) AS amount
    FROM sale_items
   WHERE sale_id = ?
   ORDER BY created_at, CHAR_LENGTH(id), id`;

export function toRefundRows(rows: any[]): RefundRow[] {
  return (rows || []).map(r => ({
    productId: String(r.product_id),
    sellingUnitId: r.selling_unit_id ?? null,
    quantity: Number(r.quantity),
    amount: Number(r.amount),
  }));
}
