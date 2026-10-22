import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

/**
 * Adds `enable_price_level_picker` to `pos_settings`: the switch that shows the
 * price level picker inside the POS Edit Price dialog.
 *
 * The picker lets a cashier price ONE cart line from a configured price level
 * at any quantity, ignoring `min_quantity` entirely — the quantity tier remains
 * the mechanism for *automatic* breaks, while the picker is the mechanism for
 * *deliberate* ones.
 *
 * **Defaults to 0, not 1.** It changes what a cashier can do at the till, so an
 * existing store must opt in rather than find a new control on the Edit Price
 * dialog after an update. This matches how `enable_browser_pos` shipped
 * (migration 136 added it, 137 then had to turn it back off) — a new POS
 * affordance defaults off.
 *
 * NOT NULL with a default so every existing row gets 0 without a backfill pass,
 * and so the GET route never has to distinguish NULL from false.
 */
const TABLE = 'pos_settings';
const COLUMN = 'enable_price_level_picker';

async function hasColumn(table: string, column: string): Promise<boolean> {
  const rows: any = await query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return Array.isArray(rows) && rows.length > 0;
}

const migration: Migration = {
  name: '142_add_pos_price_level_picker',
  timestamp: '2026-10-19_18-00-00',

  async up(): Promise<void> {
    console.log('--- ADDING enable_price_level_picker to pos_settings ---');

    if (await hasColumn(TABLE, COLUMN)) {
      console.log('   enable_price_level_picker already exists, skipping');
      return;
    }

    await query(
      `ALTER TABLE ${TABLE} ADD COLUMN ${COLUMN} TINYINT(1) NOT NULL DEFAULT 0`
    );
    console.log('✅ enable_price_level_picker column added (default off)');
  },

  async down(): Promise<void> {
    console.log('--- REMOVING enable_price_level_picker from pos_settings ---');

    if (await hasColumn(TABLE, COLUMN)) {
      await query(`ALTER TABLE ${TABLE} DROP COLUMN ${COLUMN}`);
      console.log('✅ enable_price_level_picker column dropped');
    }
  },
};

registerMigration(migration);

export default migration;
