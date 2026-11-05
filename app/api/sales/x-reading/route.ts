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
    
    // Base query to fetch shifts.
    //
    // A shift is reported per SALES DAY, not solely by the date it opened.
    // report_date used to be s.start_time, and the startDate/endDate bounds
    // used to filter DATE(s.start_time), so a shift left open across midnight
    // attributed every later sale to its opening date. Live: a shift opened
    // 2026-10-21 and closed 2026-10-30 took six sales totalling PHP 5,790.00,
    // and X-reading filed all of it as 2026-10-21 while the back-office
    // reports split the same money across 2026-10-22 and 2026-10-30. No money
    // was lost, but no day agreed and the revenue sat on the wrong BIR dates.
    //
    // sales.sale_date is the day the sales in this row were actually rung up
    // (DATE(pt.transaction_time), the basis every back-office report uses).
    // It is NULL for a shift that took no sales at all, and such a shift still
    // belongs to the day it opened — hence the COALESCE.
    let sql = `
      SELECT
        s.id,
        COALESCE(sales.sale_date, DATE(s.start_time)) as report_date,
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
              -- The day these sales were rung up. Grouping by shift_id ALONE
              -- collapsed a multi-day shift into a single row, which is what
              -- made per-day figures unobtainable no matter how the outer
              -- query was filtered.
              DATE(pt.transaction_time) as sale_date,
              -- Voiding a sale never creates or retypes a pos_transactions row —
              -- app/api/pos/void-transaction only flips
              -- sales_transactions.status to 'Voided' — so the voided sale keeps
              -- its original transaction_type = 'sale' row. Every sales
              -- aggregate must therefore exclude voided/returned statuses
              -- explicitly (NOT_VOIDED below), exactly as z-reading does, or a
              -- voided sale is still counted as revenue.
              SUM(CASE WHEN pt.transaction_type = 'sale' AND COALESCE(st.status, '') NOT IN ('Void', 'Voided', 'Cancelled', 'Returned') THEN pt.subtotal ELSE 0 END) as gross_sales,
              SUM(CASE WHEN pt.transaction_type = 'sale' AND COALESCE(st.status, '') NOT IN ('Void', 'Voided', 'Cancelled', 'Returned') THEN pt.total_amount ELSE 0 END) as net_sales,
              -- Scoped to 'sale' like the figures above: VAT and discounts are
              -- properties of a sale, and leaving the type unfiltered would let
              -- a future non-sale row type contribute to them.
              SUM(CASE WHEN pt.transaction_type = 'sale' AND COALESCE(st.status, '') NOT IN ('Void', 'Voided', 'Cancelled', 'Returned') THEN pt.tax_amount ELSE 0 END) as vat_amount,
              SUM(CASE WHEN pt.transaction_type = 'sale' AND COALESCE(st.status, '') NOT IN ('Void', 'Voided', 'Cancelled', 'Returned') THEN pt.discount_amount ELSE 0 END) as discounts,
              -- Returns store total_amount NEGATIVE (see app/api/sales/returns
              -- route: money owed back to the customer), so ABS() is what makes
              -- the RETURNS line print as a positive magnitude like VOID does,
              -- instead of reading as "RETURNS -1,254.15".
              ABS(SUM(CASE WHEN pt.transaction_type = 'return' THEN pt.total_amount ELSE 0 END)) as returns_amount,
              COUNT(CASE WHEN pt.transaction_type = 'sale' AND COALESCE(st.status, '') NOT IN ('Void', 'Voided', 'Cancelled', 'Returned') THEN 1 END) as transaction_count,
              -- Placeholder — pt.payment_method collapses split-tender sales to the
              -- literal string 'MULTIPLE', which would hide the real cash portion
              -- from the drawer reconciliation. The real per-shift cash figure is
              -- recomputed below from the same payment_details breakdown used for
              -- paymentMethods, so both stay consistent with one source of truth.
              SUM(CASE WHEN pt.transaction_type = 'sale' AND COALESCE(st.status, '') NOT IN ('Void', 'Voided', 'Cancelled', 'Returned') AND pt.payment_method = 'CASH' THEN pt.total_amount ELSE 0 END) as cash_sales,
              MIN(CASE WHEN pt.transaction_type = 'sale' AND COALESCE(st.status, '') NOT IN ('Void', 'Voided', 'Cancelled', 'Returned') THEN st.si_number END) as min_sale_id,
              MAX(CASE WHEN pt.transaction_type = 'sale' AND COALESCE(st.status, '') NOT IN ('Void', 'Voided', 'Cancelled', 'Returned') THEN st.si_number END) as max_sale_id,
              MIN(CASE WHEN pt.transaction_type = 'sale' AND COALESCE(st.status, '') NOT IN ('Void', 'Voided', 'Cancelled', 'Returned') AND pt.bir_or_number IS NOT NULL THEN pt.bir_or_number END) as min_sale_or_id,
              MAX(CASE WHEN pt.transaction_type = 'sale' AND COALESCE(st.status, '') NOT IN ('Void', 'Voided', 'Cancelled', 'Returned') AND pt.bir_or_number IS NOT NULL THEN pt.bir_or_number END) as max_sale_or_id,
              -- Voids are identified by sales_transactions.status, the column the
              -- void endpoint actually writes — NOT by transaction_type = 'void',
              -- which nothing in this codebase ever writes and which therefore
              -- made this figure structurally always 0.00. Same source of truth
              -- as z-reading's voidSeqSql, so the two reports cannot disagree.
              SUM(CASE WHEN st.status IN ('Void', 'Voided', 'Cancelled') THEN st.total ELSE 0 END) as void_amount,
              SUM(CASE WHEN pt.transaction_type = 'refund' THEN pt.total_amount ELSE 0 END) as refund_amount
          FROM pos_transactions pt
          LEFT JOIN sales_transactions st ON pt.sale_id = st.id
          WHERE pt.is_training = 0
          GROUP BY pt.shift_id, DATE(pt.transaction_time)
      ) sales ON s.id = sales.shift_id
      WHERE 1=1
    `;

    const params: any[] = [];

    // A date range selects the rows whose SALES fall in it, not the shifts that
    // happened to open in it. Filtering DATE(s.start_time) meant a range
    // covering 2026-10-30 missed that day's PHP 4,990.00 entirely, because the
    // shift those sales belonged to had opened on 2026-10-21.
    //
    // COALESCE to the shift's opening date so a shift that took no sales is
    // still reachable by the day it was opened, rather than dropping out of
    // every dated query (sales.sale_date is NULL for such a shift).
    if (startDate) {
      sql += ' AND COALESCE(DATE(sales.sale_date), DATE(s.start_time)) >= ?';
      params.push(startDate);
    }

    if (endDate) {
      sql += ' AND COALESCE(DATE(sales.sale_date), DATE(s.start_time)) <= ?';
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

    // Newest SALES day first, not newest shift opening. A shift now yields one
    // row per day it sold on, and the POS callers pass limit=1 expecting the
    // current reading — which is the latest day's, not the opening day's.
    sql += ' ORDER BY COALESCE(sales.sale_date, DATE(s.start_time)) DESC, s.start_time DESC';

    if (limit) {
        sql += ' LIMIT ?';
        params.push(parseInt(limit));
    }

    const rows = await query(sql, params);
    const shifts = rows as any[];

    // Payments and membership fees are fetched for ALL shifts in two grouped
    // queries, not per shift inside the map below.
    //
    // This used to be `Promise.all(shifts.map(...))` issuing two queries per
    // shift, all in flight at once. The back-office X-Reading page sends no
    // `limit` (only the POS callers do, with limit=1), so a month of shifts
    // across a few terminals meant hundreds of simultaneous pool
    // acquisitions against a pool of 25 — the report saturated the pool, and
    // because query() queued with no timeout it then hung forever: no rows,
    // no error, a spinner that never resolved. Grouping by shift_id makes the
    // cost two queries regardless of how many shifts the range covers.
    // De-duplicated: a shift that sold across more than one day now yields one
    // ROW PER DAY, so shifts[] can contain the same id several times. Passing
    // the raw list would repeat each id in the IN (...) clause.
    const shiftIds = [...new Set(shifts.map((s: any) => s.id))];

    // Rows are now identified by shift AND sales day, so the per-shift
    // aggregates below must be keyed the same way — keying them by shift_id
    // alone would attach a multi-day shift's whole cash total to each of its
    // days, reporting the same money two or three times over.
    // The separator is '__' rather than a punctuation character because this
    // key is returned as the row's `id`, and the back-office page interpolates
    // that id straight into a download filename (X-Reading-<id>.pdf / .png).
    // '|' and ':' are illegal in Windows filenames and would break those
    // exports.
    // The calendar day as 'YYYY-MM-DD'.
    //
    // A value from a MySQL DATE column arrives as a Date at LOCAL midnight, so
    // toISOString() would convert it to UTC and report the PREVIOUS day at any
    // positive offset (Philippine time is UTC+8). Read the local parts instead.
    const calendarDay = (value: any): string => {
        if (!value) return '';
        if (value instanceof Date) {
            const y = value.getFullYear();
            const m = String(value.getMonth() + 1).padStart(2, '0');
            const d = String(value.getDate()).padStart(2, '0');
            return `${y}-${m}-${d}`;
        }
        return String(value).slice(0, 10);
    };

    const dayKey = (shiftId: string, saleDate: any) => {
        const day = calendarDay(saleDate);
        return day ? `${shiftId}__${day}` : `${shiftId}__nodate`;
    };

    // Payment breakdown per shift. pos_transactions.payment_method collapses
    // split-tender sales (part Cash + part GCash, etc.) to the literal string
    // 'MULTIPLE' — see use-tender.ts. The real per-method split lives in
    // payment_details (one row per tender). Prefer that; fall back to
    // pos_transactions.payment_method only for sales with no payment_details
    // rows at all, so no sale is silently dropped.
    //
    // Voided sales are excluded here too: the money was handed back to the
    // customer, so it is no longer in the drawer and must not appear as a
    // payment received. Without this, a voided cash sale would inflate
    // cashInDrawer and show up as a phantom SHORT at cash count. The status
    // set matches the sales aggregates above and z-reading's.
    const paymentsByShift = new Map<string, any[]>();
    const membershipByShift = new Map<string, any>();
    const cashTransfersByShift = new Map<string, any>();

    if (shiftIds.length > 0) {
        const placeholders = shiftIds.map(() => '?').join(',');

        // Carries sale_date alongside shift_id so a multi-day shift's tenders
        // are attributed to the day they were taken, matching the per-day rows
        // the main query now returns.
        const paymentRows = await query(`
            SELECT shift_id, sale_date, name, SUM(amount) as amount FROM (
                SELECT pt.shift_id as shift_id, DATE(pt.transaction_time) as sale_date, pd.payment_method as name, SUM(pd.amount_tendered - pd.change_given) as amount
                FROM pos_transactions pt
                LEFT JOIN sales_transactions st ON pt.sale_id = st.id
                JOIN payment_details pd ON pd.transaction_id = pt.id
                WHERE pt.shift_id IN (${placeholders}) AND pt.transaction_type = 'sale' AND pt.is_training = 0
                AND COALESCE(st.status, '') NOT IN ('Void', 'Voided', 'Cancelled', 'Returned')
                GROUP BY pt.shift_id, DATE(pt.transaction_time), pd.payment_method

                UNION ALL

                SELECT pt.shift_id as shift_id, DATE(pt.transaction_time) as sale_date, pt.payment_method as name, SUM(pt.total_amount) as amount
                FROM pos_transactions pt
                LEFT JOIN sales_transactions st ON pt.sale_id = st.id
                WHERE pt.shift_id IN (${placeholders}) AND pt.transaction_type = 'sale' AND pt.is_training = 0
                AND COALESCE(st.status, '') NOT IN ('Void', 'Voided', 'Cancelled', 'Returned')
                AND NOT EXISTS (SELECT 1 FROM payment_details pd WHERE pd.transaction_id = pt.id)
                GROUP BY pt.shift_id, DATE(pt.transaction_time), pt.payment_method
            ) combined
            GROUP BY shift_id, sale_date, name
        `, [...shiftIds, ...shiftIds]) as any[];

        for (const row of paymentRows) {
            const key = dayKey(row.shift_id, row.sale_date);
            const list = paymentsByShift.get(key) ?? [];
            list.push(row);
            paymentsByShift.set(key, list);
        }

        // Cash membership fees per shift. Membership is not a sale (never in
        // pos_transactions), but its cash sits in the drawer, so it must be
        // counted toward reconciliation — same as the Z-reading. Cash only;
        // card never enters the drawer.
        // Grouped by day as well, for the same reason as the payments above: a
        // shift spanning two days must not report the same membership cash on
        // both of them.
        const membershipRows = await query(`
            SELECT
                shift_id,
                DATE(created_at)                  AS sale_date,
                COALESCE(SUM(amount), 0)          AS membership_cash,
                COALESCE(SUM(is_new_card = 1), 0) AS activation_count,
                COALESCE(SUM(is_new_card = 0), 0) AS renewal_count
            FROM membership_payments
            WHERE shift_id IN (${placeholders}) AND payment_method = 'cash'
            GROUP BY shift_id, DATE(created_at)
        `, shiftIds) as any[];

        for (const row of membershipRows) {
            membershipByShift.set(dayKey(row.shift_id, row.sale_date), row);
        }

        // Cash deposits/pickups per shift. These used to be returned as the
        // hardcoded literals `cashDeposit: 0, cashPickup: 0`, so X-reading's
        // WITHDRAWAL and "Less Withdrawal:" lines were structurally always
        // 0.00 no matter how much cash the cashier had actually pulled from
        // the drawer. The End Shift dialog (app/api/pos/shifts) had always
        // read this table correctly, which is why it showed the pickup while
        // the X-reading of the same shift did not.
        //
        // Grouped by shift_id like the two queries above, NOT issued per
        // shift inside the map below: the back-office page sends no `limit`,
        // so a per-shift fan-out over a month of shifts is what previously
        // saturated the connection pool and hung this route forever.
        // Also grouped by day, so a deposit made on the shift's second day is
        // reported against that day rather than against every day of the
        // shift. Dated by transaction_time, the same basis pos_transactions
        // uses, so the drawer figures line up with the sales figures.
        const cashTransferRows = await query(`
            SELECT
                shift_id,
                DATE(transaction_time) AS sale_date,
                COALESCE(SUM(CASE WHEN type = 'deposit' THEN amount ELSE 0 END), 0) AS total_deposits,
                COALESCE(SUM(CASE WHEN type = 'pickup'  THEN amount ELSE 0 END), 0) AS total_pickups
            FROM cash_transfers
            WHERE shift_id IN (${placeholders})
            GROUP BY shift_id, DATE(transaction_time)
        `, shiftIds) as any[];

        for (const row of cashTransferRows) {
            cashTransfersByShift.set(dayKey(row.shift_id, row.sale_date), row);
        }
    }

    const formattedReadings = shifts.map((shift) => {
        // A shift with no matching rows gets no row back from the grouped
        // queries above, which is the same "nothing to report" the per-shift
        // query expressed as SUM(...) = 0 / an empty result set.
        // Keyed by shift AND sales day: this row represents one day of this
        // shift, not the whole shift.
        const reportDay = calendarDay(shift.report_date);
        const rowKey = dayKey(shift.id, shift.report_date);
        const membershipRow = membershipByShift.get(rowKey);
        const membershipCash = parseFloat(membershipRow?.membership_cash || 0);
        const membershipActivationCount = parseInt(membershipRow?.activation_count || 0, 10) || 0;
        const membershipRenewalCount = parseInt(membershipRow?.renewal_count || 0, 10) || 0;

        const pMethods = paymentsByShift.get(rowKey) ?? [];

        // Derive cash_sales from the corrected per-method breakdown above (which
        // already attributes split-tender sales to their real methods) rather
        // than shift.cash_sales, which is computed from the collapsed
        // pos_transactions.payment_method column and would miss the cash portion
        // of any split payment.
        const cashSales = pMethods
            .filter((p: any) => p.name?.toUpperCase() === 'CASH')
            .reduce((acc: number, p: any) => acc + parseFloat(p.amount || 0), 0);

        const cashTransferRow = cashTransfersByShift.get(rowKey);
        const cashDeposit = parseFloat(cashTransferRow?.total_deposits || 0);
        const cashPickup = parseFloat(cashTransferRow?.total_pickups || 0);

        // Calculate Cash In Drawer (System) — includes cash membership fees,
        // and the cash physically added to or removed from the drawer mid-shift.
        // A pickup takes money OUT of the drawer, so expected cash must fall by
        // that amount; a deposit puts money in. Omitting them (as this did while
        // cashPickup was hardcoded to 0) made every shift with a pickup report a
        // phantom SHORT for exactly the amount picked up — the cashier was
        // blamed for cash that had been removed on purpose and recorded.
        // Matches the End Shift dialog's expectedCash, which has always been
        // startingCash + cashSales + membershipCash + deposits - pickups.
        const cashInDrawer = parseFloat(shift.starting_cash) + cashSales + membershipCash + cashDeposit - cashPickup;
        const overShort = parseFloat(shift.actual_cash) - cashInDrawer;

      return {
        // Unique per reported row. A shift that sold across more than one day
        // now returns one row per day, so the bare shift id would repeat and
        // any consumer keying on it would collapse those rows together.
        // shiftId below keeps the shift's own identity for callers that need
        // it (the POS passes ?shiftId=, and End Shift reads it back).
        id: rowKey,
        shiftId: shift.id,
        // Emitted as a 'YYYY-MM-DD' STRING, never a Date.
        //
        // report_date is now a MySQL DATE (the sales day), which mysql2 hands
        // back as a Date at LOCAL midnight. JSON.stringify then serialises it
        // via toISOString(), which converts to UTC and so shifts it back by
        // this machine's offset — at UTC+8 every reading was reported one day
        // early (a 2026-11-04 reading printing as 2026-11-03), reintroducing
        // the very date mismatch this change set out to fix. It did not show
        // before because report_date used to be s.start_time, a DATETIME whose
        // time-of-day absorbed the shift.
        date: reportDay,
        reportDate: reportDay,
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
        // From the SHIFT id, not the per-day row key: this labels the cash
        // count, which belongs to the shift as a whole.
        cashCountId: String(shift.id).substring(0, 8).toUpperCase(),
        cashCountTotal: parseFloat(shift.actual_cash || 0),
        cashDeposit: cashDeposit,
        cashPickup: cashPickup,
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
    });

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