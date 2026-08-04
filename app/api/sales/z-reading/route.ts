import { NextRequest, NextResponse } from 'next/server';
import { query, getNextZReadingNumber } from '@/lib/mysql';
import { format } from 'date-fns';
import { saveEJournalFiles } from '@/lib/ejournal/ejournal-writer';
import { sendZReadingToStaLucia } from '@/lib/integrations/sta-lucia/send-z-reading';

const safeParseFloat = (val: any): number => {
    if (val === null || val === undefined) return 0;
    const n = parseFloat(val);
    return isNaN(n) ? 0 : n;
}

const safeInt = (val: any): number => {
    if (val === null || val === undefined) return 0;
    if (typeof val === 'bigint') return Number(val);
    return parseInt(val);
}

async function ensureZReadingsSchema() {
    try {
        const currentColumnsResult = await query(
            "SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'z_readings' AND TABLE_SCHEMA = DATABASE()"
        ) as any[];
        const existingColumnsMap = new Map<string, string>(
            currentColumnsResult.map((c: any) => [c.COLUMN_NAME, (c.DATA_TYPE || '').toLowerCase()])
        );
        const existingColumns = new Set(existingColumnsMap.keys());

        const columnsToAdd = [
            { name: 'discount_summary', type: 'JSON' },
            { name: 'sales_adjustment', type: 'JSON' },
            { name: 'vat_adjustment', type: 'DECIMAL(15,2) DEFAULT 0.00' },
            { name: 'vatable_sales', type: 'DECIMAL(15,2) DEFAULT 0.00' },
            { name: 'vat_exempt', type: 'DECIMAL(15,2) DEFAULT 0.00' },
            { name: 'zero_rated', type: 'DECIMAL(15,2) DEFAULT 0.00' },
            { name: 'non_vat', type: 'DECIMAL(15,2) DEFAULT 0.00' },
            { name: 'min_void_id', type: 'VARCHAR(50)' },
            { name: 'max_void_id', type: 'VARCHAR(50)' },
            { name: 'min_return_id', type: 'VARCHAR(50)' },
            { name: 'max_return_id', type: 'VARCHAR(50)' },
            { name: 'void_amount', type: 'DECIMAL(15,2) DEFAULT 0.00' },
            { name: 'previous_reading', type: 'DECIMAL(15,2) DEFAULT 0.00' },
            { name: 'running_total', type: 'DECIMAL(15,2) DEFAULT 0.00' },
            { name: 'z_counter', type: 'INT DEFAULT 0' },
            { name: 'reset_counter', type: 'INT DEFAULT 0' },
            { name: 'min_sale_id', type: 'VARCHAR(50)' },
            { name: 'max_sale_id', type: 'VARCHAR(50)' },
            { name: 'actual_cash', type: 'DECIMAL(15,2) DEFAULT 0.00' },
            { name: 'cash_difference', type: 'DECIMAL(15,2) DEFAULT 0.00' }
        ];

        for (const col of columnsToAdd) {
            if (!existingColumns.has(col.name)) {
                await query(`ALTER TABLE z_readings ADD COLUMN ${col.name} ${col.type}`);
                console.log(`✅ Added ${col.name} column to z_readings`);
            }
        }

        // Fix vat_adjustment if it was previously created as JSON instead of DECIMAL
        const vatAdjType = existingColumnsMap.get('vat_adjustment');
        if (vatAdjType && vatAdjType === 'json') {
            await query(`ALTER TABLE z_readings MODIFY COLUMN vat_adjustment DECIMAL(15,2) DEFAULT 0.00`);
            console.log(`✅ Migrated vat_adjustment column type from JSON to DECIMAL(15,2)`);
        }
    } catch (error) {
        console.error('Error ensuring z_readings schema:', error);
    }
}

