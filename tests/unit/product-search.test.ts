import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { matchesProductSearch } from '../../lib/product-search';

// Transfer Board, Shelf Board and Bulk Adjustment each filtered products by
// name and SKU only, so a barcode scan matched nothing — even though every
// product in the DB carries a barcode and the field already reaches all three
// pages. This helper is the single shared matcher those three now use, so the
// rule cannot drift apart between them again.

const product: any = {
  name: 'Chubby Funmix 40pcs',
  sku: 'BRD-CHU-4OVDCP',
  barcode: '4800103343532',
};

// ─── the point of the change: barcode matches ────────────────────────────
assert.equal(
  matchesProductSearch(product, '4800103343532'),
  true,
  'a full barcode matches — the whole reason this helper exists',
);
assert.equal(
  matchesProductSearch(product, '48001033'),
  true,
  'a partial barcode matches, so a half-typed code still narrows the list',
);

// ─── existing behaviour must survive ─────────────────────────────────────
assert.equal(matchesProductSearch(product, 'Chubby'), true, 'name still matches');
assert.equal(matchesProductSearch(product, 'BRD-CHU'), true, 'sku still matches');
assert.equal(
  matchesProductSearch(product, 'chubby'),
  true,
  'matching is case-insensitive',
);
assert.equal(
  matchesProductSearch(product, 'brd-chu'),
  true,
  'sku matching is case-insensitive too',
);

// ─── scanner realities ───────────────────────────────────────────────────
// A hardware barcode scanner typically appends a newline, and often a
// trailing space survives a copy/paste. Without trimming, a correct barcode
// silently matches nothing — the exact failure this change is meant to end.
assert.equal(
  matchesProductSearch(product, '  4800103343532  '),
  true,
  'surrounding whitespace is trimmed, so a scanner-appended space still matches',
);
assert.equal(
  matchesProductSearch(product, '4800103343532\n'),
  true,
  'a scanner-appended newline still matches',
);

// ─── non-matches ─────────────────────────────────────────────────────────
assert.equal(
  matchesProductSearch(product, '9999999999999'),
  false,
  'an unrelated barcode does not match',
);
assert.equal(
  matchesProductSearch(product, 'Colgate'),
  false,
  'an unrelated name does not match',
);

// ─── empty term matches everything ───────────────────────────────────────
// All three callers show the full list when the box is empty; the helper must
// not turn an empty search into "no results".
assert.equal(matchesProductSearch(product, ''), true, 'empty term matches');
assert.equal(
  matchesProductSearch(product, '   '),
  true,
  'whitespace-only term matches, same as empty',
);

// ─── missing fields must not throw ───────────────────────────────────────
// Barcode is optional on the Product type, and some rows carry no SKU.
// Note the search term here deliberately avoids words appearing in the name:
// searching "barcode" against a product NAMED "No Barcode Item" would match on
// the name and prove nothing about the missing field.
assert.equal(
  matchesProductSearch({ name: 'Plain Item' } as any, '4800103343532'),
  false,
  'a product with no sku/barcode does not throw and does not match',
);
assert.equal(
  matchesProductSearch({ name: 'Plain Item' } as any, 'Plain'),
  true,
  'a product with no sku/barcode still matches on name',
);
assert.equal(
  matchesProductSearch({} as any, 'anything'),
  false,
  'a product missing every field does not throw',
);

// ─── the three callers must actually use it ──────────────────────────────
// A passing helper is worthless if a page keeps its own inline name/sku
// filter, which is exactly the state this change fixes.
const read = (rel: string) =>
  fs.readFileSync(path.join(__dirname, '../..', rel), 'utf-8');

const callers = [
  'app/(app)/inventory/transfer-board/use-transfer-board.ts',
  'app/(app)/inventory/shelf-board/ShelfBoard.tsx',
  'app/(app)/inventory/bulk-adjustment/use-bulk-adjustment.ts',
];

for (const rel of callers) {
  const src = read(rel);
  // Either entry point is correct: these three filter in a loop, so the
  // hoisted `matchesNormalizedSearch` is the intended form, but a caller
  // using the convenience `matchesProductSearch` is equally shared.
  assert.ok(
    /matches(ProductSearch|NormalizedSearch)/.test(src),
    `${rel} uses the shared matcher instead of its own name/sku filter`,
  );
  assert.ok(
    /from ['"].*product-search['"]/.test(src),
    `${rel} imports the shared matcher`,
  );
  // The inline name/sku filter it replaced must be gone, or a page could
  // import the helper and still quietly filter the old way.
  assert.ok(
    !/name\?\.toLowerCase\(\)\.includes\(|name\.toLowerCase\(\)\.includes\(/.test(src),
    `${rel} no longer carries its own inline name filter`,
  );
}

console.log('✓ product-search');
