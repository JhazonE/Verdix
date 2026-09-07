import assert from 'node:assert/strict';
import { chunk, generateUniqueSku, matchPriceListRows, type MatchMaps, type ProductLookup } from '../../lib/price-list-import';

// chunk() drives both the 1,000-per-IN() lookup batching and the 500-per-
// transaction apply batching. Off-by-one errors here silently drop rows, so
// the boundaries are pinned explicitly.

assert.deepEqual(chunk([], 500), [], 'an empty list yields no chunks');
assert.deepEqual(chunk([1, 2, 3], 500), [[1, 2, 3]], 'a short list is one chunk');
assert.equal(chunk(Array.from({ length: 999 }, (_, i) => i), 1000).length, 1, '999 items -> 1 chunk');
assert.equal(chunk(Array.from({ length: 1000 }, (_, i) => i), 1000).length, 1, '1000 items -> 1 chunk');
assert.equal(chunk(Array.from({ length: 1001 }, (_, i) => i), 1000).length, 2, '1001 items -> 2 chunks');

{
  const c = chunk(Array.from({ length: 501 }, (_, i) => i), 500);
  assert.equal(c.length, 2, '501 items -> 2 chunks');
  assert.equal(c[0].length, 500);
  assert.equal(c[1].length, 1);
  assert.equal(c.flat().length, 501, 'chunking never loses an item');
}

// --- The generated-SKU collision fix ----------------------------------

{
  // Every attempt collides -> null rather than an unbounded loop.
  const alwaysTaken = { has: () => true } as unknown as Set<string>;
  assert.equal(generateUniqueSku('Ace', 'Salt', alwaysTaken, 3), null, 'gives up after the attempt budget');
}

{
  const fresh = generateUniqueSku('Ace', 'Salt', new Set<string>());
  assert.equal(typeof fresh, 'string');
  assert.match(fresh!, /^ACE-SAL-[0-9A-Z]{1,6}$/, 'keeps the {BRAND3}-{NAME3}-{RANDOM6} shape');
}

{
  // The bug this fixes: a blank-SKU row whose generated code duplicates an
  // EXISTING product's SKU. allSkus carries the catalogue, so the generated
  // SKU must avoid it.
  const existing: ProductLookup = { id: 'p1', name: 'Rice', sku: 'ACE-SAL-ABC123', barcode: null, price: 10, cost: 5 };
  const maps: MatchMaps = {
    bySku: new Map([[existing.sku, existing]]),
    byBarcode: new Map(),
    allSkus: new Set([existing.sku]),
  };
  const r = matchPriceListRows([{
    sku: '', barcode: 'BC-NEW', name: 'Salt', brand: 'Ace', category: 'Grocery', unitOfMeasure: 'pc', newPrice: 25,
  }], maps);
  assert.equal(r.toCreate.length, 1, 'a blank-SKU row still becomes a create');
  assert.notEqual(r.toCreate[0].sku, existing.sku, 'the generated SKU never collides with an existing product');
}

console.log('price-list-import-chunking.test.ts passed');
