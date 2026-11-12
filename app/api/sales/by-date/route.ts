import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/mysql';
import { unitCostExpr } from '@/lib/cost-of-sale';
import { profitOf } from '@/lib/profit';
import { backofficeInvoiceSql } from '@/lib/backoffice-sales';

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
    // Return rows are included so revenue, cost and profit are NET OF RETURNS
    // (a return row carries a negative amount and a negative cost) and land on
    // the day they were returned. See lib/profit.ts.
    //
    // payment_status admits 'pending' as well as 'completed': checkout marks a
    // Charge (credit) sale 'pending' until it is paid, but it is a real sale the
    // moment it is rung up and every other report, and the X/Z readings, count
    // it. Filtering to 'completed' alone silently dropped credit sales.
    let whereClause =
      "WHERE pt.transaction_type IN ('sale', 'return') AND pt.payment_status IN ('completed', 'pending')" +
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

    // Determine grouping and date format. Each interval needs the bucket
    // expressed twice: once over a POS row and once over a back-office invoice,
    // because the two legs below are UNIONed and must produce the SAME bucket.
    //
    // A back-office invoice has no transaction_time. It is dated by
    // invoice_date, the accounting date typed on the invoice form (the date the
    // other invoice-based reports use). Only the hourly view needs a time of
    // day, which comes from created_at: when the invoice was keyed in.
    let selectDate = "";
    let invoiceSelectDate = "";

    switch (interval) {
        case 'hourly':
            selectDate = "DATE_FORMAT(pt.transaction_time, '%Y-%m-%d %H:00:00')";
            invoiceSelectDate = "DATE_FORMAT(TIMESTAMP(sinv.invoice_date, TIME(sinv.created_at)), '%Y-%m-%d %H:00:00')";
            break;
        case 'monthly':
            selectDate = "DATE_FORMAT(pt.transaction_time, '%Y-%m-01')";
            invoiceSelectDate = "DATE_FORMAT(sinv.invoice_date, '%Y-%m-01')";
            break;
        case 'daily':
        default:
            selectDate = "DATE(pt.transaction_time)";
            invoiceSelectDate = "DATE(sinv.invoice_date)";
            break;
    }

    // BACK-OFFICE SALES. Sales invoices keyed in on Sales > Invoices write
    // sales_invoices only (no pos_transactions row), so a report that reads
    // pos_transactions alone never saw them. They are added as a second leg.
    // See lib/backoffice-sales.ts for why transaction_source (not notes) is the
    // discriminator and why a Pending invoice counts.
    //
    // A terminal filter excludes this leg entirely: a back-office invoice is
    // not rung up on any terminal, so "Terminal 2" has no back-office sales.
    // The payment-type filter applies to the invoice's own payment_method.
    const includeBackoffice = !(terminalId && terminalId !== 'all');
    const invoiceParams: any[] = [];
    let invoiceWhere = `WHERE ${backofficeInvoiceSql('sinv')}`;
    if (paymentType && paymentType !== 'all') {
        invoiceWhere += " AND sinv.payment_method = ?";
        invoiceParams.push(paymentType);
    }
    if (startDate) {
        invoiceWhere += " AND DATE(sinv.invoice_date) >= ?";
        invoiceParams.push(startDate);
    }
    if (endDate) {
        invoiceWhere += " AND DATE(sinv.invoice_date) <= ?";
        invoiceParams.push(endDate);
    }

    // One row per sale or return, from either source, carrying just the columns
    // the daily/hourly/monthly aggregation needs. UNION ALL, never UNION: two
    // distinct sales with identical amounts must not collapse into one.
    //
    // Row ids are deliberately NOT selected. pos_transactions.id and
    // sales_invoices.id may differ in collation, and a UNION over differing
    // collations fails at runtime ("Illegal mix of collations"). Counting uses
    // the is_sale flag instead; every row here is exactly one transaction
    // (sales_transactions is joined on its primary key, so it cannot fan out,
    // and is a LEFT JOIN so a sale whose row is missing is still reported).
    //
    // si_number / bir_or_number are NULL on the invoice leg: those are BIR
    // series issued at a terminal, so the "invoice range" column stays an
    // honest POS-only range rather than mixing in INV-000123 style numbers.
    //
    // POS cost: per SELLING unit, from the cost_at_sale snapshot on the linked
    // sale_items row. pos_transaction_items has no cost_at_sale of its own, and
    // costing it from products.cost alone reported TODAY's cost against a filed
    // sale, so this report disagreed with Sales Transactions on the same day.
    // Same expression as app/api/sales/transactions/route.ts. See
    // lib/cost-of-sale.ts.
    const posLeg = `
        SELECT
            ${selectDate} AS bucket,
            CASE WHEN pt.transaction_type = 'sale' THEN 1 ELSE 0 END AS is_sale,
            0 AS is_backoffice,
            CASE WHEN pt.transaction_type = 'sale' THEN pt.si_number END AS si_number,
            CASE WHEN pt.transaction_type = 'sale' THEN pt.bir_or_number END AS bir_or_number,
            pt.total_amount AS total_amount,
            pt.discount_amount AS discount_amount,
            pt.tax_amount AS tax_amount,
            (SELECT SUM(pti.quantity * COALESCE(
                      ${unitCostExpr('si', 'p', { hasCostAtSale: true })},
                      ${unitCostExpr('pti', 'p', { hasCostAtSale: false })}
                    ))
             FROM pos_transaction_items pti
             LEFT JOIN products p ON pti.product_id = p.id
             LEFT JOIN sale_items si ON pti.sale_item_id = si.id
             WHERE pti.pos_transaction_id = pt.id) AS cost
        FROM pos_transactions pt
        LEFT JOIN sales_transactions st ON pt.sale_id = st.id
        ${whereClause}`;

    // Invoice cost: sales_invoice_items carries its own cost_at_sale (written by
    // CreateSaleUseCase), with the scaled products.cost fallback for any line
    // that predates batch costing.
    const invoiceLeg = `
        UNION ALL
        SELECT
            ${invoiceSelectDate} AS bucket,
            1 AS is_sale,
            1 AS is_backoffice,
            NULL AS si_number,
            NULL AS bir_or_number,
            sinv.total AS total_amount,
            0 AS discount_amount,
            COALESCE(sinv.vat_amount, 0) AS tax_amount,
            (SELECT SUM(sii.quantity * ${unitCostExpr('sii', 'p', { hasCostAtSale: true })})
             FROM sales_invoice_items sii
             LEFT JOIN products p ON sii.product_id = p.id
             WHERE sii.sales_invoice_id = sinv.id) AS cost
        FROM sales_invoices sinv
        ${invoiceWhere}`;

    const dayRows = `${posLeg}${includeBackoffice ? invoiceLeg : ''}`;
    const dayParams = includeBackoffice ? [...params, ...invoiceParams] : [...params];

    // Get total count of groups for pagination.
    const countQuery = `
        SELECT COUNT(DISTINCT bucket) as total
        FROM (${dayRows}) day_rows
    `;
    const countResult = await query(countQuery, dayParams);
    const totalCount = countResult[0]?.total || 0;
    const totalPages = Math.ceil(totalCount / limit);

    const queryStr = `
        SELECT
            bucket as date,
            -- Sales only: a return row is not a transaction of its own here.
            SUM(is_sale) as transaction_count,
            SUM(is_backoffice) as backoffice_count,
            SUM(CASE WHEN is_backoffice = 1 THEN total_amount ELSE 0 END) as backoffice_revenue,
            -- SI numbers, not order numbers: this column reports the invoice
            -- range for the day, which is what BIR filing is reconciled
            -- against.
            --
            -- Rows with no SI number are excluded rather than falling back to
            -- the order number: mixing the two numbering schemes in one range
            -- (e.g. "000007 - 20") reads as a real invoice span and would be
            -- wrong to file against. A day with no SI numbers shows "-".
            MIN(si_number) as start_or,
            MAX(si_number) as end_or,
            -- BIR OR numbers, kept in their own MIN/MAX pair rather than
            -- merged into the SI range above: si_number (goods) and
            -- bir_or_number (services) are independent BIR numbering
            -- sequences, so mixing them into one range would misrepresent
            -- either series when filing. A day with no OR numbers shows "-".
            MIN(bir_or_number) as start_bir_or,
            MAX(bir_or_number) as end_bir_or,
            SUM(total_amount) as total_revenue,
            SUM(discount_amount) as total_discount,
            SUM(tax_amount) as total_tax,
            SUM(cost) as total_cost
        FROM (${dayRows}) day_rows
        GROUP BY 1
        ORDER BY date DESC
        LIMIT ? OFFSET ?
    `;

    const result = await query(queryStr, [...dayParams, limit, offset]);

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
        const profit = profitOf(totalRevenue, totalCost);

        return {
            date: date,
            transactionCount: parseInt(row.transaction_count),
            // Of which back-office sales invoices, and their revenue. Both are
            // already inside transactionCount / totalRevenue; exposed so the
            // page can show how much of a day was not rung up at a till.
            backofficeCount: parseInt(row.backoffice_count) || 0,
            backofficeRevenue: parseFloat(row.backoffice_revenue) || 0,
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
