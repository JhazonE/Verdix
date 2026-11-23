import { redirect } from 'next/navigation';

// Merged into Sales by Product, which ranks by revenue, units sold, profit or
// margin. This route stays so old links and bookmarks still land correctly.
export default function Page() {
  redirect('/reports/sales/by-product?sort=revenue');
}
