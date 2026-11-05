/**
 * The single definition of which sales invoices count as a customer's debt.
 *
 * `sales_invoices.status` is
 *   enum('Paid','Pending','Failed','Shipped','Delivered','Returned',
 *        'Partially Paid','Voided')
 * and the void endpoint (app/api/sales/invoices/[id]/void/route.ts) writes
 * exactly 'Voided'.
 *
 * Three separate routes used to spell their own version of this predicate, and
 * they disagreed:
 *
 *   - customers/balances filtered only `status != 'Paid'`, so a voided or
 *     returned invoice stayed on the balance forever.
 *   - reports/soa filtered `status != 'Void'` — a value the enum does not
 *     contain, so the comparison is true for every genuinely voided invoice
 *     and the filter excluded nothing.
 *   - customers/[id] used BOTH spellings in ONE query: credit_sales excluded
 *     voided+returned, while balance did not, so the figures on a single
 *     screen could not reconcile.
 *
 * Everything that asks "does this invoice still owe money" now takes its
 * answer from here, so that typo cannot reappear in one call site only.
 */

/**
 * Statuses that mean the invoice was cancelled and is not collectable.
 *
 * 'Voided' is the live value. 'Void' and 'Cancelled' are tolerated legacy /
 * alternate spellings so historical rows and the sales-report predicate (see
 * tests/unit/sales-by-date-excludes-voids.test.ts, which pins the same set)
 * agree with this one. 'Returned' is included because the goods came back —
 * the customer-detail route already excluded it from credit_sales, and
 * counting it as debt was the inconsistency.
 */
export const VOID_INVOICE_STATUSES = [
  'Voided',
  'Void',
  'Cancelled',
  'Returned',
] as const;

/** The same set, lowercased, for case-insensitive comparison in SQL and JS. */
const VOID_SET = new Set<string>(
  VOID_INVOICE_STATUSES.map((s) => s.toLowerCase()),
);

/**
 * A SQL list of the cancelled statuses for comparison against LOWER(status).
 *
 * Built lowercase per element rather than by lowercasing the joined string, so
 * the canonical spellings stay greppable here and the comparison stays
 * case-insensitive. Both matter: the detail route compared with LOWER() while
 * the others compared exact-case, which is how one query's two halves
 * disagreed.
 */
const VOID_SQL_LIST = VOID_INVOICE_STATUSES.map(
  (s) => `'${s.toLowerCase()}'`,
).join(', ');

/**
 * Invoices that are real — i.e. not cancelled — regardless of whether they
 * have been paid.
 *
 * Use this for "how much has this customer ever been billed" totals such as
 * credit_sales. It deliberately says nothing about amount_paid: folding that
 * in would drop fully paid invoices out of a customer's sales history.
 *
 * `alias` is the table alias the caller used, e.g. 'si' or 'c'.
 */
export function countableInvoiceSql(alias = ''): string {
  const col = alias ? `${alias}.status` : 'status';
  return `LOWER(${col}) NOT IN (${VOID_SQL_LIST})`;
}

/**
 * Invoices that still owe money: not cancelled, not settled, and with an
 * unpaid remainder.
 *
 * BOTH halves matter. Status alone would keep an invoice that was paid in full
 * but never advanced to 'Paid'; amount alone would keep a voided invoice whose
 * total went unpaid — which is precisely the bug this replaces. COALESCE is
 * required because amount_paid is NULL on rows predating the column.
 */
export function openInvoiceSql(alias = ''): string {
  const a = alias ? `${alias}.` : '';
  return (
    `${countableInvoiceSql(alias)} ` +
    `AND LOWER(${a}status) != 'paid' ` +
    `AND COALESCE(${a}amount_paid, 0) < ${a}total`
  );
}

/**
 * Pre-rendered fragments for the common `si`-aliased case, so a route can
 * interpolate without a call. Exported mainly so tests can assert on the text
 * the routes actually embed.
 */
export const COUNTABLE_INVOICE_SQL = countableInvoiceSql('si');
export const OPEN_INVOICE_SQL = openInvoiceSql('si');

/** True when a status means the invoice was cancelled. Case-insensitive. */
export function isVoidInvoiceStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  return VOID_SET.has(String(status).toLowerCase());
}

/**
 * True when an invoice row still owes money — the JS mirror of
 * `openInvoiceSql`, for callers holding rows rather than building a query.
 */
export function isOpenInvoice(invoice: {
  status?: string | null;
  total: number | string;
  amount_paid?: number | string | null;
}): boolean {
  if (isVoidInvoiceStatus(invoice.status)) return false;
  if (String(invoice.status ?? '').toLowerCase() === 'paid') return false;
  const total = Number(invoice.total) || 0;
  const paid = Number(invoice.amount_paid ?? 0) || 0;
  return paid < total;
}

/**
 * The amount an invoice row still owes, or 0 if it is cancelled or settled.
 * Keeps the "voided invoices owe nothing" rule in one place for callers that
 * sum balances in JS.
 */
export function openInvoiceBalance(invoice: {
  status?: string | null;
  total: number | string;
  amount_paid?: number | string | null;
}): number {
  if (!isOpenInvoice(invoice)) return 0;
  const total = Number(invoice.total) || 0;
  const paid = Number(invoice.amount_paid ?? 0) || 0;
  return total - paid;
}
