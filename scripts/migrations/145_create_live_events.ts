import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

/**
 * Creates `live_events`, a single-row counter used to propagate "something
 * changed, refetch" between machines.
 *
 * Why a table and not just the in-process SSE hub: each terminal runs its own
 * Next.js server against the shared database, so an event published into one
 * server's memory reaches only the tabs connected to THAT server. A browser on
 * a second PC pointed at the first PC's IP does share a server and is covered
 * by memory alone, but two Electron terminals are not. The database is the one
 * thing every machine demonstrably has in common, so the SSE stream polls this
 * counter and fans the change out to its own subscribers.
 *
 * It is a counter, not a queue: consumers react by refetching, so they only
 * need to know THAT something changed since they last looked, never what or
 * how many times. That keeps the row count fixed at one and makes a missed
 * tick harmless — the next read still shows a higher number.
 *
 * `updated_at` is informational (a debugging aid for "is anything firing at
 * all"); `revision` is the value readers compare.
 */
const TABLE = 'live_events';

async function hasTable(table: string): Promise<boolean> {
  const rows: any = await query(
    `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  return Array.isArray(rows) && rows.length > 0;
}

const migration: Migration = {
  name: '145_create_live_events',
  timestamp: '2026-10-22_09-00-00',

  async up(): Promise<void> {
    console.log('--- CREATING live_events ---');

    if (await hasTable(TABLE)) {
      console.log('   live_events already exists, skipping');
      return;
    }

    await query(`
      CREATE TABLE ${TABLE} (
        name VARCHAR(64) NOT NULL PRIMARY KEY,
        revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    // Seed the one row readers expect, so a terminal that starts before any
    // write has ever happened reads a revision instead of nothing.
    await query(
      `INSERT INTO ${TABLE} (name, revision) VALUES ('stock-updated', 0)`
    );

    console.log('✅ live_events created and seeded');
  },

  async down(): Promise<void> {
    console.log('--- DROPPING live_events ---');

    if (await hasTable(TABLE)) {
      await query(`DROP TABLE ${TABLE}`);
      console.log('✅ live_events dropped');
    }
  },
};

registerMigration(migration);

export default migration;
