import { NextRequest, NextResponse } from 'next/server';

import { query } from '@/lib/mysql';

/**
 * Lists bulk stock adjustments as TRANSACTIONS rather than individual item
 * rows, which is what the Batch History screen shows and what a reprint acts
 * on.
 *
 * Two sources are unioned because the two modes have always been stored apart:
 * add/remove batches collapse `stock_adjustments` on `batch_id` (migration
 * 141), while transfers are already one header row each in
 * `inventory_transfers`.
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

    const dateWhere = (col: string, params: any[]) => {
      const parts: string[] = [];
      if (startDate) {
        parts.push(`DATE(${col}) >= ?`);
        params.push(startDate);
      }
      if (endDate) {
        parts.push(`DATE(${col}) <= ?`);
        params.push(endDate);
      }
      return parts.length ? ` AND ${parts.join(' AND ')}` : '';
    };

    // `inventory_transfers` was created utf8mb4_unicode_ci (migration 074)
    // while `stock_adjustments` and the rest of the schema are
    // utf8mb4_0900_ai_ci, so a UNION over both sides fails with
    // ER_CANT_AGGREGATE_2COLLATIONS unless every text column is forced to one
    // collation. Casting in the query rather than ALTERing the tables keeps
    // this a read-only change against live data.
    const COLL = 'utf8mb4_0900_ai_ci';

    // COALESCE(batch_id, id) makes one listing out of both shapes: a bulk row
    // groups with the rest of its batch, while a standalone adjustment (the
    // Stock Adjustment dialog, POS adjust-quantity, and every row written
    // before migration 141) groups alone and appears as a one-item
    // transaction. The id that comes back is therefore a batch_id OR an
    // adjustment id, which is why `kind` below distinguishes them — the slip
    // route has to look the two up with different WHERE clauses.
    const adjParams: any[] = [];
    const adjSql = `
      SELECT
        -- MIN() rather than a bare COALESCE: under ONLY_FULL_GROUP_BY the
        -- COLLATE makes the expression no longer match the GROUP BY term, so
        -- MySQL treats batch_id as a nonaggregated column and rejects it.
        MIN(COALESCE(sa.batch_id, sa.id)) COLLATE ${COLL} AS id,
        -- MIN() so this stays legal under ONLY_FULL_GROUP_BY; every row in a
        -- group has the same batch_id nullness, so the aggregate is exact.
        MIN(CASE WHEN sa.batch_id IS NULL THEN 'single' ELSE 'batch' END) COLLATE ${COLL} AS kind,
        MIN(sa.adj_type) COLLATE ${COLL}    AS mode,
        MIN(sa.created_at)                  AS transaction_date,
        MIN(sa.reference_no) COLLATE ${COLL} AS reference_no,
        MIN(sa.note) COLLATE ${COLL}        AS notes,
        MIN(wh.name) COLLATE ${COLL}        AS warehouse_name,
        MIN(twh.name) COLLATE ${COLL}       AS target_warehouse_name,
        COUNT(*)                            AS item_count,
        SUM(ABS(sa.quantity))               AS total_quantity
      FROM stock_adjustments sa
      LEFT JOIN warehouses wh  ON wh.id  = sa.warehouse_id
      LEFT JOIN warehouses twh ON twh.id = sa.target_warehouse_id
      WHERE 1=1${dateWhere('sa.created_at', adjParams)}${
        // A transaction matches when ANY of its lines does, so the search is an
        // EXISTS over the sibling rows rather than a filter on this row — the
        // latter would drop the other items from a batch that did match.
        search
          ? (adjParams.push(`%${search}%`, `%${search}%`, `%${search}%`),
            ` AND EXISTS (
                SELECT 1 FROM stock_adjustments sib
                LEFT JOIN products sp ON sp.id = sib.product_id
                WHERE (sib.batch_id <=> sa.batch_id AND sib.batch_id IS NOT NULL
                       OR sib.id = sa.id)
                  AND (sp.name LIKE ? OR sib.reason LIKE ? OR sib.reference_no LIKE ?)
              )`)
          : ''
      }
      GROUP BY COALESCE(sa.batch_id, sa.id)
    `;

    const trParams: any[] = [];
    const trSql = `
      SELECT
        t.id COLLATE ${COLL}                AS id,
        'transfer'                          AS kind,
        'transfer'                          AS mode,
        t.transfer_date                     AS transaction_date,
        t.reference COLLATE ${COLL}         AS reference_no,
        t.notes COLLATE ${COLL}             AS notes,
        src.name COLLATE ${COLL}            AS warehouse_name,
        dst.name COLLATE ${COLL}            AS target_warehouse_name,
        COUNT(ti.id)                        AS item_count,
        COALESCE(SUM(ABS(ti.quantity)), 0)  AS total_quantity
      FROM inventory_transfers t
      -- The COLLATE on each join key is required, not stylistic: the transfer
      -- tables are utf8mb4_unicode_ci and warehouses/products are
      -- utf8mb4_0900_ai_ci, so an uncast '=' across them raises
      -- ER_CANT_AGGREGATE_2COLLATIONS. (transfers->items needs none: both
      -- sides came from migration 074 and already share a collation.)
      LEFT JOIN warehouses src ON src.id = t.source_warehouse_id COLLATE ${COLL}
      LEFT JOIN warehouses dst ON dst.id = t.target_warehouse_id COLLATE ${COLL}
      LEFT JOIN inventory_transfer_items ti ON ti.transfer_id = t.id
      WHERE 1=1${dateWhere('t.transfer_date', trParams)}${
        search
          ? (trParams.push(`%${search}%`, `%${search}%`),
            ` AND EXISTS (
                SELECT 1 FROM inventory_transfer_items sti
                WHERE sti.transfer_id = t.id
                  AND (sti.product_name LIKE ? OR t.reference LIKE ?)
              )`)
          : ''
      }
      GROUP BY t.id, t.transfer_date, t.reference, t.notes, src.name, dst.name
    `;

    const unionSql = `SELECT * FROM ( ${adjSql} UNION ALL ${trSql} ) AS batches`;
    const unionParams = [...adjParams, ...trParams];

    const countRows: any = await query(
      `SELECT COUNT(*) AS total FROM ( ${unionSql} ) AS counted`,
      unionParams
    );
    const totalItems = Number(countRows?.[0]?.total) || 0;

    const rows: any = await query(
      `${unionSql} ORDER BY transaction_date DESC LIMIT ? OFFSET ?`,
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
