import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

/**
 * Adds the X-Reading and Z-Reading authentication settings to `pos_settings`.
 *
 * Before this, X-Reading and Z-Reading were the only POS actions whose
 * credential prompt was HARDCODED — every other gated action (line void, post
 * void, cash count, overall reading, cash transfer, …) already had an
 * `enable_*_auth` + `*_auth_username` + `*_auth_password` trio that an admin
 * could switch off from POS Setup → Security Settings. The two readings had no
 * switch at all and always demanded a full admin login, ignoring any
 * per-feature credentials.
 *
 * DEFAULT FALSE matches every other auth toggle in this table (including
 * `enable_overall_reading_auth`, the closest sibling), so the three readings
 * now behave alike. Note this DOES change behaviour for existing installs:
 * X/Z-Reading stop prompting until an admin turns the toggle on. That was the
 * deliberate choice — consistency with the other twelve toggles — and the
 * reports themselves remain BIR-locked records regardless of who previews them.
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
  { name: 'enable_x_reading_auth', type: 'BOOLEAN DEFAULT FALSE' },
  { name: 'x_reading_auth_username', type: 'VARCHAR(255) NULL' },
  { name: 'x_reading_auth_password', type: 'VARCHAR(255) NULL' },
  { name: 'enable_z_reading_auth', type: 'BOOLEAN DEFAULT FALSE' },
  { name: 'z_reading_auth_username', type: 'VARCHAR(255) NULL' },
  { name: 'z_reading_auth_password', type: 'VARCHAR(255) NULL' },
];

const migration: Migration = {
  name: '138_add_x_z_reading_auth',
  timestamp: '2026-10-15_09-00-00',

  async up(): Promise<void> {
    console.log('--- ADDING pos_settings X/Z-Reading auth columns ---');
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
    console.log('✅ X/Z-Reading auth is now configurable from POS Setup (default: off)');
  },

  async down(): Promise<void> {
    console.log('--- DROPPING pos_settings X/Z-Reading auth columns ---');
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
