import { NextRequest, NextResponse } from 'next/server';

import { query } from '@/lib/mysql';
import { buildAdjustmentTransactionsSql } from '@/lib/adjustment-history-lines';

/**
 * Lists bulk stock adjustments as TRANSACTIONS rather than individual item
 * rows, which is what the Adjustment History screen shows and what a reprint
 * acts on.
 *
 * The lines come from `lib/adjustment-history-lines.ts`, the one definition
 * shared with the Adjustment / Damaged report, so the two screens always
 * describe the same transactions; this route only groups them.
 *
 * Rows with no `batch_id` — standalone adjustments, and everything written
 * before migration 141 — are listed as one-item transactions rather than being
 * grouped or hidden. They are still never MERGED with each other: grouping them
 * by timestamp proximity would put transactions on an inventory document that
 * may never have happened.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20')));
    const offset = (page - 1) * limit;
    const search = (searchParams.get('search') || '').trim();

    // transaction_id is a batch_id, an adjustment id, or a transfer id, which
    // is why `kind` is part of the key and is returned — the slip route looks
    // each one up with a different WHERE clause.
    const { sql: unionSql, params: unionParams } = buildAdjustmentTransactionsSql({ startDate, endDate, search });

    const countRows: any = await query(
      `SELECT COUNT(*) AS total FROM ( ${unionSql} ) AS counted`,
      unionParams
    );
    const totalItems = Number(countRows?.[0]?.total) || 0;

    const rows: any = await query(
      // kind, id break ties so a page boundary is stable — and identical to
      // the Adjustment / Damaged report's, which pages the same way.
      `${unionSql} ORDER BY transaction_date DESC, kind, id LIMIT ? OFFSET ?`,
      [...unionParams, limit, offset]
    );

    return NextResponse.json({
      success: true,
      data: (rows || []).map((r: any) => ({
        id: r.id,
        kind: r.kind,
        mode: r.mode,
        transactionDate: r.transaction_date,
        referenceNo: r.reference_no || null,
        notes: r.notes || null,
        warehouseName: r.warehouse_name || null,
        targetWarehouseName: r.target_warehouse_name || null,
        itemCount: Number(r.item_count) || 0,
        totalQuantity: Number(r.total_quantity) || 0,
        /** Signed pesos (a removal is negative); a transfer's is the value moved. */
        totalCost: Number(r.total_cost) || 0,
      })),
      pagination: {
        page,
        limit,
        totalItems,
        totalPages: Math.max(1, Math.ceil(totalItems / limit)),
      },
    });
  } catch (error: any) {
    console.error('Failed to list adjustment batches:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to list adjustment batches' },
      { status: 500 }
    );
  }
}
