# Retire products.sku — Cluster 4: Repackaging + Misc Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire the last `products.sku` display sites in the codebase — the repackaging history log, the repackaging/consolidation wizards' product search results, the Break Pack dialog's target search, and the Stock Transfer dialog's product label — replacing every one with the base selling unit's barcode. This is the final cluster of Sub-project B; after this lands, no file outside the already-scoped-out Reports/bulk-import/e2e work (Sub-projects C/D) reads `.sku` anywhere in the app.

**Architecture:** Three independent product-read paths feed the files this cluster touches, and each needs the base-unit-barcode value added to its own query before any display site can show it — there is no shared plumbing to reuse, unlike Clusters 1-3 where `Product.sellingUnits` was already present on every touched value. `repackaging/actions.ts`'s `getRepackagingHistory` query gets a `LEFT JOIN` against `product_selling_units` (filtered `is_base = 1`) for each of its two product aliases, mirroring the `LEFT JOIN products sp/tp` pattern already in that query. `products/actions.ts`'s `searchProducts` — a third, previously-undocumented product-read path (distinct from both `getProducts` and `MySqlProductRepository`, and not named in the original spec) — gets a new correlated scalar subquery for the base unit's barcode, mirroring the `conversion_factors` correlated subquery already in that same function. Three independently-declared `SearchResult` types across three files consume `searchProducts`' output and all gain a `baseUnitBarcode: string | null` field. `StockTransferDialog.tsx` is unrelated to the other two paths — it already receives a fully-typed `Product` with `sellingUnits`, so it follows the same `sellingUnits?.find(su => su.isBase)?.barcode` pattern Clusters 1-3 already established.

**Tech Stack:** Next.js 16 App Router, React, TypeScript, raw `mysql2/promise` via `lib/mysql.ts`, no automated test covers any file this plan touches (manual-only, same as Clusters 1-3).

**Spec:** `docs/superpowers/specs/2026-09-22-retire-sku-search-pos-inventory-design.md` (Cluster 4 section). Clusters 1-3 are already merged. This plan extends beyond the spec's literal file list in two places — see Global Constraints below for why.

## Global Constraints

- Every touched display site reads the base selling unit's barcode first, falling back to the legacy `products.barcode` column, matching each site's existing null-handling convention. `products.barcode` itself is never the primary source and stays untouched as a column.
- `product_selling_units` has NO database-level uniqueness constraint enforcing exactly one `is_base = 1` row per product — "exactly one base unit" is an application-level invariant (see CLAUDE.md's Selling Units section), not a schema guarantee. Every new query in this plan that assumes one base unit per product uses `LIMIT 1` (in a correlated subquery) or accepts that a `LEFT JOIN` could theoretically multiply rows if the invariant is ever violated — this matches the risk profile `getProducts` already accepts elsewhere in this codebase (see `actions.ts:951`'s own un-defended `SELECT ... WHERE ... is_base = 1 LIMIT 1`), so this plan is not introducing a new class of risk, only continuing an existing one.
- **Scope addition #1 (beyond the spec's literal text):** `app/(app)/products/break-pack/break-pack-dialog.tsx` and its hook `use-break-pack.ts` are added to this plan. They were not named in the spec, but they consume the exact same `searchProducts()` function the spec's named files (`consolidation-form.tsx`, `repackaging-form.tsx`) also consume, and have the identical `p.sku` display bug. Fixing `searchProducts()`'s SQL once and updating all three consumers together is more correct than fixing the same root cause twice under two different plans — confirmed with the user before writing this plan.
- **Scope addition #2 (beyond the spec's literal text):** `searchProducts()` in `app/(app)/products/actions.ts` itself must be modified — the spec's text only names `repackaging/actions.ts`'s SQL, but `consolidation-form.tsx`/`repackaging-form.tsx` never read from a typed `Product` at all; they read from `searchProducts()`'s own narrower return shape, which has never selected a selling-unit barcode. This is a necessary consequence of fixing the named files correctly, not a design choice — confirmed during planning that no other path currently exposes this value to these three files.
- Do not touch `getProducts` (in `app/(app)/products/actions.ts`) or `MySqlProductRepository` — those are the two product-read paths Clusters 1-3 already cover; `searchProducts` is a third, separate function in the same file and this plan touches only that one function's SQL and return mapping.
- Do not touch `products.barcode` (legacy column), `supplier_product_mapping.supplier_sku`, Reports, bulk import/export, sales/purchase product selectors, or e2e test files — all out of scope per the original spec.
- Do not touch `app/(app)/inventory/stock-counts/` — its `product_sku` fields are historical snapshot columns on `stock_count_items`, a genuinely different concern flagged during Cluster 3's final review for a future pass, not this one.
- Dropping `products.sku` itself remains deferred to the final cleanup after Sub-project D — this plan keeps `products.sku` and `products.barcode` both fully intact as columns; it only stops *reading* `products.sku` in the files it touches.

