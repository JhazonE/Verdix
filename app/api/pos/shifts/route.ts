import { NextRequest, NextResponse } from 'next/server';
import { withTransaction, query } from '@/lib/mysql';

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

      // 2. Get Cash Sales
      const salesResult = await query(
        `SELECT 
           SUM(CASE WHEN transaction_type = 'sale' THEN total_amount ELSE 0 END) as total_sales,
           SUM(CASE WHEN transaction_type IN ('void', 'return', 'refund') THEN total_amount ELSE 0 END) as total_refunds
         FROM pos_transactions 
         WHERE shift_id = ? AND payment_method = 'CASH'`,
        [shiftId]
      );

      const totalCashSales = (parseFloat(salesResult[0].total_sales || 0) - parseFloat(salesResult[0].total_refunds || 0));

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

      await connection.query(
        `INSERT INTO shifts (
            id, user_id, terminal_id, starting_cash, start_time, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, NOW(), 'active', NOW(), NOW())`,
        [shiftId, userId, resolvedTerminalId, startingCash]
      );

      // BIR Annex F checklist item #29: starting a new shift on this
      // terminal is the signal that a new business day of work has begun,
      // so clear any lock a prior Z-reading left in place (see
      // app/api/sales/z-reading/route.ts POST, which sets this).
      await connection.query(
        'UPDATE pos_terminals SET business_date_locked_at = NULL WHERE id = ?',
        [resolvedTerminalId]
      );

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
            await connection.query(
                `UPDATE shifts SET
                    user_id = ?,
                    updated_at = NOW()
                 WHERE id = ?`,
                [takeoverUserId, shiftId]
            );

            // BIR Annex F checklist item #29: taking over an already-active
            // shift on this terminal is, like starting a fresh shift (see the
            // POST handler above), the signal that work is continuing/resuming
            // on this terminal, so clear any lock a mid-shift Z-reading left in
            // place (see app/api/sales/z-reading/route.ts POST, which sets
            // this). Without this, a Z-reading generated mid-shift (Task 6
            // decoupled Z-reading from shift-end, so this is now possible)
            // would leave the terminal permanently locked across a takeover,
            // since takeover only used to transfer ownership. Joined to the
            // shift row so we resolve the correct terminal from shiftId alone
            // (the request body doesn't carry a terminal id) and stay scoped
            // to that one terminal, in the same transaction as the ownership
            // transfer above.
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
