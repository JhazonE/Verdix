import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/mysql';

/**
 * Stock & Sales Summary.
 *
 * One row per product combining how much LEFT the store inside a date range
 * with how much is STILL on the shelf right now — the two numbers a buyer
 * otherwise has to open Stock on Hand and Fast & Slow Moving side by side to
 * compare.
 *
 * Quantities are in BASE units on both sides of that comparison. `sale_items`
 * records whatever selling unit was actually sold (a Case), so every quantity
 * is scaled by `selling_unit_factor` before it can be weighed against
 * `products.stock`, which is always base units. A NULL factor predates
 * selling units and means the base unit (factor 1) — see CLAUDE.md.
 *
 * Returns need no separate table: `lib/pos/process-return-leg.ts` files them
 * as NEGATIVE `sale_items` rows, so SUM() over the range is already net of
 * them. `qty_returned` re-reads only the negative rows so the report can show
 * the returned quantity as its own column without a second query.
 *
 * Only products with movement in the range are returned (HAVING on net sold),
 * by design: the Fast & Slow Moving report's "None Moving" tab already covers
 * products with zero sales, and this report exists to answer "what moved, and
 * what is left of it".
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const category = searchParams.get('category');
    const brand = searchParams.get('brand');
    const supplier = searchParams.get('supplier');
    const search = searchParams.get('search');

    // "Remaining" normally means stock RIGHT NOW. With `asOfDate` it instead
    // means stock at the end of that day, reconstructed by subtracting every
    // movement recorded after it from the current figure. See `remainingExpr`.
    const asOfDate = searchParams.get('asOfDate');

    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '10');
    const offset = (page - 1) * limit;

    const sortParam = searchParams.get('sort') || 'sold_desc';

    // Conditions on the SALE side live inside the JOIN, not the WHERE clause.
    // In the WHERE they would discard the product row entirely whenever its
    // sales fall outside the range — the same outcome here, since rows without
    // movement are dropped anyway, but it would break the moment this report
    // grows a "show all products" option.
    const joinConditions: string[] = [
      "st.status != 'voided'",
      "st.status != 'returned'",
    ];
    const joinParams: any[] = [];

    if (startDate) {
      joinConditions.push('DATE(st.created_at) >= ?');
      joinParams.push(startDate);
    }
    if (endDate) {
      joinConditions.push('DATE(st.created_at) <= ?');
      joinParams.push(endDate);
    }

    // Services carry no stock, so a "remaining" figure for them is
    // meaningless — the same reason the Stock on Hand report excludes them.
    const whereConditions: string[] = ["p.type = 'standard'"];
    const whereParams: any[] = [];

    if (category && category !== 'all') {
      whereConditions.push('p.category = ?');
      whereParams.push(category);
    }
    if (brand && brand !== 'all') {
      whereConditions.push('p.brand = ?');
      whereParams.push(brand);
    }
    if (supplier && supplier !== 'all') {
      // A product's supplier lives in EITHER the newer primary-supplier
      // mapping or the legacy `products.supplier_id` column, and the back
      // office reads both (see getProducts in products/actions.ts). Matching
      // only one of them would silently hide products from this filter.
      whereConditions.push('(spm.supplier_id = ? OR p.supplier_id = ?)');
      whereParams.push(supplier, supplier);
    }
    if (search) {
      // `sku` is deliberately absent: it is retired from product search
      // (docs/superpowers/specs/2026-09-22-retire-sku-search-pos-inventory-design.md).
      whereConditions.push('(p.name LIKE ? OR p.barcode LIKE ?)');
      const searchVal = `%${search}%`;
      whereParams.push(searchVal, searchVal);
    }

    // Net quantity that left the store, in base units. Negative rows (returns)
    // are part of this sum, which is what makes it net.
    const qtySoldExpr = `COALESCE(SUM(si.quantity * COALESCE(si.selling_unit_factor, 1)), 0)`;
    // Returned quantity as a positive number: only the negative rows, negated.
    const qtyReturnedExpr = `COALESCE(SUM(CASE WHEN si.quantity < 0 THEN -si.quantity * COALESCE(si.selling_unit_factor, 1) ELSE 0 END), 0)`;
    // Revenue uses the raw quantity against the raw price: both are already
    // per SELLING unit, so scaling by the factor here would multiply a case
    // price by the pieces in the case. Returns subtract themselves.
    const revenueExpr = `COALESCE(SUM(si.quantity * si.price), 0)`;
    // What is LEFT. Normally `products.stock` as it stands now.
    //
    // With an as-of date, stock is reconstructed by subtracting every movement
    // recorded AFTER that date from the current figure. `stock_movements` has
    // no snapshot row, so walking backwards from a known-good present is the
    // only route; it also works for products with no movement in the window,
    // which a "last new_stock before the date" lookup would return NULL for.
    //
    // This is only as good as the movement log. Verified on live data: all 98
    // products that had sold carried movement history, and 60 of 61 products
    // reconstructed to exactly the figure the log's own `new_stock` recorded
    // at that date (the one exception had a pre-existing 1-unit drift between
    // its latest movement and `products.stock`).
    const remainingExpr = asOfDate
      ? `(p.stock - COALESCE((
            SELECT SUM(sm.quantity_change) FROM stock_movements sm
             WHERE sm.product_id = p.id AND DATE(sm.created_at) > ?
          ), 0))`
      : `p.stock`;

    // Value of what is LEFT, at cost. FIFO batch cost where batches exist,
    // falling back to products.cost — the same resolution the Stock on Hand
    // report uses, so the two reports cannot disagree on stock value.
    //
    // On an as-of date the batch figures are today's and would describe a
    // different moment than the quantity beside them, so value falls back to
    // the reconstructed quantity at the product's cost. That is an
    // approximation of historical value, not a restatement of it.
    const remainingValueExpr = asOfDate
      ? `(${remainingExpr} * COALESCE(p.cost, 0))`
      : `
      COALESCE(
        (SELECT SUM(b.quantity_remaining * b.unit_cost)
           FROM inventory_batches b
          WHERE b.product_id = p.id AND b.quantity_remaining > 0),
        (p.stock * COALESCE(p.cost, 0))
      )
    `;

    // The supplier join is always present so `spm.supplier_id` can be filtered
    // on, and is a LEFT JOIN so products without a mapping are not dropped.
    const baseSql = `
      FROM products p
      LEFT JOIN supplier_product_mapping spm ON p.id = spm.product_id AND spm.is_primary = 1
      JOIN sale_items si ON p.id = si.product_id
      JOIN sales_transactions st ON si.sale_id = st.id
        AND ${joinConditions.join(' AND ')}
      WHERE ${whereConditions.join(' AND ')}
      GROUP BY p.id, p.name, p.barcode, p.category, p.brand, p.stock, p.unit_of_measure, p.cost
      HAVING qty_sold <> 0 OR qty_returned <> 0
    `;
    const baseParams = [...joinParams, ...whereParams];

    // Placeholders inside the SELECT list bind BEFORE the ones in the FROM /
    // WHERE that follows it, so every statement below prepends one asOfDate
    // argument per occurrence of `remainingExpr` in its own select list.
    const asOfArgs = (occurrences: number) =>
      asOfDate ? Array(occurrences).fill(asOfDate) : [];

    const selectSql = `
      SELECT
        p.id,
        p.name,
        p.barcode,
        p.category,
        p.brand,
        ${remainingExpr} AS qty_remaining,
        p.unit_of_measure,
        ${qtySoldExpr} AS qty_sold,
        ${qtyReturnedExpr} AS qty_returned,
        ${revenueExpr} AS revenue,
        ${remainingValueExpr} AS remaining_value
    `;
    // `remainingExpr` appears once directly and once more nested inside
    // `remainingValueExpr` when an as-of date is active.
    const SELECT_ASOF_OCCURRENCES = 2;

    const sortMap: Record<string, string> = {
      sold_desc: 'qty_sold DESC',
      sold_asc: 'qty_sold ASC',
      remaining_desc: 'qty_remaining DESC',
      remaining_asc: 'qty_remaining ASC',
      revenue_desc: 'revenue DESC',
      name_asc: 'p.name ASC',
    };
    const orderBy = sortMap[sortParam] || sortMap.sold_desc;

    // The HAVING clause makes the row count a count OF GROUPS, so it has to be
    // wrapped — COUNT(DISTINCT p.id) alongside HAVING would count groups that
    // HAVING then discards.
    const countSql = `
      SELECT COUNT(*) AS total FROM (
        SELECT p.id, ${qtySoldExpr} AS qty_sold, ${qtyReturnedExpr} AS qty_returned
        ${baseSql}
      ) AS grouped
    `;
    const [countResult] = await query(countSql, baseParams);
    const totalItems = Number(countResult?.total) || 0;
    const totalPages = Math.max(1, Math.ceil(totalItems / limit));

    const rows = await query(
      `${selectSql} ${baseSql} ORDER BY ${orderBy}, p.name ASC LIMIT ? OFFSET ?`,
      [...asOfArgs(SELECT_ASOF_OCCURRENCES), ...baseParams, limit, offset]
    );

    // Totals cover the whole filtered set, not the current page — a buyer
    // reading "total sold" off a 10-row page would badly under-read it.
    const summarySql = `
      SELECT
        COUNT(*) AS totalProducts,
        COALESCE(SUM(qty_sold), 0) AS totalSold,
        COALESCE(SUM(qty_returned), 0) AS totalReturned,
        COALESCE(SUM(qty_remaining), 0) AS totalRemaining,
        COALESCE(SUM(revenue), 0) AS totalRevenue,
        COALESCE(SUM(remaining_value), 0) AS totalRemainingValue
      FROM (
        SELECT
          p.id,
          ${remainingExpr} AS qty_remaining,
          ${qtySoldExpr} AS qty_sold,
          ${qtyReturnedExpr} AS qty_returned,
          ${revenueExpr} AS revenue,
          ${remainingValueExpr} AS remaining_value
        ${baseSql}
      ) AS grouped
    `;
    const [summaryResult] = await query(summarySql, [
      ...asOfArgs(SELECT_ASOF_OCCURRENCES),
      ...baseParams,
    ]);

    return NextResponse.json({
      success: true,
      data: (rows as any[]).map((r) => ({
        ...r,
        qty_sold: Number(r.qty_sold) || 0,
        qty_returned: Number(r.qty_returned) || 0,
        qty_remaining: Number(r.qty_remaining) || 0,
        revenue: Number(r.revenue) || 0,
        remaining_value: Number(r.remaining_value) || 0,
      })),
      pagination: { page, limit, totalItems, totalPages },
      summary: {
        totalProducts: Number(summaryResult?.totalProducts) || 0,
        totalSold: Number(summaryResult?.totalSold) || 0,
        totalReturned: Number(summaryResult?.totalReturned) || 0,
        totalRemaining: Number(summaryResult?.totalRemaining) || 0,
        totalRevenue: Number(summaryResult?.totalRevenue) || 0,
        totalRemainingValue: Number(summaryResult?.totalRemainingValue) || 0,
      },
    });
  } catch (error: any) {
    console.error('Error fetching stock & sales summary report:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch stock & sales summary report' },
      { status: 500 }
    );
  }
}