---

### Task 1: `repackaging/actions.ts` — base unit barcode in the history log

**Files:**
- Modify: `app/(app)/inventory/repackaging/actions.ts`
- Test: manual

**Interfaces:**
- Consumes: nothing new — reads `products` and `product_selling_units` directly via a `LEFT JOIN`.
- Produces: `RepackagingLog.sourceSku`/`.targetSku` are renamed to `sourceBarcode`/`targetBarcode`. No file outside this one currently reads these fields (confirmed during planning — `app/(app)/inventory/repackaging/page.tsx` imports the `RepackagingLog` type and renders `sourceProductName`/`targetProductName`/etc. but never `.sourceSku`/`.targetSku`), so this rename has no other call site to update.

- [ ] **Step 1: Confirm the current query and type**

```bash
grep -n "sp.sku\|tp.sku\|sourceSku\|targetSku" "app/(app)/inventory/repackaging/actions.ts"
```

Confirm the current state (already read during planning):

```typescript
export type RepackagingLog = {
  id: string;
  sourceProductId: string;
  sourceProductName: string;
  sourceQty: number;
  targetProductId: string;
  targetProductName: string;
  targetQtyProduced: number;
  factor: number;
  status: string;
  approvalQueueId: string | null;
  notes: string | null;
  direction: 'break' | 'consolidate';
  createdBy: string | null;
  createdAt: string;
};

export async function getRepackagingHistory(limit: number = 50, offset: number = 0): Promise<RepackagingLog[]> {
  try {
    const rows: any = await query(
      `SELECT
        rl.*,
        sp.sku AS source_sku,
        tp.sku AS target_sku
       FROM repackaging_logs rl
       LEFT JOIN products sp ON rl.source_product_id = sp.id
       LEFT JOIN products tp ON rl.target_product_id = tp.id
       ORDER BY rl.created_at DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    return (rows || []).map((r: any) => ({
      id: r.id,
      sourceProductId: r.source_product_id,
      sourceProductName: r.source_product_name,
      sourceSku: r.source_sku,
      sourceQty: parseFloat(r.source_qty),
      targetProductId: r.target_product_id,
      targetProductName: r.target_product_name,
      targetSku: r.target_sku,
      targetQtyProduced: parseFloat(r.target_qty_produced),
      factor: parseFloat(r.factor),
      status: r.status,
      approvalQueueId: r.approval_queue_id,
      notes: r.notes,
      direction: r.notes === 'consolidate' ? 'consolidate' : 'break',
      createdBy: r.created_by,
      createdAt: r.created_at,
    }));
  } catch (error) {
    console.error('Error fetching repackaging history:', error);
    return [];
  }
}
```

Note: `sourceSku`/`targetSku` are defined and populated but never rendered by `page.tsx` today (verified during planning) — this task still fixes them, matching this whole sub-project's goal of eliminating `.sku` reads everywhere, not only where currently visible, since Sub-project D will eventually drop the column and any surviving read would break silently.

- [ ] **Step 2: Rename the type's fields**

In the `RepackagingLog` type, change:
```typescript
  sourceProductName: string;
  sourceQty: number;
```
to:
```typescript
  sourceProductName: string;
  sourceBarcode: string | null;
  sourceQty: number;
```

And change:
```typescript
  targetProductName: string;
  targetQtyProduced: number;
```
to:
```typescript
  targetProductName: string;
  targetBarcode: string | null;
  targetQtyProduced: number;
```

(Inserted as new fields near their respective product-name fields, matching this type's existing grouping of source-then-target fields — not appended at the end.)

- [ ] **Step 3: Add the `LEFT JOIN`s and select the base unit's barcode**

Replace the query's `FROM`/`LEFT JOIN` clause and `SELECT` list:

```typescript
      `SELECT
        rl.*,
        COALESCE(spu.barcode, sp.barcode) AS source_barcode,
        COALESCE(tpu.barcode, tp.barcode) AS target_barcode
       FROM repackaging_logs rl
       LEFT JOIN products sp ON rl.source_product_id = sp.id
       LEFT JOIN products tp ON rl.target_product_id = tp.id
       LEFT JOIN product_selling_units spu ON spu.product_id = sp.id AND spu.is_base = 1
       LEFT JOIN product_selling_units tpu ON tpu.product_id = tp.id AND tpu.is_base = 1
       ORDER BY rl.created_at DESC
       LIMIT ? OFFSET ?`,
```

(`COALESCE` gives base-unit-barcode-first, falling back to the legacy `products.barcode` column, matching this whole sub-project's priority order. `spu`/`tpu` follow the existing `sp`/`tp` alias convention this query already uses for the two product joins.)

- [ ] **Step 4: Update the row mapper**

Replace:
```typescript
      sourceSku: r.source_sku,
