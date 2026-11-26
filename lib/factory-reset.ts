import fs from 'fs';
import path from 'path';
import { getConnection } from './mysql';
import { DEFAULT_HIDDEN_KEYS } from './page-registry';

/**
 * Full Factory Reset — returns the database to exactly what a FRESH INSTALL
 * produces, rather than to a hand-maintained approximation of it.
 *
 * A fresh install is: `verdix_install.sql` (schema + seed rows: the default
 * admin, user types, payment methods, price levels, tax rates, units, the STORE
 * warehouse, COUNTER 1, counters at their baseline…) followed by every
 * migration newer than that snapshot. So the reset:
 *
 *   1. empties EVERY table in the schema (enumerated live, so a table added by a
 *      future migration is covered without anyone remembering to list it),
 *      except KEEP_TABLES;
 *   2. re-inserts the snapshot's seed rows — read from the same
 *      `verdix_install.sql` the installer ships, so the two cannot drift;
 *   3. replays the DATA steps of migrations newer than the snapshot
 *      (applyPostSnapshotSeeds), since those migrations are already recorded as
 *      run and will not run again.
 *
 * Everything is parsed and validated BEFORE the first TRUNCATE: TRUNCATE
 * commits implicitly, so there is no rolling back once it starts.
 */

/**
 * Tables a factory reset must never empty.
 * - `migrations`: the schema is already current; emptying it would make the
 *   next `npm run migrate` re-run every migration against existing tables.
 * - `license_state`: the store's licence. A reset wipes the store's data, not
 *   its right to run the software — clearing it drops a hosted install onto the
 *   activation screen.
 */
export const KEEP_TABLES = new Set(['migrations', 'license_state']);

/** Snapshot tables whose rows are NOT restored (the live copy is authoritative). */
const SKIP_SNAPSHOT_TABLES = new Set(['migrations', 'license_state']);

const SNAPSHOT_FILE = 'verdix_install.sql';

export interface SeedTable {
  table: string;
  /** Column order as declared in the snapshot's CREATE TABLE. */
  columns: string[];
  /** Each row's values as raw SQL literals, in `columns` order. */
  rows: string[][];
}

/**
 * Where the installer's snapshot lives. Desktop installs run the server with
 * cwd = {app}, which is where setup.iss puts verdix_install.sql; dev runs from
 * the repo root; the Docker image copies it next to server.js.
 */
export function findInstallSnapshot(): string | null {
  const candidates = [
    process.env.VERDIX_INSTALL_SQL,
    path.join(process.cwd(), SNAPSHOT_FILE),
    path.join(path.dirname(process.argv[1] || ''), SNAPSHOT_FILE),
  ].filter((p): p is string => Boolean(p));
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

/**
 * Splits a mysqldump `VALUES (...),(...)` body into rows of raw literal
 * strings. Only quoting matters: a comma or parenthesis inside '...' is data.
 * mysqldump escapes with backslashes; '' doubling is handled too.
 */
export function parseTuples(values: string): string[][] {
  const rows: string[][] = [];
  const n = values.length;
  let i = 0;

  while (i < n) {
    const c = values[i];
    if (c === ',' || c === ' ' || c === '\n' || c === '\r' || c === '\t') { i++; continue; }
    if (c !== '(') throw new Error(`Unexpected "${c}" at offset ${i} in VALUES list`);
    i++;

    const row: string[] = [];
    let tok = '';
    let closed = false;
    while (i < n) {
      const ch = values[i];
      if (ch === "'") {
        tok += ch; i++;
        while (i < n) {
          const q = values[i];
          tok += q; i++;
          if (q === '\\') { tok += values[i] ?? ''; i++; continue; }
          if (q === "'") {
            if (values[i] === "'") { tok += "'"; i++; continue; }
            break;
          }
        }
      } else if (ch === ',') {
        row.push(tok.trim()); tok = ''; i++;
      } else if (ch === ')') {
        row.push(tok.trim()); i++; closed = true; break;
      } else {
        tok += ch; i++;
      }
    }
    if (!closed) throw new Error('Unterminated row in VALUES list');
    rows.push(row);
  }
  return rows;
}

/** Reads every table's column order and seed rows out of the snapshot. */
export function parseInstallSnapshot(sql: string): SeedTable[] {
  const columnsByTable = new Map<string, string[]>();
  const createRe = /CREATE TABLE (?:IF NOT EXISTS )?`([^`]+)` \(\r?\n([\s\S]*?)\r?\n\)/g;
  for (const m of sql.matchAll(createRe)) {
    const cols: string[] = [];
    for (const line of m[2].split(/\r?\n/)) {
      const col = /^\s+`([^`]+)`\s/.exec(line);
      if (col) cols.push(col[1]);
    }
    columnsByTable.set(m[1], cols);
  }

  const seeds = new Map<string, SeedTable>();
  const insertRe = /^INSERT\s+(?:IGNORE\s+)?INTO `([^`]+)` VALUES (.*);\r?$/gm;
  for (const m of sql.matchAll(insertRe)) {
    const table = m[1];
    const columns = columnsByTable.get(table);
    if (!columns) throw new Error(`${SNAPSHOT_FILE}: rows for \`${table}\` but no CREATE TABLE for it`);
    const rows = parseTuples(m[2]);
    for (const row of rows) {
      if (row.length !== columns.length) {
        throw new Error(
          `${SNAPSHOT_FILE}: a \`${table}\` row has ${row.length} values but the table declares ${columns.length} columns`
        );
      }
    }
    const seed = seeds.get(table) ?? { table, columns, rows: [] };
    seed.rows.push(...rows);
    seeds.set(table, seed);
  }
  return [...seeds.values()];
}

