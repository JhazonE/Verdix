import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

/**
 * Adds `batch_id` to `stock_adjustments` so the rows written by ONE press of
 * Apply Adjustments on the Bulk Stock Adjustment screen can be found again as
 * a single transaction.
 *
 * Why a column is needed at all: every row already carries its own
 * `adj_bulk_${Date.now()}_${random}` id, but that id is generated per ITEM
 * inside the loop — the timestamp advances and the random suffix differs — so
 * nothing in the table says which rows were submitted together. Grouping on
 * `reference_no` + a time window was considered and rejected: the reference is
 * optional (blank for most batches), and two terminals submitting against the
 * same shared DB within the same second would merge into one phantom batch.
 * The reprint slip is an inventory control document, so a merged or split
 * batch is a false record, not a cosmetic defect.
 *
 * **Existing rows keep `batch_id = NULL` and that is deliberate.** There is no
 * honest way to reconstruct historical batches from data that never recorded
 * them, so the reprint UI treats a NULL row as a single-item adjustment rather
 * than guessing at a grouping. Backfilling by timestamp proximity would invent
 * transactions that may never have existed.
 *
 * Nullable rather than NOT NULL because the single-item adjustment paths
 * (`app/api/stock-adjustments`, the inventory history actions, the POS
 * adjust-quantity screen) write to this table too and have no batch.
 */
const TABLE = 'stock_adjustments';
const COLUMN = 'batch_id';
const INDEX = 'idx_batch_id';

async function hasColumn(table: string, column: string): Promise<boolean> {
  const rows: any = await query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function hasIndex(table: string, index: string): Promise<boolean> {
  const rows: any = await query(
    `SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, index]
  );
  return Array.isArray(rows) && rows.length > 0;
}

const migration: Migration = {
  name: '141_add_batch_id_to_stock_adjustments',
  timestamp: '2026-10-19_15-00-00',

  async up(): Promise<void> {
    console.log('--- ADDING batch_id to stock_adjustments ---');

    // The column and its index are checked separately: a half-applied state is
    // reachable if a previous run failed between the two statements.
    if (await hasColumn(TABLE, COLUMN)) {
      console.log('   batch_id already exists, skipping');
    } else {
      await query(`ALTER TABLE ${TABLE} ADD COLUMN ${COLUMN} VARCHAR(50) DEFAULT NULL`);
      console.log('✅ batch_id column added');
    }

    if (await hasIndex(TABLE, INDEX)) {
      console.log('   idx_batch_id already exists, skipping');
    } else {
      // Every reprint lookup is "give me the rows for this batch", so the
      // column is only useful indexed.
      await query(`ALTER TABLE ${TABLE} ADD INDEX ${INDEX} (${COLUMN})`);
      console.log('✅ idx_batch_id index added');
    }
  },

  async down(): Promise<void> {
    console.log('--- REMOVING batch_id from stock_adjustments ---');

    if (await hasIndex(TABLE, INDEX)) {
      await query(`ALTER TABLE ${TABLE} DROP INDEX ${INDEX}`);
      console.log('✅ idx_batch_id index dropped');
    }

    if (await hasColumn(TABLE, COLUMN)) {
      await query(`ALTER TABLE ${TABLE} DROP COLUMN ${COLUMN}`);
      console.log('✅ batch_id column dropped');
    }
  },
};

registerMigration(migration);

export default migration;
