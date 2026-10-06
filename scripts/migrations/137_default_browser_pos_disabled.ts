import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

/**
 * Flips `pos_settings.enable_browser_pos` to CLOSED by default.
 *
 * 136 added the column defaulting to 1 (browser POS allowed) to guarantee that
 * no existing install changed behaviour on upgrade. That turned out to be the
 * wrong posture: the Electron desktop window is the intended POS terminal, and
 * leaving /pos open to every browser on the store LAN by default is exactly the
 * exposure this switch exists to close. Closed-by-default means a store has to
 * opt in deliberately from Developer Options.
 *
 * This is a SEPARATE migration rather than an edit to 136 because 136 is
 * already applied in the wild — an edited 136 would be recorded as executed and
 * would never re-run, so the live default would stay 1.
 *
 * BEHAVIOUR CHANGE ON UPGRADE: a store that was using /pos in a browser will
 * see the "POS Unavailable in Browser" notice after this runs, until an admin
 * re-enables it. Desktop terminals are unaffected — the gate never applies to
 * Electron (`lib/is-desktop-app.ts`).
 *
 * `down()` restores both the default and the rows to 1, returning to 136's
 * open-by-default behaviour.
 */
async function columnDefault(table: string, column: string): Promise<string | null> {
  const rows: any = await query(
    `SELECT COLUMN_DEFAULT FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  if (!rows || rows.length === 0) return null;
  return rows[0].COLUMN_DEFAULT === null ? null : String(rows[0].COLUMN_DEFAULT);
}

const migration: Migration = {
  name: '137_default_browser_pos_disabled',
  timestamp: '2026-10-06_10-00-00',

  async up(): Promise<void> {
    console.log('--- SETTING browser POS to DISABLED by default ---');

    const current = await columnDefault('pos_settings', 'enable_browser_pos');
    if (current === null) {
      // 136 should have created it, and GET /api/pos-settings auto-adds it too.
      console.log('⏭️  pos_settings.enable_browser_pos not present, skipping');
      return;
    }

    await query(
      'ALTER TABLE pos_settings MODIFY COLUMN enable_browser_pos TINYINT(1) NOT NULL DEFAULT 0'
    );
    console.log('✅ column default 1 -> 0');

    // Existing rows carry the old default (or NULL from the runtime auto-add),
    // and a stored 1 would keep browser POS open on every upgraded install.
    // Reset them so "disabled by default" is true of installs that already ran
    // 136, not just of freshly created rows.
    const res: any = await query(
      'UPDATE pos_settings SET enable_browser_pos = 0 WHERE enable_browser_pos IS NULL OR enable_browser_pos = 1'
    );
    console.log(`✅ reset ${res?.affectedRows ?? 0} existing row(s) to 0 (browser POS blocked)`);
    console.log('ℹ️  Re-enable per store from Developer Options > POS Mode & Access.');
  },

  async down(): Promise<void> {
    console.log('--- REVERTING browser POS to ENABLED by default ---');

    const current = await columnDefault('pos_settings', 'enable_browser_pos');
    if (current === null) {
      console.log('⏭️  pos_settings.enable_browser_pos not present, skipping');
      return;
    }

    await query(
      'ALTER TABLE pos_settings MODIFY COLUMN enable_browser_pos TINYINT(1) NOT NULL DEFAULT 1'
    );
    await query('UPDATE pos_settings SET enable_browser_pos = 1');
    console.log('✅ default and existing rows restored to 1 (browser POS allowed)');
  }
};

registerMigration(migration);