```
with:
```typescript
      sourceBarcode: r.source_barcode,
```

Replace:
```typescript
      targetSku: r.target_sku,
```
with:
```typescript
      targetBarcode: r.target_barcode,
```

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit -p . 2>&1 | wc -l
```

Expected: 14 — this codebase's current baseline as of Cluster 3's merge. No new errors. (If a new error appears referencing `.sourceSku`/`.targetSku` from a file this plan's own research did not find, treat it as new information to resolve within this task — this plan's research found zero consumers of these two fields outside this file.)

- [ ] **Step 6: Manual verification**

Run `npm run dev`, open `/inventory/repackaging` → History tab. Confirm the page still loads and renders existing repackaging log rows (this tab's own display never showed `sourceSku`/`targetSku` before or after this change, so there is no visible UI difference to check here — this step confirms the query itself doesn't error, which would show as an empty/broken history tab).

Query directly to confirm the new columns resolve correctly for an existing log row:
```sql
SELECT rl.id, sp.sku AS old_source_sku, spu.barcode AS new_source_barcode
FROM repackaging_logs rl
LEFT JOIN products sp ON rl.source_product_id = sp.id
LEFT JOIN product_selling_units spu ON spu.product_id = sp.id AND spu.is_base = 1
LIMIT 3;
```
Confirm `new_source_barcode` is populated (not NULL) for at least one row, proving the join resolves.

- [ ] **Step 7: Commit**

```bash
git add "app/(app)/inventory/repackaging/actions.ts"
git commit -m "feat: repackaging history log reads the base selling unit's barcode, not sku"
```

---

### Task 2: `searchProducts()` — add the base unit's barcode to its return shape

**Files:**
- Modify: `app/(app)/products/actions.ts`
- Test: manual

**Interfaces:**
- Consumes: nothing new.
- Produces: `searchProducts(searchQuery: string)`'s returned objects gain a `baseUnitBarcode: string | null` field. Tasks 3-5 (three separate consumer files) depend on this exact field name.

- [ ] **Step 1: Confirm the current function**

```bash
grep -n "export async function searchProducts" "app/(app)/products/actions.ts"
```

Confirm the current state (already read during planning, at line 2673):

```typescript
export async function searchProducts(searchQuery: string) {
  try {
    if (!searchQuery || searchQuery.trim().length < 2) return [];
    const like = `%${searchQuery.trim()}%`;
    // Services are excluded: repackaging (break pack / consolidate) moves
    // physical stock between products, which services never have.
    const sql = `
      SELECT p.id, p.name, p.sku, p.barcode, p.stock, p.unit_of_measure, p.parent_id, p.conversion_factor, p.price, p.cost,
             (SELECT JSON_ARRAYAGG(JSON_OBJECT('unit', unit, 'factor', factor))
              FROM conversion_factors cf
              WHERE cf.product_id = p.id) as conversion_factors
      FROM products p
      WHERE (p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ? OR EXISTS (
        SELECT 1 FROM product_selling_units su WHERE su.product_id = p.id AND su.barcode LIKE ?
      )) AND p.type = 'standard'
      ORDER BY p.name ASC
      LIMIT 20
    `;
    const results = await query(sql, [like, like, like, like]);
    return results.map((r: any) => ({
      id: r.id,
      name: r.name,
      sku: r.sku,
      barcode: r.barcode,
      stock: r.stock,
      unitOfMeasure: r.unit_of_measure,
      parentId: r.parent_id,
      conversionFactor: r.conversion_factor,
      price: parseFloat(r.price) || 0,
      cost: r.cost ? parseFloat(r.cost) : undefined,
      conversionFactors: typeof r.conversion_factors === 'string' ? JSON.parse(r.conversion_factors) : (r.conversion_factors || []),
    }));
  } catch (error) {
    console.error('Error searching products:', error);
    return [];
  }
}
```

This function is called by exactly three files (confirmed during planning): `app/(app)/inventory/repackaging/use-consolidation-form.ts`, `app/(app)/inventory/repackaging/use-repackaging-form.ts`, `app/(app)/products/break-pack/use-break-pack.ts`. This task changes its return shape; Tasks 3-5 update each of those three call sites' own local type declarations to match.

- [ ] **Step 2: Add the correlated subquery for the base unit's barcode**

