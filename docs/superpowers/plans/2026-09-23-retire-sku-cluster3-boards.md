# Retire products.sku — Cluster 3: Boards (Transfer, Shelf, Bulk Adjustment) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every remaining inline `product.sku` display line and stale "SKU" placeholder/comment across the Transfer Board, Shelf Board, and Bulk Adjustment pages with the base selling unit's barcode, so these three boards no longer reference `products.sku` anywhere in their own code (their client-side *matching* logic was already fixed in Cluster 1 — this cluster is display text and stale documentation only).

**Architecture:** Every touched display site changes from `product.sku` (bare, or `product.barcode || product.sku`) to `product.sellingUnits?.find(su => su.isBase)?.barcode || product.barcode` (with each site's own existing null-handling convention preserved — bare where the original was bare, `||` chain where the original already had one). Two client-side comments that describe *this file's own* `matchesNormalizedSearch` call are corrected to stop claiming SKU matching that Cluster 1 already retired; one comment that correctly describes the *server-side* SQL query (which genuinely still has `p.sku LIKE ?`) is deliberately left alone. Four search placeholders across three files change from "name, SKU or barcode" / "name or SKU" to "name or barcode", since there is conceptually one code now, not two.

**Tech Stack:** Next.js 16 App Router, React, TypeScript, no automated test covers these files' rendering (manual-only, same as Clusters 1 and 2).

**Spec:** `docs/superpowers/specs/2026-09-22-retire-sku-search-pos-inventory-design.md` (Cluster 3 section; this plan implements only Cluster 3 — Cluster 4 is a separate, later plan. Clusters 1 and 2 are already merged.)

## Global Constraints

- Every touched display site reads `product.sellingUnits?.find(su => su.isBase)?.barcode` first, falling back to `product.barcode` (the legacy, non-unique `products.barcode` column — untouched, never the primary source), matching each site's existing null-handling convention. Three of this cluster's five display sites currently render `product.sku` BARE with no fallback at all (`source-pane.tsx`, `ShelfBoard.tsx`, `adjustment-mobile-card.tsx`) — those stay bare (no `|| product.barcode` fallback added beyond the one already-established chain), matching the same "don't add a fallback the original site never had" rule Cluster 1 and 2's final reviews already confirmed is correct. Two sites already have `product.barcode || product.sku` (`adjustment-table-row.tsx`, `search-results-dropdown.tsx`) — those keep their `||` fallback, with the base-unit lookup inserted before the legacy `barcode`.
- `product.sellingUnits` can be `undefined`/empty for a service product (no selling units) — every new expression must tolerate that without throwing.
- `products.barcode` (legacy column) and `supplier_product_mapping.supplier_sku` are out of scope — do not touch either.
- This cluster's client-side *matching* logic (`matchesNormalizedSearch` calls in `use-transfer-board.ts`, `use-shelf-board` logic inside `ShelfBoard.tsx`, and `use-bulk-adjustment.ts`) is ALREADY correct — Cluster 1 fixed `lib/product-search.ts` itself, and every board already calls it. Do not touch the `.filter(i => matchesNormalizedSearch(...))` lines themselves in this plan — only the comments directly above two of them (see Task 2) and the unrelated display/placeholder lines are in scope.
- Two comments describe the *server-side* SQL query used by `buildProductQuery`/the repository's search (`use-transfer-board.ts:95`, `ShelfBoard.tsx:95`, and `use-bulk-adjustment.ts` does not have this specific server-query comment) — these say "the repository already matches name, SKU and barcode" and are accurate today: `getProducts`'s SQL genuinely still has `p.sku LIKE ?` (Sub-project A kept `products.sku` populated as a mirror; Sub-project C/D, not this plan, will eventually touch that SQL). Do NOT edit these two "server already matches" comments — only the *different*, client-side-describing comments in `ShelfBoard.tsx:180` and `use-bulk-adjustment.ts:112` are stale and in scope (see Task 2 for the exact distinction).
- Do not touch `app/(app)/products/`, `app/(app)/inventory/page.tsx`, `app/(app)/inventory/ProductCard.tsx`, `app/(app)/inventory/ProductTableRowGroup.tsx`, `app/(app)/inventory/condensed-product-row/`, or `app/(app)/inventory/use-inventory-page.ts` — those were Cluster 2, already merged.
- Do not touch `app/(app)/inventory/repackaging/`, `app/(app)/inventory/stock-transfer-dialog/`, or `app/(app)/inventory/history/actions.ts` — those belong to Cluster 4, a separate future plan.
- `lib/types.ts`'s `Product.sellingUnits` is already typed (`{ id?, name, factor, barcode?, cost?, price, isBase?, priceLevels? }[]`) — every file this plan touches already imports/receives a full `Product`-typed value (`WarehouseStockItem.product: Product`, `StockItem.product: Product`, `AdjustmentItem.product: Product`, `SearchResultsDropdown`'s `filteredProducts: Product[]`), confirmed during planning. No new type is needed; no cast should be added.

