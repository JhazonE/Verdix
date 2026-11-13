import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/mysql';
import { sumLineCostExpr, unitCostExpr } from '@/lib/cost-of-sale';
import { profitOf, lineDateExpr } from '@/lib/profit';
import { parseTaxType, taxTypeFilterSql } from '@/lib/tax-utils';
import { backofficeInvoiceSql } from '@/lib/backoffice-sales';
import { parseSalesSource } from '@/lib/sales-source';

export async function GET(request: NextRequest) {
  try {
    const queryParams = new URL(request.url).searchParams;
    const startDate = queryParams.get('startDate');
    const endDate = queryParams.get('endDate');
    const terminalId = queryParams.get('terminalId');
    const category = queryParams.get('category');
    const brand = queryParams.get('brand');
    const cashier = queryParams.get('cashier');
    const reference = queryParams.get('reference');
    const page = parseInt(queryParams.get('page') || '1');
    const limit = parseInt(queryParams.get('limit') || '10');
    const search = queryParams.get('search') || '';
    // pos | backoffice | all (default). See lib/sales-source.ts. 'pos' drops the
    // invoice and order legs; 'backoffice' drops the POS leg.
    const source = parseSalesSource(queryParams.get('source'));
    const sortBy = queryParams.get('sortBy') || 'sales'; // 'sales' or 'volume'
    const offset = (page - 1) * limit;

    // BIR tax bucket, narrowed to a known value so it can never be arbitrary
    // SQL even though the predicate binds it as a parameter.
    //
    // This filter is POS-ONLY by nature: `tax_type` exists on
    // `pos_transaction_items` and nowhere else. The all-terminals branch below
    // UNIONs in sales invoices and sales orders, which have no tax column, so
    // when this filter is active those two legs are dropped entirely rather
    // than guessed at. `taxTypeScoped` tells the client that happened, so the
    // UI can say why the totals shrank instead of leaving it a mystery.
    const taxType = parseTaxType(queryParams.get('taxType'));

    const params: any[] = [];
    let baseQueryStr = '';
    let whereClause = '';

    if (terminalId && terminalId !== 'all') {
         // Filter by Terminal: Only include items from POS sales on this terminal
         baseQueryStr = `
           SELECT
             p.id as product_id,
             p.name as product_name,
             su.barcode as base_unit_barcode,
             p.barcode,
             p.category,
             p.brand,
             p.unit_of_measure,
             SUM(si.quantity) as units_sold,
             SUM(si.price * si.quantity) as total_revenue,
             SUM(GREATEST(0, COALESCE(pti.discount_amount, 0))) as total_discount,
             -- Cost must be per SELLING unit, matching si.price/si.quantity.
             -- See lib/cost-of-sale.ts: p.cost alone costs a case as a bottle.
             ${sumLineCostExpr('si', 'p', { hasCostAtSale: true })} as total_cost,
             COUNT(DISTINCT pt.id) as number_of_sales,
             AVG(si.price) as avg_price_per_unit
           FROM sale_items si
           JOIN pos_transactions pt ON si.sale_id = pt.sale_id
           LEFT JOIN users u ON pt.user_id = u.uid
           JOIN pos_transaction_items pti ON pti.sale_item_id = si.id
           JOIN products p ON si.product_id = p.id
           LEFT JOIN product_selling_units su ON su.product_id = p.id AND su.is_base = 1
           WHERE pt.terminal_id = ?
           AND (pt.transaction_type = 'sale')
         `;
         params.push(terminalId);
         // A terminal's sales are POS by definition: no back-office sale
         // belongs to one, so Backoffice-only on a terminal is empty.
         if (source === 'backoffice') whereClause += ' AND 1=0';

        // A return line (negative quantity) is dated by when it was returned,
        // not by the original sale. See lib/profit.ts.
        if (startDate) {
          whereClause += ` AND DATE(${lineDateExpr('si', 'pt.transaction_time')}) >= ?`;
          params.push(startDate);
        }
        if (endDate) {
          whereClause += ` AND DATE(${lineDateExpr('si', 'pt.transaction_time')}) <= ?`;
          params.push(endDate);
        }
        if (category && category !== 'all') {
            whereClause += ` AND p.category = ?`;
            params.push(category);
        }
        if (brand && brand !== 'all') {
            whereClause += ` AND p.brand = ?`;
            params.push(brand);
        }
        if (cashier && cashier !== 'all') {
            whereClause += ` AND u.display_name = ?`;
            params.push(cashier);
        }
        if (reference) {
             whereClause += ` AND pt.id LIKE ?`;
             params.push(`%${reference}%`);
        }
        if (search) {
          whereClause += ` AND (p.name LIKE ? OR su.barcode LIKE ? OR p.barcode LIKE ?)`;
          params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }
        // This branch already joins pos_transaction_items, so the bucket is
        // available directly and no leg has to be dropped.
        if (taxType) {
          whereClause += ` AND ${taxTypeFilterSql('pti')}`;
          params.push(taxType);
        }
    } else {
        // When a tax bucket is requested, the invoice and order legs cannot
        // participate: neither table records a tax type, so there is no honest
        // way to include or classify them. Build the UNION from the POS leg
        // alone in that case.
        const taxScopedToPos = taxType !== null;

        // The POS leg is the only one that can be filtered by tax bucket.
        const posTaxFilter = taxScopedToPos ? `AND ${taxTypeFilterSql('pti')}` : '';

        // Sales invoices leg — no tax column, so omitted under a tax filter.
        const invoiceLeg = `
            UNION ALL

            -- Items from Sales Invoices
            SELECT
              sii.product_id,
              sii.quantity,
              sii.price,
              ${unitCostExpr('sii', 'p_cost', { hasCostAtSale: true })} as unit_cost,
              0 as discount_amount,
              sinv.id as source_id,
              sinv.invoice_date as transaction_date,
              NULL as cashier_name,
              -- The invoice's own reference (INV-001012), not its internal
              -- id (inv_1794...): that is what staff type into the Reference
              -- filter and what appears on the invoice.
              sinv.reference as reference_no
            FROM sales_invoice_items sii
            JOIN sales_invoices sinv ON sii.sales_invoice_id = sinv.id
            LEFT JOIN products p_cost ON sii.product_id = p_cost.id
            -- Back-office invoices only (POS mirrors its own sales into
            -- sales_invoices, which the POS leg already counts), and a Pending
            -- invoice counts: it is the default state of a back-office sale.
            -- See lib/backoffice-sales.ts.
            WHERE ${backofficeInvoiceSql('sinv')}`;

        // Sales orders leg — likewise has no tax column.
        const orderLeg = `
            UNION ALL

            -- Items from Sales Orders
            SELECT
              soi.product_id,
              soi.quantity,
              soi.price,
              -- sales_order_items has no cost_at_sale column, so this leg can
              -- only use the scaled products.cost fallback.
              ${unitCostExpr('soi', 'p_cost', { hasCostAtSale: false })} as unit_cost,
              0 as discount_amount,
              so.id as source_id,
              so.order_date as transaction_date,
              NULL as cashier_name,
              so.reference as reference_no
            FROM sales_order_items soi
            JOIN sales_orders so ON soi.sales_order_id = so.id
            LEFT JOIN products p_cost ON soi.product_id = p_cost.id
            WHERE so.status = 'Paid'`;

        const nonPosLegs = taxScopedToPos || source === 'pos' ? '' : invoiceLeg + orderLeg;

        // ORDER MATTERS: this placeholder sits inside the CTE in baseQueryStr,
        // ahead of every filter appended to that string below, so its value
        // must be bound first. mysql2 binds positionally — pushing it after the
        // date filters would feed the date into the tax comparison.
        if (taxType) {
            params.push(taxType);
        }

        // unified query to aggregate sales from all sources
        baseQueryStr = `
          WITH all_sale_items AS (
            -- Items from Sales Transactions (POS)
            SELECT
              si.product_id,
              si.quantity,
              si.price,
              -- Cost per SELLING unit, resolved per source table because only
              -- some of them carry cost_at_sale. See lib/cost-of-sale.ts.
              ${unitCostExpr('si', 'p_cost', { hasCostAtSale: true })} as unit_cost,
              GREATEST(0, COALESCE(pti.discount_amount, 0)) as discount_amount,
              st.id as source_id,
              ${lineDateExpr('si', 'st.invoice_date')} as transaction_date,
              u.display_name as cashier_name,
              pt.id as reference_no
            FROM sale_items si
            JOIN sales_transactions st ON si.sale_id = st.id
            LEFT JOIN products p_cost ON si.product_id = p_cost.id
            -- The transaction_type predicate below is load-bearing, not a
            -- filter: a partly-returned sale has TWO pos_transactions rows for
            -- one sale_id ('sale' and 'return'), and without it this join fans
            -- out and emits every line of that sale TWICE, double-counting its
            -- revenue. Measured on live data: 21 sale_items became 26 rows and
            -- revenue inflated from 13,410.00 to 14,270.00 off a single
            -- partly-returned transaction.
            --
            -- pt only supplies cashier_name (through u) and reference_no, so
            -- narrowing it costs nothing: returned QUANTITIES are not sourced
            -- from here, and every sale_id in this schema has a 'sale' row, so
            -- no line loses its cashier or reference. The terminal-scoped
            -- branch above has always constrained this the same way; the two
            -- branches of this endpoint simply disagreed.
            LEFT JOIN pos_transactions pt ON st.id = pt.sale_id AND pt.transaction_type = 'sale'
            LEFT JOIN users u ON pt.user_id = u.uid
            LEFT JOIN pos_transaction_items pti ON pti.sale_item_id = si.id
            WHERE st.status = 'Paid'${source === 'backoffice' ? ' AND 1=0' : ''}
            ${posTaxFilter}${nonPosLegs}
          )
          SELECT
            p.id as product_id,
            p.name as product_name,
            su.barcode as base_unit_barcode,
            p.barcode,
            p.category,
            p.brand,
            p.unit_of_measure,
            SUM(asi.quantity) as units_sold,
            SUM(asi.price * asi.quantity) as total_revenue,
            SUM(asi.discount_amount) as total_discount,
            SUM(asi.quantity * COALESCE(asi.unit_cost, 0)) as total_cost,
            COUNT(DISTINCT asi.source_id) as number_of_sales,
            AVG(asi.price) as avg_price_per_unit
          FROM all_sale_items asi
          INNER JOIN products p ON asi.product_id = p.id
          LEFT JOIN product_selling_units su ON su.product_id = p.id AND su.is_base = 1
          WHERE 1=1
        `;

        // Apply filters to the unified query
        if (startDate) {
            baseQueryStr += ` AND DATE(asi.transaction_date) >= ?`;
            params.push(startDate);
        }
        if (endDate) {
            baseQueryStr += ` AND DATE(asi.transaction_date) <= ?`;
            params.push(endDate);
        }
        if (category && category !== 'all') {
            baseQueryStr += ` AND p.category = ?`;
            params.push(category);
        }
        if (brand && brand !== 'all') {
            baseQueryStr += ` AND p.brand = ?`;
            params.push(brand);
        }
        if (cashier && cashier !== 'all') {
            baseQueryStr += ` AND asi.cashier_name = ?`;
            params.push(cashier);
        }
        if (reference) {
            baseQueryStr += ` AND asi.reference_no LIKE ?`;
            params.push(`%${reference}%`);
        }
        if (search) {
            baseQueryStr += ` AND (p.name LIKE ? OR su.barcode LIKE ? OR p.barcode LIKE ?)`;
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }
    }

    // Combine base query with where clause
    const fullQueryWithoutLimit = baseQueryStr + whereClause + `
      GROUP BY p.id, p.name, su.barcode, p.barcode, p.category, p.brand, p.unit_of_measure
    `;

    // 1. Get Total Count
    // We wrap the grouped query to count the number of resulting rows
    const countQuery = `SELECT COUNT(*) as total FROM (${fullQueryWithoutLimit}) as cnt`;
    const countResult = await query(countQuery, params);
    const totalItems = countResult[0]?.total || 0;

    // 1b. Get aggregate totals across ALL matching products (not just the current
    // page of products), so the summary cards reflect the whole filtered result set.
    const totalsQuery = `
      SELECT
        COALESCE(SUM(t.units_sold), 0) as unitsSold,
        COALESCE(SUM(t.total_revenue), 0) as totalRevenue,
        COALESCE(SUM(t.total_discount), 0) as totalDiscount,
        COALESCE(SUM(t.total_cost), 0) as totalCost
      FROM (${fullQueryWithoutLimit}) as t
    `;
    const totalsResult = await query(totalsQuery, params);
    const totalsRow = totalsResult[0] || {};
    const aggRevenue = parseFloat(totalsRow.totalRevenue) || 0;
    const aggDiscount = parseFloat(totalsRow.totalDiscount) || 0;
    const aggCost = parseFloat(totalsRow.totalCost) || 0;
    const totals = {
      totalRevenue: aggRevenue,
      totalDiscount: aggDiscount,
      totalCost: aggCost,
      totalProfit: profitOf(aggRevenue - aggDiscount, aggCost),
      unitsSold: parseInt(totalsRow.unitsSold) || 0,
    };

    // 2. Get Paginated Data
    let orderByClause = 'ORDER BY total_revenue DESC';
    if (sortBy === 'volume') {
      orderByClause = 'ORDER BY units_sold DESC';
    }

    const paginationQuery = fullQueryWithoutLimit + `
      ${orderByClause}
      LIMIT ? OFFSET ?
    `;
    
    // Add pagination params
    const paginationParams = [...params, limit, offset];
    
    const productSales = await query(paginationQuery, paginationParams);

    // Transform the data to match expected format
    const formattedData = productSales.map((row: any) => ({
      product: {
        id: row.product_id,
        name: row.product_name,
        baseUnitBarcode: row.base_unit_barcode,
        barcode: row.barcode,
        category: row.category,
        brand: row.brand,
        unitOfMeasure: row.unit_of_measure,
      },
      unitsSold: parseInt(row.units_sold),
      totalRevenue: parseFloat(row.total_revenue),
      totalDiscount: parseFloat(row.total_discount || 0),
      totalCost: parseFloat(row.total_cost || 0),
      totalProfit: profitOf(
        parseFloat(row.total_revenue) - parseFloat(row.total_discount || 0),
        parseFloat(row.total_cost || 0),
      ),
      numberOfSales: parseInt(row.number_of_sales),
      avgPricePerUnit: parseFloat(row.avg_price_per_unit),
    }));

    return NextResponse.json({
      success: true,
      data: formattedData,
      totals,
      // True when a tax filter forced the result to POS lines only, because
      // sales invoices and sales orders record no tax type. The UI shows this
      // so a shrunken total is explained rather than mysterious.
      taxTypeScopedToPos: taxType !== null && (!terminalId || terminalId === 'all'),
      appliedTaxType: taxType,
      pagination: {
        totalItems,
        totalPages: Math.ceil(totalItems / limit),
        currentPage: page,
        itemsPerPage: limit
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching sales by product:', error);
    return NextResponse.json(
      { success: false, error: `Failed to fetch sales by product data: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}
