import assert from 'node:assert/strict';
import { applyAdjustment } from '../../lib/price-update-math';

// percentage
assert.equal(applyAdjustment('percentage', 100, 10), 110, '+10% of 100 = 110');
assert.equal(applyAdjustment('percentage', 100, -10), 90, '-10% of 100 = 90');

// fixed
assert.equal(applyAdjustment('fixed', 100, 5), 105, '+5 fixed = 105');
assert.equal(applyAdjustment('fixed', 100, -5), 95, '-5 fixed = 95');

// exact
assert.equal(applyAdjustment('exact', 999, 42), 42, 'exact overwrite ignores current value');

// markup (derives price from cost, ignores currentValue)
assert.equal(applyAdjustment('markup', 0, 25, 80), 100, 'cost 80 * 1.25 = 100');
assert.equal(applyAdjustment('markup', 999, 0, 80), 80, '0% markup = cost');

// rounding to 2 decimals
assert.equal(applyAdjustment('percentage', 33.335, 10), 36.67, 'rounds to 2 decimals');

// markup requires cost
assert.throws(
  () => applyAdjustment('markup', 0, 25),
  /cost is required/,
  'markup adjustment without cost throws',
);

console.log('price-update-math: all assertions passed');
