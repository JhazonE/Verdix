import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/mysql';
import { buildAdjustmentLinesSql, buildAdjustmentTransactionsSql } from '@/lib/adjustment-history-lines';

/**
 * Adjustment / Damaged report: the same transactions Adjustment History lists
 * for the same filter, in the same order and paged the same way (both read
 * `lib/adjustment-history-lines.ts`), each carrying its costed item lines.
 *
 * Transfers are listed (History shows them) but kept OUT of the added /
 * removed / net totals: moving stock between warehouses changes where the
 * value sits, not how much of it the store has. Their value is reported
 * separately as `transferredCost`.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const search = (searchParams.get('search') || '').trim();

    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const limit = Math.max(1, parseInt(searchParams.get('limit') || '10'));
    const offset = (page - 1) * limit;

    const filter = { startDate, endDate, search };
    const tx = buildAdjustmentTransactionsSql(filter);
    const lines = buildAdjustmentLinesSql(filter);

    // Period-wide totals in one pass over the lines, so the footer reflects
    // every transaction in the range rather than just the page on screen.
    const [totalsRow]: any = await query(
      `SELECT
         COUNT(DISTINCT t.kind, t.transaction_id) AS transactions,
         COUNT(t.line_id) AS line_count,
         COALESCE(SUM(CASE WHEN t.mode <> 'transfer' THEN t.quantity * t.unit_cost ELSE 0 END), 0) AS net_cost,
         COALESCE(SUM(CASE WHEN t.mode <> 'transfer' AND t.quantity < 0 THEN -t.quantity * t.unit_cost ELSE 0 END), 0) AS removed_cost,
         COALESCE(SUM(CASE WHEN t.mode <> 'transfer' AND t.quantity > 0 THEN t.quantity * t.unit_cost ELSE 0 END), 0) AS added_cost,
         COALESCE(SUM(CASE WHEN t.mode = 'transfer' THEN t.quantity * t.unit_cost ELSE 0 END), 0) AS transferred_cost
       FROM ( ${lines.sql} ) AS t`,
      lines.params
    );
    const totalItems = Number(totalsRow?.transactions) || 0;
    const totalPages = Math.max(1, Math.ceil(totalItems / limit));

    const txRows: any = await query(
      `${tx.sql} ORDER BY transaction_date DESC, kind, id LIMIT ? OFFSET ?`,
      [...tx.params, limit, offset]
    );

    // Lines of just the transactions on this page.
    let lineRows: any[] = [];
    if (txRows?.length) {
      // When this page holds every transaction (print/export ask for all),
      // the filter already selects exactly these lines — skip a huge IN list.
      const pageHoldsAll = offset === 0 && txRows.length < limit;
      const keys = txRows.map(() => '(?, ?)').join(', ');
      const keyParams = pageHoldsAll ? [] : txRows.flatMap((r: any) => [r.kind, r.id]);
      lineRows = await query(
        `SELECT * FROM ( ${lines.sql} ) AS l
         WHERE l.line_id IS NOT NULL${pageHoldsAll ? '' : ` AND (l.kind, l.transaction_id) IN (${keys})`}
         ORDER BY l.product_name, l.line_id`,
        [...lines.params, ...keyParams]
      );
    }

    const linesByTx = new Map<string, any[]>();
    for (const l of lineRows) {
      const key = `${l.kind}:${l.transaction_id}`;
      if (!linesByTx.has(key)) linesByTx.set(key, []);
      linesByTx.get(key)!.push({
        id: l.line_id,
        product_id: l.product_id,
        product_name: l.product_name,
        barcode: l.barcode,
        unit_of_measure: l.unit_of_measure,
        reason: l.reason,
        quantity: Number(l.quantity) || 0,
        new_stock: l.new_stock === null ? null : Number(l.new_stock),
        unit_cost: Number(l.unit_cost) || 0,
        total_cost: (Number(l.quantity) || 0) * (Number(l.unit_cost) || 0),
      });
    }

    return NextResponse.json({
      success: true,
      data: (txRows || []).map((r: any) => ({
        id: r.id,
        kind: r.kind,
        mode: r.mode,
        transaction_date: r.transaction_date,
        reference_no: r.reference_no || null,
        notes: r.notes || null,
        warehouse_name: r.warehouse_name || null,
        target_warehouse_name: r.target_warehouse_name || null,
        item_count: Number(r.item_count) || 0,
        total_quantity: Number(r.total_quantity) || 0,
        total_cost: Number(r.total_cost) || 0,
        lines: linesByTx.get(`${r.kind}:${r.id}`) ?? [],
      })),
      totals: {
        transactions: totalItems,
        lines: Number(totalsRow?.line_count) || 0,
        netCost: Number(totalsRow?.net_cost) || 0,
        removedCost: Number(totalsRow?.removed_cost) || 0,
        addedCost: Number(totalsRow?.added_cost) || 0,
        transferredCost: Number(totalsRow?.transferred_cost) || 0,
      },
      pagination: {
        page,
        limit,
        totalItems,
        totalPages,
      },
    });
  } catch (error: any) {
    console.error('Error fetching adjustments report:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch adjustments report' },
      { status: 500 }
    );
  }
}
