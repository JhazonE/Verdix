# Retire products.sku — Cluster 2: Products + Inventory Listing Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate the Products and Inventory listing pages' duplicate "SKU" + "Barcode" display into a single "Barcode" column/line that reads the base selling unit's barcode first, and replace `use-inventory-page.ts`'s hand-rolled `sku`-based client-side filter and sort key with the shared matcher already built for this purpose.

**Architecture:** Every touched display site changes from `product.sku` (or a `"SKU: {sku}"` label pair with `product.barcode`) to `product.sellingUnits?.find(su => su.isBase)?.barcode || product.barcode || ''` (or the site's existing null-handling idiom), matching the pattern Cluster 1 already established in `lib/product-search.ts` and the POS files. `use-inventory-page.ts`'s inline `matches()` function is replaced with `lib/product-search.ts`'s `matchesNormalizedSearch` (with `normalizeSearchTerm` hoisted out of the filter loop, the convention every other call site in this codebase already uses) — the same shared matcher Cluster 1 fixed — rather than hand-maintaining a second, now-diverging copy of the same logic; its `sortBy: 'sku'` state value and label are renamed to `'barcode'`, and the comparator reads the same base-unit-barcode chain (`??` to `''` for `localeCompare`'s tolerance of empty strings, since a service product has no selling units).

**Tech Stack:** Next.js 16 App Router, React, TypeScript, `tests/unit/run.ts` (plain assert-based unit tests, no framework), no e2e coverage of these pages.

**Spec:** `docs/superpowers/specs/2026-09-22-retire-sku-search-pos-inventory-design.md` (Cluster 2 section; this plan implements only Cluster 2 — Clusters 3 and 4 are separate, later plans, already merged Cluster 1 covers `lib/product-search.ts`/POS).

## Global Constraints

- Every touched site reads `product.sellingUnits?.find(su => su.isBase)?.barcode` first, falling back to `product.barcode` (the legacy, non-unique `products.barcode` column — untouched, never the primary source), matching each site's existing null-handling convention (`|| ''`, `|| '-'`, a conditional render, etc.).
- `product.sellingUnits` can be `undefined`/empty for a service product (no selling units) — every new expression must tolerate that without throwing.
- `products.barcode` (legacy column) and `supplier_product_mapping.supplier_sku` are out of scope — do not touch either.
- Both `app/(app)/products/page.tsx` and `app/(app)/inventory/page.tsx` (via `use-inventory-page.ts`) already source their data from the SAME `getProducts` in `app/(app)/products/actions.ts` — confirmed during planning that this function already populates `sellingUnits[].isBase`/`.barcode` (line 395: `isBase: su.is_base === 1`; line 382's SQL select includes `barcode`). There is no product-read-path divergence risk for this plan the way there was for Cluster 1's POS work — do not add a second data-fetching path, do not touch `actions.ts`'s `getProducts` query itself.
- `lib/types.ts`'s `Product.sellingUnits` is already typed (`{ id?, name, factor, barcode?, cost?, price, isBase?, priceLevels? }[]`) — every file in this plan already imports `Product` from `@/lib/types` (confirmed for every file this plan touches), so no new type needs to be declared; the expressions below type-check directly against the existing `Product` type, not an `any`-widened one like Cluster 1's POS files needed.
- Do not touch `app/(app)/inventory/bulk-adjustment/`, `app/(app)/inventory/transfer-board/`, `app/(app)/inventory/shelf-board/`, `app/(app)/inventory/stock-transfer-dialog/`, or `app/(app)/inventory/repackaging/` — those belong to Cluster 3 (boards) and Cluster 4 (repackaging + misc), separate future plans. `app/(app)/inventory/history/actions.ts`'s `p.sku as product_sku` SQL aliases are also out of scope (server-side historical/audit query, not part of this cluster's file list).
- `tests/unit/product-search.test.ts` and `tests/unit/sku.test.ts` are unrelated to this plan's own changes and must keep passing unmodified — this plan does not touch `lib/product-search.ts` itself, only a NEW caller of its existing exports.

---

### Task 1: Consolidate Products page's SKU + Barcode columns

**Files:**
- Modify: `app/(app)/products/page.tsx`
- Test: manual

