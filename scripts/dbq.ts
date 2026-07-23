/**
 * Ad-hoc DB query runner for verification steps.
 *
 *   npx tsx scripts/dbq.ts "SELECT type, COUNT(*) c FROM products GROUP BY type"
 *
 * Importing lib/mysql.ts starts a connection pool, a backup scheduler, and a
 * background sync worker, none of which stop on their own — so this exits
 * explicitly rather than waiting for the event loop to drain.
 *
 * Note: mysql2 renders bare DATE columns as local-time JS Dates. Wrap date
 * columns in DATE_FORMAT(col,'%Y-%m-%d') when the exact stored value matters.
 */
import { query } from '../lib/mysql';

const sql = process.argv.slice(2).join(' ');

if (!sql.trim()) {
  console.error('usage: npx tsx scripts/dbq.ts "<SQL>"');
  process.exit(2);
}

(async () => {
  try {
    const rows: any = await query(sql);
    console.log(JSON.stringify(rows, null, 2));
    process.exit(0);
  } catch (err: any) {
    console.error('QUERY FAILED:', err.message);
    process.exit(1);
  }
})();
