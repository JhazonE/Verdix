import assert from 'node:assert/strict';
import { getPoolStats } from '../../lib/mysql';

// A pool smaller than MIN_POOL_LIMIT makes concurrent users queue behind each
// other, and because mysql2 queues waiters with no timer, that reads as the
// app hanging rather than as an error. The configured value is raised to the
// floor rather than obeyed, so a stale .env cannot quietly cripple a
// deployment.
//
// This asserts the EFFECTIVE limit the pool was built with, which is the thing
// that actually matters — reading the env var back would prove nothing.

(async () => {
  const stats = getPoolStats();
  assert.ok(typeof stats.limit === 'number', `pool exposes its limit, got ${stats.limit}`);

  const configured = parseInt(process.env.DB_POOL_LIMIT || '');
  if (Number.isFinite(configured) && configured > 0 && configured < 25) {
    assert.equal(
      stats.limit,
      25,
      `DB_POOL_LIMIT=${configured} must be raised to the 25 floor, got ${stats.limit}`
    );
  } else {
    assert.ok(stats.limit! >= 25, `effective pool limit must never fall below 25, got ${stats.limit}`);
  }

  console.log('✓ pool-limit-floor');
  process.exit(0);
})().catch((e) => {
  console.error('Test failed:', e);
  process.exit(1);
});
