import assert from 'node:assert/strict';
import { matchPriceListRows, type MatchMaps, type ProductLookup } from '../../lib/price-list-import';
import type { PriceListRow } from '../../lib/price-list-import';

// matchPriceListRows is the batched replacement for previewPriceListUpload's
// per-row SELECT pair. It takes pre-loaded lookup maps instead of a DB
// connection, so every matching and validation rule is testable in isolation.
// The rules here are ported from actions.ts:187-302, then updated for
// Sub-project D of the sku-retirement effort: the file's one identifier is
// now the base selling unit's barcode, not products.sku/products.barcode.

function product(over: Partial<ProductLookup> = {}): ProductLookup {
  return { id: 'p1', name: 'Rice 1kg', baseUnitBarcode: '4800001', barcode: '4800001', price: 50, cost: 40, ...over };
}

function maps(products: ProductLookup[]): MatchMaps {
  const byBaseUnitBarcode = new Map<string, ProductLookup>();
  for (const p of products) {
    if (p.baseUnitBarcode) byBaseUnitBarcode.set(p.baseUnitBarcode, p);
  }
  return { byBaseUnitBarcode };
}

function row(over: Partial<PriceListRow> = {}): PriceListRow {
  return { barcode: '', ...over };
}

// --- Matching ---------------------------------------------------------

{
  const r = matchPriceListRows([row({ barcode: '4800001', newPrice: 55 })], maps([product()]));
  assert.equal(r.matched.length, 1, 'matches an existing product by its base unit barcode');
  assert.equal(r.matched[0].productId, 'p1');
  assert.equal(r.matched[0].field, 'price');
  assert.equal(r.matched[0].oldValue, 50, 'carries the old price for display');
  assert.equal(r.matched[0].newValue, 55);
  assert.equal(r.matched[0].adjustmentType, 'exact');
}

{
  const r = matchPriceListRows([row({ newPrice: 55 })], maps([product()]));
  assert.equal(r.matched.length, 0);
  assert.equal(r.skipped.length, 1, 'a row with no barcode is skipped');
  assert.match(r.skipped[0].reason, /Missing barcode/);
}

// --- Duplicate suppression -------------------------------------------

{
  const rows = [row({ barcode: '4800001', newPrice: 55 }), row({ barcode: '4800001', newPrice: 60 })];
  const r = matchPriceListRows(rows, maps([product()]));
  assert.equal(r.matched.length, 1, 'a duplicate barcode in the same file yields one match');
  assert.equal(r.matched[0].newValue, 55, 'the FIRST occurrence wins');
  assert.equal(r.skipped.length, 1);
  assert.match(r.skipped[0].reason, /Duplicate barcode/);
}

// --- Validation, ported verbatim -------------------------------------

{
  const r = matchPriceListRows([row({ barcode: '4800001', newPrice: -5 })], maps([product()]));
  assert.equal(r.matched.length, 0);
  assert.match(r.skipped[0].reason, /new_price must be a non-negative number/);
}

{
  const r = matchPriceListRows([row({ barcode: '4800001', newPrice: NaN })], maps([product()]));
  assert.equal(r.matched.length, 0, 'a non-numeric price cell (NaN) never reaches matched');
}

{
  const r = matchPriceListRows([row({ barcode: '4800001', newCost: -1 })], maps([product()]));
  assert.equal(r.matched.length, 0);
  assert.match(r.skipped[0].reason, /new_cost must be a non-negative number/);
}

{
  // A negative markup is a legitimate markdown, unlike a negative price.
  const r = matchPriceListRows([row({ barcode: '4800001', newMarkupPct: -10 })], maps([product({ cost: 40 })]));
  assert.equal(r.matched.length, 1, 'a negative markup is accepted as a markdown');
  assert.equal(r.matched[0].newValue, 36, 'markup computes from live cost: 40 * (1 - 0.10)');
  assert.equal(r.matched[0].adjustmentType, 'markup');
}

{
  const r = matchPriceListRows([row({ barcode: '4800001', newMarkupPct: NaN })], maps([product()]));
  assert.equal(r.matched.length, 0);
  assert.match(r.skipped[0].reason, /new_markup_pct must be a number/);
}

{
  // A corrupt cost must not produce a NaN price via the markup path.
  const r = matchPriceListRows([row({ barcode: '4800001', newMarkupPct: 25 })], maps([product({ cost: 'abc' })]));
  assert.equal(r.matched.length, 0);
  assert.match(r.skipped[0].reason, /Computed price from new_markup_pct is invalid/);
}

{
  // One row carrying both price and cost produces two independent items.
  const r = matchPriceListRows([row({ barcode: '4800001', newPrice: 55, newCost: 42 })], maps([product()]));
  assert.equal(r.matched.length, 2, 'price and cost on one row are two update items');
  assert.deepEqual(r.matched.map(m => m.field).sort(), ['cost', 'price']);
}

// --- Rows that become new products ------------------------------------

{
  const r = matchPriceListRows([row({
    barcode: 'NEW-1', name: 'Salt 1kg', brand: 'Ace', category: 'Grocery', unitOfMeasure: 'pc', newPrice: 25,
  })], maps([product()]));
  assert.equal(r.toCreate.length, 1, 'an unmatched row with full identity data becomes a create');
  assert.equal(r.toCreate[0].barcode, 'NEW-1');
  assert.equal(r.toCreate[0].price, 25);
}

{
  const r = matchPriceListRows([row({ barcode: 'NEW-1', name: 'Salt 1kg', newPrice: 25 })], maps([product()]));
  assert.equal(r.toCreate.length, 0);
  assert.match(r.skipped[0].reason, /missing required fields to create it: brand, category, unit_of_measure/);
}

console.log('price-list-import-match.test.ts passed');
