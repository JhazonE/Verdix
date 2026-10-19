import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

/**
 * Adds the Discount authentication settings to `pos_settings`.
 *
 * Applying a discount was an ungated POS action: any cashier could knock any
 * percentage — or a flat peso amount — off a line or the whole cart with no
 * credential prompt, while editing that same line's PRICE (the equivalent
 * giveaway, reached from the next button over) already required credentials
 * through `enable_price_edit_auth`. This closes that gap with the same trio of
 * columns every other gated action uses.
 *
 * DEFAULT FALSE matches all fourteen existing auth toggles in this table, so
 * discounts keep working exactly as they do today until an admin turns the
 * toggle on from POS Setup → Security Settings. Unlike migration 138, this one
 * therefore changes nothing about existing installs' behaviour — the action was
 * never prompting to begin with.
 *
 * Scope note: the gate is on OPENING the discount sheet, not on each discount
 * type, so statutory discounts (Senior/PWD/NAAC/Solo Parent) are covered by the
 * same prompt. Those are legal entitlements rather than discretionary markdowns,
 * but they are reached through the same sheet, and a store that wants them
 * unprompted simply leaves the toggle off. Splitting discretionary from
 * statutory would need two toggles and is deliberately not done here.
 */
async function hasColumn(table: string, column: string): Promise<boolean> {
  const rows: any = await query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return Array.isArray(rows) && rows.length > 0;
}

const COLUMNS: { name: string; type: string }[] = [
  { name: 'enable_discount_auth', type: 'BOOLEAN DEFAULT FALSE' },
  { name: 'discount_auth_username', type: 'VARCHAR(255) NULL' },
  { name: 'discount_auth_password', type: 'VARCHAR(255) NULL' },
];

const migration: Migration = {
  name: '139_add_discount_auth',
  timestamp: '2026-10-19_09-00-00',

  async up(): Promise<void> {
    console.log('--- ADDING pos_settings Discount auth columns ---');
    for (const col of COLUMNS) {
      if (await hasColumn('pos_settings', col.name)) {
        // GET /api/pos-settings auto-adds missing columns at runtime, so a live
        // install may already have these before the migration ever runs.
        console.log(`⏭️  pos_settings.${col.name} already present, skipping`);
        continue;
      }
      await query(`ALTER TABLE pos_settings ADD COLUMN ${col.name} ${col.type}`);
      console.log(`✅ pos_settings.${col.name} added`);
    }
    console.log('✅ Discount auth is now configurable from POS Setup (default: off)');
  },

  async down(): Promise<void> {
    console.log('--- DROPPING pos_settings Discount auth columns ---');
    for (const col of COLUMNS) {
      if (!(await hasColumn('pos_settings', col.name))) {
        console.log(`⏭️  pos_settings.${col.name} not present, skipping`);
        continue;
      }
      await query(`ALTER TABLE pos_settings DROP COLUMN ${col.name}`);
      console.log(`✅ pos_settings.${col.name} dropped`);
    }
  }
};

registerMigration(migration);
