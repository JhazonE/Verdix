import assert from 'node:assert/strict';
import { getConnection, getPoolStats } from '../../lib/mysql';

// mysql2 has no acquire timeout: with waitForConnections:true and queueLimit:0
// it queues the waiter with no timer, so a saturated pool makes every caller
// wait FOREVER — the app hangs with nothing in the logs. getConnection() wraps
// the acquisition in its own timeout so saturation reports itself instead.
//
// Run with a short DB_ACQUIRE_TIMEOUT_MS so the test doesn't sit for the
// 20s default.

(async () => {
  const limit = getPoolStats().limit;
  assert.ok(typeof limit === 'number' && limit > 0, `pool stats expose a limit, got ${limit}`);

  // Hold the entire pool.
  const held = [];
  for (let i = 0; i < limit!; i++) held.push(await getConnection());

  const saturated = getPoolStats();
  assert.equal(saturated.free, 0, 'no free connections while the pool is held');
  assert.equal(saturated.inUse, limit, 'every connection is accounted for as in use');

  // One more must fail with a diagnostic, not hang.
  const budget = parseInt(process.env.DB_ACQUIRE_TIMEOUT_MS || '') || 20_000;
  const t0 = Date.now();
  let message = '';
  try {
    const extra = await getConnection();
    extra.release();
    assert.fail('acquiring from a saturated pool must not succeed');
  } catch (e: any) {
    message = e.message;
  }
  const waited = Date.now() - t0;

  assert.match(message, /Timed out after \d+ms waiting for a database connection/, `error names the cause, got: ${message}`);
  assert.match(message, /limit=\d+, inUse=\d+, waiting=\d+/, 'error carries pool stats for diagnosis');
  assert.ok(waited < budget * 2, `must give up near the budget (${budget}ms), waited ${waited}ms`);

  // Releasing must restore the pool, and the abandoned acquisition must not
  // leak the slot it was eventually granted.
  for (const c of held) c.release();
  await new Promise((r) => setTimeout(r, 300));

  const settled = getPoolStats();
  assert.equal(settled.inUse, 0, `no connection leaked after a timeout, ${settled.inUse} still held`);
  assert.equal(settled.waiting, 0, 'nothing left queued');

  console.log('✓ pool-acquire-timeout');
  process.exit(0);
})().catch((e) => {
  console.error('Test failed:', e);
  process.exit(1);
});
