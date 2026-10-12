import assert from 'node:assert/strict';
import { toSafeNumber } from '../../lib/utils';

// MySQL DECIMAL columns reach the driver as STRINGS ("10.5000"). Several read
// paths used parseInt() on them, which stops at the decimal point and silently
// truncates: a 10.5 kg line came back from the database as 10. The columns are
// DECIMAL(15,4) (migration 078 for stock, 135 for document line items), so the
// fraction is really stored — only the read was throwing it away.
//
// This test pins the coercion those paths must use instead.

// parseInt is the bug being fixed — documented here so a future edit that
// reintroduces it has something to fail against.
assert.equal(parseInt('10.5000'), 10, 'parseInt truncates a DECIMAL string (the bug)');

// toSafeNumber is what the read paths now use.
assert.equal(toSafeNumber('10.5000'), 10.5, 'keeps the fraction from a DECIMAL string');
assert.equal(toSafeNumber('3.0000'), 3, 'a whole DECIMAL string is a plain integer');
assert.equal(toSafeNumber('-2.2500'), -2.25, 'negative adjustments keep their fraction');
assert.equal(toSafeNumber(10.5), 10.5, 'a number passes through');

// Non-numeric input must land on 0 rather than NaN, since these values flow
// straight into arithmetic (running stock totals) where NaN would spread.
assert.equal(toSafeNumber(null), 0, 'null coerces to 0, not NaN');
assert.equal(toSafeNumber(undefined), 0, 'undefined coerces to 0, not NaN');
assert.equal(toSafeNumber('abc'), 0, 'garbage coerces to 0, not NaN');

console.log('✓ decimal-quantity-read tests passed');
