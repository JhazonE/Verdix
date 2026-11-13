import { NON_SALE_STATUSES } from './backoffice-sales';

/**
 * What counts as a POS sale, for reports built on `sales_transactions`.
 *
 * NOT `status = 'Paid'`. Checkout writes a Charge sale as `Pending` (and
 * `Partially Paid` once account credit part-settles it), so a Paid-only filter
 * silently dropped every credit sale — while Sales by Date and Sales
 * Transactions, which read `pos_transactions`, counted them. The same day then
 * showed two different revenue figures depending on the report.
 *
 * A Paid-only filter also let TRAINING sales through: they are written `Paid`
 * with `is_training = 1`. Training sales are rehearsals, not revenue (checkout
 * gives them no BIR number), and every pos_transactions-based report already
 * excludes them.
 *
 * Excluded statuses are the same set back-office invoices use
 * (`NON_SALE_STATUSES`), so both legs of a report agree on what a sale is.
 *
 * @param alias alias of the `sales_transactions` table in the query
 */
export const posSaleSql = (alias: string): string =>
  `COALESCE(${alias}.status, '') NOT IN (${NON_SALE_STATUSES.map((s) => `'${s}'`).join(', ')})` +
  ` AND COALESCE(${alias}.is_training, 0) = 0`;
