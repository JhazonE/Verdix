import { NextRequest, NextResponse } from 'next/server';
import { withTransaction, query } from '@/lib/mysql';
import { isTerminalLockedSameDay, SHIFT_START_BLOCKED_MESSAGE } from '@/app/api/pos/checkout/terminal-lock-check';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const shiftId = searchParams.get('shiftId');

    if (shiftId) {
      // 1. Get Shift Details
      const shiftResult = await query(
        `SELECT starting_cash, status, user_id FROM shifts WHERE id = ?`,
        [shiftId]
      );

      if (shiftResult.length === 0) {
        return NextResponse.json(
          { success: false, error: 'Shift not found' },
          { status: 404 }
        );
      }

      const startingCash = parseFloat(shiftResult[0].starting_cash || 0);

      // 2. Payment method breakdown for this shift. pos_transactions.payment_method
      // collapses split-tender sales (part Cash + part GCash, etc.) to the literal
      // string 'MULTIPLE' — see use-tender.ts. The real per-method split lives in
      // payment_details (one row per tender). Prefer that; fall back to
      // pos_transactions.payment_method only for sales with no payment_details
      // rows at all, so no sale is silently dropped. Mirrors the same fix in
      // app/api/sales/x-reading/route.ts.
      const paymentBreakdown = await query(
        `SELECT name, SUM(amount) as amount FROM (
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
         GROUP BY name`,
        [shiftId, shiftId]
      ) as any[];

      // Refunds/voids/returns aren't split-tender (see checkout route — they
      // reverse a whole sale, not a portion of one) so they stay on the
      // collapsed column; only cash reduces the physical drawer.
      const refundsResult = await query(
        `SELECT SUM(total_amount) as total_refunds
         FROM pos_transactions
         WHERE shift_id = ? AND transaction_type IN ('void', 'return', 'refund') AND payment_method = 'CASH'`,
        [shiftId]
      );

      const cashRow = paymentBreakdown.find((p: any) => p.name?.toUpperCase() === 'CASH');
      const totalCashSales = parseFloat(cashRow?.amount || 0) - parseFloat(refundsResult[0].total_refunds || 0);
      const otherPaymentMethods = paymentBreakdown
        .filter((p: any) => p.name?.toUpperCase() !== 'CASH')
        .map((p: any) => ({ name: p.name || 'Unknown', amount: parseFloat(p.amount || 0) }));

      // 3. Get Cash Transfers
      const transfersResult = await query(
        `SELECT 
           SUM(CASE WHEN type = 'deposit' THEN amount ELSE 0 END) as total_deposits,
           SUM(CASE WHEN type = 'pickup' THEN amount ELSE 0 END) as total_pickups
         FROM cash_transfers 
         WHERE shift_id = ?`,
        [shiftId]
      );

      const totalDeposits = parseFloat(transfersResult[0].total_deposits || 0);
      const totalPickups = parseFloat(transfersResult[0].total_pickups || 0);

      // Cash membership fees for this shift. Membership is not a sale (never in
      // pos_transactions), but its cash sits in the drawer, so it must count
      // toward the expected cash — same as the X/Z-reading. Cash only.
      const membershipResult = await query(
        `SELECT COALESCE(SUM(amount), 0) AS membership_cash
         FROM membership_payments
         WHERE shift_id = ? AND payment_method = 'cash'`,
        [shiftId]
      );
      const membershipCash = parseFloat(membershipResult[0].membership_cash || 0);

      return NextResponse.json({
        success: true,
        data: {
          startingCash,
          cashSales: totalCashSales,
          otherPaymentMethods,
          membershipCash,
          cashDeposits: totalDeposits,
          cashPickups: totalPickups,
          expectedCash: startingCash + totalCashSales + membershipCash + totalDeposits - totalPickups,
          userId: shiftResult[0].user_id,
          status: shiftResult[0].status
        }
      });
    }

    // Restore: Fetch active shift for a terminal (Takeover support)
    const terminalId = searchParams.get('terminalId');
    const status = searchParams.get('status');

    if (terminalId && status === 'active') {
      const activeShiftResult = await query(
        `SELECT s.id, s.user_id, s.starting_cash, u.display_name as cashier_name
         FROM shifts s
         LEFT JOIN users u ON s.user_id = u.uid
         WHERE s.terminal_id = ? AND s.status = 'active'
         ORDER BY s.created_at DESC
         LIMIT 1`,
        [terminalId]
      );

      if (activeShiftResult.length > 0) {
        return NextResponse.json({
          success: true,
          data: {
            id: activeShiftResult[0].id,
            userId: activeShiftResult[0].user_id,
            cashierName: activeShiftResult[0].cashier_name,
            startingCash: parseFloat(activeShiftResult[0].starting_cash || 0)
          }
        });
      } else {
        return NextResponse.json({ success: true, data: null });
      }
    }

    // List completed shifts
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    let sql = `
      SELECT s.id, s.user_id, s.terminal_id, s.starting_cash, s.actual_cash, s.start_time, s.end_time, s.status, u.display_name as cashier_name
      FROM shifts s
      LEFT JOIN users u ON s.user_id = u.uid
      WHERE s.status = 'completed'
    `;
    const params: any[] = [];

    if (terminalId && terminalId !== 'all') {
      sql += ' AND s.terminal_id = ?';
      params.push(terminalId);
    }

    if (startDate) {
      sql += ' AND s.start_time >= ?';
      params.push(`${startDate} 00:00:00`);
    }

    if (endDate) {
      sql += ' AND s.end_time <= ?';
      params.push(`${endDate} 23:59:59`);
    }

    sql += ' ORDER BY s.end_time DESC';

    const shifts = await query(sql, params);

    return NextResponse.json({
      success: true,
      data: shifts
    });


  } catch (error: any) {
    console.error('Error fetching shift details:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch shift details' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, terminalId, startingCash } = body;

    if (!userId || startingCash === undefined) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Generate specific ID format if needed, or use auto-increment/uuid
    // Based on existing code, IDs are often strings like "SHIFT-..."
    const shiftId = `SHIFT-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    const resolvedTerminalId = terminalId || 'Counter 1';

    return await withTransaction(async (connection) => {
      // Check if user already has an active shift? Optional but good practice.
      // For now, let's just create.

      // BIR Annex F checklist item #29: a Z-reading closes out this
      // terminal's business day for the rest of that calendar day — Start
      // Shift is no longer the unlock signal by itself (see
      // app/api/sales/z-reading/route.ts POST, which sets this lock).
      // Locked into a previous calendar day is stale and self-heals below;
      // locked into *today* must still block, or a cashier could bypass the
      // BIR-mandated same-day sales block just by starting a new shift.
      // Gated by the same pos_settings.enforce_z_reading_lockout toggle as
      // checkout (app/api/pos/checkout/route.ts) — OFF means the lockout
      // system is fully disabled, not just checkout's half of it.
      const [settingsRows]: any = await connection.query(
        'SELECT enforce_z_reading_lockout FROM pos_settings LIMIT 1'
      );
      const lockoutEnforced = settingsRows?.[0]?.enforce_z_reading_lockout ?? true;
      const [terminalRows]: any = await connection.query(
        'SELECT business_date_locked_at FROM pos_terminals WHERE id = ? FOR UPDATE',
        [resolvedTerminalId]
      );
      const lockedAt = terminalRows?.[0]?.business_date_locked_at;
      if (lockoutEnforced && isTerminalLockedSameDay(lockedAt)) {
        return NextResponse.json(
          { success: false, error: SHIFT_START_BLOCKED_MESSAGE },
          { status: 400 }
        );
      }

      await connection.query(
        `INSERT INTO shifts (
            id, user_id, terminal_id, starting_cash, start_time, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, NOW(), 'active', NOW(), NOW())`,
        [shiftId, userId, resolvedTerminalId, startingCash]
      );

      // A lock from a previous calendar day is stale (the day it was
      // guarding against has already passed) — clear it now that a new
      // shift is starting.
      if (lockedAt) {
        await connection.query(
          'UPDATE pos_terminals SET business_date_locked_at = NULL WHERE id = ?',
          [resolvedTerminalId]
        );
      }

      return NextResponse.json({
        success: true,
        data: { shiftId },
        message: 'Shift started successfully'
      });
    });

  } catch (error: any) {
    console.error('Error starting shift:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to start shift' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { shiftId, actualCash, cashDifference, notes, takeoverUserId } = body;

    if (!shiftId) {
      return NextResponse.json(
        { success: false, error: 'Missing Shift ID' },
        { status: 400 }
      );
    }

    if (takeoverUserId) {
        // Handle Shift Takeover (Transfer ownership)
        return await withTransaction(async (connection) => {
            const [settingsRows]: any = await connection.query(
                'SELECT enforce_z_reading_lockout FROM pos_settings LIMIT 1'
            );
            const lockoutEnforced = settingsRows?.[0]?.enforce_z_reading_lockout ?? true;
            const [lockRows]: any = await connection.query(
                `SELECT pt.business_date_locked_at
                 FROM pos_terminals pt
                 JOIN shifts s ON s.terminal_id = pt.id
                 WHERE s.id = ? FOR UPDATE`,
                [shiftId]
            );
            if (lockoutEnforced && isTerminalLockedSameDay(lockRows?.[0]?.business_date_locked_at)) {
                return NextResponse.json(
                    { success: false, error: SHIFT_START_BLOCKED_MESSAGE },
                    { status: 400 }
                );
            }

            await connection.query(
                `UPDATE shifts SET
                    user_id = ?,
                    updated_at = NOW()
                 WHERE id = ?`,
                [takeoverUserId, shiftId]
            );

            // Any lock still in place here is guaranteed stale (from a prior
            // calendar day) — a same-day lock already returned 400 above.
            // Clear it now, same as the POST handler above, so a takeover
            // doesn't leave the terminal permanently locked past the day the
            // lock was guarding against.
            await connection.query(
                `UPDATE pos_terminals pt
                 JOIN shifts s ON s.terminal_id = pt.id
                 SET pt.business_date_locked_at = NULL
                 WHERE s.id = ?`,
                [shiftId]
            );

            return NextResponse.json({
                success: true,
                message: 'Shift ownership transferred successfully'
            });
        });
    }

    // Standard Shift End
    if (actualCash === undefined) {
        return NextResponse.json({ success: false, error: 'Missing actual cash' }, { status: 400 });
    }

    return await withTransaction(async (connection) => {
     await connection.query(
        `UPDATE shifts SET 
            end_time = NOW(), 
            actual_cash = ?, 
            cash_difference = ?, 
            cash_denominations = ?,
            notes = ?, 
            status = 'completed', 
            updated_at = NOW() 
         WHERE id = ?`,
        [actualCash, cashDifference || 0, JSON.stringify(body.cashDenominations || []), notes || null, shiftId]
      );

      return NextResponse.json({
        success: true,
        message: 'Shift ended successfully'
      });
    });

  } catch (error: any) {
    console.error('Error ending shift:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to end shift' },
      { status: 500 }
    );
  }
}
