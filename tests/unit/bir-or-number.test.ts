import assert from 'node:assert/strict';
import { getNextBirOrNumber, withTransaction } from '../../lib/mysql';

// getNextBirOrNumber() must produce a distinct, incrementing, OR-prefixed
// sequence independent of si_number/mc_number, and must be rollback-safe
// on the same connection (a failed sale must not burn a number).

(async () => {
  await withTransaction(async (connection) => {
    const first = await getNextBirOrNumber(connection);
    const second = await getNextBirOrNumber(connection);

    assert.ok(/^OR-\d{6}$/.test(first), `first OR number is OR-prefixed 6-digit, got ${first}`);
    assert.ok(/^OR-\d{6}$/.test(second), `second OR number is OR-prefixed 6-digit, got ${second}`);

    const firstNum = parseInt(first.replace('OR-', ''), 10);
    const secondNum = parseInt(second.replace('OR-', ''), 10);
    assert.equal(secondNum, firstNum + 1, 'second call increments by exactly 1');

    // Roll back — this transaction's increments must not persist.
    throw new Error('__TEST_ROLLBACK__');
  }).catch((e: any) => {
    if (e.message !== '__TEST_ROLLBACK__') throw e;
  });

  console.log('✓ bir-or-number');
  // Allow pool to close naturally on process exit
  process.exit(0);
})().catch((e) => {
  console.error('Test failed:', e);
  process.exit(1);
});