**Interfaces:**
- Consumes: `lib/types.ts`'s `Product.sellingUnits` (already typed, already imported in this file via `import { Product } from '@/lib/types';`).
- Produces: nothing new exposed — this task only changes JSX inside an existing component.

- [ ] **Step 1: Confirm the current header and cell lines**

```bash
grep -n "hidden md:table-cell.>SKU<\|hidden lg:table-cell.>Barcode<\|product.sku}\|product.barcode}" "app/(app)/products/page.tsx"
```

Confirm these four lines (already read during planning):

Header, lines 858-859:
```tsx
                <TableHead className={cn(HEAD_CLASS, "hidden md:table-cell")}>SKU</TableHead>
                <TableHead className={cn(HEAD_CLASS, "hidden lg:table-cell")}>Barcode</TableHead>
```

Row cells, lines 138-139 (inside the `ProductRow` component):
```tsx
        <TableCell className="hidden md:table-cell">{product.sku}</TableCell>
        <TableCell className="hidden lg:table-cell">{product.barcode}</TableCell>
```

- [ ] **Step 2: Replace the two header cells with one**

Replace:
```tsx
                <TableHead className={cn(HEAD_CLASS, "hidden md:table-cell")}>SKU</TableHead>
                <TableHead className={cn(HEAD_CLASS, "hidden lg:table-cell")}>Barcode</TableHead>
```

with:
```tsx
                <TableHead className={cn(HEAD_CLASS, "hidden md:table-cell")}>Barcode</TableHead>
```

(Keep the `md:table-cell` breakpoint — the wider `lg:table-cell` breakpoint is now unused by this column and is dropped along with the removed header, matching that the two columns are becoming one.)

- [ ] **Step 3: Replace the two row cells with one**

Replace:
```tsx
        <TableCell className="hidden md:table-cell">{product.sku}</TableCell>
        <TableCell className="hidden lg:table-cell">{product.barcode}</TableCell>
```

with:
```tsx
        <TableCell className="hidden md:table-cell">
          {product.sellingUnits?.find((su) => su.isBase)?.barcode || product.barcode}
        </TableCell>
```

(No `|| ''` terminator needed here — this matches the ORIGINAL code's own convention: `{product.sku}` and `{product.barcode}` were rendered bare, with no fallback, and React already renders `undefined` as nothing, same as the original bare `{product.sku}` did when `sku` was falsy. Do not add one — Cluster 1's final review already established adding `|| ''` where the SITE'S OWN prior convention didn't have one is not required; only match what was there.)

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit -p . 2>&1 | wc -l
```

Expected: 14 (this codebase's current baseline as of Cluster 1's merge — confirm by running this once before Step 2's edit too, if not already confirmed clean in this session). No new errors.

- [ ] **Step 5: Manual verification**

Run `npm run dev`, open `/products`. Confirm the table now has a single "Barcode" column (not two), showing a value for standard products with a base selling unit. Confirm the column still hides at the same breakpoint it did before (resize the browser window narrower than `md` and confirm the column disappears, same as the old SKU column did).

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/products/page.tsx"
git commit -m "feat: consolidate Products page's SKU and Barcode columns into one"
```

---

### Task 2: Consolidate Inventory page's table header, ProductTableRowGroup's two rows, and the search placeholder

**Files:**
- Modify: `app/(app)/inventory/page.tsx`
- Modify: `app/(app)/inventory/ProductTableRowGroup.tsx`
- Test: manual

**Interfaces:**
- Consumes: `lib/types.ts`'s `Product.sellingUnits` — `ProductTableRowGroup.tsx` receives `productGroup` typed as `ProductWithChildren` (from `./product-list-types`, which `extends Product`) and iterates `child` typed as `Product` (from that interface's `children?: Product[]`). Both carry `sellingUnits`; confirmed during planning, re-confirmed in Step 1.
- Produces: nothing new exposed.

- [ ] **Step 1: Confirm `ProductWithChildren` extends `Product`**

```bash
grep -n "ProductWithChildren" "app/(app)/inventory/product-list-types.ts"
```

Confirmed during planning — this file reads:

```typescript
import type { Product } from '@/lib/types';

export interface ProductWithChildren extends Product {
  children?: Product[];
  /** Set when the group only surfaced because a child matched the filter. */
  defaultExpanded?: boolean;
}
```

