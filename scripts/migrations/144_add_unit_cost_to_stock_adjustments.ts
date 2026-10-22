import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

/**
 * Adds `unit_cost` to `stock_adjustments` so the Bulk Stock Adjustment screen
 * can record what each line was costed at.
 *
 * Why the column is needed: adding stock already creates an `inventory_batches`
 * row, and that batch's `unit_cost` is what FIFO depletion later charges
 * against a sale. Before this column the batch could only ever be costed at
 * `products.cost` — the product's standing cost — so a delivery received at a
 * different price silently entered stock at the wrong cost and misstated margin
 * on every sale that drew from it. The cost now travels with the line.
 *
 * NULL means "no cost was captured", which is NOT the same as 0 and must never
 * be coerced to it: every row written before this migration is NULL, and the
 * readers fall back to `products.cost` for those exactly as they did before.
 * A row that genuinely cost nothing stores 0.
 *
 * DECIMAL(14,4) rather than (14,2): a unit cost is frequently a case price
 * divided by its pack size, and rounding that to centavos at entry compounds
 * into a visible error across a large batch. Matches `inventory_batches.unit_cost`.
 */
const TABLE = 'stock_adjustments';
const COLUMN = 'unit_cost';

async function hasColumn(table: string, column: string): Promise<boolean> {
  const rows: any = await query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return Array.isArray(rows) && rows.length > 0;
}

const migration: Migration = {
  name: '144_add_unit_cost_to_stock_adjustments',
  timestamp: '2026-10-20_09-00-00',

  async up(): Promise<void> {
    console.log('--- ADDING unit_cost to stock_adjustments ---');

    if (await hasColumn(TABLE, COLUMN)) {
      console.log('   unit_cost already exists, skipping');
      return;
    }

    await query(
      `ALTER TABLE ${TABLE} ADD COLUMN ${COLUMN} DECIMAL(14,4) DEFAULT NULL`
    );
    console.log('✅ unit_cost column added');
  },

  async down(): Promise<void> {
    console.log('--- REMOVING unit_cost from stock_adjustments ---');

    if (await hasColumn(TABLE, COLUMN)) {
      await query(`ALTER TABLE ${TABLE} DROP COLUMN ${COLUMN}`);
      console.log('✅ unit_cost column dropped');
    }
  },
};

registerMigration(migration);

export default migration;
