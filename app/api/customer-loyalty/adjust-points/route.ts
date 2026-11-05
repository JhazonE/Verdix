import { NextRequest, NextResponse } from 'next/server';
import { withTransaction } from '../../../../lib/mysql';
import { isLoyaltyCardExpired } from '../../../../lib/loyalty-utils';

// POST endpoint to adjust customer loyalty points
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { customerId, adjustmentType, points, reason } = body;

    // Validate input
    if (!customerId) {
      return NextResponse.json(
        { success: false, error: 'Customer ID is required' },
        { status: 400 }
      );
    }

    if (!adjustmentType || !['add', 'remove'].includes(adjustmentType)) {
      return NextResponse.json(
        { success: false, error: 'Valid adjustment type (add or remove) is required' },
        { status: 400 }
      );
    }

    if (!points || points <= 0 || !Number.isInteger(points)) {
      return NextResponse.json(
        { success: false, error: 'Points must be a positive integer' },
        { status: 400 }
      );
    }

    if (!reason || reason.trim().length < 3) {
      return NextResponse.json(
        { success: false, error: 'A reason with at least 3 characters is required' },
        { status: 400 }
      );
    }

    // Read, validate and write under one transaction with the row locked.
    //
    // This used to read with a plain query, compute the new total in JS, and
    // write it back as an ABSOLUTE value. Two problems, both losing points:
    //
    //   1. Nothing serialised the read the "cannot go negative" check was
    //      based on, so two concurrent removals could both pass it.
    //   2. Worse, the absolute write DISCARDED anything that happened in
    //      between. A sale that earned the customer points while an admin was
    //      typing an adjustment had those points silently overwritten — the
    //      POS deduction path at least used a relative UPDATE, which cannot
    //      lose a concurrent write.
    //
    // Now: FOR UPDATE to serialise, then a relative delta so a concurrent
    // sale is preserved, with the same `>= ?` guard the POS path uses so the
    // database refuses an overdraw independently of the JS check.
    return await withTransaction(async (connection) => {
      const [loyaltyCheck]: any = await connection.query(
        'SELECT id, current_points, expiry_date FROM customer_loyalty WHERE customer_id = ? FOR UPDATE',
        [customerId]
      );

      if (!loyaltyCheck || loyaltyCheck.length === 0) {
        return NextResponse.json(
          { success: false, error: 'Customer loyalty record not found. Please create a loyalty card first.' },
          { status: 404 }
        );
      }

      const loyaltyRecord = loyaltyCheck[0];

      // Check for expiration
      if (isLoyaltyCardExpired(loyaltyRecord.expiry_date)) {
        return NextResponse.json(
          { success: false, error: 'Loyalty card is expired. Points cannot be adjusted.' },
          { status: 400 }
        );
      }

      const currentPoints = Number(loyaltyRecord.current_points || 0);
      const isRemoval = adjustmentType === 'remove';
      const newPoints = currentPoints + (isRemoval ? -points : points);

      // Prevent negative points
      if (newPoints < 0) {
        return NextResponse.json(
          { success: false, error: 'Cannot remove more points than the customer currently has' },
          { status: 400 }
        );
      }

      if (isRemoval) {
        const [result]: any = await connection.query(
          'UPDATE customer_loyalty SET current_points = current_points - ?, last_transaction = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND current_points >= ?',
          [points, loyaltyRecord.id, points]
        );
        if (!result || result.affectedRows === 0) {
          return NextResponse.json(
            { success: false, error: 'Cannot remove more points than the customer currently has' },
            { status: 400 }
          );
        }
      } else {
        await connection.query(
          'UPDATE customer_loyalty SET current_points = current_points + ?, last_transaction = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          [points, loyaltyRecord.id]
        );
      }

      // Insert point history record
      const historyId = `PH-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      await connection.query(
        `INSERT INTO point_history (
          id, customer_loyalty_id, transaction_type, points, reason, created_at
        ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [historyId, loyaltyRecord.id, adjustmentType, points, reason.trim()]
      );

      // Report the balance as it stands AFTER the write, read back inside the
      // transaction. Returning the JS-computed figure would misreport it
      // whenever a concurrent sale moved the balance: the relative UPDATE
      // keeps that sale's effect, so the real total differs.
      const [after]: any = await connection.query(
        'SELECT current_points FROM customer_loyalty WHERE id = ?',
        [loyaltyRecord.id]
      );
      const actualNewBalance = after && after.length > 0
        ? Number(after[0].current_points)
        : newPoints;

      return NextResponse.json({
        success: true,
        message: `Points ${adjustmentType === 'add' ? 'added' : 'removed'} successfully`,
        data: {
          customerId,
          adjustmentType,
          points,
          previousBalance: currentPoints,
          newBalance: actualNewBalance,
          reason: reason.trim()
        },
        timestamp: new Date().toISOString()
      });
    });

  } catch (error) {
    console.error('Error adjusting customer loyalty points:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to adjust customer loyalty points' },
      { status: 500 }
    );
  }
}
