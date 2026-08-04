import assert from 'node:assert/strict';
import { applyAdjustment, isValidPriceValue } from '../../lib/price-update-math';

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

// isValidPriceValue — the gate that keeps NaN/negative bulk-price-update
// values (Excel non-numeric cells, corrupt-cost markup computations) out of
// the DB. See app/(app)/products/bulk-price-update/actions.ts.
assert.equal(isValidPriceValue(0), true, '0 is a valid price');
assert.equal(isValidPriceValue(19.99), true, 'a normal positive price is valid');
assert.equal(isValidPriceValue(-1), false, 'a negative price is invalid');
assert.equal(isValidPriceValue(NaN), false, 'NaN is invalid (e.g. a non-numeric Excel cell)');
assert.equal(isValidPriceValue(Infinity), false, 'Infinity is invalid');
assert.equal(isValidPriceValue(-Infinity), false, '-Infinity is invalid');

// A markup computed over a corrupt/NaN product cost must also be caught —
// this is exactly the case applyPriceUpdateBatch and previewPriceListUpload
// guard against before writing/matching.
assert.equal(
  Number.isNaN(applyAdjustment('markup', 0, 25, NaN)),
  true,
  'markup adjustment over a NaN cost produces NaN',
);
assert.equal(
  isValidPriceValue(applyAdjustment('markup', 0, 25, NaN)),
  false,
  'isValidPriceValue rejects the NaN result of a markup-over-NaN-cost computation',
);

// Markup percentages may legitimately be negative (a markdown) — only
// non-finite values should be rejected for them, which is why the bulk
// price update markup branch checks Number.isFinite rather than
// isValidPriceValue on the *raw* pct input (isValidPriceValue is applied to
// the *computed price*, not the pct itself).
assert.equal(Number.isFinite(-10), true, 'a negative markup pct (markdown) is a valid finite number');
assert.equal(
  isValidPriceValue(applyAdjustment('markup', 0, -10, 100)),
  true,
  'a markdown markup pct over a valid cost still produces a valid non-negative price when it does not undercut cost below 0',
);

console.log('price-update-math: all assertions passed');