Because it `extends Product`, both `productGroup` (typed `ProductWithChildren`) and `child` (typed `Product`, from `children?: Product[]`) carry `sellingUnits`. This step is a re-confirmation that nothing changed since planning, not an open question. If this file no longer extends `Product`, stop and report it as a blocker — do not proceed by casting to `any`.

- [ ] **Step 2: Confirm the current header line in `page.tsx`**

```bash
grep -n "TableHead>SKU<\|TableHead>Barcode<\|Search products by name or SKU" "app/(app)/inventory/page.tsx"
```

Confirm (already read during planning), inside the `<TableHeader>` block:
```tsx
                <TableHead>SKU</TableHead>
                <TableHead>Barcode</TableHead>
```

and, in the search input above it:
```tsx
            placeholder="Search products by name or SKU..."
```

- [ ] **Step 3: Consolidate the header**

Replace:
```tsx
                <TableHead>SKU</TableHead>
                <TableHead>Barcode</TableHead>
```

with:
```tsx
                <TableHead>Barcode</TableHead>
```

- [ ] **Step 4: Update the search placeholder**

Replace:
```tsx
            placeholder="Search products by name or SKU..."
```

with:
```tsx
            placeholder="Search products by name or barcode..."
```

(This placeholder describes what `handleSearch`/`use-inventory-page.ts`'s `matches()` actually searches — Task 4 of this plan changes that function to search name/barcode instead of name/sku/barcode, so this text must describe the post-Task-4 behavior, not the pre-Task-4 behavior. This task's own product-page and row changes are independent of Task 4, but committing this placeholder text now, ahead of Task 4, would describe an inaccurate interim state for one commit — check `git log --oneline -1` after Task 4 lands before merging if working across multiple sessions; within a single continuous execution this is a non-issue since Task 4 follows shortly after in the same plan.)

- [ ] **Step 5: Confirm the current parent-row and child-row cells in `ProductTableRowGroup.tsx`**

```bash
grep -n "productGroup.sku\|productGroup.barcode\|child.sku\|child.barcode" "app/(app)/inventory/ProductTableRowGroup.tsx"
```

Confirm (already read during planning), lines 59-60 (parent row):
```tsx
        <TableCell>{productGroup.sku}</TableCell>
        <TableCell className="font-mono text-xs">{productGroup.barcode || '-'}</TableCell>
```

and lines 99-100 (child row, inside the `.map((child) => ...)` block):
```tsx
              <TableCell className="text-sm">{child.sku}</TableCell>
              <TableCell className="text-sm font-mono text-xs">{child.barcode || '-'}</TableCell>
```

- [ ] **Step 6: Consolidate the parent row's two cells into one**

Replace:
```tsx
        <TableCell>{productGroup.sku}</TableCell>
        <TableCell className="font-mono text-xs">{productGroup.barcode || '-'}</TableCell>
```

with:
```tsx
        <TableCell className="font-mono text-xs">
          {productGroup.sellingUnits?.find((su) => su.isBase)?.barcode || productGroup.barcode || '-'}
        </TableCell>
```