Replace:
```typescript
    const sql = `
      SELECT p.id, p.name, p.sku, p.barcode, p.stock, p.unit_of_measure, p.parent_id, p.conversion_factor, p.price, p.cost,
             (SELECT JSON_ARRAYAGG(JSON_OBJECT('unit', unit, 'factor', factor))
              FROM conversion_factors cf
              WHERE cf.product_id = p.id) as conversion_factors
      FROM products p
      WHERE (p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ? OR EXISTS (
        SELECT 1 FROM product_selling_units su WHERE su.product_id = p.id AND su.barcode LIKE ?
      )) AND p.type = 'standard'
      ORDER BY p.name ASC
      LIMIT 20
    `;
```

with:
```typescript
    const sql = `
      SELECT p.id, p.name, p.sku, p.barcode, p.stock, p.unit_of_measure, p.parent_id, p.conversion_factor, p.price, p.cost,
             (SELECT JSON_ARRAYAGG(JSON_OBJECT('unit', unit, 'factor', factor))
              FROM conversion_factors cf
              WHERE cf.product_id = p.id) as conversion_factors,
             (SELECT su.barcode FROM product_selling_units su
              WHERE su.product_id = p.id AND su.is_base = 1 LIMIT 1) as base_unit_barcode
      FROM products p
      WHERE (p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ? OR EXISTS (
        SELECT 1 FROM product_selling_units su WHERE su.product_id = p.id AND su.barcode LIKE ?
      )) AND p.type = 'standard'
      ORDER BY p.name ASC
      LIMIT 20
    `;
```

(This is a correlated scalar subquery, the same pattern this function already uses for `conversion_factors` two lines above, and the same `is_base = 1 LIMIT 1` pattern already used elsewhere in this same file at `actions.ts:951`. `su` as an alias is scoped to this subquery only and does not collide with the `su` alias already used inside the `EXISTS` subquery in the `WHERE` clause — each subquery has its own scope in SQL.)

- [ ] **Step 3: Add the field to the row mapper**

Replace:
```typescript
    return results.map((r: any) => ({
      id: r.id,
      name: r.name,
      sku: r.sku,
      barcode: r.barcode,
      stock: r.stock,
      unitOfMeasure: r.unit_of_measure,
      parentId: r.parent_id,
      conversionFactor: r.conversion_factor,
      price: parseFloat(r.price) || 0,
      cost: r.cost ? parseFloat(r.cost) : undefined,
      conversionFactors: typeof r.conversion_factors === 'string' ? JSON.parse(r.conversion_factors) : (r.conversion_factors || []),
    }));
```

with:
```typescript
    return results.map((r: any) => ({
      id: r.id,
      name: r.name,
      sku: r.sku,
      barcode: r.barcode,
      baseUnitBarcode: r.base_unit_barcode,
      stock: r.stock,
      unitOfMeasure: r.unit_of_measure,
      parentId: r.parent_id,
      conversionFactor: r.conversion_factor,
      price: parseFloat(r.price) || 0,
      cost: r.cost ? parseFloat(r.cost) : undefined,
      conversionFactors: typeof r.conversion_factors === 'string' ? JSON.parse(r.conversion_factors) : (r.conversion_factors || []),
    }));
```

Note: `sku`/`barcode` are deliberately LEFT IN this function's return shape for this task — Tasks 3-5 change what the three CONSUMER files read for display, not what this function returns. Removing `sku`/`barcode` here would be a needless additional risk this task doesn't need to take (no consumer is told to stop reading `barcode` as the fallback), and this plan's Global Constraints only require that no site READS `.sku` for display — this function returning the raw column is fine as long as nothing displays it, matching the same reasoning already established for `Product.sku` itself, which Sub-project A deliberately left in the schema.

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit -p . 2>&1 | wc -l
```

Expected: 14, unchanged. (`searchProducts` has no explicit return type annotation — confirmed during planning — so this is not expected to surface a new type error on its own; Tasks 3-5 are where the three consumer files' own typed `SearchResult` shapes come into play.)

- [ ] **Step 5: Manual verification**

Query directly to confirm the new subquery resolves:
```sql
SELECT p.id, p.name, p.sku,
  (SELECT su.barcode FROM product_selling_units su WHERE su.product_id = p.id AND su.is_base = 1 LIMIT 1) as base_unit_barcode
FROM products p WHERE p.type = 'standard' LIMIT 3;
```
Confirm `base_unit_barcode` is populated for standard products with a base selling unit.

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/products/actions.ts"
git commit -m "feat: searchProducts exposes the base selling unit's barcode"
```

---

### Task 3: Consolidation form — display the base unit's barcode

**Files:**
- Modify: `app/(app)/inventory/repackaging/use-consolidation-form.ts`
- Modify: `app/(app)/inventory/repackaging/consolidation-form.tsx`
- Test: manual

**Interfaces:**
- Consumes: `searchProducts()`'s new `baseUnitBarcode` field (Task 2).
- Produces: `SearchResult.sku` is removed; `SearchResult.baseUnitBarcode` is added. No other file imports this `SearchResult` type (confirmed during planning — it is declared and used only within these two files).

