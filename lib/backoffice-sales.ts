/**
 * What counts as a BACK-OFFICE sale, for the sales reports.
 *
 * A back-office sale is a sales invoice keyed in on the Sales → Invoices page
 * (`CreateSaleUseCase`). It writes ONLY `sales_invoices` + `sales_invoice_items`:
 * no `sales_transactions`, no `pos_transactions`, no `pos_transaction_items`. It
 * does deduct stock and record `cost_at_sale`, so it is a real sale — but every
 * report built on `pos_transactions` / `sales_transactions` could not see it.
 *
 * `sales_invoices` is ALSO where the POS checkout mirrors each of its own sales
 * (`transaction_source = 'POS'`), so a report that reads the table whole counts
 * every POS sale twice. `transaction_source` is the only reliable discriminator.
 * Do not use `notes NOT LIKE '%POS Sale%'` for this — it is free text, and it is
 * what the by-product legs used before this module existed.
 *
 * STATUS. A back-office invoice is created `Pending` (unpaid, on account) and
 * only becomes `Paid` once collected. It is a sale from the moment it is issued
 * — exactly as a POS Charge sale is — so it counts while `Pending`. Filtering
 * to `Paid` alone (the old behaviour) hid every unpaid invoice, which is the
 * default state of one. Only void/cancelled/returned are excluded, the same set
 * the POS-side reports exclude (see by-date, bir-summary, by-tax-type).
 */

/** Statuses that mean the invoice is NOT revenue. */
export const NON_SALE_STATUSES = ['Void', 'Voided', 'Cancelled', 'Returned'] as const;

const NON_SALE_SQL = NON_SALE_STATUSES.map((s) => `'${s}'`).join(', ');

/**
 * SQL predicate selecting valid back-office invoices.
 *
 * @param alias alias of the `sales_invoices` table in the query
 */
export const backofficeInvoiceSql = (alias: string): string =>
  `${alias}.transaction_source = 'Backoffice' AND COALESCE(${alias}.status, '') NOT IN (${NON_SALE_SQL})`;
