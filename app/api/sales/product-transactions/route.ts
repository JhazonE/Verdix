import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/mysql';
import { unitCostExpr } from '@/lib/cost-of-sale';

/**
 * Every sold LINE in range, one row per transaction per product — the detail
 * behind a sales-by-product report, for ALL of its products at once.
 *
 * `/api/sales/transactions?productId=` answers the same question for a single
 * product, which is what the on-screen expander calls as you open rows. Export
 * needs the detail for every product in the report, and calling that endpoint
 * once per product would mean thousands of round trips against a remote DB —
 * the shape that has already bitten product import and checkout here. So this
 * endpoint does it in ONE query and the client groups the rows by product.
 *
 * Filters mirror `/api/sales/by-product` so the detail matches the report it
 * expands: same date range, same category/brand/cashier/search, same sources.
 */
export async function GET(request: NextRequest) {
  try {
    const sp = new URL(request.url).searchParams;
    const startDate = sp.get('startDate');
    const endDate = sp.get('endDate');
    const terminalId = sp.get('terminalId');
    const category = sp.get('category');
    const brand = sp.get('brand');
    const cashier = sp.get('cashier');
    const search = sp.get('search') || '';
    // A safety valve, not a pagination scheme: the client wants every line, but
    // an unbounded query against a huge range should fail loudly rather than
    // stream a million rows into a browser. The response says when it trips.
    const maxRows = Math.min(parseInt(sp.get('maxRows') || '50000'), 200000);

    const params: any[] = [];

    // Mirrors the UNION in /api/sales/by-product. Only the POS leg carries a
    // terminal, cashier or customer; the other two legs fill those with NULL,
    // which is why a terminal filter restricts the result to POS lines.
    const sql = `
      WITH all_lines AS (
        -- POS sales
        SELECT
          si.product_id,
          si.quantity,
          si.price,
          ${unitCostExpr('si', 'p_cost', { hasCostAtSale: true })} as unit_cost,
          GREATEST(0, COALESCE(pti.discount_amount, 0)) as discount_amount,
          st.invoice_date as transaction_date,
          pt.order_number as order_number,
          pt.si_number as si_number,
          c.name as customer_name,
          u.display_name as cashier_name,
          pt.terminal_id as terminal_id
        FROM sale_items si
        JOIN sales_transactions st ON si.sale_id = st.id
        LEFT JOIN products p_cost ON si.product_id = p_cost.id
        LEFT JOIN pos_transactions pt ON st.id = pt.sale_id
        LEFT JOIN users u ON pt.user_id = u.uid
        LEFT JOIN customers c ON st.customer_id = c.id
        LEFT JOIN pos_transaction_items pti ON pti.sale_item_id = si.id
        WHERE st.status = 'Paid'

        UNION ALL

        -- Sales invoices (excluding POS sales, which the leg above already has)
        SELECT
          sii.product_id,
          sii.quantity,
          sii.price,
          ${unitCostExpr('sii', 'p_cost', { hasCostAtSale: true })} as unit_cost,
          0 as discount_amount,
          sinv.invoice_date as transaction_date,
          sinv.id as order_number,
          NULL as si_number,
          c.name as customer_name,
          NULL as cashier_name,
          NULL as terminal_id
        FROM sales_invoice_items sii
        JOIN sales_invoices sinv ON sii.sales_invoice_id = sinv.id
        LEFT JOIN products p_cost ON sii.product_id = p_cost.id
        LEFT JOIN customers c ON sinv.customer_id = c.id
        WHERE sinv.status = 'Paid'
          AND (sinv.notes IS NULL OR sinv.notes NOT LIKE '%POS Sale%')

        UNION ALL

        -- Sales orders. sales_order_items has no cost_at_sale column, so this
        -- leg can only use the scaled products.cost fallback.
        SELECT
          soi.product_id,
          soi.quantity,
          soi.price,
          ${unitCostExpr('soi', 'p_cost', { hasCostAtSale: false })} as unit_cost,
          0 as discount_amount,
          so.order_date as transaction_date,
          so.reference as order_number,
          NULL as si_number,
          c.name as customer_name,
          NULL as cashier_name,
          NULL as terminal_id
        FROM sales_order_items soi
        JOIN sales_orders so ON soi.sales_order_id = so.id
        LEFT JOIN products p_cost ON soi.product_id = p_cost.id
        LEFT JOIN customers c ON so.customer_id = c.id
        WHERE so.status = 'Paid'
      )
      SELECT
        al.product_id,
        p.name as product_name,
        al.transaction_date,
        al.order_number,
        al.si_number,
        al.customer_name,
        al.quantity,
        al.price,
        COALESCE(al.unit_cost, 0) as unit_cost,
        al.discount_amount
      FROM all_lines al
      INNER JOIN products p ON al.product_id = p.id
      LEFT JOIN product_selling_units su ON su.product_id = p.id AND su.is_base = 1
      WHERE 1=1
    `;

    let where = '';
    if (startDate) {
      where += ` AND DATE(al.transaction_date) >= ?`;
      params.push(startDate);
    }
    if (endDate) {
      where += ` AND DATE(al.transaction_date) <= ?`;
      params.push(endDate);
    }
    if (terminalId && terminalId !== 'all') {
      where += ` AND al.terminal_id = ?`;
      params.push(terminalId);
    }
    if (category && category !== 'all') {
      where += ` AND p.category = ?`;
      params.push(category);
    }
    if (brand && brand !== 'all') {
      where += ` AND p.brand = ?`;
      params.push(brand);
    }
    if (cashier && cashier !== 'all') {
      where += ` AND al.cashier_name = ?`;
      params.push(cashier);
    }
    if (search) {
      where += ` AND (p.name LIKE ? OR su.barcode LIKE ? OR p.barcode LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    // Oldest first within a product, so an exported history reads as a ledger.
    // Asking for one more than the cap is how we detect that we hit it.
    const fullSql = `${sql}${where} ORDER BY al.product_id, al.transaction_date ASC LIMIT ?`;
    const rows = await query(fullSql, [...params, maxRows + 1]);

    const truncated = rows.length > maxRows;
    const kept = truncated ? rows.slice(0, maxRows) : rows;

    const data = kept.map((r: any) => {
      const quantity = parseFloat(r.quantity) || 0;
      const price = parseFloat(r.price) || 0;
      const unitCost = parseFloat(r.unit_cost) || 0;
      const discount = parseFloat(r.discount_amount) || 0;
      // Discount is deducted ONCE, here, to form the line total; profit is then
      // total - cost. Subtracting it again at profit time would double-count it
      // against the Sales Discount column on the product row.
      const total = price * quantity - discount;
      return {
        productId: r.product_id,
        productName: r.product_name,
        date: r.transaction_date,
        orderNumber: r.order_number != null ? String(r.order_number) : '',
        siNumber: r.si_number != null ? String(r.si_number) : null,
        customerName: r.customer_name || 'Walk-in Customer',
        quantity,
        price,
        unitCost,
        discount,
        total,
        lineCost: unitCost * quantity,
        profit: total - unitCost * quantity,
      };
    });

    return NextResponse.json({
      success: true,
      data,
      truncated,
      maxRows,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error fetching product transaction detail:', error);
    return NextResponse.json(
      {
        success: false,
        error: `Failed to fetch product transaction detail: ${
          error instanceof Error ? error.message : String(error)
        }`,
      },
      { status: 500 }
    );
  }
}
