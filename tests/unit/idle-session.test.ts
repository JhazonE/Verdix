import assert from 'node:assert/strict';
import { idleState, parseLastActivity } from '../../lib/idle-session';

const MIN = 60_000;
const TIMEOUT = 15 * MIN;
const WARNING = 1 * MIN;
const t0 = Date.UTC(2026, 10, 13, 8, 0, 0);

// Fresh activity is active, with the whole timeout left.
assert.deepEqual(idleState(t0, t0, TIMEOUT, WARNING), { phase: 'active', remainingMs: TIMEOUT });

// Just before the warning window opens it is still active.
assert.equal(idleState(t0, t0 + 14 * MIN - 1, TIMEOUT, WARNING).phase, 'active');

// The last minute is the warning window, counting down.
const warn = idleState(t0, t0 + 14 * MIN + 30_000, TIMEOUT, WARNING);
assert.equal(warn.phase, 'warning');
assert.equal(warn.remainingMs, 30_000);

// At exactly the timeout the session has expired, and it never reports a
// negative remainder (the countdown must not show "-0:05").
assert.deepEqual(idleState(t0, t0 + TIMEOUT, TIMEOUT, WARNING), { phase: 'expired', remainingMs: 0 });
assert.deepEqual(idleState(t0, t0 + 10 * TIMEOUT, TIMEOUT, WARNING), { phase: 'expired', remainingMs: 0 });

// A machine left asleep overnight: the elapsed time is measured from the
// stored timestamp, not from a setTimeout that paused with the machine.
assert.equal(idleState(t0, t0 + 12 * 60 * MIN, TIMEOUT, WARNING).phase, 'expired');

// A timestamp in the future (clock moved backwards) must not lock the user
// out or produce a remainder longer than the timeout.
assert.deepEqual(idleState(t0 + 5 * MIN, t0, TIMEOUT, WARNING), { phase: 'active', remainingMs: TIMEOUT });

// parseLastActivity: the stored value is a string from localStorage.
assert.equal(parseLastActivity(String(t0)), t0);
assert.equal(parseLastActivity(null), null, 'missing key');
assert.equal(parseLastActivity(''), null, 'empty string');
assert.equal(parseLastActivity('abc'), null, 'garbage');
assert.equal(parseLastActivity('0'), null, 'zero is not a real timestamp');
assert.equal(parseLastActivity('-5'), null, 'negative is not a real timestamp');

console.log('✓ idle-session tests passed');
