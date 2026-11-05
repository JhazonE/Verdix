import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/mysql';
import { lineCostExpr } from '@/lib/cost-of-sale';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const terminalId = searchParams.get('terminalId');
    const interval = searchParams.get('interval') || 'daily'; // daily, hourly, monthly
    const paymentType = searchParams.get('paymentType');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '10');
    const offset = (page - 1) * limit;

    const params: any[] = [];
    // Voided and training sales are NOT revenue and must be excluded here, the
    // same way X-reading, Z-reading and bir-summary exclude them.
    //
    // Voiding a sale never retypes or removes its pos_transactions row —
    // app/api/pos/void-transaction only flips sales_transactions.status to
    // 'Voided' — so a voided sale keeps transaction_type = 'sale' and used to
    // sail straight through this filter. On the live database that made
    // 2026-11-04 report PHP 145.00 of revenue for a day whose only transaction
    // was a void, while the X-reading and Z-reading for that day correctly
    // reported 0.00. That is why this report disagreed with the readings.
    //
    // is_training = 0 for the same reason checkout issues training sales no BIR
    // number at all: they are rehearsals, not sales.
    let whereClause =
      "WHERE pt.transaction_type = 'sale' AND pt.payment_status = 'completed'" +
      " AND pt.is_training = 0" +
      " AND COALESCE(st.status, '') NOT IN ('Void', 'Voided', 'Cancelled', 'Returned')";

    if (terminalId && terminalId !== 'all') {
        whereClause += " AND pt.terminal_id = ?";
        params.push(terminalId);
    }

    if (paymentType && paymentType !== 'all') {
        whereClause += " AND pt.payment_method = ?";
        params.push(paymentType);
    }

    if (startDate) {
        whereClause += " AND DATE(pt.transaction_time) >= ?";
        params.push(startDate);
    }
    if (endDate) {
        whereClause += " AND DATE(pt.transaction_time) <= ?";
        params.push(endDate);
    }

    // Determine grouping and date format
    let selectDate = "";
    
    switch (interval) {
        case 'hourly':
            selectDate = "DATE_FORMAT(pt.transaction_time, '%Y-%m-%d %H:00:00')";
            break;
        case 'monthly':
            selectDate = "DATE_FORMAT(pt.transaction_time, '%Y-%m-01')";
            break;
        case 'daily':
        default:
            selectDate = "DATE(pt.transaction_time)";
            break;
    }

    // Get total count of groups for pagination
    // sales_transactions is joined in BOTH queries below because whereClause
    // now references st.status. A LEFT JOIN with COALESCE, not an inner join:
    // a sale whose sales_transactions row is somehow missing should still be
    // reported rather than silently vanishing from the totals.
    const countQuery = `
        SELECT COUNT(DISTINCT ${selectDate}) as total
        FROM pos_transactions pt
        LEFT JOIN sales_transactions st ON pt.sale_id = st.id
        ${whereClause}
    `;
    const countResult = await query(countQuery, params);
    const totalCount = countResult[0]?.total || 0;
    const totalPages = Math.ceil(totalCount / limit);

    const queryStr = `
        SELECT
            ${selectDate} as date,
            COUNT(DISTINCT pt.id) as transaction_count,
            -- SI numbers, not order numbers: this column reports the invoice
            -- range for the day, which is what BIR filing is reconciled
            -- against.
            --
            -- Rows with no SI number are excluded rather than falling back to
            -- the order number: mixing the two numbering schemes in one range
            -- (e.g. "000007 - 20") reads as a real invoice span and would be
            -- wrong to file against. A day with no SI numbers shows "-".
            MIN(pt.si_number) as start_or,
            MAX(pt.si_number) as end_or,
            -- BIR OR numbers, kept in their own MIN/MAX pair rather than
            -- merged into the SI range above: si_number (goods) and
            -- bir_or_number (services) are independent BIR numbering
            -- sequences, so mixing them into one range would misrepresent
            -- either series when filing. A day with no OR numbers shows "-".
            MIN(pt.bir_or_number) as start_bir_or,
            MAX(pt.bir_or_number) as end_bir_or,
            SUM(pt.total_amount) as total_revenue,
            SUM(pt.discount_amount) as total_discount,
            SUM(pt.tax_amount) as total_tax,
            SUM(
                -- Cost per SELLING unit: pos_transaction_items has no
                -- cost_at_sale, so products.cost is scaled by the line's
                -- selling_unit_factor. See lib/cost-of-sale.ts.
                (SELECT SUM(${lineCostExpr('pti', 'p', { hasCostAtSale: false })})
                 FROM pos_transaction_items pti
                 LEFT JOIN products p ON pti.product_id = p.id
                 WHERE pti.pos_transaction_id = pt.id)
            ) as total_cost
        FROM pos_transactions pt
        LEFT JOIN sales_transactions st ON pt.sale_id = st.id
        ${whereClause}
        GROUP BY 1
        ORDER BY date DESC
        LIMIT ? OFFSET ?
    `;

    const result = await query(queryStr, [...params, limit, offset]);

    const formattedData = result.map((row: any) => {
        // toISOString() reported every daily/monthly bucket one day EARLY.
        // DATE(...) and DATE_FORMAT(..., '%Y-%m-01') come back as a Date at
        // LOCAL midnight, and toISOString() converts that to UTC — at
        // Philippine time (UTC+8) 2026-11-03 00:00 local becomes
        // 2026-11-02T16:00Z, so the row was labelled 2026-11-02. The money was
        // right and the label was wrong, which is a large part of why this
        // report appeared not to match the X-reading and Z-reading.
        //
        // Hourly buckets keep their time-of-day, so they are formatted in full;
        // daily and monthly buckets are calendar days and emit 'YYYY-MM-DD'.
        const date = (() => {
            const v = row.date;
            if (!(v instanceof Date)) return v;
            const y = v.getFullYear();
            const mo = String(v.getMonth() + 1).padStart(2, '0');
            const d = String(v.getDate()).padStart(2, '0');
            if (interval !== 'hourly') return `${y}-${mo}-${d}`;
            const h = String(v.getHours()).padStart(2, '0');
            const mi = String(v.getMinutes()).padStart(2, '0');
            const s = String(v.getSeconds()).padStart(2, '0');
            return `${y}-${mo}-${d}T${h}:${mi}:${s}`;
        })();
        const totalRevenue = parseFloat(row.total_revenue) || 0;
        const totalTax = parseFloat(row.total_tax) || 0;
        const totalCost = parseFloat(row.total_cost) || 0;
        const totalDiscount = parseFloat(row.total_discount) || 0;
        
        const vatableSales = totalRevenue - totalTax;
        const profit = totalRevenue - totalCost - totalTax;

        return {
            date: date,
            transactionCount: parseInt(row.transaction_count),
            startOR: row.start_or,
            endOR: row.end_or,
            startBirOr: row.start_bir_or,
            endBirOr: row.end_bir_or,
            totalRevenue,
            totalDiscount,
            vatableSales,
            vatAmount: totalTax,
            vatExemptSales: 0,
            zeroRatedSales: 0,
            nonVatSales: 0,
            cost: totalCost,
            profit
        };
    });

    return NextResponse.json({
        success: true,
        data: formattedData,
        pagination: {
            total: totalCount,
            page,
            limit,
            totalPages
        }
    });

  } catch (error) {
    console.error('Error fetching sales by date:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch sales by date data' },
      { status: 500 }
    );
  }
}
