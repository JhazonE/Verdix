import { NextRequest, NextResponse } from 'next/server';
import { query, getNextXReadingNumber } from '@/lib/mysql';
import { saveEJournalFiles } from '@/lib/ejournal/ejournal-writer';

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
              SUM(CASE WHEN pt.transaction_type = 'sale' AND pt.payment_method = 'CASH' THEN pt.total_amount ELSE 0 END) as cash_sales,
              MIN(CASE WHEN pt.transaction_type = 'sale' THEN st.si_number END) as min_sale_id,
              MAX(CASE WHEN pt.transaction_type = 'sale' THEN st.si_number END) as max_sale_id,
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
        // Fetch payment breakdown for this shift
        const payments = await query(`
            SELECT payment_method as name, SUM(total_amount) as amount
            FROM pos_transactions
            WHERE shift_id = ? AND transaction_type = 'sale' AND is_training = 0
            GROUP BY payment_method
        `, [shift.id]);

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

        // Calculate Cash In Drawer (System) — includes cash membership fees.
        const cashInDrawer = parseFloat(shift.starting_cash) + parseFloat(shift.cash_sales) + membershipCash;
        const overShort = parseFloat(shift.actual_cash) - cashInDrawer;

        const pMethods = payments as any[];

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
        cashSales: parseFloat(shift.cash_sales) || 0,
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
      voidAmount = 0,
      refundAmount = 0,
    } = body;

    const minSaleId = minSaleIdRaw ? String(minSaleIdRaw).padStart(6, '0') : '000000';
    const maxSaleId = maxSaleIdRaw ? String(maxSaleIdRaw).padStart(6, '0') : '000000';

    if (!terminalId) {
        return NextResponse.json({ success: false, error: 'Terminal ID is required' }, { status: 400 });
    }

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
        void_amount,
        refund_amount,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
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
      voidAmount ?? 0,
      refundAmount ?? 0,
    ]);

    const ejDate = formatDate(reportDate || new Date())!.slice(0, 10);
    saveEJournalFiles(ejDate, terminalId || 'all').catch((e) => console.error('e-journal auto-save failed:', e));

    return NextResponse.json({
      success: true,
      data: { id: (result as any).insertId, readingNumber },
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