- [ ] **Step 1: Confirm the current type**

```bash
grep -n "export type SearchResult" "app/(app)/inventory/repackaging/use-consolidation-form.ts"
```

Confirm (already read during planning), at line 11:
```typescript
export type SearchResult = {
  id: string;
  name: string;
  sku: string;
  barcode: string;
  stock: number;
  unitOfMeasure: string;
  price: number;
  cost?: number;
  conversionFactors?: { unit: string; factor: number }[];
};
```

- [ ] **Step 2: Update the type**

Replace:
```typescript
export type SearchResult = {
  id: string;
  name: string;
  sku: string;
  barcode: string;
  stock: number;
  unitOfMeasure: string;
  price: number;
  cost?: number;
  conversionFactors?: { unit: string; factor: number }[];
};
```

with:
```typescript
export type SearchResult = {
  id: string;
  name: string;
  barcode: string;
  baseUnitBarcode: string | null;
  stock: number;
  unitOfMeasure: string;
  price: number;
  cost?: number;
  conversionFactors?: { unit: string; factor: number }[];
};
```

- [ ] **Step 3: Confirm the four display sites in `consolidation-form.tsx`**

```bash
grep -n "p.sku\|selectedSource.sku\|selectedTarget.sku" "app/(app)/inventory/repackaging/consolidation-form.tsx"
```

Confirm all four (already read during planning):

Line 123 (source search result row):
```tsx
                        <p className="text-sm text-muted-foreground">{p.sku} · Stock: {formatQuantity(p.stock)} {p.unitOfMeasure}</p>
```

Line 136 (selected source summary):
```tsx
                      <p className="text-sm text-muted-foreground">{selectedSource.sku}</p>
```

Line 226 (target search result row):
```tsx
                            <p className="text-sm text-muted-foreground">{p.sku} · {p.unitOfMeasure}</p>
```

Line 238 (selected target summary):
```tsx
                        <p className="text-sm text-muted-foreground">{selectedTarget.sku} · {selectedTarget.unitOfMeasure}</p>
```

- [ ] **Step 4: Replace all four**

Replace line 123:
```tsx
                        <p className="text-sm text-muted-foreground">{p.sku} · Stock: {formatQuantity(p.stock)} {p.unitOfMeasure}</p>
```
with:
```tsx
                        <p className="text-sm text-muted-foreground">{p.baseUnitBarcode || p.barcode} · Stock: {formatQuantity(p.stock)} {p.unitOfMeasure}</p>
```

Replace line 136:
```tsx
                      <p className="text-sm text-muted-foreground">{selectedSource.sku}</p>
```
with:
```tsx
                      <p className="text-sm text-muted-foreground">{selectedSource.baseUnitBarcode || selectedSource.barcode}</p>
```

Replace line 226:
```tsx
                            <p className="text-sm text-muted-foreground">{p.sku} · {p.unitOfMeasure}</p>
```
with:
```tsx
                            <p className="text-sm text-muted-foreground">{p.baseUnitBarcode || p.barcode} · {p.unitOfMeasure}</p>
```

Replace line 238:
```tsx
                        <p className="text-sm text-muted-foreground">{selectedTarget.sku} · {selectedTarget.unitOfMeasure}</p>
```
with:
```tsx
                        <p className="text-sm text-muted-foreground">{selectedTarget.baseUnitBarcode || selectedTarget.barcode} · {selectedTarget.unitOfMeasure}</p>
```

(No `|| ''` terminator on any of these four — this site's original convention rendered `{p.sku}`/`{selectedSource.sku}` bare, with no fallback beyond the raw field. `baseUnitBarcode || barcode` already provides one level of fallback, matching the priority order every other cluster established; adding a further `|| ''` would be over-applying a terminator this site's own prior convention never had.)

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit -p . 2>&1 | wc -l
```

Expected: 14, unchanged. If an error appears at any `.sku` reference this task's own research did not find in these two files, treat it as new information to resolve within this task.

- [ ] **Step 6: Manual verification**

Run `npm run dev`, open `/inventory/repackaging` → Pack → Bulk Consolidation tab. Search for a product with a base selling unit and confirm the search results show a barcode-looking value (not empty) instead of a SKU-looking value. Select a source, confirm the selected-source summary shows the same. Move to Step 2 (target), repeat for the target search and selection.

- [ ] **Step 7: Commit**

```bash
git add "app/(app)/inventory/repackaging/use-consolidation-form.ts" \
        "app/(app)/inventory/repackaging/consolidation-form.tsx"
