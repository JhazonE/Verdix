import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

/**
 * Records the price level a sale line was priced at, when a cashier picked one
 * deliberately in the POS Edit Price dialog.
 *
 * Both columns, not just the id. The NAME is captured denormalised at sale
 * time, exactly as `selling_unit_name` and `selling_unit_factor` already are:
 * a level later renamed or deleted must not change what a filed receipt meant.
 * The id alone would leave a sale pointing at a row that may no longer exist,
 * or worse, one whose name now says something different.
 *
 * NULL means "not priced by a picked level", which covers every existing row
 * and every ordinary sale from here on. That is why both are nullable with no
 * backfill: there is no honest way to say what level a historical line used,
 * because nothing recorded it.
 *
 * No index: nothing in this feature queries by level. Recording it is the
 * goal, so the question becomes answerable later.
 */
const TABLE = 'sale_items';
const COLUMNS: Array<{ name: string; ddl: string }> = [
  { name: 'price_level_id', ddl: 'VARCHAR(50) DEFAULT NULL' },
  { name: 'price_level_name', ddl: 'VARCHAR(100) DEFAULT NULL' },
];

async function hasColumn(table: string, column: string): Promise<boolean> {
  const rows: any = await query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return Array.isArray(rows) && rows.length > 0;
}

const migration: Migration = {
  name: '143_add_price_level_to_sale_items',
  timestamp: '2026-10-19_19-00-00',

  async up(): Promise<void> {
    console.log('--- ADDING price level columns to sale_items ---');

    // Checked one at a time: a half-applied state is reachable if a previous
    // run failed between the two statements.
    for (const { name, ddl } of COLUMNS) {
      if (await hasColumn(TABLE, name)) {
        console.log(`   ${name} already exists, skipping`);
        continue;
      }
      await query(`ALTER TABLE ${TABLE} ADD COLUMN ${name} ${ddl}`);
      console.log(`✅ ${name} column added`);
    }
  },

  async down(): Promise<void> {
    console.log('--- REMOVING price level columns from sale_items ---');

    for (const { name } of COLUMNS) {
      if (await hasColumn(TABLE, name)) {
        await query(`ALTER TABLE ${TABLE} DROP COLUMN ${name}`);
        console.log(`✅ ${name} column dropped`);
      }
    }
  },
};

registerMigration(migration);

export default migration;
