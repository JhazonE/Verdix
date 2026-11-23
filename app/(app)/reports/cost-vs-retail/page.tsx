import { redirect } from 'next/navigation';

// Merged into Stock on Hand & Valuation (/reports/inventory), which shows cost
// value, retail value, profit and margin on one stock × cost basis. This route
// stays so old links and bookmarks still land correctly.
export default function Page() {
  redirect('/reports/inventory');
}