/**
 * Data steps of migrations NEWER than the snapshot. Those migrations are
 * already recorded in `migrations` (kept by the reset), so they will never run
 * again — without this, a reset store would be missing what a fresh install
 * gets. Every step is idempotent, so a regenerated snapshot that already holds
 * these rows is unaffected.
 *
 * MAINTENANCE: a new migration that INSERTs/UPDATEs rows in a seed table
 * (users, user_types, user_type_permissions, pos_settings, price_levels, …)
 * needs its data step mirrored here until verdix_install.sql is regenerated
 * past it.
 */
async function applyPostSnapshotSeeds(conn: any, liveColumns: Map<string, Set<string>>): Promise<void> {
  // 130: union each user's own grants into their user type's template, and
  // give Super Admin void_invoices.
  if (liveColumns.has('user_type_permissions') && liveColumns.has('user_permissions')) {
    await conn.query(`
      INSERT INTO user_type_permissions (id, user_type_id, permission)
      SELECT UUID(), t.type_id, t.permission FROM (
        SELECT DISTINCT ut.id AS type_id, up.permission
        FROM user_permissions up
        JOIN users u ON u.uid = up.user_uid
        JOIN user_types ut ON ut.name = u.user_type
        WHERE NOT EXISTS (
          SELECT 1 FROM user_type_permissions x
          WHERE x.user_type_id = ut.id AND x.permission = up.permission
        )
      ) t`);
    await conn.query(`
      INSERT INTO user_type_permissions (id, user_type_id, permission)
      SELECT UUID(), ut.id, 'void_invoices' FROM user_types ut
      WHERE ut.name = 'Super Admin'
        AND NOT EXISTS (SELECT 1 FROM user_type_permissions x
                        WHERE x.user_type_id = ut.id AND x.permission = 'void_invoices')`);
  }

  // 137: browser access to /pos is closed by default.
  if (liveColumns.get('pos_settings')?.has('enable_browser_pos')) {
    await conn.query('UPDATE pos_settings SET enable_browser_pos = 0');
  }

  // 140: the Price Inquiry kiosk user type and its single permission.
  if (liveColumns.has('user_types') && liveColumns.has('user_type_permissions')) {
    await conn.query(`
      INSERT INTO user_types (id, name, description)
      SELECT UUID(), 'Price Inquiry', 'Self-service price-checker kiosk. Can look up a product price and nothing else.'
      FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM user_types WHERE name = 'Price Inquiry')`);
    await conn.query(`
      INSERT INTO user_type_permissions (id, user_type_id, permission)
      SELECT UUID(), ut.id, 'price_inquiry' FROM user_types ut
      WHERE ut.name = 'Price Inquiry'
        AND NOT EXISTS (SELECT 1 FROM user_type_permissions x
                        WHERE x.user_type_id = ut.id AND x.permission = 'price_inquiry')`);
  }

  // 145: the cross-terminal refresh counter's one row. Back at revision 0, which
  // every other terminal's watcher sees as a change (it compares with !==), so
  // they all refetch — exactly what a wiped database warrants.
  if (liveColumns.has('live_events')) {
    await conn.query("INSERT IGNORE INTO live_events (name, revision) VALUES ('stock-updated', 0)");
  }

  // 146: Repackaging / Approvals / Workflow Settings hidden by default, plus the
  // marker that records the defaults as applied (must match SEED_MARKER in
  // app/api/developer/disabled-pages/route.ts). If the table does not exist yet,
  // that route creates and seeds it on first request.
  if (liveColumns.has('disabled_pages')) {
    for (const key of ['__defaults_seeded__', ...DEFAULT_HIDDEN_KEYS]) {
      await conn.query('INSERT IGNORE INTO disabled_pages (page_key) VALUES (?)', [key]);
    }
  }
}