---

### Task 1: Transfer Board — display line and search placeholder

**Files:**
- Modify: `app/(app)/inventory/transfer-board/source-pane.tsx`
- Test: manual

**Interfaces:**
- Consumes: `lib/types.ts`'s `Product.sellingUnits` (already typed; `item.product` is typed `Product` via `WarehouseStockItem` in `./transfer-board-types.ts`, confirmed during planning).
- Produces: nothing new exposed — JSX-only changes.

- [ ] **Step 1: Confirm the current lines**

```bash
grep -n "item.product.sku\|Search name, SKU or barcode" "app/(app)/inventory/transfer-board/source-pane.tsx"
```

Confirm both (already read during planning):

Line 74 (search input placeholder):
```tsx
            placeholder="Search name, SKU or barcode..."
```

Line 115 (source item's identifier line, inside the item list's `.map(...)`):
```tsx
                  <span className="text-[9px] truncate font-mono">{item.product.sku}</span>
```

- [ ] **Step 2: Update the placeholder**

Replace:
```tsx
            placeholder="Search name, SKU or barcode..."
```

with:
```tsx
            placeholder="Search name or barcode..."
```

- [ ] **Step 3: Replace the display line**

Replace:
```tsx
                  <span className="text-[9px] truncate font-mono">{item.product.sku}</span>
```

with:
```tsx
                  <span className="text-[9px] truncate font-mono">
                    {item.product.sellingUnits?.find((su) => su.isBase)?.barcode || item.product.barcode}
                  </span>
```

(No `|| ''` terminator — this site's original line rendered `{item.product.sku}` bare, with no fallback at all. React renders `undefined` as nothing, same as the original did when `sku` was falsy. Match what was there, per the same rule Cluster 1 and 2's final reviews already confirmed.)

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit -p . 2>&1 | wc -l
```

Expected: 14 — this codebase's current baseline as of Cluster 2's merge. No new errors.

- [ ] **Step 5: Manual verification**

Run `npm run dev`, open `/inventory/transfer-board`. Confirm the search input's placeholder now reads "Search name or barcode..." Confirm a source item's identifier line under its name shows a barcode-looking value (not empty, for a standard product with a base selling unit).

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/inventory/transfer-board/source-pane.tsx"
git commit -m "feat: Transfer Board shows the base selling unit's barcode, not sku"
```

---

### Task 2: Shelf Board — display line, search placeholder, and stale client-side-matching comment

**Files:**
- Modify: `app/(app)/inventory/shelf-board/ShelfBoard.tsx`
- Test: manual

**Interfaces:**
- Consumes: `lib/types.ts`'s `Product.sellingUnits` (already typed; `item.product` is typed `Product` via this file's own `StockItem` type, confirmed during planning).
- Produces: nothing new exposed.

- [ ] **Step 1: Confirm the current lines**

```bash
grep -n "item.product.sku\|Search name, SKU or barcode\|name/SKU, so a scanner" "app/(app)/inventory/shelf-board/ShelfBoard.tsx"
```

Confirm all three (already read during planning):

