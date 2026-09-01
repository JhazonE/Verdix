import assert from 'node:assert/strict';
import { isSeatOverage } from '../../lib/licensing/terminal-count';

assert.equal(isSeatOverage(3, 4), false, 'under the limit is fine');
assert.equal(isSeatOverage(4, 4), false, 'exactly at the limit is fine');
assert.equal(isSeatOverage(5, 4), true, 'over the limit is an overage');

// A null limit means unlimited seats — never an overage.
assert.equal(isSeatOverage(100, null), false, 'null seatLimit is unlimited');

// Zero terminals is never an overage, whatever the limit.
assert.equal(isSeatOverage(0, 1), false, 'zero terminals is never an overage');

console.log('license-seat-overage: all assertions passed');
