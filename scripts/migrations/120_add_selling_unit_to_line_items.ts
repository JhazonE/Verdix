import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

/**
 * Records WHICH selling unit a line was sold in.
 *
 * Without this, "1 case" and "1 piece" are indistinguishable in sales history,
 * so a report cannot show cases even when the stock deduction is right.
 *
 * name and factor are denormalised on purpose: a receipt must keep its meaning
 * when someone later edits the unit. These tables feed BIR filings, so history
 * is not ours to rewrite.
 *
 * Every column is nullable — existing rows stay NULL, meaning "base unit".
 */
const TABLES = [
  'pos_transaction_items',
  'sale_items',
  'sales_invoice_items',
  'sales_order_items',
];

async function hasColumn(table: string, column: string): Promise<boolean> {
  const rows: any = await query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column],
  );
  return Boolean(rows[0]);
}

const migration: Migration = {
  name: '120_add_selling_unit_to_line_items',
  timestamp: '2026-09-10_13-00-00',

  async up(): Promise<void> {
    for (const table of TABLES) {
      if (await hasColumn(table, 'selling_unit_id')) {
        console.log(`⏭️  ${table} already has selling unit columns, skipping`);
        continue;
      }
      await query(`
        ALTER TABLE ${table}
          ADD COLUMN selling_unit_id     VARCHAR(100)  NULL,
          ADD COLUMN selling_unit_name   VARCHAR(100)  NULL,
          ADD COLUMN selling_unit_factor DECIMAL(12,4) NULL
      `);
      console.log(`✅ ${table}: added selling unit columns`);
    }
  },

  async down(): Promise<void> {
    for (const table of TABLES) {
      if (!(await hasColumn(table, 'selling_unit_id'))) continue;
      await query(`
        ALTER TABLE ${table}
          DROP COLUMN selling_unit_id,
          DROP COLUMN selling_unit_name,
          DROP COLUMN selling_unit_factor
      `);
      console.log(`✅ ${table}: dropped selling unit columns`);
    }
  }
};

registerMigration(migration);
