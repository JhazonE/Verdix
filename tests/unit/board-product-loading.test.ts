import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Transfer Board and Shelf Board each loaded products with a hard
// `/products?limit=1000` and no pagination, against a catalogue of 15,633.
// Measured on live data: 14,633 products never reached the browser, and
// because the repository orders by created_at DESC, only 2 of the 4 in-stock
// products landed in that first 1,000 — so the board listed 2 of 4 items.
//
// That also defeated the barcode search added alongside this: a client-side
// filter cannot match a product the client never received.
//
// Fix: search on the SERVER (the repository already matches name/SKU/barcode
// in SQL) and ask only for in-stock rows, so the board sees the whole
// catalogue instead of an arbitrary 1,000-row window.

const read = (rel: string) =>
  fs.readFileSync(path.join(__dirname, '../..', rel), 'utf-8');

// CRLF files; strip block/JSX comments before line comments, or explanatory
// prose naming the old `limit=1000` would satisfy assertions about the code.
const stripComments = (src: string) =>
  src
    .replace(/\r\n/g, '\n')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/--.*$/, '').replace(/\/\/.*$/, ''))
    .join('\n');

const boards = [
  'app/(app)/inventory/transfer-board/use-transfer-board.ts',
  'app/(app)/inventory/shelf-board/ShelfBoard.tsx',
];

// ─── 1. the arbitrary 1,000-row window must be gone ──────────────────────
for (const rel of boards) {
  const src = stripComments(read(rel));
  assert.ok(
    !/limit=1000\b/.test(src),
    `${rel} no longer loads a hard-capped 1,000-product window that hid ` +
      `14,633 products and most in-stock items`,
  );
}

// ─── 2. searching must reach the server ──────────────────────────────────
// The repository already matches name/SKU/barcode in SQL, so the board must
// pass the term through rather than filtering only what it happened to load.
// Both boards build their query through the shared buildProductQuery helper,
// so assert they use it AND that the helper puts the term on the wire.
for (const rel of boards) {
  const src = stripComments(read(rel));
  assert.ok(
    /buildProductQuery\(\s*search/.test(src),
    `${rel} sends the search term to the server so a barcode can match any ` +
      `product in the catalogue, not just a preloaded slice`,
  );
  assert.ok(
    /PRODUCT_SEARCH_DEBOUNCE_MS/.test(src),
    `${rel} debounces the search request, so a barcode scanner fires one ` +
      `query rather than one per character`,
  );
}

const helper = stripComments(read('lib/product-search.ts'));
assert.ok(
  /params\.set\(\s*'search'/.test(helper),
  'buildProductQuery puts the search term on the query string',
);

// ─── 3. the boards must NOT be restricted to in-stock rows ───────────────
// An earlier pass added inStock=true here on the reasoning that the boards
// only render quantity > 0. On live data that hid 15,629 of 15,633 products:
// only 4 rows in this catalogue have stock > 0 (15,584 sit at exactly 0), so
// the boards looked all but empty and a search for a real product returned
// nothing. Whether a row is displayable is the board's own decision — it
// already applies its own `quantity > 0` gate — and it is not the fetch
// layer's job to pre-empt it.
assert.ok(
  !/inStock/.test(helper),
  'buildProductQuery does NOT restrict to in-stock rows — on live data that ' +
    'hid 15,629 of 15,633 products and emptied both boards',
);
for (const rel of boards) {
  const src = stripComments(read(rel));
  assert.ok(
    !/inStock/.test(src),
    `${rel} does not request an in-stock-only product list`,
  );
}

// ─── 4. server-side search must reach the whole catalogue ────────────────
const repo = stripComments(
  read('src/infrastructure/repositories/MySqlProductRepository.ts'),
);

// The inStock filter remains available on the repository/API for callers that
// genuinely want it — it is simply not imposed on the boards. If it is used,
// it must be applied in SQL before the LIMIT: filtering after the LIMIT would
// let a page of out-of-stock rows consume the budget and hide real items.
if (/inStock/.test(repo)) {
  assert.ok(
    /stock\s*>\s*0/.test(repo),
    'where the repository offers an inStock filter it applies it in SQL, not ' +
      'in JS after the LIMIT',
  );
}

// The barcode search this depends on must remain in the server-side query.
assert.ok(
  /products\.barcode\s+LIKE/.test(repo),
  'the repository still matches barcode in SQL, so server-side search finds ' +
    'a scanned code anywhere in the catalogue',
);

console.log('✓ board-product-loading');
