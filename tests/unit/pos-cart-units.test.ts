import assert from 'node:assert/strict';
import { resolveSellingUnitForAdd, baseSellingUnitOf, findCartLineForUnit } from '../../lib/pos-cart-units';

const baseUnit = { id: 'su-base', name: 'Piece', factor: 1, barcode: '4800000000017', price: 25, isBase: true };
const packUnit = { id: 'su-pack', name: 'Pack (x12)', factor: 12, barcode: '62217958', price: 250, isBase: false };
const product = { id: 'prod-1', price: 25, sellingUnits: [baseUnit, packUnit] };

// baseSellingUnitOf
assert.deepEqual(baseSellingUnitOf(product), baseUnit, 'finds the isBase unit');
assert.deepEqual(
  baseSellingUnitOf({ price: 40 }),
  { price: 40, priceLevels: [] },
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
