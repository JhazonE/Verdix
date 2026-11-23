import { redirect } from 'next/navigation';

// Merged into Sales Summary as its "Split Payments Only" filter, which shows
// each sale's payment breakdown and items. The old page read its own endpoint
// that also listed voided sales. This route stays so old links still work.
export default function Page() {
  redirect('/reports/sales/summary?payment=split');
}
