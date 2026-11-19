import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

/**
 * Converts `cost_at_sale = 0` snapshots that were priced ONLY by uncosted
 * stock into NULL, so the product's cost reaches them.
 *
 * WHY: stock entered while a product's cost was still blank — the "Initial
 * Stock" batch on product create, a stock adjustment, a product import — is
 * written to `inventory_batches` at `unit_cost = 0` (the column is NOT NULL, so
 * those writers have nothing else to store). FIFO then charged that 0 to every
 * sale drawing from the batch, so the line snapshotted cost 0 even after the
 * cost was filled in on the product. `lib/batch-deduction.ts` now prices such a
 * batch at `products.cost`; this repairs the rows already written.
 *
 * Migration 147 did not catch these: it only touched rows with no real batch
 * split, and these rows DO have one — a batch split at unitCost 0.
 *
 * SCOPE — only rows where EVERY split in `batch_source` is a `batch` split that
 * points at an existing non-`purchase` batch whose unit_cost is 0. A purchase
 * batch at 0 (a supplier freebie) is a deliberate cost and stays frozen; a row
 * with any costed split, or a `fallback` split, is left alone.
 *
 * `down()` restores 0 for rows matching the same shape.
 */
async function columnExists(table: string, column: string): Promise<boolean> {
  const rows: any = await query(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return Number(rows?.[0]?.n || 0) > 0;
}

/** inventory_batches.id's own collation, so the JSON_TABLE join can match it. */
async function batchIdCollation(): Promise<string> {
  const rows: any = await query(
    `SELECT COLLATION_NAME AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventory_batches' AND COLUMN_NAME = 'id'`
  );
  const c = String(rows?.[0]?.c || 'utf8mb4_unicode_ci');
  // Identifier is interpolated into SQL: accept only a plain collation name.
  return /^[a-z0-9_]+$/i.test(c) ? c : 'utf8mb4_unicode_ci';
}

let collation = 'utf8mb4_unicode_ci';

function predicate(alias: string, snapshot: string): string {
  return `
    ${alias}.${snapshot}
    AND ${alias}.batch_source IS NOT NULL
    AND JSON_VALID(${alias}.batch_source)
    AND JSON_LENGTH(${alias}.batch_source) > 0
    AND NOT EXISTS (
      SELECT 1
      FROM JSON_TABLE(${alias}.batch_source, '$[*]' COLUMNS (
        split_type VARCHAR(20)  PATH '$.type',
        batch_id   VARCHAR(50)  PATH '$.batchId',
        unit_cost  DECIMAL(14,4) PATH '$.unitCost'
      )) s
      -- JSON_TABLE columns take the server default collation, which need not
      -- match inventory_batches.id; compare under the table's own collation.
      LEFT JOIN inventory_batches ib ON ib.id = CONVERT(s.batch_id USING utf8mb4) COLLATE ${collation}
      WHERE s.split_type <> 'batch'
         OR COALESCE(s.unit_cost, 0) <> 0
         OR ib.id IS NULL
         OR ib.source_type = 'purchase'
         OR ib.unit_cost <> 0
    )
  `;
}

async function apply(table: string, alias: string, from: string, to: string, label: string) {
  if (!(await columnExists(table, 'cost_at_sale')) || !(await columnExists(table, 'batch_source'))) {
    console.log(`⏭️  ${table} has no cost_at_sale/batch_source, skipping`);
    return;
  }
  const where = predicate(alias, from);
  const before: any = await query(`SELECT COUNT(*) AS n FROM ${table} ${alias} WHERE ${where}`);
  const count = Number(before?.[0]?.n || 0);
  if (count > 0) {
    await query(`UPDATE ${table} ${alias} SET ${alias}.cost_at_sale = ${to} WHERE ${where}`);
  }
  console.log(`✅ ${table}: ${label} ${count} row(s)`);
}

const migration: Migration = {
  name: '149_null_cost_at_sale_from_uncosted_batches',
  timestamp: '2026-11-18_10-00-00',

  async up() {
    collation = await batchIdCollation();
    await apply('sale_items', 'si', 'cost_at_sale = 0', 'NULL', 'nulled uncosted-batch zero snapshot(s) in');
    await apply('sales_invoice_items', 'sii', 'cost_at_sale = 0', 'NULL', 'nulled uncosted-batch zero snapshot(s) in');
  },

  async down() {
    collation = await batchIdCollation();
    await apply('sale_items', 'si', 'cost_at_sale IS NULL', '0', 'restored 0 on');
    await apply('sales_invoice_items', 'sii', 'cost_at_sale IS NULL', '0', 'restored 0 on');
  },
};

registerMigration(migration);

export default migration;