export async function GET(request: NextRequest) {
  try {
    await ensureZReadingsSchema();

    const { searchParams } = new URL(request.url);
    const mode = searchParams.get('mode');
    let startDate = searchParams.get('startDate');
    let endDate = searchParams.get('endDate');
    let terminalId = searchParams.get('terminalId') || 'all'; 

    const settingsSql = `SELECT business_name, address FROM pos_settings LIMIT 1`;
    const [settingsResult] = await query(settingsSql) as any[];
    const businessName = settingsResult?.business_name || 'Business Name';
    const businessAddress = settingsResult?.address || '';

    if (mode === 'current') {
        const lastZSql = `
            SELECT report_date 
            FROM z_readings 
            WHERE 1=1
            ${terminalId && terminalId !== 'all' ? 'AND terminal_id = ?' : ''}
            ORDER BY report_date DESC 
            LIMIT 1
        `;
        const lastZParams = terminalId && terminalId !== 'all' ? [terminalId] : [];
        const [lastZResult] = await query(lastZSql, lastZParams) as any[];

        startDate = lastZResult && lastZResult.report_date 
            ? format(new Date(lastZResult.report_date), 'yyyy-MM-dd HH:mm:ss')
            : null;
        
        endDate = format(new Date(), 'yyyy-MM-dd HH:mm:ss');

        let dateCondition = '';
        const dateParams: any[] = [];
        if (startDate) {
            dateCondition += ' AND st.created_at > ?';
            dateParams.push(startDate);
        }
        if (endDate) {
            dateCondition += ' AND st.created_at <= ?';
            dateParams.push(endDate);
        }

        let terminalCondition = '';
        if (terminalId && terminalId !== 'all') {
            terminalCondition = ' AND pt.terminal_id = ?';
            dateParams.push(terminalId);
        }

        const salesBaseSql = `
            FROM sales_transactions st
            JOIN pos_transactions pt ON st.id = pt.sale_id
            WHERE st.status NOT IN ('Void', 'Voided', 'Cancelled', 'Returned')
            AND pt.is_training = 0
            ${dateCondition}
            ${terminalCondition}
        `;

        const salesSql = `
            SELECT 
                SUM(st.total) as gross_sales,
                COUNT(*) as transaction_count,
                MIN(st.si_number) as min_sale_id,
                MAX(st.si_number) as max_sale_id,
                SUM(pt.discount_amount) as total_discounts
            ${salesBaseSql}
        `;
        const [salesResult] = await query(salesSql, dateParams) as any[];

        const returnsSql = `
            SELECT SUM(st.total) as total_returns
            FROM sales_transactions st
            JOIN pos_transactions pt ON st.id = pt.sale_id
            WHERE st.status = 'Returned'
            AND pt.is_training = 0
            ${dateCondition}
            ${terminalCondition}
        `;
        const [returnsResult] = await query(returnsSql, dateParams) as any[];

        const voidSeqSql = `
            SELECT 
                MIN(st.si_number) as min_void_id,
                MAX(st.si_number) as max_void_id,
                SUM(st.total) as void_amount
            FROM sales_transactions st
            JOIN pos_transactions pt ON st.id = pt.sale_id
            WHERE st.status IN ('Void', 'Voided', 'Cancelled')
            AND pt.is_training = 0
            ${dateCondition}
            ${terminalCondition}
        `;
        const [voidSeqResult] = await query(voidSeqSql, dateParams) as any[];
        const voidAmount = parseFloat(voidSeqResult?.void_amount || 0);

        const returnSequenceSql = `
           SELECT 
                MIN(st.si_number) as min_return_id,
                MAX(st.si_number) as max_return_id
           FROM pos_transactions pt
           LEFT JOIN sales_transactions st ON pt.sale_id = st.id
           WHERE pt.transaction_type = 'return'
           AND pt.is_training = 0
           ${dateCondition.replace(/st\.created_at/g, 'pt.created_at')}
           ${terminalCondition}
        `;
        const [returnSeqResult] = await query(returnSequenceSql, dateParams) as any[];

        const paymentSql = `
          SELECT 
            st.payment_method, 
            SUM(st.total) as amount
          FROM sales_transactions st
          JOIN pos_transactions pt ON st.id = pt.sale_id
          WHERE st.status NOT IN ('Void', 'Voided', 'Cancelled', 'Returned')
          AND pt.is_training = 0
          ${dateCondition}
          ${terminalCondition}
          GROUP BY st.payment_method
        `;
        const paymentResults = await query(paymentSql, dateParams) as any[];
        
        // Detailed Summaries
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
            ${dateCondition.replace(/st\.created_at/g, 'pt.created_at')}
            ${terminalCondition}
            GROUP BY pti.discount_type
            HAVING SUM(pti.discount_amount) > 0
            ORDER BY SUM(pti.discount_amount) DESC
        `;
        const discountSummaryResults = await query(discountSummarySql, dateParams) as any[];

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
            ${dateCondition.replace(/st\.created_at/g, 'pt.created_at')}
            ${terminalCondition}
            GROUP BY pti.tax_type
        `;
        const vatAdjustmentResults = await query(vatAdjustmentSql, dateParams) as any[];

        const shiftSql = `
            SELECT 
                SUM(starting_cash) as total_starting_cash,
                SUM(actual_cash) as total_actual_cash,
                SUM(cash_difference) as total_cash_difference
            FROM shifts
            WHERE 1=1
            ${startDate ? ' AND start_time > ?' : ''}
            AND start_time <= ?
            ${terminalId && terminalId !== 'all' ? ' AND terminal_id = ?' : ''}
        `;
        const shiftParams = startDate ? [startDate, endDate] : [endDate];
        if (terminalId && terminalId !== 'all') shiftParams.push(terminalId);
        const [shiftResult] = await query(shiftSql, shiftParams) as any[];

        const previousReadingSql = `
            SELECT SUM(net_sales) as previous_total
            FROM z_readings
            WHERE report_date <= ?
            ${terminalId && terminalId !== 'all' ? 'AND terminal_id = ?' : ''}
        `;
        const cutoffDate = startDate ? new Date(startDate) : new Date('2000-01-01');
        const previousReadingParams: any[] = [cutoffDate];
        if (terminalId && terminalId !== 'all') previousReadingParams.push(terminalId);
        
        const [prevReadingResult] = await query(previousReadingSql, previousReadingParams) as any[];
        const previousReading = parseFloat(prevReadingResult?.previous_total || 0);

        const rawNetSales = parseFloat(salesResult?.gross_sales || 0);
        const discounts = parseFloat(salesResult?.total_discounts || 0);
        const returns = parseFloat(returnsResult?.total_returns || 0);
        
        const adjustedGrossSales = rawNetSales + discounts + returns + voidAmount;
        const finalNetSales = rawNetSales; 
        const vatRow = vatAdjustmentResults.find((v: any) => v.tax_type === 'VAT');
        const vatTotalAmount = parseFloat(vatRow?.total_amount || 0);
        const vatAmount = parseFloat(vatRow?.vat_amount || 0);
        const vatableSales = vatTotalAmount - vatAmount;
        const startingCash = parseFloat(shiftResult?.total_starting_cash || 0);
        const actualCash = parseFloat(shiftResult?.total_actual_cash || 0);
        const cashVariance = parseFloat(shiftResult?.total_cash_difference || 0);
        
        const cashSalesObj = paymentResults.find((p: any) => p.payment_method?.toUpperCase() === 'CASH');
        const cashSales = parseFloat(cashSalesObj?.amount || 0);

        // Cash membership fees over the same date/terminal scope as this Z-reading.
        // Membership is not a sale (never in pos_transactions), but its cash sits in the
        // drawer, so it must be counted toward reconciliation.
        let membershipWhere = "WHERE payment_method = 'cash'";
        const membershipParams: any[] = [];
        if (startDate) { membershipWhere += ' AND created_at > ?'; membershipParams.push(startDate); }
        if (endDate) { membershipWhere += ' AND created_at <= ?'; membershipParams.push(endDate); }
        if (terminalId && terminalId !== 'all') { membershipWhere += ' AND terminal_id = ?'; membershipParams.push(terminalId); }
        const membershipCashRows: any[] = await query(
            `SELECT
                COALESCE(SUM(amount), 0) AS membership_cash,
                COALESCE(SUM(is_new_card = 1), 0) AS activation_count,
                COALESCE(SUM(is_new_card = 0), 0) AS renewal_count
             FROM membership_payments ${membershipWhere}`,
            membershipParams
        );
        const membershipCash = parseFloat(membershipCashRows[0]?.membership_cash || 0);
        const membershipActivationCount = safeInt(membershipCashRows[0]?.activation_count);
        const membershipRenewalCount = safeInt(membershipCashRows[0]?.renewal_count);

        const cashInDrawer = startingCash + cashSales + membershipCash;
        const runningTotal = previousReading + finalNetSales;

        const paymentMethods = paymentResults.map((p: any) => ({
            name: p.payment_method || 'Unknown',
            amount: parseFloat(p.amount)
        }));

        let terminalMin = '';
        let terminalSn = '';
        let terminalPermitNo = '';
        let terminalAccreditationNo = '';
        let terminalPermitDateIssued = '';
        let terminalZCounter = 0;
        let terminalResetCounter = 0;

        if (terminalId && terminalId !== 'all') {
            const termSql = `SELECT min_number, serial_number, permit_no, accreditation_no, permit_date_issued, z_counter, reset_counter FROM pos_terminals WHERE id = ?`;
            const [termResult] = await query(termSql, [terminalId]) as any[];
            if (termResult) {
                terminalMin = termResult.min_number;
                terminalSn = termResult.serial_number;
                terminalPermitNo = termResult.permit_no;
                terminalAccreditationNo = termResult.accreditation_no;
                terminalPermitDateIssued = termResult.permit_date_issued;
                terminalZCounter = safeInt(termResult.z_counter);
                terminalResetCounter = safeInt(termResult.reset_counter);
            }
        }

        const vatExemptSales = vatAdjustmentResults.find((v: any) => v.tax_type === 'VAT_EXEMPT')?.total_amount || 0;
        const zeroRatedSales = vatAdjustmentResults.find((v: any) => v.tax_type === 'ZERO_RATED')?.total_amount || 0;
        const nonVatSales = vatAdjustmentResults.find((v: any) => v.tax_type === 'NON_VAT')?.total_amount || 0;
        const vatAdjustmentAmount = vatAdjustmentResults.filter((v: any) => v.tax_type !== 'VAT').reduce((acc: number, v: any) => acc + parseFloat(v.vat_amount || 0), 0);

        const generatedReading = {
            id: `PREVIEW`,
            date: format(new Date(), 'yyyy-MM-dd HH:mm:ss'),
            reportDate: new Date(),
            businessName,
            address: businessAddress,
            grossSales: safeParseFloat(adjustedGrossSales),
            returns: safeParseFloat(returns),
            discounts: safeParseFloat(discounts),
            netSales: safeParseFloat(finalNetSales),
            vatSales: safeParseFloat(vatableSales),
            vatAmount: safeParseFloat(vatAmount),
            vatExempt: safeParseFloat(vatExemptSales),
            zeroRated: safeParseFloat(zeroRatedSales),
            nonVat: safeParseFloat(nonVatSales),
            paymentMethods: paymentMethods.map((pm: any) => ({
                name: String(pm.name),
                amount: safeParseFloat(pm.amount)
            })),
            transactionCount: safeInt(salesResult?.transaction_count),
            startingCash: safeParseFloat(startingCash),
            cashSales: safeParseFloat(cashSales),
            membershipCash: safeParseFloat(membershipCash),
            membershipActivationCount: membershipActivationCount,
            membershipRenewalCount: membershipRenewalCount,
            cashInDrawer: safeParseFloat(cashInDrawer),
            cashierName: 'Admin',
            terminalId: terminalId,
            terminalMin: terminalMin || '',
            terminalSerialNumber: terminalSn || '',
            terminalPermitNo: terminalPermitNo || '',
            terminalAccreditationNo: terminalAccreditationNo || '',
            terminalPermitDateIssued: terminalPermitDateIssued || '',
            minSaleId: salesResult?.min_sale_id ? String(salesResult.min_sale_id).padStart(6, '0') : '000000',
            maxSaleId: salesResult?.max_sale_id ? String(salesResult.max_sale_id).padStart(6, '0') : '000000',
            minVoidId: voidSeqResult?.min_void_id ? String(voidSeqResult.min_void_id).padStart(6, '0') : '000000',
            maxVoidId: voidSeqResult?.max_void_id ? String(voidSeqResult.max_void_id).padStart(6, '0') : '000000',
            minReturnId: returnSeqResult?.min_return_id ? String(returnSeqResult.min_return_id).padStart(6, '0') : '000000',
            maxReturnId: returnSeqResult?.max_return_id ? String(returnSeqResult.max_return_id).padStart(6, '0') : '000000',
            previousReading: safeParseFloat(previousReading),
            runningTotal: safeParseFloat(runningTotal),
            voidAmount: safeParseFloat(voidAmount),
            vatAdjustment: safeParseFloat(vatAdjustmentAmount),
            discountSummary: discountSummaryResults.map((d: any) => ({
                type: d.discount_type,
                amount: parseFloat(d.total_amount),
                count: parseInt(d.txn_count),
                itemCount: parseInt(d.item_count)
            })),
            salesAdjustment: {
                void: {
                    count: 0, // Need to implement void count if possible
                    amount: voidAmount
                },
                return: {
                    count: 0, // Need to implement return count if possible
                    amount: returns
                }
            },
            zCounter: terminalZCounter + 1,
            resetCounter: terminalResetCounter,
            actualCash,
            variance: cashVariance,
            intervalStartDate: startDate
        };

        
        return NextResponse.json({ success: true, data: [generatedReading] });

    } else {
        let querySql = `
            SELECT z.*, pt.min_number AS terminal_min, pt.serial_number AS terminal_sn,
                   pt.permit_no AS terminal_permit_no, pt.accreditation_no AS terminal_accreditation_no,
                   pt.permit_date_issued AS terminal_permit_date_issued
            FROM z_readings z
            LEFT JOIN pos_terminals pt ON z.terminal_id = pt.id
            WHERE 1=1
        `;
        const queryParams: any[] = [];
        if (startDate) {
            querySql += ' AND z.report_date >= ?';
            queryParams.push(`${startDate} 00:00:00`);
        }
        if (endDate) {
            querySql += ' AND z.report_date <= ?';
            queryParams.push(`${endDate} 23:59:59`);
        }
        if (terminalId && terminalId !== 'all') {
            querySql += ' AND z.terminal_id = ?';
            queryParams.push(terminalId);
        }
        querySql += ' ORDER BY z.report_date DESC';

        const results = await query(querySql, queryParams) as any[];

        const mappedResults = results.map((row: any) => {
             let paymentMethods = [];
             try {
                const parsed = typeof row.payment_methods === 'string' ? JSON.parse(row.payment_methods) : row.payment_methods;
                paymentMethods = Array.isArray(parsed) ? parsed : [];
             } catch (e) {
                paymentMethods = [];
             }

             let discountSummary = [];
             try {
                 const parsed = typeof row.discount_summary === 'string' ? JSON.parse(row.discount_summary) : row.discount_summary;
                 discountSummary = Array.isArray(parsed) ? parsed : [];
             } catch (e) {}

             let salesAdjustment = { void: { count: 0, amount: 0 }, return: { count: 0, amount: 0 } };
             try {
                 const parsed = typeof row.sales_adjustment === 'string' ? JSON.parse(row.sales_adjustment) : row.sales_adjustment;
                 if (parsed) salesAdjustment = parsed;
             } catch (e) {}
             
             return {
                id: row.reading_number,
                date: format(new Date(row.report_date), 'yyyy-MM-dd HH:mm:ss'),
                reportDate: new Date(row.report_date),
                businessName, 
                address: businessAddress,
                grossSales: safeParseFloat(row.gross_sales),
                returns: safeParseFloat(row.returns),
                discounts: safeParseFloat(row.discounts),
                netSales: safeParseFloat(row.net_sales),
                vatSales: safeParseFloat(row.vat_sales), 
                vatAmount: safeParseFloat(row.vat_amount),
                vatExempt: safeParseFloat(row.vat_exempt),
                zeroRated: safeParseFloat(row.zero_rated),
                nonVat: safeParseFloat(row.non_vat),
                paymentMethods: paymentMethods.map((pm: any) => ({
                    name: String(pm.name),
                    amount: safeParseFloat(pm.amount)
                })),
                transactionCount: safeInt(row.transaction_count),
                startingCash: safeParseFloat(row.starting_cash),
                cashSales: safeParseFloat(row.cash_sales),
                cashInDrawer: safeParseFloat(row.cash_in_drawer),
                cashierName: row.cashier_name,
                terminalId: row.terminal_id,
                terminalMin: row.terminal_min || '',
                terminalSerialNumber: row.terminal_sn || '',
                terminalPermitNo: row.terminal_permit_no || '',
                terminalAccreditationNo: row.terminal_accreditation_no || '',
                terminalPermitDateIssued: row.terminal_permit_date_issued || '',
                minSaleId: row.min_sale_id || '',
                maxSaleId: row.max_sale_id || '',
                minVoidId: row.min_void_id || '',
                maxVoidId: row.max_void_id || '',
                minReturnId: row.min_return_id || '',
                maxReturnId: row.max_return_id || '',
                previousReading: safeParseFloat(row.previous_reading), 
                runningTotal: safeParseFloat(row.running_total),
                voidAmount: safeParseFloat(row.void_amount),
                vatAdjustment: safeParseFloat(row.vat_adjustment),
                discountSummary,
                salesAdjustment,
                actualCash: safeParseFloat(row.actual_cash),
                variance: safeParseFloat(row.cash_difference),
                zCounter: safeInt(row.z_counter),
                resetCounter: safeInt(row.reset_counter)
             };

        });

        return NextResponse.json({ success: true, data: mappedResults });
    }
  } catch (error: any) {
    console.error('Error fetching Z-readings:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch Z-readings', details: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
    try {
        await ensureZReadingsSchema();

        const body = await request.json();
        const ejTerminal = body.terminalId && body.terminalId !== 'all' ? body.terminalId : 'all';
        let { terminalId, cashierName } = body;
        terminalId = terminalId && terminalId !== 'all' ? terminalId : 'terminal_default_01';
        cashierName = cashierName || 'Admin';

        const lastZSql = `SELECT report_date FROM z_readings WHERE terminal_id = ? ORDER BY report_date DESC LIMIT 1`;
        const [lastZResult] = await query(lastZSql, [terminalId]) as any[];
        const startDate = lastZResult && lastZResult.report_date ? format(new Date(lastZResult.report_date), 'yyyy-MM-dd HH:mm:ss') : null;
        const endDate = format(new Date(), 'yyyy-MM-dd HH:mm:ss');
        const readingNumber = await getNextZReadingNumber(terminalId);

        let dateCondition = '';
        const dateParams: any[] = [];
        if (startDate) {
           dateCondition += ' AND st.created_at > ?';
           dateParams.push(startDate);
        }
        if (endDate) {
           dateCondition += ' AND st.created_at <= ?';
           dateParams.push(endDate);
        }

        const salesBaseSql = `
            FROM sales_transactions st
            JOIN pos_transactions pt ON st.id = pt.sale_id
            WHERE st.status NOT IN ('Void', 'Voided', 'Cancelled', 'Returned')
            AND pt.is_training = 0
            ${dateCondition}
            AND pt.terminal_id = ?
        `;
        const salesParams = [...dateParams, terminalId];

        const salesSql = `SELECT SUM(st.total) as gross_sales, COUNT(*) as transaction_count, MIN(st.si_number) as min_sale_id, MAX(st.si_number) as max_sale_id, SUM(pt.discount_amount) as total_discounts ${salesBaseSql}`;
        const [salesResult] = await query(salesSql, salesParams) as any[];

        const returnsSql = `SELECT SUM(st.total) as total_returns FROM sales_transactions st JOIN pos_transactions pt ON st.id = pt.sale_id WHERE st.status = 'Returned' AND pt.is_training = 0 ${dateCondition} AND pt.terminal_id = ?`;
        const [returnsResult] = await query(returnsSql, salesParams) as any[];

        const paymentSql = `SELECT st.payment_method, SUM(st.total) as amount FROM sales_transactions st JOIN pos_transactions pt ON st.id = pt.sale_id WHERE st.status NOT IN ('Void', 'Voided', 'Cancelled', 'Returned') AND pt.is_training = 0 ${dateCondition} AND pt.terminal_id = ? GROUP BY st.payment_method`;
        const paymentResults = await query(paymentSql, salesParams) as any[];

        const voidSeqSql = `SELECT MIN(st.si_number) as min_void_id, MAX(st.si_number) as max_void_id, SUM(st.total) as void_amount FROM sales_transactions st JOIN pos_transactions pt ON st.id = pt.sale_id WHERE st.status IN ('Void', 'Voided', 'Cancelled') AND pt.is_training = 0 ${dateCondition} AND pt.terminal_id = ?`;
        const [voidSeqResult] = await query(voidSeqSql, salesParams) as any[];
        const voidAmount = parseFloat(voidSeqResult?.void_amount || 0);

        const returnSeqSql = `SELECT MIN(st.si_number) as min_return_id, MAX(st.si_number) as max_return_id FROM pos_transactions pt LEFT JOIN sales_transactions st ON pt.sale_id = st.id WHERE pt.transaction_type = 'return' AND pt.is_training = 0 ${dateCondition.replace(/st\.created_at/g, 'pt.created_at')} AND pt.terminal_id = ?`;
        const [returnSeqResult] = await query(returnSeqSql, salesParams) as any[];

        // Detailed Summaries for POST
        const discountSummarySql = `
            SELECT 
                pti.discount_type,
                SUM(pti.discount_amount) as total_amount,
                COUNT(DISTINCT pt.id) as txn_count,
                COUNT(pti.id) as item_count
            FROM pos_transaction_items pti
            JOIN pos_transactions pt ON pti.pos_transaction_id = pt.id
            JOIN sales_transactions st ON pt.sale_id = st.id
            WHERE st.status NOT IN ('Void', 'Voided', 'Cancelled', 'Returned')
            AND pt.is_training = 0
            AND pti.discount_amount > 0
            ${dateCondition.replace(/st\.created_at/g, 'pt.created_at')}
            AND pt.terminal_id = ?
            GROUP BY pti.discount_type
            HAVING SUM(pti.discount_amount) > 0
            ORDER BY SUM(pti.discount_amount) DESC
        `;
        const discountSummaryResults = await query(discountSummarySql, [...dateParams, terminalId]) as any[];

        const vatAdjustmentSql = `
            SELECT 
                pti.tax_type,
                SUM(pti.line_total) as total_amount,
                SUM(CASE 
                    WHEN pti.tax_type = 'VAT' THEN pti.line_total - (pti.line_total / 1.12)
                    ELSE 0 
                END) as vat_amount
            FROM pos_transaction_items pti
            JOIN pos_transactions pt ON pti.pos_transaction_id = pt.id
            JOIN sales_transactions st ON pt.sale_id = st.id
            WHERE st.status NOT IN ('Void', 'Voided', 'Cancelled', 'Returned')
            AND pt.is_training = 0
            ${dateCondition.replace(/st\.created_at/g, 'pt.created_at')}
            AND pt.terminal_id = ?
            GROUP BY pti.tax_type
        `;
        const vatAdjustmentResults = await query(vatAdjustmentSql, [...dateParams, terminalId]) as any[];

        const shiftSql = `
            SELECT 
                SUM(starting_cash) as total_starting_cash,
                SUM(actual_cash) as total_actual_cash,
                SUM(cash_difference) as total_cash_difference
            FROM shifts 
            WHERE 1=1 ${startDate ? ' AND start_time > ?' : ''} AND start_time <= ? AND terminal_id = ?
        `;
        const shiftParams = startDate ? [startDate, endDate, terminalId] : [endDate, terminalId];
        const [shiftResult] = await query(shiftSql, shiftParams) as any[];

        const rawNetSales = parseFloat(salesResult?.gross_sales || 0);
        const finalNetSales = rawNetSales; 
        const vatRow = vatAdjustmentResults.find((v: any) => v.tax_type === 'VAT');
        const vatTotalAmount = parseFloat(vatRow?.total_amount || 0);
        const vatAmount = parseFloat(vatRow?.vat_amount || 0);
        const vatableSales = vatTotalAmount - vatAmount;
        const startingCash = parseFloat(shiftResult?.total_starting_cash || 0);
        const actualCash = parseFloat(shiftResult?.total_actual_cash || 0);
        const cashVariance = parseFloat(shiftResult?.total_cash_difference || 0);
        const cashSalesObj = paymentResults.find((p: any) => p.payment_method?.toUpperCase() === 'CASH');
        const cashSales = parseFloat(cashSalesObj?.amount || 0);
        const cashInDrawer = startingCash + cashSales; 

        const paymentMethods = paymentResults.map((p: any) => ({ name: p.payment_method || 'Unknown', amount: parseFloat(p.amount) }));
        const [termResult] = await query(`SELECT min_number, serial_number, permit_no, accreditation_no, permit_date_issued, z_counter, reset_counter FROM pos_terminals WHERE id = ?`, [terminalId]) as any[];
        const [prevResult] = await query(`SELECT SUM(net_sales) as previous_total FROM z_readings WHERE report_date <= ? AND terminal_id = ?`, [startDate || '2000-01-01', terminalId]) as any[];
        

        const vatExemptSales = vatAdjustmentResults.find((v: any) => v.tax_type === 'VAT_EXEMPT')?.total_amount || 0;
        const zeroRatedSales = vatAdjustmentResults.find((v: any) => v.tax_type === 'ZERO_RATED')?.total_amount || 0;
        const nonVatSales = vatAdjustmentResults.find((v: any) => v.tax_type === 'NON_VAT')?.total_amount || 0;
        const vatAdjustmentAmount = vatAdjustmentResults.filter((v: any) => v.tax_type !== 'VAT').reduce((acc: number, v: any) => acc + parseFloat(v.vat_amount || 0), 0);

        const discountSummary = discountSummaryResults.map((d: any) => ({
            type: d.discount_type,
            amount: parseFloat(d.total_amount),
            count: parseInt(d.txn_count),
            itemCount: parseInt(d.item_count)
        }));

        const salesAdjustment = {
            void: { count: 0, amount: voidAmount },
            return: { count: 0, amount: parseFloat(returnsResult?.total_returns || 0) }
        };

        const previousReading = parseFloat(prevResult?.previous_total || 0);

        const runningTotal = previousReading + finalNetSales;

        const insertSql = `
            INSERT INTO z_readings (
                reading_number, report_date, terminal_id, cashier_name, gross_sales, returns, discounts, net_sales, vat_amount,
                payment_methods, transaction_count, starting_cash, cash_sales, cash_in_drawer, min_sale_id, max_sale_id,
                min_void_id, max_void_id, min_return_id, max_return_id, z_counter, reset_counter, previous_reading, running_total,
                vatable_sales, vat_exempt, zero_rated, non_vat,
                discount_summary, sales_adjustment, vat_adjustment, void_amount,
                actual_cash, cash_difference
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        
        await query(insertSql, [
            readingNumber, endDate, terminalId, cashierName, rawNetSales + parseFloat(salesResult?.total_discounts || 0) + parseFloat(returnsResult?.total_returns || 0) + voidAmount,
            parseFloat(returnsResult?.total_returns || 0), parseFloat(salesResult?.total_discounts || 0), finalNetSales, vatAmount,
            JSON.stringify(paymentMethods), parseInt(salesResult?.transaction_count || 0), startingCash, cashSales, cashInDrawer,
            salesResult?.min_sale_id || '000000', salesResult?.max_sale_id || '000000', voidSeqResult?.min_void_id || '000000', voidSeqResult?.max_void_id || '000000',
            returnSeqResult?.min_return_id || '000000', returnSeqResult?.max_return_id || '000000', (termResult?.z_counter || 0), termResult?.reset_counter || 0,
            previousReading, runningTotal, vatableSales, vatExemptSales, zeroRatedSales, nonVatSales,
            JSON.stringify(discountSummary), JSON.stringify(salesAdjustment), vatAdjustmentAmount, voidAmount,
            actualCash, cashVariance
        ]);

        // NOTE: z_counter is already incremented atomically by getNextZReadingNumber()
        // above (see lib/mysql.ts). Do NOT increment again here, otherwise the Z Counter
        // advances by 2 per reading and no longer matches the reading number / preview.

        const [settingsResult] = await query(`SELECT business_name, address FROM pos_settings LIMIT 1`) as any[];
        const generatedReading = {
            id: readingNumber, date: endDate, reportDate: new Date(endDate), businessName: settingsResult?.business_name || 'Business Name', address: settingsResult?.address || '',
            grossSales: rawNetSales + parseFloat(salesResult?.total_discounts || 0) + parseFloat(returnsResult?.total_returns || 0) + voidAmount,
            returns: parseFloat(returnsResult?.total_returns || 0), discounts: parseFloat(salesResult?.total_discounts || 0),
            netSales: finalNetSales, vatSales: vatableSales, vatAmount, paymentMethods,
            transactionCount: parseInt(salesResult?.transaction_count || 0), startingCash, cashSales, cashInDrawer, cashierName, terminalId,
            terminalMin: termResult?.min_number || '', terminalSerialNumber: termResult?.serial_number || '',
            terminalPermitNo: termResult?.permit_no || '', terminalAccreditationNo: termResult?.accreditation_no || '',
            terminalPermitDateIssued: termResult?.permit_date_issued || '',
            minSaleId: salesResult?.min_sale_id || '000000', maxSaleId: salesResult?.max_sale_id || '000000',
            minVoidId: voidSeqResult?.min_void_id || '000000', maxVoidId: voidSeqResult?.max_void_id || '000000',
            minReturnId: returnSeqResult?.min_return_id || '000000', maxReturnId: returnSeqResult?.max_return_id || '000000',
            previousReading, runningTotal, voidAmount, vatAdjustment: vatAdjustmentAmount, 
            discountSummary: discountSummary, 
            salesAdjustment: salesAdjustment,
            vatExempt: vatExemptSales,
            zeroRated: zeroRatedSales,
            nonVat: nonVatSales,
            actualCash,
            variance: cashVariance,
            zCounter: (termResult?.z_counter || 0), resetCounter: termResult?.reset_counter || 0
        };


        const ejDate = format(new Date(endDate), 'yyyy-MM-dd');   // `format` from date-fns is already imported here
        saveEJournalFiles(ejDate, ejTerminal).catch((e) => console.error('e-journal auto-save failed:', e));

        // Sta. Lucia tenant-system submission. Detached on purpose: the Z-reading
        // row is already committed and its BIR sequence is already consumed, so a
        // third-party HTTP failure must not be able to fail, delay, or roll back
        // this response. Failures land in external_api_logs and are picked up by
        // the sync-queue sweep in lib/scheduler.ts.
        sendZReadingToStaLucia(String(readingNumber)).catch((e) =>
          console.error('Sta Lucia sales submission failed:', e),
        );

        return NextResponse.json({ success: true, data: [generatedReading] });
    } catch (error: any) {
        console.error('Error in Z-Reading POST:', error);
        return NextResponse.json({ 
            success: false, 
            error: 'Failed to save Z-Reading',
            details: error.message 
        }, { status: 500 });
    }
}