git commit -m "feat: Consolidation form shows the base selling unit's barcode, not sku"
```

---

### Task 4: Repackaging (Break Pack) form — display the base unit's barcode

**Files:**
- Modify: `app/(app)/inventory/repackaging/use-repackaging-form.ts`
- Modify: `app/(app)/inventory/repackaging/repackaging-form.tsx`
- Test: manual

**Interfaces:**
- Consumes: `searchProducts()`'s new `baseUnitBarcode` field (Task 2).
- Produces: `SearchResult.sku` is removed; `SearchResult.baseUnitBarcode` is added. This is a SEPARATE, independently-declared `SearchResult` type from Task 3's — the two files do not share a type despite being byte-identical duplicates (confirmed during planning) — so this task's changes are self-contained and do not depend on Task 3 having run first.

- [ ] **Step 1: Confirm the current type**

```bash
grep -n "export type SearchResult" "app/(app)/inventory/repackaging/use-repackaging-form.ts"
```

Confirm (already read during planning), at line 12 — identical shape to Task 3's type:
```typescript
export type SearchResult = {
  id: string;
  name: string;
  sku: string;
  barcode: string;
  stock: number;
  unitOfMeasure: string;
  price: number;
  cost?: number;
  conversionFactors?: { unit: string; factor: number }[];
};
```

- [ ] **Step 2: Update the type**

Same replacement as Task 3 Step 2, applied to this file's own copy of the type:

```typescript
export type SearchResult = {
  id: string;
  name: string;
  barcode: string;
  baseUnitBarcode: string | null;
  stock: number;
  unitOfMeasure: string;
  price: number;
  cost?: number;
  conversionFactors?: { unit: string; factor: number }[];
};
```

- [ ] **Step 3: Confirm the four display sites in `repackaging-form.tsx`**

```bash
grep -n "p.sku\|selectedSource.sku\|selectedTarget.sku" "app/(app)/inventory/repackaging/repackaging-form.tsx"
```

Confirm all four (already read during planning):

Line 107 (source search result row):
```tsx
                        <p className="text-sm text-muted-foreground">{p.sku} · Stock: {formatQuantity(p.stock)} {p.unitOfMeasure}</p>
```

Line 120 (selected source summary):
```tsx
                      <p className="text-sm text-muted-foreground">{selectedSource.sku}</p>
```

Line 209 (target search result row):
```tsx
                            <p className="text-sm text-muted-foreground">{p.sku} · {p.unitOfMeasure}</p>
```

Line 221 (selected target summary):
```tsx
                        <p className="text-sm text-muted-foreground">{selectedTarget.sku} · {selectedTarget.unitOfMeasure}</p>
```

- [ ] **Step 4: Replace all four**

Replace line 107:
```tsx
                        <p className="text-sm text-muted-foreground">{p.sku} · Stock: {formatQuantity(p.stock)} {p.unitOfMeasure}</p>
```
with:
```tsx
                        <p className="text-sm text-muted-foreground">{p.baseUnitBarcode || p.barcode} · Stock: {formatQuantity(p.stock)} {p.unitOfMeasure}</p>
```

Replace line 120:
```tsx
                      <p className="text-sm text-muted-foreground">{selectedSource.sku}</p>
```
with:
```tsx
                      <p className="text-sm text-muted-foreground">{selectedSource.baseUnitBarcode || selectedSource.barcode}</p>
```

Replace line 209:
```tsx
                            <p className="text-sm text-muted-foreground">{p.sku} · {p.unitOfMeasure}</p>
```
with:
```tsx
                            <p className="text-sm text-muted-foreground">{p.baseUnitBarcode || p.barcode} · {p.unitOfMeasure}</p>
```

Replace line 221:
```tsx
                        <p className="text-sm text-muted-foreground">{selectedTarget.sku} · {selectedTarget.unitOfMeasure}</p>
```
with:
```tsx
                        <p className="text-sm text-muted-foreground">{selectedTarget.baseUnitBarcode || selectedTarget.barcode} · {selectedTarget.unitOfMeasure}</p>
```

(Same bare-no-`|| ''` reasoning as Task 3 Step 4 — this site's original convention had no further fallback beyond the raw field.)

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit -p . 2>&1 | wc -l
```

Expected: 14, unchanged.

- [ ] **Step 6: Manual verification**

Run `npm run dev`, open `/inventory/repackaging` → Break Pack tab. Search for a product, confirm the search results show a barcode-looking value instead of a SKU-looking value. Select a source, confirm the summary shows the same. Move to Step 2 (target), repeat.

- [ ] **Step 7: Commit**

```bash
git add "app/(app)/inventory/repackaging/use-repackaging-form.ts" \
        "app/(app)/inventory/repackaging/repackaging-form.tsx"
git commit -m "feat: Repackaging (Break Pack) form shows the base selling unit's barcode, not sku"
```

---

### Task 5: Break Pack dialog — display the base unit's barcode

