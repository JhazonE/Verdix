import assert from 'node:assert/strict';
import { isGraceExpired, GRACE_WINDOW_DAYS } from '../../lib/licensing/state-store';

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-08-31T12:00:00Z');

assert.equal(GRACE_WINDOW_DAYS, 7, 'grace window is 7 days');

// Never validated yet (bootstrap) must NOT lock.
assert.equal(isGraceExpired(null, now), false, 'null lastValidatedAt does not lock');

// Inside the window.
assert.equal(
  isGraceExpired(new Date(now.getTime() - 1 * DAY), now), false, '1 day ago is inside grace');
assert.equal(
  isGraceExpired(new Date(now.getTime() - 6.9 * DAY), now), false, '6.9 days is inside grace');

// Outside the window.
assert.equal(
  isGraceExpired(new Date(now.getTime() - 7.1 * DAY), now), true, '7.1 days is expired');
assert.equal(
  isGraceExpired(new Date(now.getTime() - 30 * DAY), now), true, '30 days is expired');

// A future timestamp (clock skew) must not lock.
assert.equal(
  isGraceExpired(new Date(now.getTime() + 1 * DAY), now), false, 'future timestamp does not lock');

console.log('license-state-store: all assertions passed');
