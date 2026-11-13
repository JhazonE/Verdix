import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/mysql';
import { getFiscalYearRange, getCurrentFiscalYear, toLocalYmd } from '@/lib/fiscal-utils';
import { backofficeInvoiceSql } from '@/lib/backoffice-sales';
import { posSaleSql } from '@/lib/pos-sales';
import { lineDateExpr } from '@/lib/profit';

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        // Optional date range filters could be added later, defaulting to "all time" or "recent"
        // For now, let's fetch summary data.

        // 1. Sales Over Time (Last 30 Days)
        //
        // BACK-OFFICE INVOICES are folded in throughout this endpoint. They write
        // sales_invoices only (never sales_transactions), so every POS-based
        // query here was blind to them. They count while Pending (a sale from the
        // day it is issued), are dated by invoice_date, and are told apart from
        // the POS mirror rows in the same table by transaction_source. See
        // lib/backoffice-sales.ts.
        const BO = backofficeInvoiceSql('sinv');
        // POS sales: every non-void, non-training sale, Charge (Pending) included.
        // This used to be status = 'Paid', which dropped credit sales and kept
        // training sales. See lib/pos-sales.ts.
        const POS = posSaleSql('st');

        // RETURNS. A return is a NEGATIVE sale_items line under the original
        // sale, and st.total does not shrink when one is added, so a revenue
        // figure summed from st.total alone ignores returns. Revenue here is
        // net of returns, counted on the day of the return — the same rule as
        // Sales by Date and Fiscal Year (lib/profit.ts). This expression is the
        // (negative) returned value; callers add a date condition.
        const returnedSql = (dateCond: string) => `
            SELECT COALESCE(SUM(si.price * si.quantity), 0)
            FROM sale_items si JOIN sales_transactions st ON si.sale_id = st.id
            WHERE ${POS} AND si.quantity < 0 ${dateCond}`;

        // Dates come back as 'YYYY-MM-DD' strings (not Date objects) so the two
        // sources can be merged by key without timezone drift. The return leg is
        // dated by when the return happened, so it nets against that day.
        const salesByDayQuery = `
            SELECT date, SUM(sales) as sales FROM (
                SELECT DATE_FORMAT(st.invoice_date, '%Y-%m-%d') as date, st.total as sales
                FROM sales_transactions st
                WHERE ${POS} AND st.invoice_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
                UNION ALL
                SELECT DATE_FORMAT(si.created_at, '%Y-%m-%d') as date, si.price * si.quantity as sales
                FROM sale_items si JOIN sales_transactions st ON si.sale_id = st.id
                WHERE ${POS} AND si.quantity < 0 AND DATE(si.created_at) >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
            ) d
            GROUP BY date
        `;
        const salesByDayPos = await query(salesByDayQuery) as any[];
        const salesByDayBo = await query(`
            SELECT DATE_FORMAT(sinv.invoice_date, '%Y-%m-%d') as date, SUM(sinv.total) as sales
            FROM sales_invoices sinv
            WHERE ${BO} AND sinv.invoice_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
            GROUP BY DATE_FORMAT(sinv.invoice_date, '%Y-%m-%d')
        `) as any[];
        const dayTotals = new Map<string, number>();
        for (const r of [...salesByDayPos, ...salesByDayBo]) {
            dayTotals.set(r.date, (dayTotals.get(r.date) || 0) + parseFloat(r.sales));
        }
        const salesByDayData = [...dayTotals.entries()]
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([date, sales]) => ({ date, sales }));

        // 2. Top Selling Products (Top 5 by Revenue)
        const topProductsQuery = `
            SELECT
                si.product_id as product_id,
                si.product_name as name,
                SUM(si.quantity * si.price) as sales
            FROM sale_items si
            JOIN sales_transactions st ON si.sale_id = st.id
            WHERE ${POS}
            GROUP BY si.product_id, si.product_name
        `;
        // No LIMIT per source: the combined top 5 is not the top 5 of each
        // source merged (a product can be 6th in both and 1st overall), so the
        // two lists are summed per product first and cut afterwards.
        const topProductsPos = await query(topProductsQuery) as any[];
        const topProductsBo = await query(`
            SELECT sii.product_id as product_id, sii.product_name as name, SUM(sii.quantity * sii.price) as sales
            FROM sales_invoice_items sii
            JOIN sales_invoices sinv ON sii.sales_invoice_id = sinv.id
            WHERE ${BO}
            GROUP BY sii.product_id, sii.product_name
        `) as any[];
        const productTotals = new Map<string, { name: string; sales: number }>();
        for (const r of [...topProductsPos, ...topProductsBo]) {
            const key = String(r.product_id);
            const prev = productTotals.get(key);
            productTotals.set(key, { name: r.name, sales: (prev?.sales || 0) + parseFloat(r.sales) });
        }
        const topProductsData = [...productTotals.values()]
            .sort((a, b) => b.sales - a.sales)
            .slice(0, 5);

        // 3. Sales by Category
        const salesByCategoryQuery = `
            SELECT
                IFNULL(p.category, 'Uncategorized') as name,
                SUM(si.quantity * si.price) as value
            FROM sale_items si
            JOIN sales_transactions st ON si.sale_id = st.id
            JOIN products p ON si.product_id = p.id
            WHERE ${POS}
            GROUP BY p.category
        `;
        const salesByCategoryPos = await query(salesByCategoryQuery) as any[];
        const salesByCategoryBo = await query(`
            SELECT IFNULL(p.category, 'Uncategorized') as name, SUM(sii.quantity * sii.price) as value
            FROM sales_invoice_items sii
            JOIN sales_invoices sinv ON sii.sales_invoice_id = sinv.id
            JOIN products p ON sii.product_id = p.id
            WHERE ${BO}
            GROUP BY p.category
        `) as any[];
        const categoryTotals = new Map<string, number>();
        for (const r of [...salesByCategoryPos, ...salesByCategoryBo]) {
            categoryTotals.set(r.name, (categoryTotals.get(r.name) || 0) + parseFloat(r.value));
        }
        const salesByCategoryData = [...categoryTotals.entries()].map(([name, value]) => ({ name, value }));

        // 4. Dashboard Summary Metrics
        // Total Revenue (All time or this month? Dashboard says "Total Revenue", usually implies broad or specific period. Let's do current month for "trends" or all time? 
        // The mock data implied "Total Revenue" and "+20.1% from last month". 
        // Let's fetch metrics for:
        // - Total Revenue (This Month)
        // - Total Sales Count (This Month)
        // - Products Sold (This Month)
        // - Low Stock Items (Current)
        // - Total Items (Current)

        const currentMonthStart = new Date();
        currentMonthStart.setDate(1);
        // Local date, not toISOString(): in UTC+8 the UTC date of "the 1st at
        // 07:00" is still the previous month's last day.
        const currentMonthStartStr = toLocalYmd(currentMonthStart);

        // Fetch settings for fiscal year
        const settingsResult = await query("SELECT fiscal_year_start_month FROM pos_settings LIMIT 1") as any[];
        const startMonth = settingsResult[0]?.fiscal_year_start_month || 1;

        const currentFiscalYear = getCurrentFiscalYear(startMonth);

        // Optional ?fiscalYear= override; fall back to current fiscal year.
        const requestedFy = parseInt(searchParams.get('fiscalYear') || '', 10);
        const fiscalYear = Number.isFinite(requestedFy) ? requestedFy : currentFiscalYear;

        const { startDate: fiscalStartDate, endDate: fiscalEndDate } = getFiscalYearRange(fiscalYear, startMonth);
        const fiscalStartDateStr = toLocalYmd(fiscalStartDate);
        const fiscalEndDateStr = toLocalYmd(fiscalEndDate);

        // Available fiscal years: from the earliest paid sale through the current FY.
        const [firstSaleRow] = await query(
            `SELECT MIN(d) AS first_date FROM (
                SELECT MIN(st.invoice_date) AS d FROM sales_transactions st WHERE ${POS}
                UNION ALL
                SELECT MIN(sinv.invoice_date) FROM sales_invoices sinv WHERE ${BO}
            ) firsts`
        ) as any[];
        const availableFiscalYears: number[] = [];
        if (firstSaleRow?.first_date) {
            const firstFy = getCurrentFiscalYear(startMonth, new Date(firstSaleRow.first_date));
            for (let y = firstFy; y <= currentFiscalYear; y++) availableFiscalYears.push(y);
        } else {
            availableFiscalYears.push(currentFiscalYear);
        }

        // Services are excluded: they have no stock, so they would otherwise appear
        // permanently out-of-stock and drag inventory valuation totals to zero.
        const summaryQuery = `
            SELECT
                -- Revenue is net of returns (returnedSql is negative), each
                -- return counted in the period it was returned.
                ((SELECT COALESCE(SUM(st.total), 0) FROM sales_transactions st WHERE ${POS})
                  + (${returnedSql('')})) as total_revenue_all_time,
                ((SELECT COALESCE(SUM(st.total), 0) FROM sales_transactions st WHERE ${POS} AND st.invoice_date >= ?)
                  + (${returnedSql('AND DATE(si.created_at) >= ?')})) as total_revenue_month,
                (SELECT COUNT(*) FROM sales_transactions st WHERE ${POS} AND st.invoice_date >= ?) as total_sales_month,
                -- si.quantity is in whatever selling unit was sold (1 case, 1 piece);
                -- scale by selling_unit_factor so this counts actual base units moved,
                -- not a mix of units. NULL factor means base unit (1). A return
                -- line is dated by when it was returned (lineDateExpr), not by
                -- the original sale, matching the revenue figures.
                (SELECT COALESCE(SUM(si.quantity * COALESCE(si.selling_unit_factor, 1)), 0) FROM sale_items si JOIN sales_transactions st ON si.sale_id = st.id WHERE ${POS} AND DATE(${lineDateExpr('si', 'st.invoice_date')}) >= ?) as products_sold_month,
                ((SELECT COALESCE(SUM(st.total), 0) FROM sales_transactions st WHERE ${POS} AND st.invoice_date >= ? AND st.invoice_date <= ?)
                  + (${returnedSql('AND DATE(si.created_at) >= ? AND DATE(si.created_at) <= ?')})) as total_revenue_fiscal_ytd,
                (SELECT COUNT(*) FROM products WHERE type = 'standard' AND stock > 0 AND (stock < reorder_point OR stock < (SELECT COALESCE(low_stock_threshold, 0) FROM pos_settings LIMIT 1))) as low_stock_items,
                (SELECT COUNT(*) FROM products WHERE type = 'standard') as total_items
        `;

        const [summaryData] = await query(summaryQuery, [
            currentMonthStartStr, currentMonthStartStr,   // total_revenue_month (sales, returns)
            currentMonthStartStr,                         // total_sales_month
            currentMonthStartStr,                         // products_sold_month
            fiscalStartDateStr, fiscalEndDateStr,         // total_revenue_fiscal_ytd (sales)
            fiscalStartDateStr, fiscalEndDateStr,         // total_revenue_fiscal_ytd (returns)
        ]) as any[];

        // The same four sales figures, for back-office invoices. Quantity is
        // scaled by selling_unit_factor exactly as products_sold_month is above,
        // so "products sold" stays in base units across both sources.
        const [boSummary] = await query(
            `SELECT
                (SELECT COALESCE(SUM(sinv.total), 0) FROM sales_invoices sinv WHERE ${BO}) as revenue_all_time,
                (SELECT COALESCE(SUM(sinv.total), 0) FROM sales_invoices sinv WHERE ${BO} AND sinv.invoice_date >= ?) as revenue_month,
                (SELECT COUNT(*) FROM sales_invoices sinv WHERE ${BO} AND sinv.invoice_date >= ?) as sales_month,
                (SELECT COALESCE(SUM(sii.quantity * COALESCE(sii.selling_unit_factor, 1)), 0)
                   FROM sales_invoice_items sii JOIN sales_invoices sinv ON sii.sales_invoice_id = sinv.id
                  WHERE ${BO} AND sinv.invoice_date >= ?) as products_sold_month,
                (SELECT COALESCE(SUM(sinv.total), 0) FROM sales_invoices sinv WHERE ${BO} AND sinv.invoice_date >= ? AND sinv.invoice_date <= ?) as revenue_fiscal_ytd`,
            [currentMonthStartStr, currentMonthStartStr, currentMonthStartStr, fiscalStartDateStr, fiscalEndDateStr]
        ) as any[];
        const bo = (k: string) => parseFloat(boSummary?.[k]) || 0;


         // Transform Sales By Day for Chart (Recharts expects specific format)
        const formattedSalesByDay = salesByDayData.map((row: any) => ({
            // 'YYYY-MM-DD' parsed at LOCAL midnight; a bare date string would be
            // read as UTC and could label the day before in a negative-offset zone.
            date: new Date(`${row.date}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            sales: parseFloat(row.sales)
        }));

        // Transform Top Products
        const formattedTopProducts = topProductsData.map((row: any) => ({
            name: row.name,
            sales: parseFloat(row.sales)
        }));

        // Transform Sales By Category
        // Assign colors dynamically in frontend or here. Frontend has config, so we just send name/value.
        const formattedSalesByCategory = salesByCategoryData.map((row: any) => ({
            name: row.name,
            value: parseFloat(row.value)
        }));


        return NextResponse.json({
            salesByDay: formattedSalesByDay,
            topProducts: formattedTopProducts,
            salesByCategory: formattedSalesByCategory,
            summary: {
                totalRevenueAllTime: parseFloat(summaryData.total_revenue_all_time) + bo('revenue_all_time'),
                totalRevenueMonth: parseFloat(summaryData.total_revenue_month) + bo('revenue_month'),
                totalRevenueFiscalYTD: parseFloat(summaryData.total_revenue_fiscal_ytd) + bo('revenue_fiscal_ytd'),
                fiscalYear: fiscalYear,
                fiscalStartMonth: startMonth,
                availableFiscalYears: availableFiscalYears,
                totalSalesMonth: parseInt(summaryData.total_sales_month) + bo('sales_month'),
                productsSoldMonth: parseInt(summaryData.products_sold_month) + Math.round(bo('products_sold_month')),
                lowStockItems: parseInt(summaryData.low_stock_items),
                totalItems: parseInt(summaryData.total_items)
            }
        });

    } catch (error: any) {
        console.error('Error fetching reports stats:', error);

        const isDev = process.env.NODE_ENV !== 'production';
        // mysql2 surfaces connection failures via error.code — treat these as
        // "database unavailable" (503) so the client can tell a down DB apart
        // from an actual server bug (500).
        const connectionErrorCodes = [
            'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EHOSTUNREACH',
            'PROTOCOL_CONNECTION_LOST', 'ER_CON_COUNT_ERROR', 'ER_ACCESS_DENIED_ERROR',
        ];
        const isDbUnavailable = typeof error?.code === 'string' && connectionErrorCodes.includes(error.code);

        if (isDbUnavailable) {
            return NextResponse.json(
                {
                    error: 'Database unavailable. Please ensure the database service is running.',
                    code: 'DB_UNAVAILABLE',
                    ...(isDev && { detail: error.message }),
                },
                { status: 503 }
            );
        }

        return NextResponse.json(
            {
                error: 'Failed to fetch reports statistics',
                ...(isDev && { detail: error?.message }),
            },
            { status: 500 }
        );
    }
}