**Files:**
- Modify: `app/(app)/products/break-pack/use-break-pack.ts`
- Modify: `app/(app)/products/break-pack/break-pack-dialog.tsx`
- Test: manual

**Interfaces:**
- Consumes: `searchProducts()`'s new `baseUnitBarcode` field (Task 2).
- Produces: `SearchResult.sku` is removed; `SearchResult.baseUnitBarcode` is added. This is a THIRD, independently-declared `SearchResult` type (confirmed during planning — a different shape from Tasks 3-4's types: it has `parentId`/`conversionFactor` instead of `conversionFactors`/`price`/`cost`), self-contained, no dependency on Tasks 3-4.

- [ ] **Step 1: Confirm the current type**

```bash
grep -n "export type SearchResult" "app/(app)/products/break-pack/use-break-pack.ts"
```

Confirm (already read during planning), at line 13:
```typescript
export type SearchResult = {
  id: string;
  name: string;
  sku: string;
  barcode: string;
  stock: number;
  unitOfMeasure: string;
  parentId: string | null;
  conversionFactor: number;
};
```

- [ ] **Step 2: Update the type**

Replace:
```typescript
export type SearchResult = {
  id: string;
  name: string;
  sku: string;
  barcode: string;
  stock: number;
  unitOfMeasure: string;
  parentId: string | null;
  conversionFactor: number;
};
```

with:
```typescript
export type SearchResult = {
  id: string;
  name: string;
  barcode: string;
  baseUnitBarcode: string | null;
  stock: number;
  unitOfMeasure: string;
  parentId: string | null;
  conversionFactor: number;
};
```

- [ ] **Step 3: Confirm the one display site in `break-pack-dialog.tsx`**

```bash
grep -n "p.sku" "app/(app)/products/break-pack/break-pack-dialog.tsx"
```

Confirm (already read during planning), at line 182:
```tsx
                              <p className="text-xs text-muted-foreground">{p.sku} · {p.unitOfMeasure}</p>
```

- [ ] **Step 4: Replace it**

Replace:
```tsx
                              <p className="text-xs text-muted-foreground">{p.sku} · {p.unitOfMeasure}</p>
```

with:
```tsx
                              <p className="text-xs text-muted-foreground">{p.baseUnitBarcode || p.barcode} · {p.unitOfMeasure}</p>
```

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit -p . 2>&1 | wc -l
```

Expected: 14, unchanged.

- [ ] **Step 6: Manual verification**

Run `npm run dev`, open `/products`, click a standard product's row to open the View Product dialog (`app/(app)/products/view-product/view-product-dialog.tsx`), and use the "Break this pack into smaller units" button in its footer (confirmed during planning: `view-product-dialog.tsx:274` renders `<BreakPackDialog parentProduct={product} ...>`). Search for a target product in the dialog, confirm the search results show a barcode-looking value instead of a SKU-looking value.

- [ ] **Step 7: Commit**

```bash
git add "app/(app)/products/break-pack/use-break-pack.ts" \
        "app/(app)/products/break-pack/break-pack-dialog.tsx"
git commit -m "feat: Break Pack dialog shows the base selling unit's barcode, not sku"
```

---

### Task 6: Stock Transfer dialog — display the base unit's barcode

**Files:**
- Modify: `app/(app)/inventory/stock-transfer-dialog/StockTransferDialog.tsx`
- Test: manual

**Interfaces:**
- Consumes: `lib/types.ts`'s `Product.sellingUnits` (already typed; this file's `product` prop is typed `Product` directly, confirmed during planning — the only file in this whole cluster that already had this available, since it's unrelated to the `searchProducts()` path Tasks 2-5 fix).
- Produces: nothing new exposed.

- [ ] **Step 1: Confirm the current lines**

```bash
grep -n "SKU / Barcode\|product.sku || product.barcode" "app/(app)/inventory/stock-transfer-dialog/StockTransferDialog.tsx"
```

Confirm (already read during planning), lines 83-84:
```tsx
                <span className="text-muted-foreground">SKU / Barcode:</span>
                <span>{product.sku || product.barcode || 'N/A'}</span>
```

- [ ] **Step 2: Replace the label and value**

Replace:
```tsx
                <span className="text-muted-foreground">SKU / Barcode:</span>
                <span>{product.sku || product.barcode || 'N/A'}</span>
```

with:
```tsx
                <span className="text-muted-foreground">Barcode:</span>
                <span>{product.sellingUnits?.find((su) => su.isBase)?.barcode || product.barcode || 'N/A'}</span>
```

(This site's original convention already had a final `|| 'N/A'` terminator — keep it. Base-unit lookup inserted first, `sku` dropped entirely from the chain, legacy `barcode` and the `'N/A'` terminator both preserved in their original positions.)

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit -p . 2>&1 | wc -l
```

Expected: 14, unchanged.

- [ ] **Step 4: Manual verification**

Run `npm run dev`, open `/inventory`, open any product row's actions menu (the `⋮` / row-actions dropdown rendered by `ProductRowActions.tsx`) and choose "Transfer Stock" (confirmed during planning: `ProductRowActions.tsx:52-54` renders this menu item, which opens `StockTransferDialog`). Confirm the dialog shows a "Barcode:" label (not "SKU / Barcode:") with a barcode-looking value.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/inventory/stock-transfer-dialog/StockTransferDialog.tsx"
git commit -m "feat: Stock Transfer dialog shows the base selling unit's barcode, not sku"
```

---

### Task 7: Full regression pass

**Files:** none (verification only)

**Interfaces:** none.

- [ ] **Step 1: Full typecheck**

```bash
npx tsc --noEmit -p . 2>&1 | wc -l
```

Expected: 14 — same baseline as before Task 1. Never higher.

- [ ] **Step 2: Confirm no leftover `.sku` reference in any file this plan touched**

```bash
grep -rn "\.sku\b" "app/(app)/inventory/repackaging/actions.ts" \
                    "app/(app)/products/actions.ts" \
                    "app/(app)/inventory/repackaging/use-consolidation-form.ts" \
                    "app/(app)/inventory/repackaging/consolidation-form.tsx" \
                    "app/(app)/inventory/repackaging/use-repackaging-form.ts" \
                    "app/(app)/inventory/repackaging/repackaging-form.tsx" \
                    "app/(app)/products/break-pack/use-break-pack.ts" \
                    "app/(app)/products/break-pack/break-pack-dialog.tsx" \
                    "app/(app)/inventory/stock-transfer-dialog/StockTransferDialog.tsx"
```

Expected: no matches in any file OTHER than `app/(app)/products/actions.ts`, where `searchProducts`'s SQL still selects `p.sku` and its mapper still returns a `sku` field (deliberately kept per Task 2 Step 3's own note — nothing displays it, and Sub-project D's final cleanup is the point where reading `products.sku` anywhere finally goes away, not this plan).

```bash
grep -n "\.sku\b\|p.sku\|r.sku\|sku:" "app/(app)/products/actions.ts" | grep -i "searchProducts\|sku: r.sku\|p.sku"
```

Confirm the ONLY remaining `sku` references in `searchProducts` are the SQL column `p.sku` and the mapper's `sku: r.sku` — both deliberately retained, not read by any of this cluster's display sites.

- [ ] **Step 3: Confirm the two other product-read paths were not touched**

```bash
git diff main --stat -- "app/(app)/products/actions.ts" | grep -c "getProducts\|MySqlProductRepository"
```

(This is a sanity check that no accidental edit landed inside `getProducts` while working in the same file as `searchProducts` — expected output is empty/0, since `git diff --stat` doesn't list function names; if this check feels inconclusive, instead manually confirm via `git diff main -- "app/(app)/products/actions.ts"` that the diff's hunks are confined to the `searchProducts` function body, matching exactly Task 2's Steps 2-3.)

```bash
ls "src/infrastructure/repositories/MySqlProductRepository.ts" && git diff main --stat -- "src/infrastructure/repositories/MySqlProductRepository.ts"
```

Expected: this file shows NO changes — this plan never touches it.

- [ ] **Step 4: Manual end-to-end walkthrough with a real divergence**

Using the same technique as Clusters 1-3 (deliberately edit ONLY a dev-DB product's base selling unit barcode, leaving `products.sku`/`products.barcode` untouched):

```sql
UPDATE product_selling_units
SET barcode = 'TESTBARCODE995'
WHERE product_id = '<a standard product id>' AND is_base = 1;
```

1. `/inventory/repackaging` → Break Pack tab: search for the product, confirm the result and the selected-source summary show `TESTBARCODE995`.
2. `/inventory/repackaging` → Pack → Bulk Consolidation tab: same two checks.
3. View Product dialog's "Break this pack into smaller units" button (Task 5's confirmed trigger): search for the product as a target, confirm `TESTBARCODE995` appears.
4. `/inventory` row actions → "Transfer Stock" (Task 6's confirmed trigger): confirm the "Barcode:" field shows `TESTBARCODE995`.
5. `/inventory/repackaging` → History tab: this tab never displayed `sourceSku`/`targetSku` before or after this plan (confirmed in Task 1), so there is nothing new to visually check here — Task 1's own direct-query verification already covers this query's correctness.
6. Revert the test value afterward:

```sql
UPDATE product_selling_units
SET barcode = '<original value>'
WHERE product_id = '<the id>' AND is_base = 1;
```

- [ ] **Step 5: No commit for this task** (verification only — if any step fails, return to the relevant task above and fix before proceeding)