(This site's existing convention was `|| '-'` on the barcode cell specifically — carry that same `|| '-'` terminator forward, per the Global Constraints' "matching each site's existing null-handling convention" rule. The removed SKU cell had no fallback of its own; the surviving cell's own convention wins.)

- [ ] **Step 7: Consolidate the child row's two cells into one**

Replace:
```tsx
              <TableCell className="text-sm">{child.sku}</TableCell>
              <TableCell className="text-sm font-mono text-xs">{child.barcode || '-'}</TableCell>
```

with:
```tsx
              <TableCell className="text-sm font-mono text-xs">
                {child.sellingUnits?.find((su) => su.isBase)?.barcode || child.barcode || '-'}
              </TableCell>
```

- [ ] **Step 8: Typecheck**

```bash
npx tsc --noEmit -p . 2>&1 | wc -l
```

Expected: 14, unchanged. (`ProductWithChildren extends Product` and `children?: Product[]`, both confirmed in Step 1, so `sellingUnits` type-checks on both the parent and child expressions without a cast.)

- [ ] **Step 9: Manual verification**

Run `npm run dev`, open `/inventory`, switch to list/table view if the page defaults to grid (check the `viewMode` toggle from `use-inventory-page.ts`). Confirm the header shows one "Barcode" column. Confirm a product with extra selling units (if one exists in dev data) expands to show child rows, and each child row also shows one "Barcode" cell, not two. Confirm the search input's placeholder now reads "Search products by name or barcode...".

- [ ] **Step 10: Commit**

```bash
git add "app/(app)/inventory/page.tsx" "app/(app)/inventory/ProductTableRowGroup.tsx"
git commit -m "feat: consolidate Inventory page's table header and row-group SKU/Barcode columns"
```

---

### Task 3: Consolidate ProductCard and CondensedProductRow's SKU/BC lines

**Files:**
- Modify: `app/(app)/inventory/ProductCard.tsx`
- Modify: `app/(app)/inventory/condensed-product-row/CondensedProductRow.tsx`
- Test: manual

**Interfaces:**
- Consumes: `lib/types.ts`'s `Product.sellingUnits` — both files already receive a `product: Product` prop.
- Produces: nothing new exposed.

- [ ] **Step 1: Confirm the current lines in `ProductCard.tsx`**

```bash
grep -n "SKU: {product.sku}\|BC: {product.barcode}" "app/(app)/inventory/ProductCard.tsx"
```

Confirm (already read during planning):
```tsx
            <p className="text-sm text-muted-foreground">SKU: {product.sku}</p>
            {product.barcode && (
              <p className="text-sm text-muted-foreground font-mono">BC: {product.barcode}</p>
            )}
```

- [ ] **Step 2: Replace with one conditional "Barcode:" line**

Replace:
```tsx
            <p className="text-sm text-muted-foreground">SKU: {product.sku}</p>
            {product.barcode && (
              <p className="text-sm text-muted-foreground font-mono">BC: {product.barcode}</p>
            )}
```

with:
```tsx
            {(product.sellingUnits?.find((su) => su.isBase)?.barcode || product.barcode) && (
              <p className="text-sm text-muted-foreground font-mono">
                Barcode: {product.sellingUnits?.find((su) => su.isBase)?.barcode || product.barcode}
              </p>
            )}
```

(The ORIGINAL "SKU:" line was unconditional — always rendered, even when `product.sku` was falsy, showing "SKU: " with nothing after it. The original "BC:" line was conditional on `product.barcode` truthiness. Per the spec's own description — "one conditional 'Barcode:' line" — this task makes the single surviving line conditional, matching the BC line's convention rather than the SKU line's, since a card with neither a base-unit barcode nor a legacy barcode should show nothing here, not an empty "Barcode: " label. This is a deliberate behavior narrowing the spec itself calls for, not an oversight.)

- [ ] **Step 3: Confirm the current line in `CondensedProductRow.tsx`**

```bash
grep -n "SKU: {product.sku}" "app/(app)/inventory/condensed-product-row/CondensedProductRow.tsx"
```

Confirm (already read during planning), line 29-31:
```tsx
        <p className="text-[9px] text-muted-foreground truncate uppercase font-mono">
          SKU: {product.sku} {product.barcode && `| BC: ${product.barcode}`}
        </p>
```

- [ ] **Step 4: Replace with a single "Barcode:" line**

Replace:
```tsx
        <p className="text-[9px] text-muted-foreground truncate uppercase font-mono">
          SKU: {product.sku} {product.barcode && `| BC: ${product.barcode}`}
        </p>
```

with:
```tsx
        <p className="text-[9px] text-muted-foreground truncate uppercase font-mono">
          Barcode: {product.sellingUnits?.find((su) => su.isBase)?.barcode || product.barcode}
        </p>
```

(Same reasoning as Task 1 Step 3 — the original line had no fallback terminator of its own for the leading `SKU: {product.sku}` segment; React renders `undefined` as nothing, so no `|| ''` is needed to avoid a crash. This differs from `ProductCard.tsx`'s Step 2 because THIS site's original line was unconditional/always-rendered — matching the spec's own description of this file's change: "becomes a single 'Barcode: {value}' line," not a conditional one.)

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit -p . 2>&1 | wc -l
```

Expected: 14, unchanged.

- [ ] **Step 6: Manual verification**

Run `npm run dev`, open `/inventory` in grid view — confirm `ProductCard.tsx`'s rendering shows one "Barcode:" line (or none, for a product with neither value) instead of separate "SKU:"/"BC:" lines. If any product in dev data has expandable children rendered via `CondensedProductRow.tsx` (check whichever view mode renders it — confirm by grepping its own usage site if not obvious from the UI), confirm that row also shows "Barcode: {value}" instead of "SKU: {value} | BC: {value}".

```bash
grep -rn "CondensedProductRow" "app/(app)/inventory/" --include="*.tsx" -l
```

- [ ] **Step 7: Commit**

```bash
git add "app/(app)/inventory/ProductCard.tsx" "app/(app)/inventory/condensed-product-row/CondensedProductRow.tsx"
git commit -m "feat: consolidate ProductCard and CondensedProductRow's SKU/BC lines into one Barcode line"
```

---

### Task 4: Replace `use-inventory-page.ts`'s inline sku-based filter with the shared matcher, and rename `sortBy: 'sku'` to `'barcode'`

**Files:**
- Modify: `app/(app)/inventory/use-inventory-page.ts`
- Modify: `app/(app)/inventory/page.tsx`
- Test: manual

**Interfaces:**
- Consumes: `lib/product-search.ts`'s existing `matchesNormalizedSearch(product, normalizedTerm)` and `normalizeSearchTerm(term)` exports (already built and merged by Cluster 1 — signatures unchanged). `Product` (from `lib/types.ts`) structurally satisfies `SearchableProduct` (`name?`, `barcode?`, `sellingUnits?: { isBase?; barcode? }[]`) — no adapter needed. This pairing (hoist `normalizeSearchTerm` out of the loop, then call `matchesNormalizedSearch` per row) is the established convention at all three existing call sites in this codebase — `use-bulk-adjustment.ts:114-115`, `ShelfBoard.tsx:183`, `use-transfer-board.ts:133` — confirmed during planning. Follow it; do not use the `matchesProductSearch` convenience wrapper here, which would re-lowercase the term once per product and diverge from every sibling call site.
- Produces: `useInventoryPage()`'s returned `sortBy` state's type changes from `'name' | 'stock' | 'sku'` to `'name' | 'stock' | 'barcode'`. Any caller reading `sortBy`'s value against the string `'sku'` would break — Step 1 confirms `page.tsx` is the only such caller before this task changes it.

- [ ] **Step 1: Confirm `page.tsx` is the only consumer of `sortBy`'s `'sku'` value**

```bash
grep -rn "'sku'" "app/(app)/inventory/" --include="*.ts" --include="*.tsx"
```

Confirm the only two matches are inside `use-inventory-page.ts` itself (the `useState` type parameter and the comparator's `if (sortBy === 'sku')` check) and `page.tsx`'s `<SelectItem value="sku">SKU</SelectItem>` / the `onValueChange` cast. If any other file matches, stop and report it as a blocker before proceeding — this task's plan assumes exactly these two files reference the `'sku'` sort value.

- [ ] **Step 2: Add the import in `use-inventory-page.ts`**

At the top of `app/(app)/inventory/use-inventory-page.ts`, add:

```typescript
import { matchesNormalizedSearch, normalizeSearchTerm } from '@/lib/product-search';
```

The file's current import block is:

```typescript
import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { useLiveRefresh } from '@/hooks/use-live-refresh';
import type { Product } from '@/lib/types';

import { getProducts } from '../products/actions';
import type { ProductWithChildren } from './product-list-types';
```

Add the new import into the middle group (the `@/`-prefixed block), after the `Product` type import, so the block reads:

```typescript
import { useLiveRefresh } from '@/hooks/use-live-refresh';
import { matchesNormalizedSearch, normalizeSearchTerm } from '@/lib/product-search';
import type { Product } from '@/lib/types';
```

- [ ] **Step 3: Replace the inline `matches` function**

Find:
```typescript
  const products = useMemo(() => {
    const lower = searchTerm.toLowerCase().trim();
    const matches = (p: Product) =>
      (p.name?.toLowerCase() ?? '').includes(lower) ||
      (p.sku?.toLowerCase() ?? '').includes(lower) ||
      (p.barcode?.toLowerCase() ?? '').includes(lower);

    const matchesType = (p: Product) =>
      typeFilter === 'all' || (p.type ?? 'standard') === typeFilter;
```

Replace with:
```typescript
  const products = useMemo(() => {
    // Normalize once rather than re-lowercasing the term for every product on
    // every keystroke. Matching covers the base selling unit's barcode as well
    // as name — see lib/product-search.ts.
    const term = normalizeSearchTerm(searchTerm);

    const matchesType = (p: Product) =>
      typeFilter === 'all' || (p.type ?? 'standard') === typeFilter;
```

(The local `lower` binding is replaced by `term` from the shared `normalizeSearchTerm` — which also trims, where the old `lower` did `.toLowerCase().trim()` inline, so behavior is identical. The local `matches` function is deleted entirely: it was a hand-rolled duplicate of the shared matcher that had drifted, still reading `p.sku`. The hoist-then-match pattern and its explanatory comment match `use-bulk-adjustment.ts:111-115` verbatim in shape.)

- [ ] **Step 4: Update the `.filter()` call to use the new matcher**

Find:
```typescript
    const visible: ProductWithChildren[] = allLoadedProducts
      .filter((p: Product) => (!lower || matches(p)) && matchesType(p))
      .map((p: Product) => ({ ...p, children: [] }));
```

Replace with:
```typescript
    const visible: ProductWithChildren[] = allLoadedProducts
      .filter((p: Product) => matchesNormalizedSearch(p, term) && matchesType(p))
      .map((p: Product) => ({ ...p, children: [] }));
```

(`matchesNormalizedSearch` already returns `true` for an empty term — `if (!normalizedTerm) return true;` is its first line — so the old `!lower ||` short-circuit is redundant and removed; behavior is identical for the empty-search case.)

- [ ] **Step 5: Rename the `sortBy` state's `'sku'` member to `'barcode'` and update its comparator**

Find:
```typescript
  const [sortBy, setSortBy] = useState<'name' | 'stock' | 'sku'>('name');
```

Replace with:
```typescript
  const [sortBy, setSortBy] = useState<'name' | 'stock' | 'barcode'>('name');
```

Find:
```typescript
    visible.sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'stock') return b.stock - a.stock;
      if (sortBy === 'sku') return a.sku.localeCompare(b.sku);
      return 0;
    });
```

Replace with:
```typescript
    visible.sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'stock') return b.stock - a.stock;
      if (sortBy === 'barcode') {
        const aBarcode = a.sellingUnits?.find((su) => su.isBase)?.barcode ?? a.barcode ?? '';
        const bBarcode = b.sellingUnits?.find((su) => su.isBase)?.barcode ?? b.barcode ?? '';
        return aBarcode.localeCompare(bBarcode);
      }
      return 0;
    });
