# Bulk Price List 15,000-Row Upload — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Bulk Update Price "Upload Excel" path handle a mixed 15,000-row spreadsheet (≈12,000 updates + ≈3,000 new products) without erroring or hanging.

**Architecture:** Pull the matching/applying logic out of the Server Action into a pure, DB-agnostic `lib/price-list-import.ts` that operates over injected lookup maps. Add a streaming multipart route that parses the file server-side (bypassing the 1MB Server Action body cap), does batched `IN (…)` lookups instead of per-row queries, applies in 500-row chunked transactions, and inserts new products with multi-row INSERTs instead of 3,000 `addProduct()` calls. The client posts the file and reads NDJSON progress frames.

**Tech Stack:** Next.js 16 route handlers, `mysql2/promise` raw SQL, `xlsx` + `papaparse` (already present), `tsx`-driven `node:assert/strict` unit tests.

**Spec:** `docs/superpowers/specs/2026-09-07-bulk-price-list-15k-rows-design.md`

## Global Constraints

- **Preserve every existing validation rule verbatim.** The NaN guards, duplicate-SKU suppression, `isValidPriceValue` checks, missing-field reasons, and apply-time markup recomputation all keep their current behaviour and their current skip-reason strings. Only the *lookup mechanism* changes.
- **Lookup chunk size: 1,000** identifiers per `IN (…)` query. **Apply/insert chunk size: 500** rows per transaction.
- **Preview sample cap: 50** rows per section. **All** skipped rows are returned, uncapped.
- **SKU takes priority over barcode** when matching, exactly as `actions.ts:200-214` does today.
- **Server Actions keep their existing signatures.** The manual drawer and the approvals finalizer (`app/api/approvals/process/route.ts:189`, which calls with `isInternalFinalization: true`) must keep working unchanged.
- **Unit tests are self-executing**: `import assert from 'node:assert/strict'`, assertions run at import time, and every new test file must be registered in `tests/unit/run.ts`. Run with `npm run test:unit`.
- **Verification baseline is red.** `npm run lint` is fully broken and `npm run typecheck` has pre-existing errors repo-wide. Never claim these pass. To prove a failure is yours, capture the error list before your change and diff against it.
- No new npm dependencies.

---

### Task 1: Extract pure matching logic into `lib/price-list-import.ts`

Creates the shared module with the batched matcher, operating over injected `Map`s so it is testable without a database. Nothing is wired up yet — this task is pure logic plus tests.

**Files:**
- Create: `lib/price-list-import.ts`
- Create: `tests/unit/price-list-import-match.test.ts`
- Modify: `tests/unit/run.ts`

**Interfaces:**
- Consumes: `PriceListRow`, `PriceUpdateItem`, `NewProductFromExcel` shapes from `app/(app)/products/bulk-price-update/actions.ts` (re-declared here; Task 5 makes `actions.ts` import them back from this module).
- Produces:
  - `interface ProductLookup { id: string; name: string; sku: string; barcode: string | null; price: string | number; cost: string | number | null }`
  - `interface MatchMaps { bySku: Map<string, ProductLookup>; byBarcode: Map<string, ProductLookup>; allSkus: Set<string> }`
  - `function matchPriceListRows(rows: PriceListRow[], maps: MatchMaps): PriceListPreviewResult`
  - Re-exported types `PriceUpdateItem`, `NewProductFromExcel`, `PriceListRow`, `PriceListPreviewResult`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/price-list-import-match.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/unit/price-list-import-match.test.ts`
Expected: FAIL — `Cannot find module '../../lib/price-list-import'`.

- [ ] **Step 3: Write the implementation**

Create `lib/price-list-import.ts`. Port the body of `previewPriceListUpload` (`actions.ts:178-305`) with the DB calls replaced by map lookups. Everything else is unchanged.

```typescript
import { applyAdjustment, isValidPriceValue, type AdjustmentType } from '@/lib/price-update-math';
import { generateSku } from '@/lib/sku';

export interface PriceUpdateItem {
  productId: string;
  sku: string;
  barcode: string;
  productName: string;
  field: 'price' | 'cost' | 'priceLevel';
  priceLevelId?: string;
  priceLevelName?: string;
  oldValue: number;
  newValue: number;
  adjustmentType: AdjustmentType;
  adjustmentValue: number;
}

export interface PriceListRow {
  sku: string;
  barcode: string;
  name?: string;
  brand?: string;
  category?: string;
  unitOfMeasure?: string;
  newPrice?: number;
  newCost?: number;
  newMarkupPct?: number;
}

export interface NewProductFromExcel {
  sku: string;
  barcode: string;
  name: string;
  brand: string;
  category: string;
  unitOfMeasure: string;
  price: number;
  cost?: number;
}

export interface PriceListPreviewResult {
  matched: PriceUpdateItem[];
  toCreate: NewProductFromExcel[];
  skipped: { row: PriceListRow; reason: string }[];
}

/** A product row as loaded by the batched lookup queries. */
export interface ProductLookup {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  price: string | number;
  cost: string | number | null;
}

/**
 * Pre-loaded lookups replacing the per-row SELECT pair. `allSkus` covers every
 * SKU in the warehouse, not just the ones in the file — it is what makes the
 * generated-SKU collision check possible (see generateUniqueSku).
 */
export interface MatchMaps {
  bySku: Map<string, ProductLookup>;
  byBarcode: Map<string, ProductLookup>;
  allSkus: Set<string>;
}

/**
 * Generates a SKU that collides with neither an existing product nor one
 * already claimed by an earlier row in this file.
 *
 * The previous inline `generateSku()` call checked only the in-file set, so a
 * generated code could duplicate an existing product's SKU and produce either
 * a failed insert or a duplicate SKU in the catalogue. generateSku draws a
 * 6-char base36 suffix (~2.2 billion values), so a collision is already
 * unlikely; the retries make it bounded rather than merely improbable, and
 * returning null lets the caller skip the one row instead of failing the file.
 */
export function generateUniqueSku(
  brand: string | undefined,
  name: string | undefined,
  taken: Set<string>,
  attempts = 10,
): string | null {
  for (let i = 0; i < attempts; i++) {
    const candidate = generateSku(brand, name);
    if (!taken.has(candidate)) return candidate;
  }
  return null;
}

