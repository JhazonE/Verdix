import assert from 'node:assert/strict';
import { applyPriceLevelAdjustment } from '../../lib/price-level-calc';

// percentage (default type when adjustmentType is undefined, matching pre-existing rows)
assert.equal(applyPriceLevelAdjustment('percentage', 20, 100), 120, '20% on 100 = 120');
assert.equal(applyPriceLevelAdjustment(undefined, 20, 100), 120, 'undefined adjustmentType behaves as percentage');
assert.equal(applyPriceLevelAdjustment('percentage', 0, 100), 100, '0% on 100 = 100 (no change)');

// fixed
assert.equal(applyPriceLevelAdjustment('fixed', 20, 100), 120, 'fixed +20 on base 100 = 120');
assert.equal(applyPriceLevelAdjustment('fixed', 0, 100), 100, 'fixed +0 on base 100 = 100 (no change)');

// missing/non-numeric value defaults to 0 (no adjustment)
assert.equal(applyPriceLevelAdjustment('percentage', undefined, 100), 100, 'undefined value = no adjustment (percentage)');
assert.equal(applyPriceLevelAdjustment('fixed', undefined, 100), 100, 'undefined value = no adjustment (fixed)');
assert.equal(applyPriceLevelAdjustment('fixed', NaN, 100), 100, 'NaN value = no adjustment (fixed)');

console.log('price-level-calc: all assertions passed');
