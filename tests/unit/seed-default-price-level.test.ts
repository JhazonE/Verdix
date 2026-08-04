import assert from 'node:assert/strict';
import { seedDefaultPriceLevel } from '../../lib/price-level-seed';

const levelDefs = [
  { id: 'retail-level', name: 'Retail', isDefault: true, percentageAdjustment: 0 },
  { id: 'wholesale-level', name: 'Wholesale', isDefault: false, percentageAdjustment: -10 },
];

// no existing rows -> seeds a default-level row from the live price
assert.deepEqual(
  seedDefaultPriceLevel([], levelDefs, 100),
  [{ levelId: 'retail-level', price: 100, minQuantity: 0 }],
  'seeds a default row when there are no existing price levels',
);

// price given as a string (e.g. a MySQL decimal column) is coerced correctly
assert.deepEqual(
  seedDefaultPriceLevel([], levelDefs, '133.5'),
  [{ levelId: 'retail-level', price: 133.5, minQuantity: 0 }],
  'coerces a string price and rounds to 2 decimals',
);

// existing rows are never touched, even if only a non-default level is present
const existing = [{ levelId: 'wholesale-level', price: 90, minQuantity: 5 }];
assert.deepEqual(
  seedDefaultPriceLevel(existing, levelDefs, 100),
  existing,
  'never modifies or adds to existing price-level rows',
);

// no default level defined -> leaves an empty array empty, does not guess
assert.deepEqual(
  seedDefaultPriceLevel([], [{ id: 'wholesale-level', isDefault: false, percentageAdjustment: -10 }], 100),
  [],
  'does not seed when no level is marked as default',
);

// missing / non-numeric price -> does not seed
assert.deepEqual(seedDefaultPriceLevel([], levelDefs, null), [], 'does not seed when price is null');
assert.deepEqual(seedDefaultPriceLevel([], levelDefs, undefined), [], 'does not seed when price is undefined');
assert.deepEqual(seedDefaultPriceLevel([], levelDefs, 'not-a-number'), [], 'does not seed when price is non-numeric');

console.log('seed-default-price-level: all assertions passed');