export function matchPriceListRows(rows: PriceListRow[], maps: MatchMaps): PriceListPreviewResult {
  const matched: PriceUpdateItem[] = [];
  const toCreate: NewProductFromExcel[] = [];
  const skipped: PriceListPreviewResult['skipped'] = [];
  const seenSkus = new Set<string>();

  for (const row of rows) {
    const sku = (row.sku || '').trim();
    const barcode = (row.barcode || '').trim();

    if (!sku && !barcode) {
      skipped.push({ row, reason: 'Missing SKU and barcode' });
      continue;
    }
    if (sku && seenSkus.has(sku)) {
      skipped.push({ row, reason: `Duplicate SKU "${sku}" (earlier row in this file superseded)` });
      continue;
    }

    let product: ProductLookup | undefined;
    if (sku) product = maps.bySku.get(sku);
    if (!product && barcode) product = maps.byBarcode.get(barcode);

    if (!product) {
      const missing: string[] = [];
      if (!row.name) missing.push('name');
      if (!row.brand) missing.push('brand');
      if (!row.category) missing.push('category');
      if (!row.unitOfMeasure) missing.push('unit_of_measure');
      if (row.newPrice == null) missing.push('new_price');

      if (missing.length > 0) {
        skipped.push({ row, reason: `Product not found and missing required fields to create it: ${missing.join(', ')}` });
        continue;
      }
      if (!isValidPriceValue(row.newPrice!)) {
        skipped.push({ row, reason: 'new_price must be a non-negative number' });
        continue;
      }
      if (row.newCost != null && !isValidPriceValue(row.newCost)) {
        skipped.push({ row, reason: 'new_cost must be a non-negative number' });
        continue;
      }

      let newSku = sku;
      if (!newSku) {
        // Check against BOTH the catalogue and the SKUs this file already
        // claimed. `maps.allSkus` is the fix for the collision bug.
        const generated = generateUniqueSku(row.brand, row.name, new Set([...maps.allSkus, ...seenSkus]));
        if (!generated) {
          skipped.push({ row, reason: 'Could not generate a unique SKU for this product' });
          continue;
        }
        newSku = generated;
      }
      if (seenSkus.has(newSku) || maps.allSkus.has(newSku)) {
        skipped.push({ row, reason: `Duplicate SKU "${newSku}" (earlier row in this file superseded)` });
        continue;
      }
      seenSkus.add(newSku);
      toCreate.push({
        sku: newSku, barcode, name: row.name!, brand: row.brand!, category: row.category!,
        unitOfMeasure: row.unitOfMeasure!, price: row.newPrice!, cost: row.newCost,
      });
      continue;
    }
    if (sku) seenSkus.add(sku);

    if (row.newPrice != null) {
      if (!isValidPriceValue(row.newPrice)) {
        skipped.push({ row, reason: 'new_price must be a non-negative number' });
      } else {
        matched.push({
          productId: product.id, sku: product.sku, barcode: product.barcode || '', productName: product.name,
          field: 'price', oldValue: parseFloat(String(product.price)), newValue: row.newPrice,
          adjustmentType: 'exact', adjustmentValue: row.newPrice,
        });
      }
    }
    if (row.newCost != null) {
      if (!isValidPriceValue(row.newCost)) {
        skipped.push({ row, reason: 'new_cost must be a non-negative number' });
      } else {
        matched.push({
          productId: product.id, sku: product.sku, barcode: product.barcode || '', productName: product.name,
          field: 'cost', oldValue: parseFloat(String(product.cost || 0)), newValue: row.newCost,
          adjustmentType: 'exact', adjustmentValue: row.newCost,
        });
      }
    }
    if (row.newMarkupPct != null) {
      if (!Number.isFinite(row.newMarkupPct)) {
        skipped.push({ row, reason: 'new_markup_pct must be a number' });
      } else {
        const liveCost = parseFloat(String(product.cost || 0));
        const newPrice = applyAdjustment('markup', 0, row.newMarkupPct, liveCost);
        if (!isValidPriceValue(newPrice)) {
          skipped.push({ row, reason: 'Computed price from new_markup_pct is invalid (check product cost)' });
        } else {
          matched.push({
            productId: product.id, sku: product.sku, barcode: product.barcode || '', productName: product.name,
            field: 'price', oldValue: parseFloat(String(product.price)), newValue: newPrice,
            adjustmentType: 'markup', adjustmentValue: row.newMarkupPct,
          });
        }
      }
    }
  }

  return { matched, toCreate, skipped };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/unit/price-list-import-match.test.ts`
Expected: PASS — prints `price-list-import-match.test.ts passed`.

- [ ] **Step 5: Register the test in the suite**

In `tests/unit/run.ts`, add after the `import './price-list-template.test';` line:

```typescript
import './price-list-import-match.test';
```

Run: `npm run test:unit`
Expected: the whole suite passes, including the new file.

- [ ] **Step 6: Commit**

```bash
git add lib/price-list-import.ts tests/unit/price-list-import-match.test.ts tests/unit/run.ts
git commit -m "feat: extract batched price-list matching into a pure module

Ports previewPriceListUpload's per-row validation verbatim, replacing the
per-row SELECT pair with injected lookup maps. Also fixes the generated-SKU
collision: generateUniqueSku now checks the catalogue's SKUs, not just the
ones seen earlier in the file.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: SKU collision + chunking helpers

Adds the remaining pure helpers the route needs: a chunk splitter and explicit coverage of the collision fix.

**Files:**
- Modify: `lib/price-list-import.ts`
- Create: `tests/unit/price-list-import-chunking.test.ts`
- Modify: `tests/unit/run.ts`

**Interfaces:**
- Consumes: `matchPriceListRows`, `generateUniqueSku`, `MatchMaps` from Task 1.
- Produces: `function chunk<T>(items: T[], size: number): T[][]`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/price-list-import-chunking.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/unit/price-list-import-chunking.test.ts`
Expected: FAIL — `chunk` is not exported from `lib/price-list-import`.

- [ ] **Step 3: Add `chunk` to `lib/price-list-import.ts`**

Append:

```typescript
/**
 * Splits a list into fixed-size chunks. Used for both the 1,000-identifier
 * IN (...) lookup batches and the 500-item apply transactions.
 */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Identifiers-per-IN() for the batched lookups. */
export const LOOKUP_CHUNK_SIZE = 1000;
/** Rows-per-transaction for applying updates and inserting new products. */
export const APPLY_CHUNK_SIZE = 500;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/unit/price-list-import-chunking.test.ts`
Expected: PASS.

- [ ] **Step 5: Register and run the full suite**

Add `import './price-list-import-chunking.test';` to `tests/unit/run.ts` after the Task 1 line.

Run: `npm run test:unit`
Expected: whole suite passes.

- [ ] **Step 6: Commit**

```bash
git add lib/price-list-import.ts tests/unit/price-list-import-chunking.test.ts tests/unit/run.ts
git commit -m "feat: add chunking helpers and pin the SKU-collision fix

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Batched DB loader and chunked apply

Adds the DB-touching half of the module: loading lookup maps with `IN (…)` queries, applying updates in chunked transactions, and inserting new products with multi-row INSERTs.

**Files:**
- Modify: `lib/price-list-import.ts`
- Modify: `tests/unit/run.ts` (no new test file — this task's code is DB-bound and is covered by Task 6's integration run)

**Interfaces:**
- Consumes: `chunk`, `LOOKUP_CHUNK_SIZE`, `APPLY_CHUNK_SIZE`, `MatchMaps`, `PriceUpdateItem`, `NewProductFromExcel` from Tasks 1–2. `query` and `withTransaction` from `lib/mysql.ts`.
- Produces:
  - `async function loadMatchMaps(warehouseId: string, rows: PriceListRow[]): Promise<MatchMaps>`
  - `async function applyMatchedItems(items: PriceUpdateItem[], onProgress?: (done: number) => void): Promise<{ applied: number; skipped: {productId:string; productName:string; reason:string}[] }>`
  - `async function insertNewProducts(warehouseId: string, rows: NewProductFromExcel[], onProgress?: (done: number) => void): Promise<{ created: number; failed: {row: NewProductFromExcel; reason: string}[] }>`

- [ ] **Step 1: Add the batched loader**

Append to `lib/price-list-import.ts`:

```typescript
import { query, withTransaction } from '@/lib/mysql';

/**
 * Loads every product this file could match, in chunked IN (...) queries
 * instead of one or two SELECTs per row. A 15,000-row file goes from up to
 * 30,000 sequential round-trips to roughly 30.
 *
 * `allSkus` additionally loads every SKU in the warehouse (not just the ones
 * named in the file) so generateUniqueSku can avoid colliding with a product
 * the file never mentions.
 */
export async function loadMatchMaps(warehouseId: string, rows: PriceListRow[]): Promise<MatchMaps> {
  const skus = [...new Set(rows.map(r => (r.sku || '').trim()).filter(Boolean))];
  const barcodes = [...new Set(rows.map(r => (r.barcode || '').trim()).filter(Boolean))];

  const bySku = new Map<string, ProductLookup>();
  const byBarcode = new Map<string, ProductLookup>();

  for (const part of chunk(skus, LOOKUP_CHUNK_SIZE)) {
    const rowsOut: any = await query(
      `SELECT id, name, sku, barcode, price, cost FROM products
       WHERE warehouse_id = ? AND sku IN (${part.map(() => '?').join(',')})`,
      [warehouseId, ...part],
    );
    for (const p of rowsOut ?? []) if (p.sku) bySku.set(p.sku, p);
  }

  for (const part of chunk(barcodes, LOOKUP_CHUNK_SIZE)) {
    const rowsOut: any = await query(
      `SELECT id, name, sku, barcode, price, cost FROM products
       WHERE warehouse_id = ? AND barcode IN (${part.map(() => '?').join(',')})`,
      [warehouseId, ...part],
    );
    for (const p of rowsOut ?? []) if (p.barcode) byBarcode.set(p.barcode, p);
  }

  const allSkuRows: any = await query('SELECT sku FROM products WHERE warehouse_id = ? AND sku IS NOT NULL', [warehouseId]);
  const allSkus = new Set<string>((allSkuRows ?? []).map((r: any) => r.sku));

  return { bySku, byBarcode, allSkus };
}
```

- [ ] **Step 2: Add the chunked apply**

Append. This is `applyPriceUpdateBatch`'s body (`actions.ts:65-147`) with the single `withTransaction` replaced by one per chunk:

```typescript
/**
 * Applies matched items in APPLY_CHUNK_SIZE transactions rather than one.
 *
 * This deliberately trades all-or-nothing atomicity for liveness: holding
 * 15,000 row locks in a single transaction blocks POS checkout for minutes and
 * risks innodb_lock_wait_timeout. A mid-run failure leaves earlier chunks
 * committed; re-running the same file is idempotent, since it sets the same
 * prices again.
 */
export async function applyMatchedItems(
  items: PriceUpdateItem[],
  onProgress?: (done: number) => void,
): Promise<{ applied: number; skipped: { productId: string; productName: string; reason: string }[] }> {
  const skipped: { productId: string; productName: string; reason: string }[] = [];
  let applied = 0;
  let done = 0;

  const [defaultLevelRows]: any = await query('SELECT id FROM price_levels WHERE is_default = 1 LIMIT 1');
  const defaultLevelId: string | undefined = Array.isArray(defaultLevelRows)
    ? defaultLevelRows[0]?.id
    : (defaultLevelRows as any)?.id;

  for (const part of chunk(items, APPLY_CHUNK_SIZE)) {
    await withTransaction(async (connection) => {
      for (const item of part) {
        const [rows]: any = await connection.query('SELECT id, cost FROM products WHERE id = ?', [item.productId]);
        if (!rows || rows.length === 0) {
          skipped.push({ productId: item.productId, productName: item.productName, reason: 'Product no longer exists' });
          continue;
        }

        // Recompute markup-derived prices at apply time: cost may have drifted
        // since preview (e.g. a new PO landed).
        let newValue = item.newValue;
        if (item.adjustmentType === 'markup') {
          const liveCost = parseFloat(rows[0].cost ?? 0);
          newValue = applyAdjustment('markup', 0, item.adjustmentValue, liveCost);
        }

        if (!isValidPriceValue(newValue)) {
          skipped.push({ productId: item.productId, productName: item.productName, reason: 'Computed price is invalid' });
          continue;
        }

        if (item.field === 'price') {
          await connection.query('UPDATE products SET price = ? WHERE id = ?', [newValue, item.productId]);
          // Keep an existing default-level price-level row in sync with the
          // base price it mirrors. Never creates one.
          if (defaultLevelId) {
            await connection.query(
              'UPDATE product_price_levels SET price = ? WHERE product_id = ? AND price_level_id = ?',
              [newValue, item.productId, defaultLevelId],
            );
          }
        } else if (item.field === 'cost') {
          await connection.query('UPDATE products SET cost = ? WHERE id = ?', [newValue, item.productId]);
        } else if (item.field === 'priceLevel' && item.priceLevelId) {
          // Upsert on the real PK (product_id, price_level_id); min_quantity is
          // not part of it, so an existence check filtered on min_quantity can
          // miss a row and hit a duplicate-PK error.
          await connection.query(
            `INSERT INTO product_price_levels (product_id, price_level_id, price, min_quantity)
             VALUES (?, ?, ?, 0)
             ON DUPLICATE KEY UPDATE price = VALUES(price)`,
            [item.productId, item.priceLevelId, newValue],
          );
        }
        applied++;
      }
    });
    done += part.length;
    onProgress?.(done);
  }

  return { applied, skipped };
}
```

- [ ] **Step 3: Add the batched product insert**

Append. Column list and defaults are copied from `addProduct`'s own INSERT (`app/(app)/products/actions.ts:513-521`) so an Excel-created product is identical to a dialog-created one. The Excel path passes no shelves, conversion factors, price levels, or supplier mappings and `stock: 0`, so no sub-inserts and no `inventory_batches` row are needed.

```typescript
/**
 * Inserts new products with multi-row INSERTs instead of one addProduct() call
 * (and therefore one transaction) per row.
 *
 * Safe because the Excel path supplies none of addProduct's optional
 * sub-entities — no shelf locations, conversion factors, price levels or
 * supplier mappings — and stock 0, so addProduct reduces to this single INSERT.
 * If addProduct's column defaults change, change them here too.
 */
export async function insertNewProducts(
  warehouseId: string,
  rows: NewProductFromExcel[],
  onProgress?: (done: number) => void,
): Promise<{ created: number; failed: { row: NewProductFromExcel; reason: string }[] }> {
  let created = 0;
  let done = 0;
  const failed: { row: NewProductFromExcel; reason: string }[] = [];

  const columns = `id, name, description, category, brand, warehouse_id, stock, reorder_point,
    avg_daily_sales, price, cost, sku, barcode, image_hint, unit_of_measure, conversion_factor,
    vat_status, availability, earns_points, is_perishable, type`;

  for (const part of chunk(rows, APPLY_CHUNK_SIZE)) {
    const values: any[] = [];
    const placeholders: string[] = [];
    for (const r of part) {
      const productId = `${r.sku}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
      placeholders.push('(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      values.push(
        productId, r.name, r.name, r.category, r.brand, warehouseId, 0, 0,
        0, r.price, r.cost ?? null, r.sku, r.barcode || null,
        r.name.toLowerCase().replace(/\s+/g, '-'), r.unitOfMeasure, 1,
        'YES (Subject to 12% VAT)', 'Available', 1, 0, 'standard',
      );
    }

    try {
      await withTransaction(async (connection) => {
        await connection.query(`INSERT INTO products (${columns}) VALUES ${placeholders.join(', ')}`, values);
      });
      created += part.length;
    } catch (error: any) {
      // One bad row fails its whole chunk. Retry the chunk row-by-row so the
      // good rows still land and only the genuinely bad ones are reported.
      for (const r of part) {
        const productId = `${r.sku}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
        try {
          await query(
            `INSERT INTO products (${columns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              productId, r.name, r.name, r.category, r.brand, warehouseId, 0, 0,
              0, r.price, r.cost ?? null, r.sku, r.barcode || null,
              r.name.toLowerCase().replace(/\s+/g, '-'), r.unitOfMeasure, 1,
              'YES (Subject to 12% VAT)', 'Available', 1, 0, 'standard',
            ],
          );
          created++;
        } catch (rowError: any) {
          failed.push({ row: r, reason: rowError.message || 'Failed to create product' });
        }
      }
    }
    done += part.length;
    onProgress?.(done);
  }

  return { created, failed };
}
```

- [ ] **Step 4: Verify the module compiles**

Run: `npx tsc --noEmit lib/price-list-import.ts 2>&1 | head -20`

Expected: no errors *originating in this file*. The repo's typecheck baseline is red, so ignore errors from other files; only `lib/price-list-import.ts` lines matter.

- [ ] **Step 5: Confirm the pure tests still pass**

Run: `npm run test:unit`
Expected: passes. (Tasks 1–2's tests import this module; adding DB functions must not break them at import time.)

- [ ] **Step 6: Commit**

```bash
git add lib/price-list-import.ts
git commit -m "feat: batched lookups, chunked apply, and multi-row product insert

