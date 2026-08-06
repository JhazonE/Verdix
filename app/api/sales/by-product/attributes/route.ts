import { NextResponse } from 'next/server';
import { query } from '@/lib/mysql';

// GET /api/sales/by-product/attributes — category/brand filter options for the
// Sales by Product/Service report. Scoped to products that actually have a
// recorded 'Paid' sale (POS, invoices, orders) — the same universe /api/sales/by-product
// draws from — so the filter never offers a category/brand that yields zero rows.
const SOLD_PRODUCT_IDS = `
  SELECT si.product_id FROM sale_items si
  JOIN sales_transactions st ON si.sale_id = st.id
  WHERE st.status = 'Paid'
  UNION
  SELECT sii.product_id FROM sales_invoice_items sii
  JOIN sales_invoices sinv ON sii.sales_invoice_id = sinv.id
  WHERE sinv.status = 'Paid' AND (sinv.notes IS NULL OR sinv.notes NOT LIKE '%POS Sale%')
  UNION
  SELECT soi.product_id FROM sales_order_items soi
  JOIN sales_orders so ON soi.sales_order_id = so.id
  WHERE so.status = 'Paid'
`;

export async function GET() {
  try {
    const categories = await query(
      `SELECT DISTINCT p.category FROM products p
       WHERE p.category IS NOT NULL AND p.category != ''
       AND p.id IN (${SOLD_PRODUCT_IDS})
       ORDER BY p.category`
    );
    const brands = await query(
      `SELECT DISTINCT p.brand FROM products p
       WHERE p.brand IS NOT NULL AND p.brand != ''
       AND p.id IN (${SOLD_PRODUCT_IDS})
       ORDER BY p.brand`
    );

    return NextResponse.json({
      success: true,
      categories: categories.map((c: any) => c.category),
      brands: brands.map((b: any) => b.brand),
    });
  } catch (error: any) {
    console.error('Error fetching sales-by-product attributes:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch sales-by-product attributes' },
      { status: 500 }
    );
  }
}
