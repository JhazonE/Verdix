import { NextRequest, NextResponse } from 'next/server';
import { query, getNextXReadingNumber } from '@/lib/mysql';
import { saveEJournalFiles } from '@/lib/ejournal/ejournal-writer';

// x_readings historically had its columns added ad-hoc via a one-off script
// (scripts/update_reading_schemas.ts) rather than a numbered migration or an
// in-route auto-alter like z_readings' ensureZReadingsSchema(). Adding the new
// BIR OR-series columns (Task 8, mirroring Task 7's z_readings columns) the
// same ad-hoc way would leave a fresh install's x_readings table without them
// until someone remembers to run that script. Follow z-reading's safer
// pattern instead: an idempotent auto-alter run before the INSERT that needs
// the columns.
async function ensureXReadingsSchema() {
    try {
        const currentColumns = await query(
            "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'x_readings' AND TABLE_SCHEMA = DATABASE()"
        ) as any[];
        const existingColumns = new Set(currentColumns.map((c: any) => c.COLUMN_NAME));

        const columnsToAdd = [
            // BIR OR-series counterpart of min_sale_id/max_sale_id (Task 8). Goods
            // (si_number) and services (bir_or_number) are independent BIR
            // numbering sequences, so their MIN/MAX ranges must never be merged.
            { name: 'min_sale_or_id', type: 'VARCHAR(50)' },
            { name: 'max_sale_or_id', type: 'VARCHAR(50)' },
        ];

        for (const col of columnsToAdd) {
            if (!existingColumns.has(col.name)) {
                await query(`ALTER TABLE x_readings ADD COLUMN ${col.name} ${col.type}`);
                console.log(`✅ Added ${col.name} column to x_readings`);
            }
        }
    } catch (error) {
        console.error('Error ensuring x_readings schema:', error);
    }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const cashierId = searchParams.get('cashierId');
    const shiftStatus = searchParams.get('shiftStatus');
    const limit = searchParams.get('limit');
    const shiftId = searchParams.get('shiftId');
    
    // Base query to fetch shifts
    let sql = `
      SELECT
        s.id,
        s.start_time as report_date,
        s.start_time as shift_start,
        s.end_time as shift_end,
        s.terminal_id,
        u.display_name as cashier_name,
        u.username,
        s.user_id as cashier_id,
        s.starting_cash,
        s.actual_cash,
        s.expected_cash,
        s.cash_difference,
        s.cash_difference,
        s.status as shift_status,
        s.cash_denominations,
        -- Aggregate Sales
        COALESCE(sales.gross_sales, 0) as gross_sales,
        COALESCE(sales.net_sales, 0) as net_sales,
        COALESCE(sales.vat_amount, 0) as vat_amount,
        COALESCE(sales.discounts, 0) as discounts,
        COALESCE(sales.returns_amount, 0) as returns_amount,
        COALESCE(sales.transaction_count, 0) as transaction_count,
        COALESCE(sales.cash_sales, 0) as cash_sales,
        sales.min_sale_id,
        sales.max_sale_id,
        sales.min_sale_or_id,
        sales.max_sale_or_id,
        COALESCE(sales.void_amount, 0) as void_amount,
        COALESCE(sales.refund_amount, 0) as refund_amount,
        pt_term.min_number as terminal_min,
        pt_term.serial_number as terminal_sn,
        pt_term.permit_no as terminal_permit_no,
        pt_term.accreditation_no as terminal_accreditation_no
      FROM shifts s
      LEFT JOIN users u ON s.user_id = u.uid
      LEFT JOIN pos_terminals pt_term ON s.terminal_id = pt_term.id
      LEFT JOIN (
          SELECT 
              pt.shift_id,
              SUM(CASE WHEN pt.transaction_type = 'sale' THEN pt.subtotal ELSE 0 END) as gross_sales,
              SUM(CASE WHEN pt.transaction_type = 'sale' THEN pt.total_amount ELSE 0 END) as net_sales,
              SUM(pt.tax_amount) as vat_amount,
              SUM(pt.discount_amount) as discounts,
              SUM(CASE WHEN pt.transaction_type = 'return' THEN pt.total_amount ELSE 0 END) as returns_amount,
              COUNT(CASE WHEN pt.transaction_type = 'sale' THEN 1 END) as transaction_count,
              -- Placeholder — pt.payment_method collapses split-tender sales to the
              -- literal string 'MULTIPLE', which would hide the real cash portion
              -- from the drawer reconciliation. The real per-shift cash figure is
              -- recomputed below from the same payment_details breakdown used for
              -- paymentMethods, so both stay consistent with one source of truth.
              SUM(CASE WHEN pt.transaction_type = 'sale' AND pt.payment_method = 'CASH' THEN pt.total_amount ELSE 0 END) as cash_sales,
              MIN(CASE WHEN pt.transaction_type = 'sale' THEN st.si_number END) as min_sale_id,
              MAX(CASE WHEN pt.transaction_type = 'sale' THEN st.si_number END) as max_sale_id,
              MIN(CASE WHEN pt.transaction_type = 'sale' AND pt.bir_or_number IS NOT NULL THEN pt.bir_or_number END) as min_sale_or_id,
              MAX(CASE WHEN pt.transaction_type = 'sale' AND pt.bir_or_number IS NOT NULL THEN pt.bir_or_number END) as max_sale_or_id,
              SUM(CASE WHEN pt.transaction_type = 'void' THEN pt.total_amount ELSE 0 END) as void_amount,
              SUM(CASE WHEN pt.transaction_type = 'refund' THEN pt.total_amount ELSE 0 END) as refund_amount
          FROM pos_transactions pt
          LEFT JOIN sales_transactions st ON pt.sale_id = st.id
          WHERE pt.is_training = 0
          GROUP BY pt.shift_id
      ) sales ON s.id = sales.shift_id
      WHERE 1=1
    `;

    const params: any[] = [];

    if (startDate) {
      sql += ' AND DATE(s.start_time) >= ?';
      params.push(startDate);
    }

    if (endDate) {
      sql += ' AND DATE(s.start_time) <= ?';
      params.push(endDate);
    }

    if (cashierId && cashierId !== 'all') {
      sql += ' AND s.user_id = ?';
      params.push(cashierId);
    }

    if (shiftStatus && shiftStatus !== 'all') {
      sql += ' AND s.status = ?';
      params.push(shiftStatus);
    }

    if (shiftId) {
        sql += ' AND s.id = ?';
        params.push(shiftId);
    }

    sql += ' ORDER BY s.start_time DESC';

    if (limit) {
        sql += ' LIMIT ?';
        params.push(parseInt(limit));
    }

    const rows = await query(sql, params);
    const shifts = rows as any[];

    // For each shift, we also need breakdown of payments
    const formattedReadings = await Promise.all(shifts.map(async (shift) => {
        // Fetch payment breakdown for this shift. pos_transactions.payment_method
        // collapses split-tender sales (part Cash + part GCash, etc.) to the
        // literal string 'MULTIPLE' — see use-tender.ts. The real per-method
        // split lives in payment_details (one row per tender). Prefer that;
        // fall back to pos_transactions.payment_method only for sales with no
        // payment_details rows at all, so no sale is silently dropped.
        const payments = await query(`
            SELECT name, SUM(amount) as amount FROM (
                SELECT pd.payment_method as name, SUM(pd.amount_tendered - pd.change_given) as amount
                FROM pos_transactions pt
                JOIN payment_details pd ON pd.transaction_id = pt.id
                WHERE pt.shift_id = ? AND pt.transaction_type = 'sale' AND pt.is_training = 0
                GROUP BY pd.payment_method

                UNION ALL

                SELECT pt.payment_method as name, SUM(pt.total_amount) as amount
                FROM pos_transactions pt
                WHERE pt.shift_id = ? AND pt.transaction_type = 'sale' AND pt.is_training = 0
                AND NOT EXISTS (SELECT 1 FROM payment_details pd WHERE pd.transaction_id = pt.id)
                GROUP BY pt.payment_method
            ) combined
            GROUP BY name
        `, [shift.id, shift.id]);

        // Cash membership fees for this shift. Membership is not a sale (never in
        // pos_transactions), but its cash sits in the drawer, so it must be counted
        // toward reconciliation — same as the Z-reading. Cash only; card never
        // enters the drawer.
        const membershipRows = await query(`
            SELECT
                COALESCE(SUM(amount), 0)          AS membership_cash,
                COALESCE(SUM(is_new_card = 1), 0) AS activation_count,
                COALESCE(SUM(is_new_card = 0), 0) AS renewal_count
            FROM membership_payments
            WHERE shift_id = ? AND payment_method = 'cash'
        `, [shift.id]) as any[];
        const membershipCash = parseFloat(membershipRows[0]?.membership_cash || 0);
        const membershipActivationCount = parseInt(membershipRows[0]?.activation_count || 0, 10) || 0;
        const membershipRenewalCount = parseInt(membershipRows[0]?.renewal_count || 0, 10) || 0;

        const pMethods = payments as any[];

        // Derive cash_sales from the corrected per-method breakdown above (which
        // already attributes split-tender sales to their real methods) rather
        // than shift.cash_sales, which is computed from the collapsed
        // pos_transactions.payment_method column and would miss the cash portion
        // of any split payment.
        const cashSales = pMethods
            .filter((p: any) => p.name?.toUpperCase() === 'CASH')
            .reduce((acc: number, p: any) => acc + parseFloat(p.amount || 0), 0);

        // Calculate Cash In Drawer (System) — includes cash membership fees.
        const cashInDrawer = parseFloat(shift.starting_cash) + cashSales + membershipCash;
        const overShort = parseFloat(shift.actual_cash) - cashInDrawer;

      return {
        id: shift.id,
        date: shift.report_date,
        reportDate: shift.report_date,
        shiftStart: shift.shift_start,
        shiftEnd: shift.shift_end,
        grossSales: parseFloat(shift.gross_sales) || 0,
        returns: parseFloat(shift.returns_amount) || 0,
        discounts: parseFloat(shift.discounts) || 0,
        netSales: parseFloat(shift.net_sales) || 0,
        vatAmount: parseFloat(shift.vat_amount) || 0,
        paymentMethods: pMethods.map(p => ({ name: p.name, amount: parseFloat(p.amount) })),
        transactionCount: shift.transaction_count || 0,
        startingCash: parseFloat(shift.starting_cash) || 0,
        cashSales: cashSales,
        cashInDrawer: cashInDrawer,
        membershipCash: membershipCash,
        membershipActivationCount: membershipActivationCount,
        membershipRenewalCount: membershipRenewalCount,
        cashierName: shift.cashier_name || shift.username || 'Unknown',
        cashierId: shift.cashier_id,
        terminalId: shift.terminal_id || 'Counter 1',
        shiftStatus: shift.shift_status,
        
        // Cash Count Fields for Layout
        cashCountId: shift.id.substring(0, 8).toUpperCase(),
        cashCountTotal: parseFloat(shift.actual_cash || 0),
        cashDeposit: 0,
        cashPickup: 0,
        overShort: overShort,
        cashDenominations: typeof shift.cash_denominations === 'string' 
            ? JSON.parse(shift.cash_denominations) 
            : shift.cash_denominations || [],

        // New Layout Fields
        minSaleId: shift.min_sale_id ? String(shift.min_sale_id).padStart(6, '0') : '000000',
        maxSaleId: shift.max_sale_id ? String(shift.max_sale_id).padStart(6, '0') : '000000',
        minSaleOrId: shift.min_sale_or_id ? String(shift.min_sale_or_id) : 'OR-000000',
        maxSaleOrId: shift.max_sale_or_id ? String(shift.max_sale_or_id) : 'OR-000000',
        voidAmount: parseFloat(shift.void_amount || 0),
        refundAmount: parseFloat(shift.refund_amount || 0),
        min: shift.terminal_min || '',
        sn: shift.terminal_sn || '',
        permitNo: shift.terminal_permit_no || '',
        accreditationNo: shift.terminal_accreditation_no || '',
      };
    }));

    return NextResponse.json({
      success: true,
      data: formattedReadings,
    });
  } catch (error) {
    console.error('Error fetching X-readings:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch X-readings',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      reportDate,
      shiftStart,
      shiftEnd,
      terminalId,
      cashierName,
      cashierId,
      grossSales,
      returns,
      discounts,
      netSales,
      vatAmount,
      paymentMethods,
      transactionCount,
      startingCash,
      cashSales,
      cashInDrawer,
      shiftStatus = 'active',
      minSaleId: minSaleIdRaw,
      maxSaleId: maxSaleIdRaw,
      minSaleOrId: minSaleOrIdRaw,
      maxSaleOrId: maxSaleOrIdRaw,
      voidAmount = 0,
      refundAmount = 0,
    } = body;

    const minSaleId = minSaleIdRaw ? String(minSaleIdRaw).padStart(6, '0') : '000000';
    const maxSaleId = maxSaleIdRaw ? String(maxSaleIdRaw).padStart(6, '0') : '000000';
    // bir_or_number already carries the 'OR-' prefix baked in (see
    // getNextBirOrNumber(), lib/mysql.ts) unlike si_number's bare digits, so the
    // empty-range default must be 'OR-000000', not '000000'.
    const minSaleOrId = minSaleOrIdRaw ? String(minSaleOrIdRaw) : 'OR-000000';
    const maxSaleOrId = maxSaleOrIdRaw ? String(maxSaleOrIdRaw) : 'OR-000000';

    if (!terminalId) {
        return NextResponse.json({ success: false, error: 'Terminal ID is required' }, { status: 400 });
    }

    await ensureXReadingsSchema();

    // Generate Reading Number server-side
    const readingNumber = await getNextXReadingNumber(terminalId);

    const sql = `
      INSERT INTO x_readings (
        reading_number,
        report_date,
        shift_start,
        shift_end,
        terminal_id,
        cashier_name,
        cashier_id,
        gross_sales,
        returns,
        discounts,
        net_sales,
        vat_amount,
        payment_methods,
        transaction_count,
        starting_cash,
        cash_sales,
        cash_in_drawer,
        shift_status,
        min_sale_id,
        max_sale_id,
        min_sale_or_id,
        max_sale_or_id,
        void_amount,
        refund_amount,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `;

    const formatDate = (date: any) => {
        if (!date) return null;
        const d = new Date(date);
        if (isNaN(d.getTime())) return null;
        // Format to YYYY-MM-DD HH:mm:ss for MySQL
        return d.toISOString().slice(0, 19).replace('T', ' ');
    };

    const result = await query(sql, [
      readingNumber,
      formatDate(reportDate || new Date()),
      formatDate(shiftStart),
      formatDate(shiftEnd),
      terminalId,
      cashierName,
      cashierId,
      grossSales,
      returns,
      discounts,
      netSales,
      vatAmount,
      JSON.stringify(paymentMethods),
      transactionCount,
      startingCash,
      cashSales,
      cashInDrawer,
      shiftStatus,
      minSaleId,
      maxSaleId,
      minSaleOrId,
      maxSaleOrId,
      voidAmount ?? 0,
      refundAmount ?? 0,
    ]);

    const ejDate = formatDate(reportDate || new Date())!.slice(0, 10);
    saveEJournalFiles(ejDate, terminalId || 'all').catch((e) => console.error('e-journal auto-save failed:', e));

    return NextResponse.json({
      success: true,
      data: { id: (result as any).insertId, readingNumber, minSaleId, maxSaleId, minSaleOrId, maxSaleOrId },
    });
  } catch (error) {
    console.error('Error creating X-reading:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to create X-reading',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}