Replaces 30k sequential lookups with ~30 chunked IN() queries, splits the
single unbounded apply transaction into 500-row chunks so a bulk update no
longer blocks POS checkout, and inserts new products in batches rather than
one addProduct() transaction each.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Streaming route handler

Adds the route that removes the 1MB Server Action wall, gates on approvals, and streams NDJSON progress.

**Files:**
- Create: `app/api/products/price-list/process/route.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–3; `parseFile`-equivalents `parseXlsxBuffer` / `parseCsvText` from `lib/import/parse-file.ts`; `mapParsedRowsToPriceListRows` from `app/(app)/products/bulk-price-update/price-list-template.ts`; `checkApprovalRequired` from `lib/approvals.ts`.
- Produces: `POST /api/products/price-list/process` accepting multipart fields `file`, `warehouseId`, `userId`, `mode` (`preview` | `apply`), `confirmCreate` (`'1'`), returning an NDJSON stream.

- [ ] **Step 1: Write the route**

Create `app/api/products/price-list/process/route.ts`:

```typescript
import { NextRequest } from 'next/server';
import { parseXlsxBuffer, parseCsvText } from '@/lib/import/parse-file';
import { mapParsedRowsToPriceListRows } from '@/app/(app)/products/bulk-price-update/price-list-template';
import { checkApprovalRequired } from '@/lib/approvals';
import {
  loadMatchMaps, matchPriceListRows, applyMatchedItems, insertNewProducts,
} from '@/lib/price-list-import';

