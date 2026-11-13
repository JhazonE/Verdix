/**
 * The single definition of "what is in Adjustment History", at LINE level.
 *
 * Both screens read from here so they can never drift apart again:
 *  - Adjustment History (`/api/inventory/adjust/batches`) GROUPS these lines
 *    into one row per transaction.
 *  - The Adjustment / Damaged report (`/api/reports/adjustments`) lists the
 *    lines themselves, with cost, under the same reference number.
 *
 * Two sources are unioned because the modes have always been stored apart:
 * add/remove lines live in `stock_adjustments` (grouped on `batch_id`, or alone
 * when it is NULL — standalone adjustments and everything before migration
 * 141), while transfers are `inventory_transfers` + `inventory_transfer_items`.
 *
 * Search matches a TRANSACTION, not a line: a batch whose any one line matches
 * comes back with ALL its lines. That keeps the report's lines exactly the
 * lines of the transactions History shows for the same filter.
 */

/**
 * `inventory_transfers`/`_items` are utf8mb4_unicode_ci (migration 074) while
 * the rest of the schema is utf8mb4_0900_ai_ci, so every text column in the
 * UNION — and every join key across the two — is forced to one collation, or
 * MySQL raises ER_CANT_AGGREGATE_2COLLATIONS.
 */
const COLL = 'utf8mb4_0900_ai_ci';

export interface AdjustmentHistoryFilter {
  startDate?: string | null;
  endDate?: string | null;
  search?: string | null;
}

/**
 * Columns of every line:
 *   transaction_id, kind ('batch' | 'single' | 'transfer'), mode ('add' |
 *   'remove' | 'transfer'), line_date, reference_no, notes, warehouse_name,
 *   target_warehouse_name, line_id (NULL for a transfer with no items),
 *   product_id, product_name, barcode, unit_of_measure, reason,
 *   quantity (signed base units; transfers are positive = moved),
 *   new_stock (NULL for transfers), unit_cost (pesos per base unit).
 */
export function buildAdjustmentLinesSql(filter: AdjustmentHistoryFilter): { sql: string; params: any[] } {
  const { startDate, endDate } = filter;
  const search = (filter.search || '').trim();

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

  const adjParams: any[] = [];
  const adjSql = `
    SELECT
      COALESCE(sa.batch_id, sa.id) COLLATE ${COLL}                       AS transaction_id,
      (CASE WHEN sa.batch_id IS NULL THEN 'single' ELSE 'batch' END) COLLATE ${COLL} AS kind,
      -- adj_type is NULL on rows written by paths that never set it; reading
      -- that as "add" mislabelled removals, so fall back to the sign.
      (CASE
         WHEN sa.adj_type IS NOT NULL THEN sa.adj_type
         WHEN sa.quantity < 0 THEN 'remove'
         ELSE 'add'
       END) COLLATE ${COLL}                                               AS mode,
      sa.created_at                                                       AS line_date,
      sa.reference_no COLLATE ${COLL}                                     AS reference_no,
      sa.note COLLATE ${COLL}                                             AS notes,
      wh.name COLLATE ${COLL}                                             AS warehouse_name,
      twh.name COLLATE ${COLL}                                            AS target_warehouse_name,
      sa.id COLLATE ${COLL}                                               AS line_id,
      sa.product_id COLLATE ${COLL}                                       AS product_id,
      p.name COLLATE ${COLL}                                              AS product_name,
      p.barcode COLLATE ${COLL}                                           AS barcode,
      p.unit_of_measure COLLATE ${COLL}                                   AS unit_of_measure,
      sa.reason COLLATE ${COLL}                                           AS reason,
      sa.quantity                                                         AS quantity,
      sa.new_stock                                                        AS new_stock,
      -- The cost captured on the line (migration 144); older rows fall back to
      -- the product's standing cost, the same fallback the batch writer used.
      COALESCE(sa.unit_cost, p.cost, 0)                                   AS unit_cost
    FROM stock_adjustments sa
    LEFT JOIN products   p   ON p.id   = sa.product_id
    LEFT JOIN warehouses wh  ON wh.id  = sa.warehouse_id
    LEFT JOIN warehouses twh ON twh.id = sa.target_warehouse_id
    WHERE 1=1${dateWhere('sa.created_at', adjParams)}${
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
  `;

  const trParams: any[] = [];
  const trSql = `
    SELECT
      t.id COLLATE ${COLL}                                                AS transaction_id,
      'transfer' COLLATE ${COLL}                                          AS kind,
      'transfer' COLLATE ${COLL}                                          AS mode,
      t.transfer_date                                                     AS line_date,
      t.reference COLLATE ${COLL}                                         AS reference_no,
      t.notes COLLATE ${COLL}                                             AS notes,
      src.name COLLATE ${COLL}                                            AS warehouse_name,
      dst.name COLLATE ${COLL}                                            AS target_warehouse_name,
      ti.id COLLATE ${COLL}                                               AS line_id,
      ti.product_id COLLATE ${COLL}                                       AS product_id,
      ti.product_name COLLATE ${COLL}                                     AS product_name,
      p.barcode COLLATE ${COLL}                                           AS barcode,
      COALESCE(ti.unit_of_measure COLLATE ${COLL}, p.unit_of_measure)    AS unit_of_measure,
      NULL                                                                AS reason,
      ti.quantity                                                         AS quantity,
      NULL                                                                AS new_stock,
      COALESCE(p.cost, 0)                                                 AS unit_cost
    FROM inventory_transfers t
    LEFT JOIN warehouses src ON src.id = t.source_warehouse_id COLLATE ${COLL}
    LEFT JOIN warehouses dst ON dst.id = t.target_warehouse_id COLLATE ${COLL}
    LEFT JOIN inventory_transfer_items ti ON ti.transfer_id = t.id
    LEFT JOIN products p ON p.id = ti.product_id COLLATE ${COLL}
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
  `;

  return {
    sql: `${adjSql} UNION ALL ${trSql}`,
    params: [...adjParams, ...trParams],
  };
}

/**
 * The same lines grouped into one row per TRANSACTION — what Adjustment
 * History lists and what the report groups its lines under. Order and page it
 * with `ORDER BY transaction_date DESC` so both screens page identically.
 *
 * Columns: id, kind, mode, transaction_date, reference_no, notes,
 * warehouse_name, target_warehouse_name, item_count, total_quantity,
 * total_cost (signed pesos; a transfer's is the value moved).
 */
export function buildAdjustmentTransactionsSql(filter: AdjustmentHistoryFilter): { sql: string; params: any[] } {
  const lines = buildAdjustmentLinesSql(filter);
  return {
    sql: `
      SELECT
        l.transaction_id                    AS id,
        l.kind                              AS kind,
        MIN(l.mode)                         AS mode,
        MIN(l.line_date)                    AS transaction_date,
        MIN(l.reference_no)                 AS reference_no,
        MIN(l.notes)                        AS notes,
        MIN(l.warehouse_name)               AS warehouse_name,
        MIN(l.target_warehouse_name)        AS target_warehouse_name,
        COUNT(l.line_id)                    AS item_count,
        COALESCE(SUM(ABS(l.quantity)), 0)   AS total_quantity,
        COALESCE(SUM(l.quantity * l.unit_cost), 0) AS total_cost
      FROM ( ${lines.sql} ) AS l
      GROUP BY l.kind, l.transaction_id
    `,
    params: lines.params,
  };
}
