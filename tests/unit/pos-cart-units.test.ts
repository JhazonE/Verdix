import assert from 'node:assert/strict';
import { resolveSellingUnitForAdd, baseSellingUnitOf, findCartLineForUnit, promoteToLargestUnit } from '../../lib/pos-cart-units';

const baseUnit = { id: 'su-base', name: 'Piece', factor: 1, barcode: '4800000000017', price: 25, isBase: true };
const packUnit = { id: 'su-pack', name: 'Pack (x12)', factor: 12, barcode: '62217958', price: 250, isBase: false };
const product = { id: 'prod-1', price: 25, sellingUnits: [baseUnit, packUnit] };

// baseSellingUnitOf
assert.deepEqual(baseSellingUnitOf(product), baseUnit, 'finds the isBase unit');
assert.deepEqual(
  baseSellingUnitOf({ price: 40 }),
  { name: '', factor: 1, price: 40, priceLevels: [] },
  'falls back to product.price when sellingUnits is absent'
);

// resolveSellingUnitForAdd — no code (plain suggestion/F9 pick) always resolves base
assert.deepEqual(resolveSellingUnitForAdd(product), baseUnit, 'no code resolves base unit');
assert.deepEqual(resolveSellingUnitForAdd(product, ''), baseUnit, 'empty code resolves base unit');

// resolveSellingUnitForAdd — code matches a non-base unit's barcode
assert.deepEqual(
  resolveSellingUnitForAdd(product, '62217958'),
  packUnit,
  'matches the Pack unit by its own barcode'
);

// Case-insensitive / whitespace-tolerant, matching how the rest of the POS
// scan matchers already lowercase/trim (use-pos.ts:668, :671).
assert.deepEqual(
  resolveSellingUnitForAdd(product, '  62217958  '),
  packUnit,
  'trims surrounding whitespace'
);

// resolveSellingUnitForAdd — code matches the product's own top-level
// barcode (not any selling unit's) resolves to base, same as today.
assert.deepEqual(
  resolveSellingUnitForAdd(product, '4800000000017'),
  baseUnit,
  'a base-unit barcode match resolves to base'
);

// resolveSellingUnitForAdd — code matches nothing resolves to base (a
// name/SKU match falls through here, same as today's behavior).
assert.deepEqual(
  resolveSellingUnitForAdd(product, 'nonexistent-code'),
  baseUnit,
  'unmatched code falls back to base unit'
);

// A unit flagged isBase is never returned by the non-base barcode search,
// even if its own barcode is passed in — base matches always go through
// the same fallback path, never the "found a non-base match" branch.
const productSingleUnit = { id: 'prod-2', price: 10, sellingUnits: [baseUnit] };
assert.deepEqual(
  resolveSellingUnitForAdd(productSingleUnit, '4800000000017'),
  baseUnit,
  'single-unit product always resolves base regardless of code'
);

// findCartLineForUnit
type Line = { id: string; selectedSellingUnit?: typeof baseUnit };
const lineA: Line = { id: 'prod-1', selectedSellingUnit: baseUnit };
const lineB: Line = { id: 'prod-1', selectedSellingUnit: packUnit };
const cart: Line[] = [lineA, lineB];

assert.equal(findCartLineForUnit(cart, 'prod-1', 'su-base'), lineA, 'finds the matching-unit line');
assert.equal(findCartLineForUnit(cart, 'prod-1', 'su-pack'), lineB, 'distinguishes different units of the same product');
assert.equal(findCartLineForUnit(cart, 'prod-1', 'su-missing'), undefined, 'no match for an unrelated unit id');
assert.equal(findCartLineForUnit(cart, 'prod-9', 'su-base'), undefined, 'no match for an unrelated product id');

console.log('✅ pos-cart-units tests passed');

// promoteToLargestUnit
const caseUnit = { id: 'su-case', name: 'Case (x24)', factor: 24, price: 480, isBase: false };
const allUnits = [baseUnit, packUnit, caseUnit];
assert.deepEqual(promoteToLargestUnit(11, baseUnit, allUnits), { unit: baseUnit, quantity: 11 }, 'below factor stays base');
assert.deepEqual(promoteToLargestUnit(12, baseUnit, allUnits), { unit: packUnit, quantity: 1 }, 'reaching factor promotes');
assert.deepEqual(promoteToLargestUnit(13, baseUnit, allUnits), { unit: baseUnit, quantity: 13 }, 'non-multiple stays base');
assert.deepEqual(promoteToLargestUnit(24, baseUnit, allUnits), { unit: caseUnit, quantity: 1 }, 'picks the largest fitting unit');
assert.deepEqual(promoteToLargestUnit(36, baseUnit, allUnits), { unit: packUnit, quantity: 3 }, 'falls to a smaller unit when largest does not divide');
assert.deepEqual(promoteToLargestUnit(2, packUnit, allUnits), { unit: caseUnit, quantity: 1 }, 'promotes from a non-base unit');
assert.deepEqual(promoteToLargestUnit(5, baseUnit, [baseUnit]), { unit: baseUnit, quantity: 5 }, 'single-unit product unchanged');
console.log('pos-cart-units: ok');

// demotion: fractional non-base quantity falls back to base pieces
assert.deepEqual(promoteToLargestUnit(1 - 1 / 12, packUnit, allUnits), { unit: baseUnit, quantity: 11 }, '1 Pack minus a piece = 11 Piece');
assert.deepEqual(promoteToLargestUnit(1 + 1 / 12, packUnit, allUnits), { unit: baseUnit, quantity: 13 }, '1 Pack plus a piece = 13 Piece');
console.log('pos-cart-units demotion: ok');
