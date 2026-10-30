import assert from 'node:assert/strict';
import { query, getConnection, getPoolStats } from '../../lib/mysql';

// getConnection() grew an acquire timeout so pool saturation reports itself
// instead of hanging forever (mysql2 queues waiters with no timer). But
// query() called pool.query() DIRECTLY, bypassing that wrapper entirely —
// and query() is what every API route uses. So the protection covered
// checkout (withTransaction) while leaving every report route to hang with
// no error, no data and no log line: the reports simply never displayed.
//
// Standalone like pool-acquire-timeout.test.ts (needs a live DB); run with a
// short DB_ACQUIRE_TIMEOUT_MS so the test doesn't sit for the 20s default.

(async () => {
  const limit = getPoolStats().limit;
  assert.ok(typeof limit === 'number' && limit > 0, `pool stats expose a limit, got ${limit}`);

  // Hold the entire pool so the next acquisition cannot be served.
  const held = [];
  for (let i = 0; i < limit!; i++) held.push(await getConnection());
  assert.equal(getPoolStats().free, 0, 'no free connections while the pool is held');

  const budget = parseInt(process.env.DB_ACQUIRE_TIMEOUT_MS || '') || 20_000;
  const t0 = Date.now();
  let message = '';
  try {
    await query('SELECT 1');
    assert.fail('query() on a saturated pool must fail, not hang');
  } catch (e: any) {
    message = e.message;
  }
  const waited = Date.now() - t0;

  assert.match(
    message,
    /Timed out after \d+ms waiting for a database connection/,
    `query() must surface the saturation diagnostic, got: ${message}`
  );
  assert.match(message, /limit=\d+, inUse=\d+, waiting=\d+/, 'error carries pool stats for diagnosis');
  assert.ok(waited < budget * 2, `must give up near the budget (${budget}ms), waited ${waited}ms`);

  // A parameterised query takes the same path and must be protected too.
  let paramMessage = '';
  try {
    await query('SELECT ?', [1]);
    assert.fail('parameterised query() on a saturated pool must fail, not hang');
  } catch (e: any) {
    paramMessage = e.message;
  }
  assert.match(
    paramMessage,
    /Timed out after \d+ms waiting for a database connection/,
    `parameterised query() must be protected too, got: ${paramMessage}`
  );

  // The timed-out attempts must not leak the slots they were eventually granted.
  for (const c of held) c.release();
  await new Promise((r) => setTimeout(r, 300));

  const settled = getPoolStats();
  assert.equal(settled.inUse, 0, `no connection leaked after a timeout, ${settled.inUse} still held`);
  assert.equal(settled.waiting, 0, 'nothing left queued');

  // And a healthy pool must still answer normally.
  const rows = await query('SELECT 1 AS ok');
  assert.equal(rows[0].ok, 1, 'query() still works on a healthy pool');

  console.log('✓ query-acquire-timeout');
  process.exit(0);
})().catch((e) => {
  console.error('Test failed:', e);
  process.exit(1);
});