const quoteId = (name: string) => '`' + name.replace(/`/g, '``') + '`';

export interface FactoryResetResult {
  tablesCleared: number;
  seedTables: number;
  seedRows: number;
}

export async function runFactoryReset(): Promise<FactoryResetResult> {
  // ── 1. Load and validate everything before touching data ──────────────────
  const snapshotPath = findInstallSnapshot();
  if (!snapshotPath) {
    throw new Error(
      `Factory reset needs ${SNAPSHOT_FILE} (the installer's database snapshot) and could not find it. ` +
      'Nothing was deleted.'
    );
  }
  const seeds = parseInstallSnapshot(fs.readFileSync(snapshotPath, 'utf8'))
    .filter((s) => !SKIP_SNAPSHOT_TABLES.has(s.table));
  if (!seeds.some((s) => s.table === 'users' && s.rows.length > 0)) {
    // Without the default admin nobody could log in after the reset.
    throw new Error(`${SNAPSHOT_FILE} holds no default user. Nothing was deleted.`);
  }

  const conn: any = await getConnection();
  let restored = false;
  let saved: { tz: string; mode: string } | null = null;
  try {
    const [[sess]]: any = await conn.query('SELECT @@session.time_zone AS tz, @@session.sql_mode AS mode');
    saved = sess;

    const [tableRows]: any = await conn.query(
      `SELECT TABLE_NAME AS name FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'`
    );
    const [colRows]: any = await conn.query(
      `SELECT TABLE_NAME AS t, COLUMN_NAME AS c, EXTRA AS extra FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()`
    );
    const liveColumns = new Map<string, Set<string>>();
    for (const r of colRows) {
      // A generated column cannot be inserted into. Match only VIRTUAL/STORED
      // GENERATED: EXTRA also says DEFAULT_GENERATED for any column whose
      // default is an expression (CURRENT_TIMESTAMP, curdate()), and those
      // must keep the snapshot's value.
      if (/\b(VIRTUAL|STORED) GENERATED\b/i.test(r.extra || '')) continue;
      if (!liveColumns.has(r.t)) liveColumns.set(r.t, new Set());
      liveColumns.get(r.t)!.add(r.c);
    }

    // Resolve each seed table's insertable columns now, so a mismatch fails
    // before the TRUNCATEs. Columns added since the snapshot take their live
    // DEFAULT (exactly what the migration that added them did on a fresh
    // install); columns dropped since are left out.
    const plans = seeds
      .filter((s) => liveColumns.has(s.table))
      .map((s) => {
        const live = liveColumns.get(s.table)!;
        const keep = s.columns.map((c, idx) => ({ c, idx })).filter(({ c }) => live.has(c));
        if (keep.length === 0) throw new Error(`No snapshot column of \`${s.table}\` exists any more. Nothing was deleted.`);
        return { ...s, keep };
      });

    // ── 2. Empty every table except KEEP_TABLES ─────────────────────────────
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    let tablesCleared = 0;
    for (const { name } of tableRows) {
      if (KEEP_TABLES.has(name)) continue;
      await conn.query(`TRUNCATE TABLE ${quoteId(name)}`);
      tablesCleared++;
    }

    // ── 3. Restore the snapshot's seed rows ─────────────────────────────────
    // Same session settings the installer applies the dump under: timestamps
    // in the file are UTC, and NO_AUTO_VALUE_ON_ZERO keeps an explicit 0 id.
    await conn.query("SET SESSION time_zone = '+00:00'");
    await conn.query("SET SESSION sql_mode = 'NO_AUTO_VALUE_ON_ZERO'");
    let seedRows = 0;
    for (const p of plans) {
      const cols = p.keep.map(({ c }) => quoteId(c)).join(', ');
      for (let start = 0; start < p.rows.length; start += 200) {
        const chunk = p.rows.slice(start, start + 200);
        const values = chunk.map((row) => '(' + p.keep.map(({ idx }) => row[idx]).join(', ') + ')').join(',\n');
        await conn.query(`INSERT IGNORE INTO ${quoteId(p.table)} (${cols}) VALUES ${values}`);
      }
      seedRows += p.rows.length;
    }
    await conn.query('SET SESSION time_zone = ?', [saved!.tz]);
    await conn.query('SET SESSION sql_mode = ?', [saved!.mode]);

    // ── 4. Data steps of migrations newer than the snapshot ─────────────────
    await applyPostSnapshotSeeds(conn, liveColumns);

    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    restored = true;
    return { tablesCleared, seedTables: plans.length, seedRows };
  } finally {
    if (!restored) {
      try {
        await conn.query('SET FOREIGN_KEY_CHECKS = 1');
        if (saved) {
          await conn.query('SET SESSION time_zone = ?', [saved.tz]);
          await conn.query('SET SESSION sql_mode = ?', [saved.mode]);
        }
        restored = true;
      } catch {
        // fall through: destroy rather than return a connection whose session
        // settings (FK checks off, UTC, loose sql_mode) would leak to the next user
      }
    }
    if (restored) conn.release();
    else conn.destroy();
  }
}