Line 180 (comment directly above this file's own client-side matcher call):
```tsx
    // Normalize once, not per row. Matching covers barcode as well as
    // name/SKU, so a scanner finds the item — see lib/product-search.ts.
```

Line 243 (search input placeholder):
```tsx
                <Input placeholder="Search name, SKU or barcode..." value={sourceSearch} onChange={e => setSourceSearch(e.target.value)} className="h-8 text-sm pr-8" />
```

Line 261 (source item's identifier line):
```tsx
                              <div className="flex items-center gap-1.5 opacity-70"><Badge variant="outline" className="text-[9px] px-1 h-3.5 truncate max-w-[60px]">{item.shelfName}</Badge><span className="text-[9px] truncate font-mono">{item.product.sku}</span></div>
```

**Do NOT touch** the different comment at line 95 (`// has to happen in SQL — the repository already matches name, SKU and barcode.`) — that one describes the server-side query, which genuinely still matches on `sku`, and is out of scope per this plan's Global Constraints.

- [ ] **Step 2: Fix the stale client-side-matching comment**

This comment (line 179-180) describes what THIS FILE's own `matchesNormalizedSearch(i.product, term)` call (a few lines below it) actually matches — and that function no longer reads `sku` as of Cluster 1. Replace:

```tsx
    // Normalize once, not per row. Matching covers barcode as well as
    // name/SKU, so a scanner finds the item — see lib/product-search.ts.
```

with:

```tsx
    // Normalize once, not per row. Matching covers the base selling unit's
    // barcode as well as name, so a scanner finds the item — see
    // lib/product-search.ts.
```

- [ ] **Step 3: Update the placeholder**

Replace:
```tsx
                <Input placeholder="Search name, SKU or barcode..." value={sourceSearch} onChange={e => setSourceSearch(e.target.value)} className="h-8 text-sm pr-8" />
```

with:
```tsx
                <Input placeholder="Search name or barcode..." value={sourceSearch} onChange={e => setSourceSearch(e.target.value)} className="h-8 text-sm pr-8" />
```

- [ ] **Step 4: Replace the display line**

Replace:
```tsx
                              <div className="flex items-center gap-1.5 opacity-70"><Badge variant="outline" className="text-[9px] px-1 h-3.5 truncate max-w-[60px]">{item.shelfName}</Badge><span className="text-[9px] truncate font-mono">{item.product.sku}</span></div>
```

with:
```tsx
                              <div className="flex items-center gap-1.5 opacity-70"><Badge variant="outline" className="text-[9px] px-1 h-3.5 truncate max-w-[60px]">{item.shelfName}</Badge><span className="text-[9px] truncate font-mono">{item.product.sellingUnits?.find((su) => su.isBase)?.barcode || item.product.barcode}</span></div>
```

(Bare, no `|| ''` — same reasoning as Task 1 Step 3. This file's original line had no fallback beyond the bare `sku` reference.)

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit -p . 2>&1 | wc -l
```

Expected: 14, unchanged.

- [ ] **Step 6: Manual verification**

Run `npm run dev`, open `/inventory/shelf-board`. Confirm the search placeholder reads "Search name or barcode..." Confirm a source item shows a barcode-looking value under its shelf badge.

- [ ] **Step 7: Commit**

```bash
git add "app/(app)/inventory/shelf-board/ShelfBoard.tsx"
git commit -m "feat: Shelf Board shows the base selling unit's barcode, not sku"
```

---

### Task 3: Bulk Adjustment — three display sites, search placeholder, and stale comment

**Files:**
- Modify: `app/(app)/inventory/bulk-adjustment/adjustment-mobile-card.tsx`
- Modify: `app/(app)/inventory/bulk-adjustment/adjustment-table-row.tsx`
- Modify: `app/(app)/inventory/bulk-adjustment/search-results-dropdown.tsx`
- Modify: `app/(app)/inventory/bulk-adjustment/use-bulk-adjustment.ts`
- Modify: `app/(app)/inventory/bulk-adjustment/BulkAdjustmentClient.tsx`
- Test: manual

**Interfaces:**
- Consumes: `lib/types.ts`'s `Product.sellingUnits`. `adj.product` is typed `Product` via `AdjustmentItem` in `./constants.ts`; `SearchResultsDropdown`'s `p` is typed `Product` directly (both confirmed during planning).
- Produces: nothing new exposed.

- [ ] **Step 1: Confirm the current line in `adjustment-mobile-card.tsx`**

```bash
grep -n "adj.product.sku" "app/(app)/inventory/bulk-adjustment/adjustment-mobile-card.tsx"
```

Confirm (already read during planning), line 33:
```tsx
            <span className="text-[10px] font-mono bg-muted px-1.5 py-0.5 rounded text-muted-foreground">{adj.product.sku}</span>
```

Replace with:
```tsx
            <span className="text-[10px] font-mono bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
              {adj.product.sellingUnits?.find((su) => su.isBase)?.barcode || adj.product.barcode}
            </span>
```

(Bare, no `|| ''` — this site's original was bare, same rule as Tasks 1-2.)

- [ ] **Step 2: Confirm and replace the current line in `adjustment-table-row.tsx`**

```bash
grep -n "adj.product.barcode || adj.product.sku" "app/(app)/inventory/bulk-adjustment/adjustment-table-row.tsx"
```

Confirm (already read during planning), line 35:
```tsx
            <span className="text-[10px] font-mono bg-muted px-1.5 py-0.5 rounded text-muted-foreground">{adj.product.barcode || adj.product.sku}</span>
```

Replace with:
```tsx
            <span className="text-[10px] font-mono bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
              {adj.product.sellingUnits?.find((su) => su.isBase)?.barcode || adj.product.barcode}
            </span>
```

(This site's original already had `adj.product.barcode || adj.product.sku` — an `||` chain, unlike Task 3 Step 1's bare version in the sibling mobile-card file. The base-unit lookup is inserted BEFORE the legacy `adj.product.barcode`, and `sku` is dropped from the end of the chain entirely — not kept as a further fallback. This is the same "insert base-unit-first, drop sku, keep the legacy fallback that was already there" pattern Cluster 1's POS display sites used.)

- [ ] **Step 3: Confirm and replace the current line in `search-results-dropdown.tsx`**

```bash
grep -n "p.barcode || p.sku" "app/(app)/inventory/bulk-adjustment/search-results-dropdown.tsx"
```

Confirm (already read during planning), line 42:
```tsx
                <p className="text-xs text-muted-foreground font-mono">{p.barcode || p.sku}</p>
```

Replace with:
```tsx
                <p className="text-xs text-muted-foreground font-mono">
                  {p.sellingUnits?.find((su) => su.isBase)?.barcode || p.barcode}
                </p>
```

- [ ] **Step 4: Fix the stale client-side-matching comment in `use-bulk-adjustment.ts`**

```bash
grep -n "Matching covers barcode as well as name/SKU" "app/(app)/inventory/bulk-adjustment/use-bulk-adjustment.ts"
```

Confirm (already read during planning), lines 111-113 — this comment describes THIS FILE's own `matchesNormalizedSearch(p, term)` call two lines below it (unlike `use-transfer-board.ts`'s comment, which this plan does NOT touch, because that one describes the server-side query):

```tsx
    // Normalize once rather than re-lowercasing the term for every product on
    // every keystroke. Matching covers barcode as well as name/SKU, so a
    // scanner finds the item — see lib/product-search.ts.
```

Replace with:

```tsx
    // Normalize once rather than re-lowercasing the term for every product on
    // every keystroke. Matching covers the base selling unit's barcode as
    // well as name — see lib/product-search.ts.
```

- [ ] **Step 5: Update the search placeholder in `BulkAdjustmentClient.tsx`**

```bash
grep -n "Search products by name or SKU" "app/(app)/inventory/bulk-adjustment/BulkAdjustmentClient.tsx"
```

Confirm (already read during planning), line 101:
```tsx
                    placeholder="Search products by name or SKU..."
```

Replace with:
```tsx
                    placeholder="Search products by name or barcode..."
```

(A second placeholder in this same file, `"Search products..."` at ~line 212, does not mention SKU and is unrelated — do not touch it.)

- [ ] **Step 6: Typecheck**

```bash
npx tsc --noEmit -p . 2>&1 | wc -l
```

Expected: 14, unchanged.

- [ ] **Step 7: Manual verification**

Run `npm run dev`, open `/inventory/bulk-adjustment`. Confirm the top search placeholder reads "Search products by name or barcode...". Search for a product and add it — confirm the added item shows a barcode-looking value in both the desktop table row and (resize to mobile width, or use browser dev tools' device toolbar) the mobile card. Confirm the search-results dropdown itself (before adding) also shows a barcode-looking value under each candidate's name.

- [ ] **Step 8: Commit**

```bash
git add "app/(app)/inventory/bulk-adjustment/adjustment-mobile-card.tsx" \
        "app/(app)/inventory/bulk-adjustment/adjustment-table-row.tsx" \
        "app/(app)/inventory/bulk-adjustment/search-results-dropdown.tsx" \
        "app/(app)/inventory/bulk-adjustment/use-bulk-adjustment.ts" \
        "app/(app)/inventory/bulk-adjustment/BulkAdjustmentClient.tsx"
git commit -m "feat: Bulk Adjustment shows the base selling unit's barcode, not sku"
```

---

### Task 4: Full regression pass

**Files:** none (verification only)

**Interfaces:** none.

- [ ] **Step 1: Full typecheck**

```bash
npx tsc --noEmit -p . 2>&1 | wc -l
```

Expected: 14 — same baseline as before Task 1. Never higher.

- [ ] **Step 2: Confirm no leftover `.sku` reference in any file this plan touched**

```bash
grep -rn "\.sku\b" "app/(app)/inventory/transfer-board/source-pane.tsx" \
                    "app/(app)/inventory/shelf-board/ShelfBoard.tsx" \
                    "app/(app)/inventory/bulk-adjustment/adjustment-mobile-card.tsx" \
                    "app/(app)/inventory/bulk-adjustment/adjustment-table-row.tsx" \
                    "app/(app)/inventory/bulk-adjustment/search-results-dropdown.tsx" \
                    "app/(app)/inventory/bulk-adjustment/use-bulk-adjustment.ts" \
                    "app/(app)/inventory/bulk-adjustment/BulkAdjustmentClient.tsx"
```

Expected: no matches.

- [ ] **Step 3: Confirm the two deliberately-untouched "server already matches" comments are still intact**

```bash
grep -n "repository already matches name, SKU and barcode" \
  "app/(app)/inventory/transfer-board/use-transfer-board.ts" \
  "app/(app)/inventory/shelf-board/ShelfBoard.tsx"
```

Expected: both still show this exact text — confirms this plan did not accidentally touch the server-query comments it was told to leave alone.

- [ ] **Step 4: Manual end-to-end walkthrough with a real divergence**

Using the same technique as Clusters 1 and 2 (deliberately edit ONLY a dev-DB product's base selling unit barcode, leaving `products.sku`/`products.barcode` untouched, to prove the UI reads the intended column rather than one that merely happens to agree today):

```sql
UPDATE product_selling_units
SET barcode = 'TESTBARCODE997'
WHERE product_id = '<a standard product id>' AND is_base = 1;
```

1. `/inventory/transfer-board`: confirm the source item list shows `TESTBARCODE997` for that product, and that typing `TESTBARCODE997` (or part of it) into the search box finds it (this exercises the server-side query via `buildProductQuery`, unaffected by this plan, but confirms the end-to-end path still works).
2. `/inventory/shelf-board`: same two checks.
3. `/inventory/bulk-adjustment`: search for the product, confirm the dropdown shows `TESTBARCODE997`; add it, confirm both the desktop table row and mobile card show `TESTBARCODE997`.
4. Revert the test value afterward:

```sql
UPDATE product_selling_units
SET barcode = '<original value>'
WHERE product_id = '<the id>' AND is_base = 1;
```

- [ ] **Step 5: No commit for this task** (verification only — if any step fails, return to the relevant task above and fix before proceeding)