```

(`??` rather than `||` here, per the spec's own explicit instruction: "`a.sellingUnits?.find(su => su.isBase)?.barcode` can be undefined for a service product... `??` to an empty string, matching `localeCompare`'s existing tolerance for empty strings." An empty-string barcode from a base unit that legitimately has one but it's `''` should NOT fall through to `products.barcode` the way `||` would — `??` only falls through on `null`/`undefined`, which is the correct semantic here and differs deliberately from every display site's `||` chain in Tasks 1-3, where `||` is correct because an empty STRING in a display context should also trigger the fallback. A sort comparator has no such display concern.)

- [ ] **Step 6: Update `page.tsx`'s `sortBy` cast and `SelectItem`**

In `app/(app)/inventory/page.tsx`, find:
```tsx
        <Select value={sortBy} onValueChange={(v) => setSortBy(v as 'name' | 'stock' | 'sku')}>
```

Replace with:
```tsx
        <Select value={sortBy} onValueChange={(v) => setSortBy(v as 'name' | 'stock' | 'barcode')}>
```

Find:
```tsx
            <SelectItem value="sku">SKU</SelectItem>
```

Replace with:
```tsx
            <SelectItem value="barcode">Barcode</SelectItem>
```

- [ ] **Step 7: Typecheck**

```bash
npx tsc --noEmit -p . 2>&1 | wc -l
```

Expected: 14, unchanged. If `Product` does not structurally satisfy `SearchableProduct` (e.g. a type mismatch on `sellingUnits`'s element shape), this step is where it surfaces — compare `lib/types.ts`'s `Product.sellingUnits` element type against `lib/product-search.ts`'s `SearchableProduct.sellingUnits` element type (`{ isBase?: boolean; barcode?: string | null }`) before assuming a fix is needed; `Product`'s richer shape (`{ id?, name, factor, barcode?, cost?, price, isBase?, priceLevels? }`) is a structural superset and should satisfy it without changes.

- [ ] **Step 8: Run the unit test suite**

```bash
npm run test:unit
```

Expected: `product-search` (Cluster 1's own test) still passes — this task is a NEW caller of `matchesNormalizedSearch`, not a change to the function itself, so no existing test's assertions are affected. This suite has a known, pre-existing, unrelated crash later in the run at `business-date-lock-lifecycle.test.ts` (confirmed during Cluster 1 as predating that branch, commit `73ae9be`) — that crash is not this task's concern; everything before it in `tests/unit/run.ts`'s import order, including `product-search`, must still show as passing.

- [ ] **Step 9: Manual verification**

Run `npm run dev`, open `/inventory`. Type a product's base-unit barcode (not its name) into the search box — confirm it still finds the product (proves `matchesNormalizedSearch` is wired correctly). Change the sort dropdown to "Barcode" — confirm the list re-sorts (visually spot-check a few rows' barcode values are in ascending order, using the now-consolidated Barcode column from Task 2). Clear the search box — confirm the full list returns (proves the empty-term case still works without the old `!lower ||` guard).

For a real divergence test (optional but recommended, mirrors Cluster 1's approach): using the same technique as Cluster 1's Task 4 (deliberately `UPDATE product_selling_units SET barcode = '<test-value>' WHERE product_id = ? AND is_base = 1` on a dev-DB product, without touching `products.sku`/`products.barcode`), confirm searching for that test value on `/inventory` finds the product, then revert.

- [ ] **Step 10: Commit**

```bash
git add "app/(app)/inventory/use-inventory-page.ts" "app/(app)/inventory/page.tsx"
git commit -m "feat: Inventory page search/sort use the shared matcher and base selling unit barcode"
```

---

### Task 5: Full regression pass

**Files:** none (verification only)

**Interfaces:** none.

- [ ] **Step 1: Full typecheck**

```bash
npx tsc --noEmit -p . 2>&1 | wc -l
```

Expected: 14 — same baseline as before Task 1. Never higher.

- [ ] **Step 2: Full unit test suite**

```bash
npm run test:unit
```

Expected: every test up through `tests/unit/run.ts`'s import order passes, same pre-existing crash point as documented in every prior task — no NEW failures before that point.

- [ ] **Step 3: Confirm no other file was left referencing the old `'sku'` sort value or the removed `matches` function**

```bash
grep -rn "sortBy === 'sku'\|value=\"sku\"\|const matches = " "app/(app)/inventory/"
```

Expected: no matches.

- [ ] **Step 4: Manual end-to-end walkthrough**

1. `/products`: confirm one "Barcode" column, showing the base selling unit's barcode for standard products.
2. `/inventory` grid view: confirm `ProductCard.tsx` shows one conditional "Barcode:" line (Task 3).
3. `/inventory` list/table view: confirm the header has one "Barcode" column (Task 2), and if any product has extra selling units, its expanded child rows also show one "Barcode" cell each (Task 2).
4. `/inventory`: confirm the search placeholder reads "Search products by name or barcode..." (Task 2) and that searching by a base-unit barcode value actually finds the product (Task 4).
5. `/inventory`: confirm the sort dropdown offers "Barcode" (not "SKU") and sorting by it works (Task 4).
6. Using the same `UPDATE product_selling_units SET barcode = 'TESTBARCODE998' WHERE product_id = ? AND is_base = 1` technique from Cluster 1 (pick a different test value than Cluster 1 used, to avoid any confusion with leftover state), confirm on a dev product that: (a) `/products`' Barcode column shows `TESTBARCODE998`, not the product's `sku`/legacy `barcode`; (b) `/inventory`'s Barcode column and card view both show it too; (c) searching `/inventory` for `TESTBARCODE998` finds the product. Revert the test value afterward.

- [ ] **Step 5: No commit for this task** (verification only — if any step fails, return to the relevant task above and fix before proceeding)
