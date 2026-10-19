import { NextRequest, NextResponse } from 'next/server';

import { query } from '@/lib/mysql';

/**
 * Suggests the next reference number for a bulk stock adjustment or transfer,
 * so the field is never left blank — the reference is what identifies the
 * transaction on a printed slip and in Adjustment History.
 *
 * Format: `ADJ-YYYYMMDD-NNN` (or `TRF-` for a transfer). Date-first so the
 * numbers sort chronologically and a human can read when a slip was raised;
 * the counter restarts each day, which keeps it short.
 *
 * **This is a suggestion, not a reservation.** The number is derived by
 * looking at what already exists, so two terminals asking at the same moment
 * can be handed the same one, and the user can overwrite it freely. That is
 * deliberate: an adjustment reference is an operational convenience, NOT a BIR
 * sequential document number, and must not be confused with one — nothing here
 * may gap-check or enforce uniqueness the way `sales_invoice_number` does.
 * The batch_id written alongside it is what actually identifies the
 * transaction in the database.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const isTransfer = searchParams.get('type') === 'transfer';
    const prefix = isTransfer ? 'TRF' : 'ADJ';

    const now = new Date();
    const stamp = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('');

    const like = `${prefix}-${stamp}-%`;

    // Look in both tables: a transfer raised from this screen lands in
    // inventory_transfers, an add/remove in stock_adjustments, and the two
    // should not hand out the same number on the same day.
    const [adjRows, trRows]: any = await Promise.all([
      query(
        `SELECT reference_no AS ref FROM stock_adjustments
         WHERE reference_no LIKE ? ORDER BY reference_no DESC LIMIT 1`,
        [like]
      ),
      query(
        `SELECT reference AS ref FROM inventory_transfers
         WHERE reference LIKE ? ORDER BY reference DESC LIMIT 1`,
        [like]
      ),
    ]);

    // Take the highest trailing counter seen in either table.
    const highest = [adjRows?.[0]?.ref, trRows?.[0]?.ref]
      .filter(Boolean)
      .map((ref: string) => parseInt(String(ref).split('-').pop() || '0', 10))
      .filter((n: number) => Number.isFinite(n))
      .reduce((max: number, n: number) => Math.max(max, n), 0);

    const next = String(highest + 1).padStart(3, '0');

    return NextResponse.json({
      success: true,
      reference: `${prefix}-${stamp}-${next}`,
    });
  } catch (error: any) {
    console.error('Failed to build next reference:', error);
    // A missing suggestion must not block an adjustment: the caller leaves the
    // field editable and empty rather than failing the screen.
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to build next reference' },
      { status: 500 }
    );
  }
}
