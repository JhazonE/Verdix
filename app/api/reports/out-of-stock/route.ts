import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/mysql';
import { posSaleSql } from '@/lib/pos-sales';
import { backofficeInvoiceSql } from '@/lib/backoffice-sales';

/**
 * Out of Stock report.
 *
 * Products with nothing on hand (stock <= 0). Low Stock deliberately leaves
 * these out — zero stock is OUT of stock, not low (lib/low-stock-alerts.ts) —
 * so without this report no page listed them.
 *
 * NEVER-STOCKED PRODUCTS are hidden by default. A bulk-imported catalogue is
 * mostly rows that were never stocked (15,919 of 15,987 on the catalogue that
 * exposed the low-stock bell bug); listing them would bury the items that
 * actually ran out. "Was stocked" means the product has stock-movement
 * history: every stock change writes a movement (lib/stock-movements.ts).
 * `includeNeverStocked=true` lists them too.
 *
 * Columns:
 *  - out_since: the last stock movement. Stock has not changed since, so this
 *    is when the product reached its current level. NULL for never-stocked.
 *  - last_sold: the latest real sale, POS (posSaleSql, positive lines only, so
 *    a return is not a sale) or back office (backofficeInvoiceSql).
 *  - Negative stock means more was sold than the system had on hand; the page
 *    flags it as oversold.
 *
 * Services carry no stock and are excluded, as on Low Stock and Stock on Hand.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search')?.trim();
    const includeNeverStocked = searchParams.get('includeNeverStocked') === 'true';
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
    const limit = Math.min(10000, Math.max(1, parseInt(searchParams.get('limit') || '10', 10) || 10));
    const offset = (page - 1) * limit;

    const conditions: string[] = ["p.type = 'standard'", 'p.stock <= 0'];
    const params: any[] = [];
    if (!includeNeverStocked) {
      conditions.push('EXISTS (SELECT 1 FROM stock_movements sm0 WHERE sm0.product_id = p.id)');
    }
    if (search) {
      // `sku` is retired from product search (see the stock-sales report).
      conditions.push('(p.name LIKE ? OR p.barcode LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }
    const where = `WHERE ${conditions.join(' AND ')}`;

    const outSinceExpr = `(SELECT MAX(sm.created_at) FROM stock_movements sm WHERE sm.product_id = p.id)`;
    const lastSoldExpr = `GREATEST(
        COALESCE((SELECT MAX(st.created_at) FROM sale_items si
                    JOIN sales_transactions st ON si.sale_id = st.id
                   WHERE si.product_id = p.id AND si.quantity > 0 AND ${posSaleSql('st')}), '1000-01-01'),
        COALESCE((SELECT MAX(TIMESTAMP(sinv.invoice_date)) FROM sales_invoice_items sii
                    JOIN sales_invoices sinv ON sii.sales_invoice_id = sinv.id
                   WHERE sii.product_id = p.id AND sii.quantity > 0 AND ${backofficeInvoiceSql('sinv')}), '1000-01-01')
      )`;

    // Recently-selling items first: a product that sold yesterday and is now
    // gone is the restock that matters. Never-sold rows sink to the bottom.
    const sortMap: Record<string, string> = {
      recent_sale: 'last_sold_raw DESC, p.name ASC',
      out_longest: 'out_since IS NULL, out_since ASC, p.name ASC',
      out_newest: 'out_since DESC, p.name ASC',
      name: 'p.name ASC',
    };
    const orderBy = sortMap[searchParams.get('sort') || ''] || sortMap.recent_sale;

    const [counts]: any = await query(
      `SELECT COUNT(*) AS total, COALESCE(SUM(p.stock < 0), 0) AS oversold
         FROM products p ${where}`,
      params
    );
    const totalItems = Number(counts?.total) || 0;

    const rows: any[] = await query(
      `SELECT p.id, p.name, p.barcode, p.category, p.brand,
              (SELECT w.name FROM warehouses w WHERE w.id = p.warehouse_id) AS warehouse_name,
              p.stock, p.unit_of_measure, p.reorder_point,
              ${outSinceExpr} AS out_since,
              ${lastSoldExpr} AS last_sold_raw
         FROM products p
         ${where}
        ORDER BY ${orderBy}
        LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const toIso = (v: any): string | null => {
      if (!v) return null;
      const d = v instanceof Date ? v : new Date(v);
      return Number.isNaN(d.getTime()) || d.getFullYear() <= 1000 ? null : d.toISOString();
    };

    return NextResponse.json({
      success: true,
      data: rows.map((r) => ({
        id: r.id,
        name: r.name,
        barcode: r.barcode,
        category: r.category,
        brand: r.brand,
        warehouse_name: r.warehouse_name,
        stock: Number(r.stock) || 0,
        unit_of_measure: r.unit_of_measure,
        reorder_point: Number(r.reorder_point) || 0,
        out_since: toIso(r.out_since),
        last_sold: toIso(r.last_sold_raw),
      })),
      pagination: { page, limit, totalItems, totalPages: Math.max(1, Math.ceil(totalItems / limit)) },
      summary: { totalItems, oversold: Number(counts?.oversold) || 0 },
    });
  } catch (error) {
    console.error('Error fetching out-of-stock report:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch out-of-stock report' }, { status: 500 });
  }
}
