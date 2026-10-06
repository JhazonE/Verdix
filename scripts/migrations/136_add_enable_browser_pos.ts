import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

/**
 * Adds `pos_settings.enable_browser_pos` — the store-wide switch that decides
 * whether /pos may be opened from an ordinary web browser.
 *
 * The Electron desktop window is the intended POS deployment target, but the
 * same Next.js server answers any browser on the LAN, so until now anyone who
 * typed /pos into Chrome got the checkout screen. This flag lets an admin close
 * that door from Developer Options while leaving the desktop app untouched —
 * the gate only ever applies to browser clients, never to Electron.
 *
 * DEFAULT 1 here keeps every existing install behaving as it did when this
 * migration shipped. NOTE: migration 137 subsequently flips the default (and
 * existing rows) to 0 — browser POS is now CLOSED by default and must be
 * enabled per store from Developer Options. This file is left as it was
 * because it is already applied in the wild.
 */
async function hasColumn(table: string, column: string): Promise<boolean> {
  const rows: any = await query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return Array.isArray(rows) && rows.length > 0;
}

const migration: Migration = {
  name: '136_add_enable_browser_pos',
  timestamp: '2026-10-06_09-00-00',

  async up(): Promise<void> {
    console.log('--- ADDING pos_settings.enable_browser_pos ---');
    if (await hasColumn('pos_settings', 'enable_browser_pos')) {
      // GET /api/pos-settings auto-adds missing columns at runtime, so a live
      // install may already have this one before the migration ever runs.
      console.log('⏭️  pos_settings.enable_browser_pos already present, skipping');
      return;
    }
    await query(
      'ALTER TABLE pos_settings ADD COLUMN enable_browser_pos TINYINT(1) NOT NULL DEFAULT 1'
    );
    console.log('✅ pos_settings.enable_browser_pos added (default 1 = browser POS allowed)');
  },

  async down(): Promise<void> {
    console.log('--- DROPPING pos_settings.enable_browser_pos ---');
    if (!(await hasColumn('pos_settings', 'enable_browser_pos'))) {
      console.log('⏭️  pos_settings.enable_browser_pos not present, skipping');
      return;
    }
    await query('ALTER TABLE pos_settings DROP COLUMN enable_browser_pos');
    console.log('✅ pos_settings.enable_browser_pos dropped — browser POS is open again');
  }
};

registerMigration(migration);
