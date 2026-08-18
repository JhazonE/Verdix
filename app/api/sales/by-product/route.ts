import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/mysql';

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
    const sortBy = queryParams.get('sortBy') || 'sales'; // 'sales' or 'volume'
    const offset = (page - 1) * limit;

    const params: any[] = [];
    let baseQueryStr = '';
    let whereClause = '';

    if (terminalId && terminalId !== 'all') {
         // Filter by Terminal: Only include items from POS sales on this terminal
         baseQueryStr = `
           SELECT
             p.id as product_id,
             p.name as product_name,
             p.sku,
             p.barcode,
             p.category,
             p.brand,
             p.unit_of_measure,
             SUM(si.quantity) as units_sold,
             SUM(si.price * si.quantity) as total_revenue,
             SUM(GREATEST(0, COALESCE(pti.discount_amount, 0))) as total_discount,
             SUM(si.quantity * COALESCE(p.cost, 0)) as total_cost,
             COUNT(DISTINCT pt.id) as number_of_sales,
             AVG(si.price) as avg_price_per_unit
           FROM sale_items si
           JOIN pos_transactions pt ON si.sale_id = pt.sale_id
           JOIN users u ON pt.user_id = u.id
           JOIN pos_transaction_items pti ON pti.sale_item_id = si.id
           JOIN products p ON si.product_id = p.id
           WHERE pt.terminal_id = ? 
           AND (pt.transaction_type = 'sale')
         `;
         params.push(terminalId);

        if (startDate) {
          whereClause += ` AND DATE(pt.transaction_time) >= ?`;
          params.push(startDate);
        }
        if (endDate) {
          whereClause += ` AND DATE(pt.transaction_time) <= ?`;
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
          whereClause += ` AND (p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)`;
          params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }
    } else {
        // unified query to aggregate sales from all sources
        baseQueryStr = `
          WITH all_sale_items AS (
            -- Items from Sales Transactions (POS)
            SELECT 
              si.product_id, 
              si.quantity, 
              si.price,
              GREATEST(0, COALESCE(pti.discount_amount, 0)) as discount_amount,
              st.id as source_id,
              st.invoice_date as transaction_date,
              u.display_name as cashier_name,
              pt.id as reference_no
            FROM sale_items si
            JOIN sales_transactions st ON si.sale_id = st.id
            LEFT JOIN pos_transactions pt ON st.id = pt.sale_id
            LEFT JOIN users u ON pt.user_id = u.uid
            LEFT JOIN pos_transaction_items pti ON pti.sale_item_id = si.id
            WHERE st.status = 'Paid'
            
            UNION ALL
            
            -- Items from Sales Invoices
            SELECT 
              sii.product_id, 
              sii.quantity, 
              sii.price,
              0 as discount_amount,
              sinv.id as source_id,
              sinv.invoice_date as transaction_date,
              NULL as cashier_name,
              sinv.id as reference_no
            FROM sales_invoice_items sii
            JOIN sales_invoices sinv ON sii.sales_invoice_id = sinv.id
            WHERE sinv.status = 'Paid' AND (sinv.notes IS NULL OR sinv.notes NOT LIKE '%POS Sale%')
            
            UNION ALL
            
            -- Items from Sales Orders
            SELECT 
              soi.product_id, 
              soi.quantity, 
              soi.price,
              0 as discount_amount,
              so.id as source_id,
              so.order_date as transaction_date,
              NULL as cashier_name,
              so.reference as reference_no
            FROM sales_order_items soi
            JOIN sales_orders so ON soi.sales_order_id = so.id
            WHERE so.status = 'Paid'
          )
          SELECT
            p.id as product_id,
            p.name as product_name,
            p.sku,
            p.barcode,
            p.category,
            p.brand,
            p.unit_of_measure,
            SUM(asi.quantity) as units_sold,
            SUM(asi.price * asi.quantity) as total_revenue,
            SUM(asi.discount_amount) as total_discount,
            SUM(asi.quantity * COALESCE(p.cost, 0)) as total_cost,
            COUNT(DISTINCT asi.source_id) as number_of_sales,
            AVG(asi.price) as avg_price_per_unit
          FROM all_sale_items asi
          INNER JOIN products p ON asi.product_id = p.id
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
            baseQueryStr += ` AND (p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)`;
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }
    }

    // Combine base query with where clause
    const fullQueryWithoutLimit = baseQueryStr + whereClause + `
      GROUP BY p.id, p.name, p.sku, p.barcode, p.category, p.brand, p.unit_of_measure
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
      totalProfit: aggRevenue - aggCost - aggDiscount,
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
        sku: row.sku,
        barcode: row.barcode,
        category: row.category,
        brand: row.brand,
        unitOfMeasure: row.unit_of_measure,
      },
      unitsSold: parseInt(row.units_sold),
      totalRevenue: parseFloat(row.total_revenue),
      totalDiscount: parseFloat(row.total_discount || 0),
      totalCost: parseFloat(row.total_cost || 0),
      totalProfit: parseFloat(row.total_revenue) - parseFloat(row.total_cost || 0) - parseFloat(row.total_discount || 0),
      numberOfSales: parseInt(row.number_of_sales),
      avgPricePerUnit: parseFloat(row.avg_price_per_unit),
    }));

    return NextResponse.json({
      success: true,
      data: formattedData,
      totals,
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
