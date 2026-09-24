# Retire products.sku — Cluster 1: Shared Search Helper + POS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the shared client-side product matcher and POS's own search/ranking/display logic read the base selling unit's barcode directly instead of the mirrored `products.sku` field, so this codebase's highest-risk, cashier-facing search paths no longer depend on a value Sub-project D's final cleanup will eventually remove.

**Architecture:** `lib/product-search.ts`'s `SearchableProduct` type gains an optional `sellingUnits` field and a new match branch checks the base unit's barcode there. `use-pos.ts`'s `rankMatches`/`matchesProductOrUnitCode` get the same explicit base-unit-barcode check, promoted to the "exact code" tier the extras-only check already has. Four display-only POS files swap their `.sku` fallback for the base-unit-barcode-first chain — except `SaleDetailView.tsx`, which reads a historical sale-line snapshot proven (by reading its populating API route) to carry no `sellingUnits` at all, so it is explicitly left unchanged, not force-fit into the pattern.

**Tech Stack:** Next.js 16 App Router, React, TypeScript, `tests/unit/run.ts` (plain assert-based unit tests, no framework), Playwright e2e (not touched by this plan).

**Spec:** `docs/superpowers/specs/2026-09-22-retire-sku-search-pos-inventory-design.md` (Cluster 1 section; this plan implements only Cluster 1 of that spec's four clusters — Clusters 2–4 are separate, later plans).

## Global Constraints

- Every site this plan touches must read `product.sellingUnits?.find(su => su.isBase)?.barcode` first, falling back to `product.barcode` (the legacy, non-unique `products.barcode` column — untouched, never the primary source), matching each site's existing null-handling convention (`|| ''`, `|| '-'`, etc.).
- `product.sellingUnits` can be `undefined`/empty for a service product (no selling units) — every new expression must tolerate that without throwing.
- `products.barcode` (legacy column) and `supplier_product_mapping.supplier_sku` are out of scope — do not touch either.
- The server-side `getProducts` SQL query in `app/(app)/products/actions.ts` already matches the base unit's barcode via an `EXISTS` subquery — do not touch that query; this plan is entirely about client-side re-filtering and display.
- `SaleDetailView.tsx` reads a **historical** sale-line snapshot (`app/api/pos/recent-sales/route.ts`'s `items.map(...)` at line ~181) that is confirmed by direct inspection to carry `{ id, name, sku, barcode, price, unitOfMeasure, taxType }` with **no `sellingUnits` field** — this plan does not change that file. A future sub-project may decide to add `sellingUnits` to that API response; this plan does not do that.
- `tests/unit/sku.test.ts` (tests `lib/sku.ts`'s `generateSku`, a separate, still-in-repo function per Sub-project A) is unrelated and must keep passing unmodified.

---

### Task 1: `lib/product-search.ts` reads the base unit's barcode

**Files:**
- Modify: `lib/product-search.ts`
- Modify: `tests/unit/product-search.test.ts`
- Test: `npm run test:unit` (runs the whole suite; this task's own assertions are in `product-search.test.ts`)

**Interfaces:**
- Consumes: nothing new — this is the first task.
- Produces: `SearchableProduct` type gains `sellingUnits?: { isBase?: boolean; barcode?: string | null }[] | null`. `matchesNormalizedSearch(product, normalizedTerm)` and `matchesProductSearch(product, term)` keep their exact existing signatures (no breaking change for callers), but their match logic now also checks the base unit's barcode. Later tasks (Task 3, and Cluster 3's separate plan) rely on this updated `SearchableProduct` shape and the new match branch.

- [ ] **Step 1: Read the current file**

```bash
cat lib/product-search.ts
```

Confirm it matches what's shown below (already read during planning — reconfirm nothing has changed):

```typescript
type SearchableProduct = {
    name?: string | null;
    sku?: string | null;
    barcode?: string | null;
};

export function matchesNormalizedSearch(
    product: SearchableProduct | null | undefined,
    normalizedTerm: string
): boolean {
    if (!normalizedTerm) return true;
    if (!product) return false;

    return (
        (product.name?.toLowerCase() ?? '').includes(normalizedTerm) ||
        (product.sku?.toLowerCase() ?? '').includes(normalizedTerm) ||
        (product.barcode?.toLowerCase() ?? '').includes(normalizedTerm)
    );
}
```

- [ ] **Step 2: Update the type and the matcher**

Replace the `SearchableProduct` type:

```typescript
type SearchableProduct = {
    name?: string | null;
    barcode?: string | null;
    /**
     * The base selling unit's own barcode is the real identifier now (see
     * docs/superpowers/specs/2026-09-22-retire-sku-search-pos-inventory-design.md)
     * — `sku` is retired from this matcher's own vocabulary. `barcode` above
     * stays as the legacy `products.barcode` column fallback only; it is
     * never the primary source once a caller supplies `sellingUnits`.
     */
    sellingUnits?: { isBase?: boolean; barcode?: string | null }[] | null;
};
```

Note: `sku` is removed from the type entirely, not kept-but-unused — no caller after this task passes a `sku` field to this matcher, and keeping a dead field on the type would misrepresent what this function actually reads.

Replace `matchesNormalizedSearch`:

```typescript
export function matchesNormalizedSearch(
    product: SearchableProduct | null | undefined,
    normalizedTerm: string
): boolean {
    if (!normalizedTerm) return true;
    if (!product) return false;

    const baseUnitBarcode = product.sellingUnits?.find(su => su.isBase)?.barcode ?? '';

    return (
        (product.name?.toLowerCase() ?? '').includes(normalizedTerm) ||
        (product.barcode?.toLowerCase() ?? '').includes(normalizedTerm) ||
        baseUnitBarcode.toLowerCase().includes(normalizedTerm)
    );
}
```

`matchesProductSearch` is unchanged — it already just calls `matchesNormalizedSearch(product, normalizeSearchTerm(term))`.

- [ ] **Step 3: Update the file's own top-of-file doc comment**

The comment block at the top of the file currently says:

```
 * Transfer Board, Shelf Board and Bulk Adjustment each carried their own
 * inline `name || sku` filter, so scanning a barcode matched nothing even
```

This describes the *history* of why this file exists (accurate, don't rewrite it), but leave it as-is — it is retrospective ("carried their own inline filter... they now share this one matcher"), not a claim about current behavior. Do not edit this comment; only the type and function bodies change in this task.

- [ ] **Step 4: Update the existing test file**

Read the current test file:

```bash
cat tests/unit/product-search.test.ts
```

Replace the fixture and the `sku`-specific assertions. The current fixture:

```typescript
const product: any = {
  name: 'Chubby Funmix 40pcs',
  sku: 'BRD-CHU-4OVDCP',
  barcode: '4800103343532',
};
```

becomes:

```typescript
const product: any = {
  name: 'Chubby Funmix 40pcs',
  barcode: '4800103343532',
  sellingUnits: [{ isBase: true, barcode: '4800103343532' }],
};
```

(the base unit's barcode and the legacy `barcode` field carry the same value here deliberately, so the existing assertions that search for `'4800103343532'` keep passing without having to distinguish which field satisfied them — Step 5 below adds a NEW assertion that tests the two fields independently.)

Replace these two existing assertions:

```typescript
assert.equal(matchesProductSearch(product, 'BRD-CHU'), true, 'sku still matches');
...
assert.equal(
  matchesProductSearch(product, 'brd-chu'),
  true,
  'sku matching is case-insensitive too',
);
```

Delete both — there is no `sku` field on the fixture anymore for these to test, and this matcher no longer has an `sku`-matching behavior to assert.

Keep every other existing assertion in the file exactly as-is (the barcode-matches, name-matches, whitespace-trimming, empty-term, and missing-fields assertions all still apply unchanged, since `product.barcode` — the legacy field — is untouched and the fixture's `barcode` value is unchanged).

- [ ] **Step 5: Add a new assertion proving base-unit-barcode-only matching works**

Add this block after the existing "barcode matches" assertions (near the top of the file, after the `matchesProductSearch(product, '48001033')` assertion):

```typescript
// ─── base unit barcode matches even with no legacy barcode field ────────
const productWithOnlyBaseUnitBarcode: any = {
  name: 'No Legacy Barcode Item',
  sellingUnits: [{ isBase: true, barcode: '1234567890123' }],
};
assert.equal(
  matchesProductSearch(productWithOnlyBaseUnitBarcode, '1234567890123'),
  true,
  'a product with only a base selling unit barcode (no legacy products.barcode) still matches',
);
assert.equal(
  matchesProductSearch(productWithOnlyBaseUnitBarcode, '9999999999999'),
  false,
  'an unrelated code does not match the base unit barcode either',
);

// ─── a non-base extra unit's barcode is NOT matched by this function ────
// matchesNormalizedSearch only checks the BASE unit — an extra unit's own
// barcode is deliberately out of scope here (callers that need to match
// extras do so themselves, e.g. use-pos.ts's own unitBarcodeMatch check).
const productWithOnlyExtraUnitBarcode: any = {
  name: 'Extra Unit Only Item',
  sellingUnits: [
    { isBase: true, barcode: '' },
    { isBase: false, barcode: '5555555555555' },
  ],
};
assert.equal(
  matchesProductSearch(productWithOnlyExtraUnitBarcode, '5555555555555'),
  false,
  'an extra (non-base) selling unit barcode is not matched by this shared helper',
);
```

- [ ] **Step 6: Run the unit test suite**

```bash
npm run test:unit
```

Expected: every test passes, including the updated `product-search.test.ts`'s new assertions. If any OTHER test file fails, stop and investigate before proceeding — this task should not break any test outside `product-search.test.ts`.

- [ ] **Step 7: Typecheck**

```bash
npx tsc --noEmit -p . 2>&1 | wc -l
```

Expected: 14 (the pre-existing baseline — confirm by running this before Step 2's edit too, if not already confirmed clean in this session). No new errors.

- [ ] **Step 8: Commit**

```bash
git add lib/product-search.ts tests/unit/product-search.test.ts
git commit -m "feat: lib/product-search.ts matches the base selling unit's barcode, not sku"
```

---

### Task 2: `use-pos.ts` matches the base unit's barcode as an exact-code hit

**Files:**
- Modify: `app/(app)/pos/pos-content/use-pos.ts`
- Test: manual (no unit test covers this file's ranking logic directly — see Global Constraints)

**Interfaces:**
- Consumes: nothing new from Task 1 (this file does not import `lib/product-search.ts` — it has its own inline `rankMatches`/`matchesProductOrUnitCode`, confirmed by reading the file during planning).
- Produces: `rankMatches` and `matchesProductOrUnitCode` both gain a base-unit-barcode check in their "exact code" tier. No exported signature changes — both remain internal to this file's hook.

- [ ] **Step 1: Locate and confirm the current `rankMatches`**

```bash
grep -n "const rankMatches" "app/(app)/pos/pos-content/use-pos.ts"
```

Confirm the body matches (already read during planning):

```typescript
  const rankMatches = (list: any[], q: string, limit: number): any[] => {
    const exactCode: any[] = [];
    const exactName: any[] = [];
    const partial: any[] = [];
    const seen = new Set<string>();
    for (const p of list) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      const sku = (p.sku || '').toLowerCase();
      const barcode = (p.barcode || '').toLowerCase();
      const name = (p.name || '').toLowerCase();
      const unitBarcodeMatch = (p.sellingUnits || []).some((u: any) => !u.isBase && (u.barcode || '').toLowerCase() === q);
      if (sku === q || barcode === q || unitBarcodeMatch) exactCode.push(p);
      else if (name === q) exactName.push(p);
      // Fuzzy/partial matching stays product-name/SKU/barcode only — matching
      // partial text against every unit's barcode too would surface confusing
      // unit-level partial hits for what should read as a product-name search.
      else if (sku.includes(q) || barcode.includes(q) || name.includes(q)) partial.push(p);
    }
    return [...exactCode, ...exactName, ...partial];
  };
```

- [ ] **Step 2: Replace `rankMatches`**

```typescript
  const rankMatches = (list: any[], q: string, limit: number): any[] => {
    const exactCode: any[] = [];
    const exactName: any[] = [];
    const partial: any[] = [];
    const seen = new Set<string>();
    for (const p of list) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      const barcode = (p.barcode || '').toLowerCase();
      const name = (p.name || '').toLowerCase();
      const baseUnitBarcode = ((p.sellingUnits || []).find((u: any) => u.isBase)?.barcode || '').toLowerCase();
      const unitBarcodeMatch = (p.sellingUnits || []).some((u: any) => !u.isBase && (u.barcode || '').toLowerCase() === q);
      if (baseUnitBarcode === q || barcode === q || unitBarcodeMatch) exactCode.push(p);
      else if (name === q) exactName.push(p);
      // Fuzzy/partial matching stays product-name/barcode only (base unit's
      // own barcode included) — matching partial text against every EXTRA
      // unit's barcode too would surface confusing unit-level partial hits
      // for what should read as a product-name search.
      else if (baseUnitBarcode.includes(q) || barcode.includes(q) || name.includes(q)) partial.push(p);
    }
    return [...exactCode, ...exactName, ...partial];
  };
```

Note what changed: `sku` is gone entirely; `baseUnitBarcode` is a new local derived from `p.sellingUnits`, checked in both the exact-code tier (alongside the legacy `barcode` and the extras-only `unitBarcodeMatch`) and the partial-match tier (alongside `barcode` and `name`) — mirroring exactly where `sku` used to sit in both tiers, so search behavior for a typed partial code is unchanged in kind, only in which field it reads.

- [ ] **Step 3: Locate and confirm the current `matchesProductOrUnitCode`**

```bash
grep -n "const matchesProductOrUnitCode" "app/(app)/pos/pos-content/use-pos.ts"
```

Confirm it matches:

```typescript
  const matchesProductOrUnitCode = (p: any, q: string) =>
    (p.sku || '').toLowerCase() === q ||
    (p.barcode || '').toLowerCase() === q ||
    (p.sellingUnits || []).some((u: any) => !u.isBase && (u.barcode || '').toLowerCase() === q);
```

- [ ] **Step 4: Replace `matchesProductOrUnitCode`**

```typescript
  const matchesProductOrUnitCode = (p: any, q: string) =>
    ((p.sellingUnits || []).find((u: any) => u.isBase)?.barcode || '').toLowerCase() === q ||
    (p.barcode || '').toLowerCase() === q ||
    (p.sellingUnits || []).some((u: any) => !u.isBase && (u.barcode || '').toLowerCase() === q);
```

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit -p . 2>&1 | wc -l
```

Expected: 14 (unchanged baseline — both functions are untyped `any`-based, so no new type errors are expected either way, but confirm).

- [ ] **Step 6: Manual verification — scanner-submits-exact-code path**

This requires a running dev server and DB access (confirmed available in this environment as of Sub-project A's final review). Per the spec's testing section, a query-only check cannot prove this fix reads the right column, since this dataset currently has zero products where the base unit's barcode diverges from `products.sku`/`products.barcode`. Deliberately create a divergence for one test product:

```sql
-- Pick any existing standard product's id first:
SELECT id, name FROM products WHERE type = 'standard' LIMIT 1;

-- Then, using that id, set a distinct test value ONLY on the base unit's barcode:
UPDATE product_selling_units
SET barcode = 'TESTBARCODE999'
WHERE product_id = '<the id you picked>' AND is_base = 1;
```

Confirm this did NOT touch `products.sku` or `products.barcode`:

```sql
SELECT sku, barcode FROM products WHERE id = '<the id you picked>';
```

(Both should show their prior, unrelated values — not `TESTBARCODE999`.)

Run `npm run dev`, open the POS page (`/pos`), and in the product search/scan input type `TESTBARCODE999`. Confirm the product is found and auto-added to the cart (this exercises `findExactCodeMatch` → `matchesProductOrUnitCode`). Then clear the cart, and in the product search suggestions box, type a partial fragment of `TESTBARCODE999` (e.g. `TESTBAR`) and confirm the product appears in the suggestion list (this exercises `getSearchSuggestions` → `rankMatches`'s partial-match tier).

Afterward, revert the test data:

```sql
UPDATE product_selling_units
SET barcode = '<the barcode it had before your test — re-derive from the id you saved, or accept this is throwaway test data on a dev DB>'
WHERE product_id = '<the id you picked>' AND is_base = 1;
```

If you did not record the prior value, leaving `TESTBARCODE999` in place on a dev database is acceptable — note this in your report rather than silently leaving inconsistent state unmentioned.

- [ ] **Step 7: Commit**

```bash
git add "app/(app)/pos/pos-content/use-pos.ts"
git commit -m "feat: POS search ranking matches the base selling unit's barcode, not sku"
```

---

### Task 3: POS display-only sites read the base unit's barcode

**Files:**
- Modify: `app/(app)/pos/pos-content/PosCartTable.tsx`
- Modify: `app/(app)/pos/price-inquiry/PriceInquiryDialog.tsx`
- Modify: `app/(app)/pos/product-search/ProductSearchDialog.tsx`
- Test: manual

**Interfaces:**
- Consumes: nothing new — these are independent display-only edits, not depending on Task 1 or 2's internals (though Task 1 and 2 establish the pattern these follow).
- Produces: no exported signature changes.

- [ ] **Step 1: `PosCartTable.tsx` — the search-suggestion row's subtitle**

```bash
grep -n "unit?.barcode || product.sku" "app/(app)/pos/pos-content/PosCartTable.tsx"
```

Confirm the current line:

```tsx
                      <div className="text-xs text-muted-foreground">
                        {unit?.barcode || product.sku}
                      </div>
```

Replace with:

```tsx
                      <div className="text-xs text-muted-foreground">
                        {unit?.barcode || product.sellingUnits?.find((su: any) => su.isBase)?.barcode || product.barcode}
                      </div>
```

(`unit` here is already the specific selling unit this suggestion row represents — base or extra — per `expandToUnitSuggestions`'s `{ product, unit }` shape confirmed during planning. `unit?.barcode` already covers the common case; the added fallback chain only matters on the rare row where `unit` itself somehow lacks a barcode, falling back first to the product's own base unit, then to the legacy column — never to `.sku`.)

- [ ] **Step 2: `PriceInquiryDialog.tsx` — three occurrences**

```bash
grep -n "product.barcode || product.sku\|selectedProduct.barcode || selectedProduct.sku" "app/(app)/pos/price-inquiry/PriceInquiryDialog.tsx"
```

Confirm the three current lines:

```tsx
                            value={`${product.name} ${product.barcode || product.sku}`}
...
                              <p className="text-sm text-muted-foreground truncate">{product.barcode || product.sku} • {product.unitOfMeasure}</p>
...
                  {selectedProduct.barcode || selectedProduct.sku}
```

Replace each, in order:

```tsx
                            value={`${product.name} ${product.sellingUnits?.find((su: any) => su.isBase)?.barcode || product.barcode || ''}`}
```

```tsx
                              <p className="text-sm text-muted-foreground truncate">{product.sellingUnits?.find((su: any) => su.isBase)?.barcode || product.barcode} • {product.unitOfMeasure}</p>
```

```tsx
                  {selectedProduct.sellingUnits?.find((su: any) => su.isBase)?.barcode || selectedProduct.barcode}
```

- [ ] **Step 3: `ProductSearchDialog.tsx` — two occurrences (search value string and display line)**

```bash
grep -n "unit?.barcode || product.barcode || ''} \${product.sku}\|unit?.barcode || product.barcode || product.sku" "app/(app)/pos/product-search/ProductSearchDialog.tsx"
```

Confirm the two current lines:

```tsx
                        value={`${product.name} ${unit?.name || ''} ${unit?.barcode || product.barcode || ''} ${product.sku}`}
```

```tsx
                            <span className="text-[11px] text-muted-foreground font-mono truncate">
                              {unit?.barcode || product.barcode || product.sku}
                            </span>
```

Replace the search value string — remove the trailing `${product.sku}` token entirely rather than swapping it for another expression, since `unit?.barcode` (checked first) already covers the base unit case when `unit` is the base row, and `product.barcode` is the legacy fallback already present in the same chain:

```tsx
                        value={`${product.name} ${unit?.name || ''} ${unit?.barcode || product.barcode || ''}`}
```

Replace the display line:

```tsx
                            <span className="text-[11px] text-muted-foreground font-mono truncate">
                              {unit?.barcode || product.sellingUnits?.find((su: any) => su.isBase)?.barcode || product.barcode}
                            </span>
```

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit -p . 2>&1 | wc -l
```

Expected: 14, unchanged.

- [ ] **Step 5: Manual verification**

Using the same `TESTBARCODE999` test product from Task 2 Step 6 (re-apply the `UPDATE` if you already reverted it, or pick a fresh product and repeat the same divergence setup):

1. Open POS (`/pos`), add the test product to the cart via search, and confirm the cart line's suggestion-list subtitle (before adding) showed `TESTBARCODE999` (PosCartTable.tsx).
2. Open the Price Inquiry dialog (usually a keyboard shortcut or button on the POS screen — check the app for how it's triggered) and search for the test product by typing `TESTBARCODE999` or part of the product's name; confirm the code shown under the product name and in the detail panel reads `TESTBARCODE999`.
3. Open the full Product Search dialog (separate from the inline cart suggestions) and confirm the same.

Revert the test data afterward, same as Task 2 Step 6.

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/pos/pos-content/PosCartTable.tsx" \
        "app/(app)/pos/price-inquiry/PriceInquiryDialog.tsx" \
        "app/(app)/pos/product-search/ProductSearchDialog.tsx"
git commit -m "feat: POS display components show the base selling unit's barcode, not sku"
```

---

### Task 4: Full regression pass

**Files:** none (verification only)

**Interfaces:** none.

- [ ] **Step 1: Full unit test suite**

```bash
npm run test:unit
```

Expected: every test passes (the suite in `tests/unit/run.ts` runs ~60 files; this task's changes should affect only `product-search.test.ts`'s outcome, and every other file should be unaffected).

- [ ] **Step 2: Full typecheck**

```bash
npx tsc --noEmit -p . 2>&1 | wc -l
```

Expected: 14 — the same baseline as before Task 1. Never higher.

- [ ] **Step 3: `tests/e2e/purchase-order.spec.ts` sanity check**

This plan's Global Constraints note this spec is unaffected (it never touches Products, Inventory, or POS pages) — confirm this claim rather than assume it, since it's cheap to check:

```bash
grep -n "pos\|product-search\|price-inquiry" tests/e2e/purchase-order.spec.ts
```

Expected: no matches, or only incidental substring matches inside unrelated words — confirming this spec genuinely doesn't exercise any file this plan touched. Do not run the spec itself unless this grep turns up something unexpected.

- [ ] **Step 4: Manual end-to-end walkthrough**

1. On the dev DB, deliberately diverge one product's base-unit barcode from its `products.sku`/`products.barcode` (same technique as Task 2 Step 6), if not already left in a divergent state from an earlier task.
2. POS (`/pos`): scan/type the divergent barcode into the main search input — confirm it's found and added to cart.
3. POS: open Price Inquiry, search by name, confirm the divergent barcode displays correctly for that product.
4. POS: open the full Product Search dialog, search by the divergent barcode itself, confirm the product is found.
5. Revert the test divergence (or note in your final report that it was left in place on this dev DB, if the prior value wasn't recorded).

- [ ] **Step 5: No commit for this task** (verification only — if any step fails, return to the relevant task above and fix before proceeding)