/** Rows echoed back as a preview sample. All skipped rows are returned uncapped. */
const SAMPLE_LIMIT = 50;

export async function POST(request: NextRequest) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ message: 'Could not read the uploaded form.' }, { status: 400 });
  }

  const file = form.get('file');
  const warehouseId = String(form.get('warehouseId') || '');
  const mode = String(form.get('mode') || 'preview');
  const confirmCreate = String(form.get('confirmCreate') || '') === '1';

  if (!(file instanceof File)) return Response.json({ message: 'No file uploaded.' }, { status: 400 });
  if (!warehouseId) return Response.json({ message: 'No warehouse selected.' }, { status: 400 });
  if (mode !== 'preview' && mode !== 'apply') return Response.json({ message: 'Invalid mode.' }, { status: 400 });

  // Parse before the approval gate so the gate can tell whether the file
  // actually contains new products, and so an unreadable file fails as a plain
  // 400 rather than mid-stream.
  let rows;
  try {
    const name = file.name.toLowerCase();
    const parsed = name.endsWith('.xlsx') || name.endsWith('.xls')
      ? parseXlsxBuffer(await file.arrayBuffer())
      : parseCsvText(await file.text());
    rows = mapParsedRowsToPriceListRows(parsed);
  } catch (error: any) {
    return Response.json({ message: `Could not read the spreadsheet: ${error.message}` }, { status: 400 });
  }

  if (rows.length === 0) return Response.json({ message: 'The spreadsheet has no data rows.' }, { status: 400 });

  // A 15,000-item batch lands in approval_queue.transaction_data as one ~4MB
  // JSON blob and the kanban renders every item as a table row — unreviewable.
  // Block the bulk path rather than queue something nobody can approve.
  if (await checkApprovalRequired('PRICE_UPDATE')) {
    return Response.json({
      message: 'Bulk Excel upload is not available while price approvals are on. Turn off price approvals, or use the manual selection drawer.',
    }, { status: 409 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
      try {
        send({ phase: 'parsing', total: rows.length });

        const maps = await loadMatchMaps(warehouseId, rows);
        send({ phase: 'matching', done: rows.length, total: rows.length });
        const result = matchPriceListRows(rows, maps);

        if (result.toCreate.length > 0 && await checkApprovalRequired('PRODUCT_CREATE')) {
          send({
            phase: 'error',
            message: 'This file creates new products, which is not available while product approvals are on.',
          });
          controller.close();
          return;
        }

        if (mode === 'preview') {
          send({
            phase: 'done',
            mode: 'preview',
            matched: result.matched.length,
            toCreate: result.toCreate.length,
            skipped: result.skipped.length,
            matchedSample: result.matched.slice(0, SAMPLE_LIMIT),
            toCreateSample: result.toCreate.slice(0, SAMPLE_LIMIT),
            skippedRows: result.skipped,
          });
          controller.close();
          return;
        }

        // apply
        if (result.toCreate.length > 0 && !confirmCreate) {
          send({ phase: 'error', message: 'This file creates new products; confirmation is required.' });
          controller.close();
          return;
        }

        const totalWork = result.matched.length + result.toCreate.length;
        let base = 0;
        const applyOut = await applyMatchedItems(result.matched, (done) => {
          send({ phase: 'applying', done, total: totalWork });
        });
        base = result.matched.length;
        const createOut = await insertNewProducts(warehouseId, result.toCreate, (done) => {
          send({ phase: 'applying', done: base + done, total: totalWork });
        });

        send({
          phase: 'done',
          mode: 'apply',
          applied: applyOut.applied,
          created: createOut.created,
          skipped: result.skipped.length + applyOut.skipped.length,
          failed: createOut.failed.length,
          skippedRows: result.skipped,
        });
      } catch (error: any) {
        send({ phase: 'error', message: error?.message || 'Processing failed.' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
```

- [ ] **Step 2: Verify the approval gate with a real request**

Start the dev server (`npm run dev`), turn price approvals ON in Settings, then:

```bash
printf 'sku,new_price\nRICE-1KG,55\n' > /tmp/t.csv
curl -s -i -X POST http://localhost:3000/api/products/price-list/process \
  -F file=@/tmp/t.csv -F warehouseId=wh_main -F userId=system -F mode=preview | head -20
```

Expected: `HTTP/1.1 409` and the "not available while price approvals are on" message.

- [ ] **Step 3: Verify preview streams with approvals OFF**

Turn price approvals OFF, then re-run the same curl. Expected: `200`, `Content-Type: application/x-ndjson`, and NDJSON lines ending in a `{"phase":"done","mode":"preview",...}` frame whose counts match the file.

- [ ] **Step 4: Commit**

```bash
git add app/api/products/price-list/process/route.ts
git commit -m "feat: streaming price-list route that bypasses the 1MB action limit

Takes the file as multipart and parses it server-side, so a 15k-row sheet is
no longer capped by the Server Action body limit. Streams NDJSON progress and
blocks the bulk path while approvals are on.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Point the Server Actions at the shared module

Removes the duplicated logic so the drawer path and the route path cannot diverge.

**Files:**
- Modify: `app/(app)/products/bulk-price-update/actions.ts`

**Interfaces:**
- Consumes: `matchPriceListRows`, `loadMatchMaps`, `applyMatchedItems`, `insertNewProducts` and the exported types from `lib/price-list-import.ts`.
- Produces: unchanged public signatures — `submitPriceUpdateBatch`, `previewPriceListUpload`, `createProductsFromExcel`, and the `PriceUpdateItem` / `PriceListRow` / `NewProductFromExcel` / `PriceListPreviewResult` / `PriceUpdateResult` types other files import.

- [ ] **Step 1: Re-export the types from the shared module**

In `actions.ts`, delete the local `PriceUpdateItem`, `PriceListRow`, `NewProductFromExcel`, and `PriceListPreviewResult` interface declarations and replace them with a re-export, so existing importers keep working:

```typescript
export type {
  PriceUpdateItem, PriceListRow, NewProductFromExcel, PriceListPreviewResult,
} from '@/lib/price-list-import';
```

Keep `PriceUpdateResult` declared locally — it is this file's own result shape, not the shared module's.

- [ ] **Step 2: Delegate the three function bodies**

Replace the body of `previewPriceListUpload` with:

```typescript
export async function previewPriceListUpload(
  warehouseId: string,
  rows: PriceListRow[],
): Promise<PriceListPreviewResult> {
  const maps = await loadMatchMaps(warehouseId, rows);
  return matchPriceListRows(rows, maps);
}
```

Replace the private `applyPriceUpdateBatch` helper's body with a call to `applyMatchedItems`, keeping its `PriceUpdateResult` shape:

```typescript
async function applyPriceUpdateBatch(items: PriceUpdateItem[]): Promise<PriceUpdateResult> {
  const { applied, skipped } = await applyMatchedItems(items);
  return {
    success: true,
    applied,
    skipped,
    message: `Updated ${applied} product(s).${skipped.length ? ` ${skipped.length} skipped.` : ''}`,
  };
}
```

Leave `submitPriceUpdateBatch` untouched — its approval branching is unchanged, and `app/api/approvals/process/route.ts:189` depends on it.

`createProductsFromExcel` keeps calling `addProduct` per row. It is the drawer's small-batch path and must retain per-product approval routing; the route handler uses `insertNewProducts` instead. Add a comment saying so:

```typescript
// The drawer path keeps per-row addProduct() so each new product still routes
// through PRODUCT_CREATE approvals. The bulk Excel route uses
// insertNewProducts() instead, which is why it refuses to run while product
// approvals are on.
```

Add the import at the top:

```typescript
import { loadMatchMaps, matchPriceListRows, applyMatchedItems } from '@/lib/price-list-import';
```

- [ ] **Step 3: Confirm no importer broke**

Run: `npx tsc --noEmit 2>&1 | grep -E "bulk-price-update|price-list-import" | head -20`

Expected: no errors mentioning these files. (Repo-wide typecheck is red at baseline; only these paths matter.)

- [ ] **Step 4: Run the unit suite**

Run: `npm run test:unit`
Expected: passes.

- [ ] **Step 5: Verify the manual drawer still works end-to-end**

Run: `npx playwright test tests/e2e/bulk-price-update.spec.ts`

Expected: passes. This spec covers the manual selection drawer, which shares the code just rewritten. If it fails, compare against a stash of your changes to confirm whether the failure is pre-existing.

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/products/bulk-price-update/actions.ts"
git commit -m "refactor: server actions delegate to the shared price-list module

One implementation for both the drawer and the bulk route, so they cannot
drift apart. Public signatures unchanged.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Client — upload the file, read the stream, show progress

Rewires the hook and dialog: post the file to the route, read NDJSON frames, show a progress bar, and render a summary with samples plus a skipped-rows CSV download.

**Files:**
- Modify: `app/(app)/products/bulk-price-update/use-upload-price-list.ts`
- Modify: `app/(app)/products/bulk-price-update/UploadPriceListDialog.tsx`

**Interfaces:**
- Consumes: `POST /api/products/price-list/process` from Task 4.
- Produces: hook returning `{ file, preview, confirmCreate, setConfirmCreate, isParsing, isSubmitting, progress, handleFile, submit, reset, downloadSkippedCsv }` where `progress` is `{ phase: string; done: number; total: number } | null` and `preview` is the `done` frame from a preview run.

- [ ] **Step 1: Rewrite the hook**

Replace `use-upload-price-list.ts` entirely:

```typescript
'use client';

import { useState } from 'react';
import * as XLSX from 'xlsx';
import { useToast } from '@/hooks/use-toast';

export interface PreviewSummary {
  matched: number;
  toCreate: number;
  skipped: number;
  matchedSample: any[];
  toCreateSample: any[];
  skippedRows: { row: any; reason: string }[];
}

export interface Progress { phase: string; done: number; total: number }

/**
 * Reads an NDJSON stream, invoking `onFrame` per line. Buffers partial lines:
 * a chunk boundary can fall mid-line, so lines are only parsed once terminated.
 */
async function readNdjson(response: Response, onFrame: (frame: any) => void) {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) if (line.trim()) onFrame(JSON.parse(line));
  }
  if (buffer.trim()) onFrame(JSON.parse(buffer));
}

export function useUploadPriceList(warehouseId: string, onUpdated?: () => void) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewSummary | null>(null);
  const [confirmCreate, setConfirmCreate] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const { toast } = useToast();

  const post = async (theFile: File, mode: 'preview' | 'apply', userId: string) => {
    const form = new FormData();
    form.append('file', theFile);
    form.append('warehouseId', warehouseId);
    form.append('userId', userId);
    form.append('mode', mode);
    if (confirmCreate) form.append('confirmCreate', '1');

    const response = await fetch('/api/products/price-list/process', { method: 'POST', body: form });
    // Errors raised before streaming starts (approval gate, unreadable file)
    // come back as ordinary JSON, not as a stream.
    if (!response.ok) {
      const body = await response.json().catch(() => ({ message: 'Upload failed.' }));
      throw new Error(body.message || 'Upload failed.');
    }

    let final: any = null;
    await readNdjson(response, (frame) => {
      if (frame.phase === 'applying' || frame.phase === 'matching') {
        setProgress({ phase: frame.phase, done: frame.done, total: frame.total });
      } else if (frame.phase === 'parsing') {
        setProgress({ phase: 'parsing', done: 0, total: frame.total ?? 0 });
      } else if (frame.phase === 'error') {
        throw new Error(frame.message);
      } else if (frame.phase === 'done') {
        final = frame;
      }
    });
    return final;
  };

  const handleFile = async (theFile: File) => {
    setIsParsing(true);
    setPreview(null);
    setConfirmCreate(false);
    setProgress(null);
    setFile(theFile);
    try {
      const result = await post(theFile, 'preview', 'system');
      setPreview(result);
    } catch (err: any) {
      setFile(null);
      toast({ variant: 'destructive', title: 'Failed to read file', description: err.message || String(err) });
    } finally {
      setIsParsing(false);
      setProgress(null);
    }
  };

  const submit = async (userId: string) => {
    if (!file || !preview) return null;
    if (preview.toCreate > 0 && !confirmCreate) return null;
    setIsSubmitting(true);
    try {
      const result = await post(file, 'apply', userId);
      const parts: string[] = [];
      if (result.applied > 0) parts.push(`Updated ${result.applied} product(s)`);
      if (result.created > 0) parts.push(`Created ${result.created} new product(s)`);
      if (result.skipped > 0) parts.push(`${result.skipped} row(s) skipped`);
      if (result.failed > 0) parts.push(`${result.failed} failed`);
      toast({
        variant: result.failed > 0 ? 'destructive' : undefined,
        title: result.failed > 0 ? 'Completed with issues' : 'Price list processed',
        description: parts.join('. ') || 'Nothing to do.',
      });
      setPreview(null);
      setFile(null);
      setConfirmCreate(false);
      onUpdated?.();
      return result;
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message || 'Failed to submit price list.' });
      return null;
    } finally {
      setIsSubmitting(false);
      setProgress(null);
    }
  };

  const downloadSkippedCsv = () => {
    if (!preview?.skippedRows?.length) return;
    const data = preview.skippedRows.map(s => ({
      sku: s.row?.sku ?? '', barcode: s.row?.barcode ?? '', name: s.row?.name ?? '',
      new_price: s.row?.newPrice ?? '', new_cost: s.row?.newCost ?? '',
      new_markup_pct: s.row?.newMarkupPct ?? '', reason: s.reason,
    }));
    const sheet = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'Skipped');
    XLSX.writeFile(wb, 'skipped-rows.csv', { bookType: 'csv' });
  };

  return {
    file, preview, confirmCreate, setConfirmCreate, isParsing, isSubmitting, progress,
    handleFile, submit, downloadSkippedCsv,
    reset: () => { setPreview(null); setFile(null); setConfirmCreate(false); setProgress(null); },
  };
}
```

- [ ] **Step 2: Update the dialog to render counts, samples, and progress**

In `UploadPriceListDialog.tsx`:

Change `canSubmit` and `hasCreateRows` to read the new count fields:

```typescript
const hasCreateRows = (up.preview?.toCreate ?? 0) > 0;
const canSubmit = !!up.preview
  && ((up.preview.matched ?? 0) > 0 || (up.preview.toCreate ?? 0) > 0)
  && (!hasCreateRows || up.confirmCreate)
  && !up.isSubmitting;
```

Add a progress bar below the file input:

```tsx
{up.progress && (
  <div className="space-y-1">
    <p className="text-sm text-muted-foreground">
      {up.progress.phase === 'applying' ? 'Applying changes' : 'Matching products'}
      {up.progress.total > 0 && ` — ${up.progress.done.toLocaleString()} / ${up.progress.total.toLocaleString()}`}
    </p>
    <div className="h-2 w-full rounded bg-muted overflow-hidden">
      <div
        className="h-full bg-primary transition-all"
        style={{ width: up.progress.total > 0 ? `${Math.round((up.progress.done / up.progress.total) * 100)}%` : '0%' }}
      />
    </div>
  </div>
)}
```

Replace the summary block. Counts first, then a capped sample table, then the skipped download:

```tsx
{up.preview && (
  <div className="space-y-4">
    <div className="text-sm space-y-1">
      <p>{up.preview.matched.toLocaleString()} product(s) will be updated</p>
      {hasCreateRows && <p>{up.preview.toCreate.toLocaleString()} new product(s) will be created</p>}
      {up.preview.skipped > 0 && (
        <p className="flex items-center gap-2 text-muted-foreground">
          {up.preview.skipped.toLocaleString()} row(s) skipped
          <Button type="button" variant="link" className="h-auto p-0" onClick={up.downloadSkippedCsv}>
            Download skipped rows (CSV)
          </Button>
        </p>
      )}
    </div>

    {up.preview.matchedSample.length > 0 && (
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">
          Showing first {up.preview.matchedSample.length} of {up.preview.matched.toLocaleString()}
        </p>
        <div className="border rounded-lg max-h-56 overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Field</TableHead>
                <TableHead className="text-right">Old</TableHead>
                <TableHead className="text-right">New</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {up.preview.matchedSample.map((item: any, i: number) => (
                <TableRow key={`${item.productId}-${item.field}-${i}`}>
                  <TableCell>{item.productName}</TableCell>
                  <TableCell>{item.field}</TableCell>
                  <TableCell className="text-right">₱{Number(item.oldValue).toFixed(2)}</TableCell>
                  <TableCell className="text-right font-medium">₱{Number(item.newValue).toFixed(2)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    )}

    {hasCreateRows && (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Showing first {up.preview.toCreateSample.length} of {up.preview.toCreate.toLocaleString()} new product(s)
        </p>
        <div className="border rounded-lg max-h-56 overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Brand</TableHead>
                <TableHead className="text-right">Price</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {up.preview.toCreateSample.map((row: any, i: number) => (
                <TableRow key={`${row.sku}-${i}`}>
                  <TableCell>{row.name}</TableCell>
                  <TableCell>{row.sku}</TableCell>
                  <TableCell>{row.brand}</TableCell>
                  <TableCell className="text-right">₱{Number(row.price).toFixed(2)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="flex items-center space-x-2">
          <Checkbox id="confirmCreate" checked={up.confirmCreate} onCheckedChange={(c) => up.setConfirmCreate(!!c)} />
          <Label htmlFor="confirmCreate" className="text-sm font-normal">
            I understand {up.preview.toCreate.toLocaleString()} new product(s) will be created
          </Label>
        </div>
      </div>
    )}
  </div>
)}
```

Update the submit button label:

```tsx
{up.isSubmitting ? 'Submitting...' : `Submit ${((up.preview?.matched ?? 0) + (up.preview?.toCreate ?? 0)).toLocaleString()} Change(s)`}
```

- [ ] **Step 3: Verify in the browser with a small file**

Run `npm run dev`, open Products → Bulk Update Price → Upload Excel, upload a 3-row file (one matching SKU, one new product with all identity columns, one row with neither SKU nor barcode).

Expected: counts read 1 update / 1 create / 1 skipped; the sample tables render; "Download skipped rows (CSV)" produces a CSV with the reason column; submitting applies and the toast reports the counts.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/products/bulk-price-update/use-upload-price-list.ts" "app/(app)/products/bulk-price-update/UploadPriceListDialog.tsx"
git commit -m "feat: stream upload progress and summarise large price-list previews

Posts the file to the streaming route instead of pushing parsed rows through
a Server Action, shows a real progress bar, and replaces the full-table
preview with counts plus 50-row samples and a complete skipped-rows CSV.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: 15,000-row end-to-end verification

Proves the actual goal. Everything before this is unverified at scale.

**Files:**
- Create: `scripts/dev/generate-price-list-fixture.ts`

**Interfaces:**
- Consumes: the full stack from Tasks 1–6.
- Produces: a generator script and a recorded timing result.

- [ ] **Step 1: Write the fixture generator**

Create `scripts/dev/generate-price-list-fixture.ts`:

```typescript
/**
 * Generates a 15,000-row mixed price list: 12,000 rows targeting existing
 * products (by SKU) and 3,000 rows that will be created. Run against a dev DB.
 *
 *   npx tsx scripts/dev/generate-price-list-fixture.ts <warehouseId> [out.xlsx]
 */
import * as XLSX from 'xlsx';
import { query } from '../../lib/mysql';

async function main() {
  const warehouseId = process.argv[2];
  const out = process.argv[3] || 'price-list-15k.xlsx';
  if (!warehouseId) throw new Error('usage: generate-price-list-fixture.ts <warehouseId> [out.xlsx]');

  const existing: any = await query(
    'SELECT sku, price FROM products WHERE warehouse_id = ? AND sku IS NOT NULL LIMIT 12000',
    [warehouseId],
  );
  console.log(`found ${existing.length} existing products to update`);

  const header = ['sku', 'barcode', 'name', 'new_price', 'new_cost', 'new_markup_pct', 'brand', 'category', 'unit_of_measure'];
  const rows: any[][] = [];

  for (const p of existing) {
    const newPrice = Math.round((parseFloat(p.price || 10) * 1.05) * 100) / 100;
    rows.push([p.sku, '', '', newPrice, '', '', '', '', '']);
  }

  const stamp = Date.now();
  for (let i = 0; i < 3000; i++) {
    rows.push([`FIXT-${stamp}-${i}`, '', `Fixture Product ${i}`, 25 + (i % 50), 20, '', 'FixtureBrand', 'Grocery', 'pc']);
  }

  const sheet = XLSX.utils.aoa_to_sheet([header, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'Price List');
  XLSX.writeFile(wb, out);
  console.log(`wrote ${rows.length} rows to ${out}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Generate the fixture**

Run: `npx tsx scripts/dev/generate-price-list-fixture.ts wh_main price-list-15k.xlsx`

Expected: reports the existing-product count and writes the file. If the dev DB has fewer than 12,000 products, the file will be smaller — note the actual row count and use it as the real test size.

- [ ] **Step 3: Time the preview pass**

```bash
time curl -s -X POST http://localhost:3000/api/products/price-list/process \
  -F file=@price-list-15k.xlsx -F warehouseId=wh_main -F userId=system -F mode=preview \
  | tail -c 2000
```

Expected: completes without a body-size error; the final `done` frame's `matched + toCreate + skipped` reconciles against the row count. Record the elapsed time.

- [ ] **Step 4: Time the apply pass and confirm progress frames arrive incrementally**

```bash
time curl -sN -X POST http://localhost:3000/api/products/price-list/process \
  -F file=@price-list-15k.xlsx -F warehouseId=wh_main -F userId=system \
  -F mode=apply -F confirmCreate=1 | grep -c applying
```

Expected: a non-zero count of `applying` frames (proving progress streams rather than arriving all at once), and the run completes. Target under a minute; record the actual time.

- [ ] **Step 5: Verify the DB actually changed**

```bash
npx tsx -e "import {query} from './lib/mysql'; (async()=>{const r:any=await query(\"SELECT COUNT(*) c FROM products WHERE sku LIKE 'FIXT-%'\"); console.log('created:', r[0].c); process.exit(0);})()"
```

Expected: reports 3,000 (or the fixture's create count). Confirms the batched insert wrote real rows.

- [ ] **Step 6: Re-run the same file to confirm idempotency**

Re-run Step 4's command. Expected: the updates re-apply harmlessly (same prices), and the 3,000 creates are now *skipped as duplicates* rather than creating 3,000 more products. Re-run Step 5 and confirm the count is still 3,000, not 6,000.

- [ ] **Step 7: Full verification sweep**

```bash
npm run test:unit
npx playwright test tests/e2e/bulk-price-update.spec.ts
```

Expected: unit suite passes; the E2E spec passes. Report the measured 15k timings from Steps 3–4 explicitly — that number is the deliverable.

- [ ] **Step 8: Commit**

```bash
git add scripts/dev/generate-price-list-fixture.ts
git commit -m "test: add 15k-row price-list fixture generator

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage.** Wall 1 (1MB limit) → Task 4's multipart route. Wall 2 (N+1) → Task 3's `loadMatchMaps`. Wall 3 (giant transaction) → Task 3's `applyMatchedItems`. Wall 4 (`addProduct` per row) → Task 3's `insertNewProducts`. Streaming progress → Tasks 4 and 6. Approval block → Task 4 Step 1, verified Step 2. Preview summary + 50-row samples + skipped CSV → Task 6. SKU-collision fix → Tasks 1–2. Shared-module organisation → Tasks 1, 3, 5. Testing section → Tasks 1, 2, 7.

**Type consistency.** `MatchMaps` / `ProductLookup` are defined in Task 1 and used unchanged in Tasks 2 and 3. `chunk`, `LOOKUP_CHUNK_SIZE`, `APPLY_CHUNK_SIZE` are defined in Task 2 and consumed in Task 3. The route's `done` frame fields (`matched`, `toCreate`, `skipped`, `matchedSample`, `toCreateSample`, `skippedRows`) match `PreviewSummary` in Task 6 exactly. `applyMatchedItems` returns `{applied, skipped}` in Task 3 and is destructured as such in Tasks 4 and 5.

**Known trade-offs, carried from the spec.** Chunked apply is not all-or-nothing (Task 3 Step 2 documents why). `insertNewProducts` duplicates `addProduct`'s column defaults and must be updated alongside it (noted in the function's own comment). The file is uploaded twice, once per mode.
