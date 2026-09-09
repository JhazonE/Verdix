import assert from 'node:assert/strict';
import { isValidMarkupValue, MARKUP_MAX } from '../../lib/markup-validation';

// null is valid: it means "inherit from category/brand/supplier"
assert.equal(isValidMarkupValue(null), true, 'null is valid and means inherit');

// 0 is valid and distinct from null: sell at cost
assert.equal(isValidMarkupValue(0), true, '0 is a valid markup (sell at cost)');

// ordinary values
assert.equal(isValidMarkupValue(25), true, '25% is valid');
assert.equal(isValidMarkupValue(12.5), true, 'fractional markup is valid');
assert.equal(isValidMarkupValue(MARKUP_MAX), true, 'the maximum itself is valid');

// negatives are rejected — selling below cost is expressed as a manual price,
// not as a negative markup
assert.equal(isValidMarkupValue(-1), false, 'a negative markup is invalid');

// above the ceiling
assert.equal(isValidMarkupValue(MARKUP_MAX + 0.01), false, 'above the max is invalid');

// non-finite values (an empty or garbled numeric input)
assert.equal(isValidMarkupValue(NaN), false, 'NaN is invalid');
assert.equal(isValidMarkupValue(Infinity), false, 'Infinity is invalid');

assert.equal(MARKUP_MAX, 1000, 'the documented ceiling is 1000%');

console.log('✅ markup-validation tests passed');
