import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/mysql';
import { format, startOfDay } from 'date-fns';

const safeParseFloat = (val: any): number => {
    if (val === null || val === undefined) return 0;
    const n = parseFloat(val);
    return isNaN(n) ? 0 : n;
}

const safeInt = (val: any): number => {
    if (val === null || val === undefined) return 0;
    if (typeof val === 'bigint') return Number(val);
    const n = parseInt(val);
    return isNaN(n) ? 0 : n;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const terminalId = searchParams.get('terminalId');
    
    if (!terminalId) {
        return NextResponse.json({ success: false, error: 'Terminal ID is required' }, { status: 400 });
    }

    const isAllTerminals = terminalId === 'all';

    // ─── OVERALL READING ─────────────────────────────────────────────────────
    // Shows transactions for the selected date range or current day (midnight → now)
    // for the selected terminal. This is a full reading regardless of Z-readings.
    // ─────────────────────────────────────────────────────────────────────────

    const startDateParam = searchParams.get('startDate');
    const endDateParam = searchParams.get('endDate');

    const startDate = startDateParam ? (startDateParam.includes(':') ? startDateParam : `${startDateParam} 00:00:00`) : format(startOfDay(new Date()), 'yyyy-MM-dd HH:mm:ss');
    const endDate   = endDateParam ? (endDateParam.includes(':') ? endDateParam : `${endDateParam} 23:59:59`) : format(new Date(), 'yyyy-MM-dd HH:mm:ss');

    // Build terminal condition
    let terminalCondition = '';
    const terminalParams: any[] = [];
    if (!isAllTerminals) {
        terminalCondition = ' AND pt.terminal_id = ?';
        terminalParams.push(terminalId);
    }

    const shiftId = searchParams.get('shiftId');
    
    // Date conditions or Shift condition
    let dateCondition = ' AND st.created_at >= ? AND st.created_at <= ?';
    let ptDateCondition = ' AND pt.created_at >= ? AND pt.created_at <= ?';
    let dateParams = [startDate, endDate];

    if (shiftId) {
        dateCondition = ' AND pt.shift_id = ?';
        ptDateCondition = ' AND pt.shift_id = ?';
        dateParams = [shiftId];
    }

    // Combined params for queries that join sales_transactions + pos_transactions
    const allParams = [...terminalParams, ...dateParams];

    // ── 1. Overall totals (completed sales + adjustments) ────────────────────
    const totalsSql = `
        SELECT 
            SUM(CASE WHEN st.status NOT IN ('Void', 'Voided', 'Cancelled', 'Returned') THEN st.total ELSE 0 END) as net_sales,
            COUNT(CASE WHEN st.status NOT IN ('Void', 'Voided', 'Cancelled', 'Returned') THEN 1 ELSE NULL END) as transaction_count,
            SUM(CASE WHEN st.status NOT IN ('Void', 'Voided', 'Cancelled', 'Returned') THEN pt.discount_amount ELSE 0 END) as completed_discounts,
            SUM(pt.discount_amount) as total_discounts_all
        FROM sales_transactions st
        JOIN pos_transactions pt ON st.id = pt.sale_id
        WHERE pt.is_training = 0
        ${terminalCondition}
        ${dateCondition}
    `;
    const [overallTotals] = await query(totalsSql, allParams) as any[];

    // ── 2. Terminal breakdown ─────────────────────────────────────────────────
    let shiftCondition = '';
    const breakdownParams = [...allParams];
    if (!isAllTerminals && !shiftId) {
        shiftCondition = ` AND pt.shift_id = (SELECT id FROM shifts WHERE terminal_id = ? ORDER BY start_time DESC LIMIT 1)`;
        breakdownParams.push(terminalId);
    }

    const terminalBreakdownSql = `
        SELECT 
            pt.terminal_id,
            t.name as terminal_name,
            SUM(st.total) as net_sales,
            COUNT(*) as transaction_count
        FROM sales_transactions st
        JOIN pos_transactions pt ON st.id = pt.sale_id
        LEFT JOIN pos_terminals t ON pt.terminal_id = t.id
        WHERE st.status NOT IN ('Void', 'Voided', 'Cancelled', 'Returned')
        AND pt.is_training = 0
        ${terminalCondition}
        ${dateCondition}
        ${shiftCondition}
        GROUP BY pt.terminal_id, t.name
    `;
    const terminalResults = await query(terminalBreakdownSql, breakdownParams) as any[];

    // ── 3. Cashier breakdown ──────────────────────────────────────────────────
    const cashierBreakdownSql = `
        SELECT 
            u.display_name as cashier_name,
            u.uid as cashier_id,
            SUM(st.total) as net_sales,
            COUNT(*) as transaction_count
        FROM sales_transactions st
        JOIN pos_transactions pt ON st.id = pt.sale_id
        LEFT JOIN users u ON pt.user_id = u.uid
        WHERE st.status NOT IN ('Void', 'Voided', 'Cancelled', 'Returned')
        AND pt.is_training = 0
        ${terminalCondition}
        ${dateCondition}
        ${shiftCondition}
        GROUP BY u.uid, u.display_name
    `;
    const cashiers = await query(cashierBreakdownSql, breakdownParams) as any[];

    // ── 4. Payment method breakdown ───────────────────────────────────────────
    const paymentSql = `
        SELECT 
            st.payment_method,
            SUM(st.total) as amount
        FROM sales_transactions st
        JOIN pos_transactions pt ON st.id = pt.sale_id
        WHERE st.status NOT IN ('Void', 'Voided', 'Cancelled', 'Returned')
        AND pt.is_training = 0
        ${terminalCondition}
        ${dateCondition}
        GROUP BY st.payment_method
    `;
    const paymentResults = await query(paymentSql, allParams) as any[];

    // ── 5. Discount summary ───────────────────────────────────────────────────
    // Only include rows that actually have a discount amount applied (> 0)
    const discountSummarySql = `
        SELECT 
            COALESCE(pti.discount_type, 'percent') as discount_type,
            SUM(pti.discount_amount) as total_amount,
            COUNT(DISTINCT pt.id) as txn_count,
            COUNT(pti.id) as item_count
        FROM pos_transaction_items pti
        JOIN pos_transactions pt ON pti.pos_transaction_id = pt.id
        JOIN sales_transactions st ON pt.sale_id = st.id
        WHERE st.status NOT IN ('Void', 'Voided', 'Cancelled', 'Returned')
        AND pt.is_training = 0
        AND pti.discount_amount > 0
        ${terminalCondition}
        ${ptDateCondition}
        GROUP BY pti.discount_type
        HAVING SUM(pti.discount_amount) > 0
        ORDER BY SUM(pti.discount_amount) DESC
    `;
    const discountSummaryResults = await query(discountSummarySql, allParams) as any[];

    // ── 6. VAT breakdown ──────────────────────────────────────────────────────
    const vatAdjustmentSql = `
        SELECT 
            COALESCE(pti.tax_type, 'VAT') as tax_type,
            SUM(pti.line_total) as total_amount,
            SUM(CASE 
                WHEN COALESCE(pti.tax_type, 'VAT') = 'VAT' THEN pti.line_total - (pti.line_total / 1.12)
                ELSE 0 
            END) as vat_amount
        FROM pos_transaction_items pti
        JOIN pos_transactions pt ON pti.pos_transaction_id = pt.id
        JOIN sales_transactions st ON pt.sale_id = st.id
        WHERE st.status NOT IN ('Void', 'Voided', 'Cancelled', 'Returned')
        AND pt.is_training = 0
        ${terminalCondition}
        ${ptDateCondition}
        GROUP BY pti.tax_type
    `;
    const vatAdjustmentResults = await query(vatAdjustmentSql, allParams) as any[];

    // ── 7. Returns & Voids ────────────────────────────────────────────────────
    let returnsDateCondition = ' AND st.updated_at >= ? AND st.updated_at <= ?';
    let returnsParams = [startDate, endDate];

    if (shiftId) {
        returnsDateCondition = ' AND pt.shift_id = ?';
        returnsParams = [shiftId];
    }

    const returnsSql = `
        SELECT SUM(st.total) as total_returns, COUNT(*) as return_count
        FROM sales_transactions st
        JOIN pos_transactions pt ON st.id = pt.sale_id
        WHERE st.status = 'Returned'
        AND pt.is_training = 0
        ${terminalCondition}
        ${returnsDateCondition}
    `;
    const [returnsResult] = await query(returnsSql, [...terminalParams, ...returnsParams]) as any[];

    const voidSql = `
        SELECT SUM(st.total) as total_void, COUNT(*) as void_count
        FROM sales_transactions st
        JOIN pos_transactions pt ON st.id = pt.sale_id
        WHERE st.status IN ('Void', 'Voided', 'Cancelled')
        AND pt.is_training = 0
        ${terminalCondition}
        ${returnsDateCondition}
    `;
    const [voidResult] = await query(voidSql, [...terminalParams, ...returnsParams]) as any[];

    // ── 8. Starting cash (Latest Shift Only) ───────────────────────────
    let shiftSql = `
        SELECT 
            s.starting_cash as total_starting_cash,
            s.actual_cash as total_actual_cash,
            s.cash_difference as total_cash_difference
        FROM shifts s
        WHERE s.start_time >= ? AND s.start_time <= ?
    `;
    const shiftParams: any[] = [startDate, endDate];
    if (!isAllTerminals) {
        shiftSql += ' AND s.terminal_id = ? ORDER BY s.start_time DESC LIMIT 1';
        shiftParams.push(terminalId);
    } else {
        // If all terminals, just sum the latest shifts per terminal
        shiftSql = `
            SELECT 
                SUM(starting_cash) as total_starting_cash,
                SUM(actual_cash) as total_actual_cash,
                SUM(cash_difference) as total_cash_difference
            FROM shifts
            WHERE start_time >= ? AND start_time <= ?
        `;
    }
    const shiftResultArray = await query(shiftSql, shiftParams) as any[];
    const shiftResult = shiftResultArray[0] || {};

    // Sums for overall totals based on the shift query
    const startingCash = safeParseFloat(shiftResult.total_starting_cash);
    const actualCash   = safeParseFloat(shiftResult.total_actual_cash);
    const cashVariance = safeParseFloat(shiftResult.total_cash_difference);

    // ── 9. Business settings & terminal info ─────────────────────────────────
    const [settingsResult] = await query(`SELECT business_name, address, tin, contact_number, vat_registration FROM pos_settings LIMIT 1`) as any[];

    let headerTerminalInfo = { min: '', sn: '', name: '', permitNo: '', accreditationNo: '' };
    if (!isAllTerminals) {
        const [termResult] = await query(
            `SELECT min_number, serial_number, permit_no, accreditation_no, name FROM pos_terminals WHERE id = ?`,
            [terminalId]
        ) as any[];
        headerTerminalInfo = {
            min: termResult?.min_number || '',
            sn: termResult?.serial_number || '',
            permitNo: termResult?.permit_no || '',
            accreditationNo: termResult?.accreditation_no || '',
            name: termResult?.name || ''
        };
    }

    // ── Computations ──────────────────────────────────────────────────────────
    const netSales          = safeParseFloat(overallTotals?.net_sales);
    const completedDiscounts = safeParseFloat(overallTotals?.completed_discounts);
    const totalReturns      = safeParseFloat(returnsResult?.total_returns);
    const totalVoid         = safeParseFloat(voidResult?.total_void);
    
    // Gross Sales = (Final Net) + (Deductions from that Net)
    // Actually, Gross should be the value BEFORE any adjustments.
    // So Gross = Net + Discounts + Returns + Voids
    const grossSales        = netSales + completedDiscounts + totalReturns + totalVoid;

    // VAT Breakdown - Use actual sums from items for accuracy
    const vatRow = vatAdjustmentResults.find((v: any) => v.tax_type === 'VAT');
    const vatTotalAmount = safeParseFloat(vatRow?.total_amount);
    const vatAmount      = safeParseFloat(vatRow?.vat_amount);
    const vatSales       = vatTotalAmount - vatAmount;

    const vatExemptSales = safeParseFloat(
        vatAdjustmentResults.find((v: any) => v.tax_type === 'VAT_EXEMPT')?.total_amount
    );
    const zeroRatedSales = safeParseFloat(
        vatAdjustmentResults.find((v: any) => v.tax_type === 'ZERO_RATED')?.total_amount
    );
    const nonVatSales = safeParseFloat(
        vatAdjustmentResults.find((v: any) => v.tax_type === 'NON_VAT')?.total_amount
    );

    const cashSalesObj = paymentResults.find((p: any) => p.payment_method?.toUpperCase() === 'CASH');
    const cashSales    = safeParseFloat(cashSalesObj?.amount);
    const cashInDrawer = startingCash + cashSales;

    const data = {
        terminalId: isAllTerminals ? 'ALL TERMINALS' : terminalId,
        terminalName: isAllTerminals ? 'All Terminals' : (headerTerminalInfo.name || terminalId),
        startDate,
        endDate,
        grossSales,
        netSales,
        totalDiscounts: completedDiscounts,
        transactionCount: safeInt(overallTotals?.transaction_count),
        vatSales,
        vatAmount,
        vatExempt: vatExemptSales,
        zeroRated: zeroRatedSales,
        nonVat: nonVatSales,
        voidAmount: totalVoid,
        voidCount: safeInt(voidResult?.void_count),
        returnAmount: totalReturns,
        returnCount: safeInt(returnsResult?.return_count),
        vatAdjustment: 0,
        startingCash,
        cashSales,
        cashInDrawer,
        actualCash,
        variance: cashVariance,
        paymentMethods: paymentResults.map((p: any) => ({
            name: p.payment_method || 'Unknown',
            amount: safeParseFloat(p.amount)
        })),
        discountSummary: [
            ...discountSummaryResults.map((d: any) => ({
                type: d.discount_type,
                amount: safeParseFloat(d.total_amount),
                count: safeInt(d.txn_count),
                itemCount: safeInt(d.item_count)
            })),
            // Add transaction-level discounts if they exist
            ...(completedDiscounts > discountSummaryResults.reduce((s: number, d: any) => s + safeParseFloat(d.total_amount), 0) + 0.01
                ? [{
                    type: 'transaction',
                    amount: completedDiscounts - discountSummaryResults.reduce((s: number, d: any) => s + safeParseFloat(d.total_amount), 0),
                    count: safeInt(overallTotals?.transaction_count), // Approximate
                    itemCount: 0
                }]
                : [])
        ],
        salesAdjustment: {
            void:   { count: safeInt(voidResult?.void_count),    amount: totalVoid },
            return: { count: safeInt(returnsResult?.return_count), amount: totalReturns }
        },
        terminals: terminalResults.map((t: any) => ({
            terminalId:       t.terminal_id,
            terminalName:     t.terminal_name || t.terminal_id,
            netSales:         safeParseFloat(t.net_sales),
            transactionCount: safeInt(t.transaction_count)
        })),
        cashiers: cashiers.map((c: any) => ({
            cashierName:      c.cashier_name || 'Unknown',
            cashierId:        c.cashier_id,
            netSales:         safeParseFloat(c.net_sales),
            transactionCount: safeInt(c.transaction_count)
        })),
        businessSettings: {
            businessName:  settingsResult?.business_name || 'Business Name',
            address:       settingsResult?.address || '',
            tin:           settingsResult?.tin || '',
            contactNumber: settingsResult?.contact_number || '',
            vatRegistration: settingsResult?.vat_registration || 'VAT'
        },
        terminalInfo: headerTerminalInfo
    };

    return NextResponse.json({ 
      success: true, 
      data,
      debug: {
        startDate,
        endDate,
        terminalId: terminalId || 'all'
      }
    });

  } catch (error: any) {
    console.error('Error fetching overall reading:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch overall reading', details: error.message }, { status: 500 });
  }
}
