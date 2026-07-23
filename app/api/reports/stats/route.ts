import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/mysql';
import { getFiscalYearRange, getCurrentFiscalYear, toLocalYmd } from '@/lib/fiscal-utils';

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        // Optional date range filters could be added later, defaulting to "all time" or "recent"
        // For now, let's fetch summary data.

        // 1. Sales Over Time (Last 30 Days)
        const salesByDayQuery = `
            SELECT
                DATE(invoice_date) as date,
                SUM(total) as sales
            FROM sales_transactions
            WHERE status = 'Paid'
            AND invoice_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
            GROUP BY DATE(invoice_date)
            ORDER BY DATE(invoice_date) ASC
        `;
        const salesByDayData = await query(salesByDayQuery) as any[];

        // 2. Top Selling Products (Top 5 by Revenue)
        const topProductsQuery = `
            SELECT
                si.product_name as name,
                SUM(si.quantity * si.price) as sales
            FROM sale_items si
            JOIN sales_transactions st ON si.sale_id = st.id
            WHERE st.status = 'Paid'
            GROUP BY si.product_id, si.product_name
            ORDER BY sales DESC
            LIMIT 5
        `;
        const topProductsData = await query(topProductsQuery) as any[];

        // 3. Sales by Category
        const salesByCategoryQuery = `
            SELECT
                IFNULL(p.category, 'Uncategorized') as name,
                SUM(si.quantity * si.price) as value
            FROM sale_items si
            JOIN sales_transactions st ON si.sale_id = st.id
            JOIN products p ON si.product_id = p.id
            WHERE st.status = 'Paid'
            GROUP BY p.category
        `;
        const salesByCategoryData = await query(salesByCategoryQuery) as any[];

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
        const currentMonthStartStr = currentMonthStart.toISOString().split('T')[0];

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
            "SELECT MIN(invoice_date) AS first_date FROM sales_transactions WHERE status = 'Paid'"
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
                (SELECT COALESCE(SUM(total), 0) FROM sales_transactions WHERE status = 'Paid') as total_revenue_all_time,
                (SELECT COALESCE(SUM(total), 0) FROM sales_transactions WHERE status = 'Paid' AND invoice_date >= ?) as total_revenue_month,
                (SELECT COUNT(*) FROM sales_transactions WHERE status = 'Paid' AND invoice_date >= ?) as total_sales_month,
                (SELECT COALESCE(SUM(si.quantity), 0) FROM sale_items si JOIN sales_transactions st ON si.sale_id = st.id WHERE st.status = 'Paid' AND st.invoice_date >= ?) as products_sold_month,
                (SELECT COALESCE(SUM(total), 0) FROM sales_transactions WHERE status = 'Paid' AND invoice_date >= ? AND invoice_date <= ?) as total_revenue_fiscal_ytd,
                (SELECT COUNT(*) FROM products WHERE type = 'standard' AND stock > 0 AND (stock < reorder_point OR stock < (SELECT COALESCE(low_stock_threshold, 0) FROM pos_settings LIMIT 1))) as low_stock_items,
                (SELECT COUNT(*) FROM products WHERE type = 'standard') as total_items
        `;

        const [summaryData] = await query(summaryQuery, [currentMonthStartStr, currentMonthStartStr, currentMonthStartStr, fiscalStartDateStr, fiscalEndDateStr]) as any[];


         // Transform Sales By Day for Chart (Recharts expects specific format)
        const formattedSalesByDay = salesByDayData.map((row: any) => ({
            date: new Date(row.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
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
                totalRevenueAllTime: parseFloat(summaryData.total_revenue_all_time),
                totalRevenueMonth: parseFloat(summaryData.total_revenue_month),
                totalRevenueFiscalYTD: parseFloat(summaryData.total_revenue_fiscal_ytd),
                fiscalYear: fiscalYear,
                fiscalStartMonth: startMonth,
                availableFiscalYears: availableFiscalYears,
                totalSalesMonth: parseInt(summaryData.total_sales_month),
                productsSoldMonth: parseInt(summaryData.products_sold_month),
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
