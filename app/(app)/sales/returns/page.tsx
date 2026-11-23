// Merchandise Credits (sidebar, Sales section) and Reports > Sales Returns were
// two copies of the same report over /api/sales/transactions?status=Returned.
// This copy sent no limit, so it silently stopped at the API's default 50 rows
// and its totals undercounted. One implementation now serves both routes; this
// route stays so the sidebar entry and its page-registry key (sales_returns)
// keep working without a redirect into the Reports permission.
export { default } from '@/app/(app)/reports/sales/returns/page';
