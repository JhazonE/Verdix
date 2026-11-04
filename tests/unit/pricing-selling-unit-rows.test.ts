import assert from 'node:assert/strict';
import { toPricingRows } from '../../app/(app)/products/bulk-price-update/use-bulk-price-update';

// The Pricing page used to list one row per product, so a non-base selling
// unit (a Case packed from Pieces) had no row to select and no way to be
// repriced. toPricingRows() is what makes each unit individually selectable.

// ── A product with several selling units yields one row each ──────────────
const withUnits = toPricingRows([
  {
    id: 'p1',
    name: 'Coke 1.5L',
    price: 85,
    cost: 60,
    barcode: '1111',
    baseUnitBarcode: '1111',
    sellingUnits: [
      { id: 'u-case', name: 'Case', barcode: '2222', factor: 12, price: 960, cost: 720, isBase: false, priceLevels: [] },
      { id: 'u-pc', name: 'Piece', barcode: '1111', factor: 1, price: 85, cost: 60, isBase: true, priceLevels: [] },
    ],
  },
]);

assert.equal(withUnits.length, 2, 'one row per selling unit');
assert.equal(withUnits[0].isBase, true, 'base unit sorts first');
assert.equal(withUnits[0].sellingUnitId, 'u-pc');
assert.equal(withUnits[1].sellingUnitName, 'Case', 'the Case is now a selectable row');
assert.equal(withUnits[1].sellingUnitId, 'u-case');

// Keys must be unique per unit — the preview and the selection Set both key on
// them, and a product id alone cannot distinguish two units of one product.
assert.equal(new Set(withUnits.map(r => r.key)).size, 2, 'row keys are unique per unit');
assert.ok(withUnits[1].key.includes('u-case'), 'key identifies the unit, not just the product');

// Each unit carries its OWN price and cost. A Case priced at 960 must never be
// collapsed to the product's 85, which is the per-piece shelf price.
assert.equal(withUnits[1].price, 960, 'Case keeps its own price');
assert.equal(withUnits[1].cost, 720, 'Case keeps its own cost');
assert.equal(withUnits[1].factor, 12, 'factor is carried through for display');

// The base row shows the product's effective price, which getProducts already
// resolved from any untiered default-level override.
assert.equal(withUnits[0].price, 85, 'base row shows the product shelf price');

// ── A Case with no cost of its own is unknown (0), not the piece cost ─────
const noCost = toPricingRows([
  {
    id: 'p2',
    name: 'Rice',
    price: 50,
    cost: 40,
    barcode: '3333',
    baseUnitBarcode: '3333',
    sellingUnits: [
      { id: 'u2-base', name: 'Kilo', barcode: '3333', factor: 1, price: 50, cost: undefined, isBase: true, priceLevels: [] },
      { id: 'u2-sack', name: 'Sack', barcode: '4444', factor: 25, price: 1200, cost: undefined, isBase: false, priceLevels: [] },
    ],
  },
]);

assert.equal(noCost[0].cost, 40, 'base unit with no cost falls back to the product cost');
assert.equal(
  noCost[1].cost,
  0,
  'a Sack with no cost is genuinely unknown — inheriting the per-kilo cost would mark it up off a 25x-too-small figure',
);

// ── A product with no selling-unit rows still gets one repriceable row ────
const legacy = toPricingRows([
  { id: 'p3', name: 'Legacy item', price: 10, cost: 7, barcode: '5555', baseUnitBarcode: '5555', sellingUnits: [] },
]);

assert.equal(legacy.length, 1, 'a product with no units still yields a row');
assert.equal(legacy[0].isBase, true);
assert.equal(
  legacy[0].sellingUnitId,
  undefined,
  'no sellingUnitId means "the base unit" — the write layer reads it exactly as it behaved before units were selectable',
);
assert.equal(legacy[0].key, 'p3', 'falls back to the product id as its key');

// ── Rows from different products never collide ───────────────────────────
const twoProducts = toPricingRows([
  {
    id: 'pA', name: 'A', price: 1, cost: 1, barcode: 'a', baseUnitBarcode: 'a',
    sellingUnits: [{ id: 'uA', name: 'Base', barcode: 'a', factor: 1, price: 1, cost: 1, isBase: true, priceLevels: [] }],
  },
  {
    id: 'pB', name: 'B', price: 2, cost: 2, barcode: 'b', baseUnitBarcode: 'b',
    sellingUnits: [{ id: 'uB', name: 'Base', barcode: 'b', factor: 1, price: 2, cost: 2, isBase: true, priceLevels: [] }],
  },
]);
assert.equal(new Set(twoProducts.map(r => r.key)).size, 2, 'keys are unique across products');

console.log('✓ pricing-selling-unit-rows: all assertions passed');
