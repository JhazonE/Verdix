/**
 * Which kind of sale a report row came from, and the filter that selects one.
 *
 *   pos         rung up at a till (sales_transactions / pos_transactions)
 *   backoffice  a sales invoice keyed in on Sales > Invoices (sales_invoices)
 *
 * Client-safe (no database imports): the report pages and the API routes share
 * this one parser, so a typo in a query string can never silently mean "all".
 * See lib/backoffice-sales.ts for what counts as a back-office sale.
 */
export type SalesSource = 'pos' | 'backoffice';
export type SalesSourceFilter = 'all' | SalesSource;

export const SALES_SOURCE_OPTIONS: { value: SalesSourceFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'pos', label: 'POS' },
  { value: 'backoffice', label: 'Backoffice' },
];

/** Anything unrecognised means "all": an unknown value must not hide sales. */
export function parseSalesSource(raw: string | null | undefined): SalesSourceFilter {
  const v = String(raw ?? '').trim().toLowerCase();
  return v === 'pos' || v === 'backoffice' ? v : 'all';
}
