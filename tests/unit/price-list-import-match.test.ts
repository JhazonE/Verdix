import assert from 'node:assert/strict';
import { matchPriceListRows, type MatchMaps, type ProductLookup } from '../../lib/price-list-import';
import type { PriceListRow } from '../../lib/price-list-import';

// matchPriceListRows is the batched replacement for previewPriceListUpload's
// per-row SELECT pair. It takes pre-loaded lookup maps instead of a DB
// connection, so every matching and validation rule is testable in isolation.
// The rules here are ported verbatim from actions.ts:187-302 — this test is
// the guard that the port did not change behaviour.

function product(over: Partial<ProductLookup> = {}): ProductLookup {
  return { id: 'p1', name: 'Rice 1kg', sku: 'RICE-1KG', barcode: '4800001', price: 50, cost: 40, ...over };
}

function maps(products: ProductLookup[]): MatchMaps {
  const bySku = new Map<string, ProductLookup>();
  const byBarcode = new Map<string, ProductLookup>();
  const allSkus = new Set<string>();
  for (const p of products) {
    if (p.sku) { bySku.set(p.sku, p); allSkus.add(p.sku); }
    if (p.barcode) byBarcode.set(p.barcode, p);
  }
  return { bySku, byBarcode, allSkus };
}

function row(over: Partial<PriceListRow> = {}): PriceListRow {
  return { sku: '', barcode: '', ...over };
}

// --- Matching ---------------------------------------------------------

{
  const r = matchPriceListRows([row({ sku: 'RICE-1KG', newPrice: 55 })], maps([product()]));
  assert.equal(r.matched.length, 1, 'matches an existing product by SKU');
  assert.equal(r.matched[0].productId, 'p1');
  assert.equal(r.matched[0].field, 'price');
  assert.equal(r.matched[0].oldValue, 50, 'carries the old price for display');
  assert.equal(r.matched[0].newValue, 55);
  assert.equal(r.matched[0].adjustmentType, 'exact');
}

{
  const r = matchPriceListRows([row({ barcode: '4800001', newPrice: 55 })], maps([product()]));
  assert.equal(r.matched.length, 1, 'falls back to barcode when SKU is absent');
  assert.equal(r.matched[0].productId, 'p1');
}

{
  // SKU wins over barcode when the two point at different products.
  const a = product({ id: 'pA', sku: 'SKU-A', barcode: 'BC-SHARED' });
  const b = product({ id: 'pB', sku: 'SKU-B', barcode: 'BC-SHARED' });
  const r = matchPriceListRows([row({ sku: 'SKU-A', barcode: 'BC-SHARED', newPrice: 9 })], maps([a, b]));
  assert.equal(r.matched[0].productId, 'pA', 'SKU takes priority over barcode');
}

{
  const r = matchPriceListRows([row({ newPrice: 55 })], maps([product()]));
  assert.equal(r.matched.length, 0);
  assert.equal(r.skipped.length, 1, 'a row with neither SKU nor barcode is skipped');
  assert.match(r.skipped[0].reason, /Missing SKU and barcode/);
}

// --- Duplicate suppression -------------------------------------------

{
  const rows = [row({ sku: 'RICE-1KG', newPrice: 55 }), row({ sku: 'RICE-1KG', newPrice: 60 })];
  const r = matchPriceListRows(rows, maps([product()]));
  assert.equal(r.matched.length, 1, 'a duplicate SKU in the same file yields one match');
  assert.equal(r.matched[0].newValue, 55, 'the FIRST occurrence wins');
  assert.equal(r.skipped.length, 1);
  assert.match(r.skipped[0].reason, /Duplicate SKU/);
}

// --- Validation, ported verbatim -------------------------------------

{
  const r = matchPriceListRows([row({ sku: 'RICE-1KG', newPrice: -5 })], maps([product()]));
  assert.equal(r.matched.length, 0);
  assert.match(r.skipped[0].reason, /new_price must be a non-negative number/);
}

{
  const r = matchPriceListRows([row({ sku: 'RICE-1KG', newPrice: NaN })], maps([product()]));
  assert.equal(r.matched.length, 0, 'a non-numeric price cell (NaN) never reaches matched');
}

{
  const r = matchPriceListRows([row({ sku: 'RICE-1KG', newCost: -1 })], maps([product()]));
  assert.equal(r.matched.length, 0);
  assert.match(r.skipped[0].reason, /new_cost must be a non-negative number/);
}

{
  // A negative markup is a legitimate markdown, unlike a negative price.
  const r = matchPriceListRows([row({ sku: 'RICE-1KG', newMarkupPct: -10 })], maps([product({ cost: 40 })]));
  assert.equal(r.matched.length, 1, 'a negative markup is accepted as a markdown');
  assert.equal(r.matched[0].newValue, 36, 'markup computes from live cost: 40 * (1 - 0.10)');
  assert.equal(r.matched[0].adjustmentType, 'markup');
}

{
  const r = matchPriceListRows([row({ sku: 'RICE-1KG', newMarkupPct: NaN })], maps([product()]));
  assert.equal(r.matched.length, 0);
  assert.match(r.skipped[0].reason, /new_markup_pct must be a number/);
}

{
  // A corrupt cost must not produce a NaN price via the markup path.
  const r = matchPriceListRows([row({ sku: 'RICE-1KG', newMarkupPct: 25 })], maps([product({ cost: 'abc' })]));
  assert.equal(r.matched.length, 0);
  assert.match(r.skipped[0].reason, /Computed price from new_markup_pct is invalid/);
}

{
  // One row carrying both price and cost produces two independent items.
  const r = matchPriceListRows([row({ sku: 'RICE-1KG', newPrice: 55, newCost: 42 })], maps([product()]));
  assert.equal(r.matched.length, 2, 'price and cost on one row are two update items');
  assert.deepEqual(r.matched.map(m => m.field).sort(), ['cost', 'price']);
}

// --- Rows that become new products ------------------------------------

{
  const r = matchPriceListRows([row({
    sku: 'NEW-1', name: 'Salt 1kg', brand: 'Ace', category: 'Grocery', unitOfMeasure: 'pc', newPrice: 25,
  })], maps([product()]));
  assert.equal(r.toCreate.length, 1, 'an unmatched row with full identity data becomes a create');
  assert.equal(r.toCreate[0].sku, 'NEW-1');
  assert.equal(r.toCreate[0].price, 25);
}

{
  const r = matchPriceListRows([row({ sku: 'NEW-1', name: 'Salt 1kg', newPrice: 25 })], maps([product()]));
  assert.equal(r.toCreate.length, 0);
  assert.match(r.skipped[0].reason, /missing required fields to create it: brand, category, unit_of_measure/);
}

console.log('price-list-import-match.test.ts passed');
