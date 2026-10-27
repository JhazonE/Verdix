import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';
import { DEFAULT_HIDDEN_KEYS } from '../../lib/page-registry';

/**
 * Hides Repackaging, the Approvals Board and Workflow Settings by default.
 *
 * `disabled_pages` holds one row per HIDDEN page, so an empty table means
 * "show everything" — which is what every existing install has. This migration
 * inserts the three default-hidden keys, plus the SEED_MARKER row that records
 * the defaults as applied.
 *
 * This migration is a CONVENIENCE, not the mechanism. `ensureTable()` in
 * app/api/developer/disabled-pages/route.ts does the same seeding on first
 * request, keyed on that same marker, so an install seeds itself whether or not
 * this ever runs. Keeping both means the default lands at upgrade time (here)
 * instead of waiting for someone to open Developer Options, while an install
 * that skipped migrations is not left stuck.
 *
 * ONE-TIME, AND ONLY ON A TABLE THAT WAS NEVER CONFIGURED. A row's absence
 * cannot distinguish "never configured" from "an admin switched this module on
 * deliberately", so the insert is skipped entirely when the table already holds
 * any real row. On such an install the admin has used Page Visibility, and their
 * saved set is authoritative — re-hiding modules underneath them is exactly the
 * failure mode this guard exists to prevent. Those stores keep Repackaging and
 * Approvals visible; they can hide them from Developer Options like any other
 * page.
 *
 * BEHAVIOUR CHANGE ON UPGRADE: a store that never touched Page Visibility and
 * was using Repackaging or the Approvals Board loses those sidebar links, and
 * their URLs redirect to the dashboard until an admin re-enables them in
 * Developer Options > Page Visibility.
 *
 * `down()` removes the keys this migration could have added AND the marker —
 * dropping the marker is what makes the revert real, since leaving it would stop
 * the route from ever re-seeding. It bails out when the table holds anything
 * else, so an admin's own later choices are never discarded.
 */
async function tableExists(table: string): Promise<boolean> {
  const rows: any = await query(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  return Number(rows?.[0]?.n ?? 0) > 0;
}

// Must match SEED_MARKER in app/api/developer/disabled-pages/route.ts.
const SEED_MARKER = '__defaults_seeded__';

/** Real page rows only — the marker is bookkeeping and never counts as config. */
async function rowCount(): Promise<number> {
  const rows: any = await query(
    'SELECT COUNT(*) AS n FROM disabled_pages WHERE page_key <> ?',
    [SEED_MARKER]
  );
  return Number(rows?.[0]?.n ?? 0);
}

async function isSeeded(): Promise<boolean> {
  const rows: any = await query(
    'SELECT 1 FROM disabled_pages WHERE page_key = ? LIMIT 1',
    [SEED_MARKER]
  );
  return Boolean(rows?.length);
}

const migration: Migration = {
  name: '146_default_hidden_pages',
  timestamp: '2026-10-26_10-00-00',

  async up(): Promise<void> {
    console.log('--- HIDING Repackaging / Approvals Board / Workflow Settings by default ---');

    if (!(await tableExists('disabled_pages'))) {
      // The route's ensureTable() creates and seeds it on first request, so
      // there is nothing to do here and nothing is lost by skipping.
      console.log('⏭️  disabled_pages not present — the API seeds it on creation, skipping');
      return;
    }

    if (await isSeeded()) {
      console.log('⏭️  defaults already applied to this database, skipping');
      return;
    }

    const existing = await rowCount();
    if (existing > 0) {
      // Mark it anyway: the defaults are intentionally NOT applied here, and
      // without the marker the route would try to apply them on first request.
      await query('INSERT IGNORE INTO disabled_pages (page_key) VALUES (?)', [SEED_MARKER]);
      console.log(
        `⏭️  disabled_pages already holds ${existing} row(s) — page visibility has been ` +
        'configured on this install, leaving it untouched'
      );
      return;
    }

    await query('INSERT IGNORE INTO disabled_pages (page_key) VALUES (?)', [SEED_MARKER]);
    for (const key of DEFAULT_HIDDEN_KEYS) {
      await query('INSERT IGNORE INTO disabled_pages (page_key) VALUES (?)', [key]);
      console.log(`✅ hidden by default: ${key}`);
    }
    console.log('ℹ️  Re-enable per store from Developer Options > Page Visibility.');
  },

  async down(): Promise<void> {
    console.log('--- RESTORING Repackaging / Approvals Board / Workflow Settings ---');

    if (!(await tableExists('disabled_pages'))) {
      console.log('⏭️  disabled_pages not present, skipping');
      return;
    }

    const total = await rowCount();
    if (total > DEFAULT_HIDDEN_KEYS.length) {
      console.log(
        `⏭️  disabled_pages holds ${total} row(s), more than this migration added — ` +
        'an admin has configured page visibility since, leaving it untouched'
      );
      return;
    }

    const placeholders = DEFAULT_HIDDEN_KEYS.map(() => '?').join(', ');
    const res: any = await query(
      `DELETE FROM disabled_pages WHERE page_key IN (${placeholders})`,
      DEFAULT_HIDDEN_KEYS
    );
    // Drop the marker too, or the route will consider the defaults applied and
    // never seed again — the revert would hold only until the next upgrade.
    await query('DELETE FROM disabled_pages WHERE page_key = ?', [SEED_MARKER]);
    console.log(`✅ removed ${res?.affectedRows ?? 0} default-hidden row(s) — pages visible again`);
  }
};

registerMigration(migration);
