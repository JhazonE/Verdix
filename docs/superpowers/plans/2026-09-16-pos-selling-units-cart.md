# POS Selling Units in the Cart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the POS cart resolve, price, and checkout a non-base selling unit (e.g. "Pack of 12"), not just a product's base unit.

**Architecture:** A new client-safe pure-logic module (`lib/pos-cart-units.ts`) centralizes "which unit did this code/pick resolve to" and "which existing cart line does this unit belong on," so `use-pos.ts` stays a thin caller. `SaleItem` gains a `selectedSellingUnit` field. Three matcher functions in `use-pos.ts` extend to check `sellingUnits[].barcode`. `PosCartTable.tsx`'s Unit cell becomes a picker when a product has more than one unit. `use-tender.ts` sends the selected unit's id/name/factor in the checkout payload. No backend changes — checkout, void, and returns already handle these fields correctly.

**Tech Stack:** Next.js 16 (App Router), React Hook state (no cart state library), TypeScript, `node:assert/strict` unit tests run via `tsx` (see `tests/unit/run.ts`), Radix `Select` (`@/components/ui/select`).

**Spec:** `docs/superpowers/specs/2026-09-16-pos-selling-units-cart-design.md`

## Global Constraints

- No changes to `app/api/pos/checkout/route.ts`, `app/api/pos/void-transaction/route.ts`,
  `app/api/sales/returns/route.ts`, `lib/batch-deduction.ts`, `lib/selling-units.ts`, or
  `lib/pricing.ts`. All already correctly handle `sellingUnitId`/`sellingUnitName`/`sellingUnitFactor`
  when present — verified during design (spec Sections 6-8).
- `lib/selling-units.ts` imports `./mysql` (server-only) at module scope — never import it from
  `use-pos.ts` or any other `'use client'` file. New pure logic needed client-side goes in
  `lib/pos-cart-units.ts` (new file, no imports from `mysql` or any server-only module).
- Switching a cart line's selling unit resets that line's quantity to 1 (no factor-ratio conversion) —
  confirmed user decision, spec Non-goals.
- A resolved non-base-unit barcode scan adds straight to the cart with no confirmation dialog — same
  behavior as a base-unit scan today — confirmed user decision, spec Goals.
- The suggestion dropdown and F9 product search dialog keep showing only the base unit's name/price —
  confirmed user decision, spec Section 3. Do not add per-unit rows there.
- Cart lines for the same product AND the same selling unit must merge (quantity sums); cart lines for
  the same product but DIFFERENT selling units must stay separate lines. This applies both to
  scan/search add (Task 2) and to switching a line's unit via the picker (Task 4).
- Insufficient-stock comparison must multiply cart quantity by the line's selected unit factor before
  comparing to `item.stock` (spec Section 5) — `item.stock` is always in base units.
- `sales_invoice_items` gets no selling-unit columns — explicitly out of scope (spec Non-goals).

---

### Task 1: Pure cart-unit resolution helpers + unit tests

**Files:**
- Create: `lib/pos-cart-units.ts`
- Test: `tests/unit/pos-cart-units.test.ts`
- Modify: `tests/unit/run.ts` (register the new test)

**Interfaces:**
- Consumes: nothing (pure functions, no imports from `lib/mysql`, `lib/selling-units.ts`, or any
  server-only module — this file must be safely importable from `'use client'` code).
- Produces:
  - `type CartSellingUnit = { id?: string; name: string; factor: number; barcode?: string; cost?: number; price: number; isBase?: boolean; priceLevels?: { levelId: string; price: number; minQuantity?: number }[] }`
  - `resolveSellingUnitForAdd(product: { sellingUnits?: CartSellingUnit[]; price?: number }, code?: string): CartSellingUnit` — used by Task 2 (`use-pos.ts`'s `handleAddItem`).
  - `baseSellingUnitOf(product: { sellingUnits?: CartSellingUnit[]; price?: number }): CartSellingUnit` — the existing `baseSellingUnit()` logic from `use-pos.ts:22-24`, moved here so it's the single source of truth Task 2/3/4 all call, and so it's unit-testable.
  - `findCartLineForUnit<T extends { id: string; selectedSellingUnit?: CartSellingUnit }>(items: T[], productId: string, unitId: string | undefined): T | undefined` — the merge-key lookup used by both Task 2 (scan/search add) and Task 4 (unit-picker switch).

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/pos-cart-units.test.ts`:

```ts
import assert from 'node:assert/strict';
import { resolveSellingUnitForAdd, baseSellingUnitOf, findCartLineForUnit } from '../../lib/pos-cart-units';

const baseUnit = { id: 'su-base', name: 'Piece', factor: 1, barcode: '4800000000017', price: 25, isBase: true };
const packUnit = { id: 'su-pack', name: 'Pack (x12)', factor: 12, barcode: '62217958', price: 250, isBase: false };
const product = { id: 'prod-1', price: 25, sellingUnits: [baseUnit, packUnit] };

// baseSellingUnitOf
assert.deepEqual(baseSellingUnitOf(product), baseUnit, 'finds the isBase unit');
assert.deepEqual(
  baseSellingUnitOf({ price: 40 }),
  { price: 40, priceLevels: [] },
  'falls back to product.price when sellingUnits is absent'
);

// resolveSellingUnitForAdd — no code (plain suggestion/F9 pick) always resolves base
assert.deepEqual(resolveSellingUnitForAdd(product), baseUnit, 'no code resolves base unit');
assert.deepEqual(resolveSellingUnitForAdd(product, ''), baseUnit, 'empty code resolves base unit');

// resolveSellingUnitForAdd — code matches a non-base unit's barcode
assert.deepEqual(
  resolveSellingUnitForAdd(product, '62217958'),
  packUnit,
  'matches the Pack unit by its own barcode'
);

// Case-insensitive / whitespace-tolerant, matching how the rest of the POS
// scan matchers already lowercase/trim (use-pos.ts:668, :671).
assert.deepEqual(
  resolveSellingUnitForAdd(product, '  62217958  '),
  packUnit,
  'trims surrounding whitespace'
);

// resolveSellingUnitForAdd — code matches the product's own top-level
// barcode (not any selling unit's) resolves to base, same as today.
assert.deepEqual(
  resolveSellingUnitForAdd(product, '4800000000017'),
  baseUnit,
  'a base-unit barcode match resolves to base'
);

// resolveSellingUnitForAdd — code matches nothing resolves to base (a
// name/SKU match falls through here, same as today's behavior).
assert.deepEqual(
  resolveSellingUnitForAdd(product, 'nonexistent-code'),
  baseUnit,
  'unmatched code falls back to base unit'
);

// A unit flagged isBase is never returned by the non-base barcode search,
// even if its own barcode is passed in — base matches always go through
// the same fallback path, never the "found a non-base match" branch.
const productSingleUnit = { id: 'prod-2', price: 10, sellingUnits: [baseUnit] };
assert.deepEqual(
  resolveSellingUnitForAdd(productSingleUnit, '4800000000017'),
  baseUnit,
  'single-unit product always resolves base regardless of code'
);

// findCartLineForUnit
type Line = { id: string; selectedSellingUnit?: typeof baseUnit };
const lineA: Line = { id: 'prod-1', selectedSellingUnit: baseUnit };
const lineB: Line = { id: 'prod-1', selectedSellingUnit: packUnit };
const cart: Line[] = [lineA, lineB];

assert.equal(findCartLineForUnit(cart, 'prod-1', 'su-base'), lineA, 'finds the matching-unit line');
assert.equal(findCartLineForUnit(cart, 'prod-1', 'su-pack'), lineB, 'distinguishes different units of the same product');
assert.equal(findCartLineForUnit(cart, 'prod-1', 'su-missing'), undefined, 'no match for an unrelated unit id');
assert.equal(findCartLineForUnit(cart, 'prod-9', 'su-base'), undefined, 'no match for an unrelated product id');

console.log('✅ pos-cart-units tests passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/unit/pos-cart-units.test.ts`
Expected: FAIL with a module-not-found error for `../../lib/pos-cart-units` (the file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `lib/pos-cart-units.ts`:

```ts
/**
 * Pure, client-safe helpers for resolving which selling unit a POS cart
 * line uses. No imports from `lib/mysql` or any server-only module — this
 * file is imported directly by 'use client' code (`use-pos.ts`), unlike
 * `lib/selling-units.ts`, which touches the DB pool at module scope and
 * must never be imported client-side.
 */

export type CartSellingUnit = {
  id?: string;
  name: string;
  factor: number;
  barcode?: string;
  cost?: number;
  price: number;
  isBase?: boolean;
  priceLevels?: { levelId: string; price: number; minQuantity?: number }[];
};

type CartProduct = {
  price?: number;
  sellingUnits?: CartSellingUnit[];
};

/**
 * A product's base unit (factor 1). Falls back to the product's own plain
 * price only if a product is somehow missing its base entry — every
 * product created after the selling-units migration has one.
 */
export function baseSellingUnitOf(product: CartProduct): CartSellingUnit {
  return (
    product.sellingUnits?.find((u) => u.isBase) ?? {
      name: '',
      factor: 1,
      price: product.price ?? 0,
      priceLevels: [],
    }
  );
}

/**
 * Resolves which selling unit a scanned/typed code, or a plain
 * suggestion/F9-dialog pick (no code), should add to the cart.
 *
 * `code` is the raw scanned/typed string. When it matches a NON-base
 * unit's own barcode, that unit wins. Every other case — no code, an
 * empty code, a match against the product's own top-level barcode, a
 * name/SKU match, or no match at all — resolves to the base unit, which
 * is exactly today's behavior for everything except a non-base barcode.
 */
export function resolveSellingUnitForAdd(product: CartProduct, code?: string): CartSellingUnit {
  const units = product.sellingUnits || [];
  if (code) {
    const trimmed = code.trim().toLowerCase();
    if (trimmed) {
      const byBarcode = units.find(
        (u) => !u.isBase && (u.barcode || '').toLowerCase() === trimmed
      );
      if (byBarcode) return byBarcode;
    }
  }
  return baseSellingUnitOf(product);
}

/**
 * Finds the existing cart line for this exact (product, selling unit)
 * pair, if any. Two lines for the same product but different units are
 * intentionally distinct — a Pack scan must never bump a Piece line's
 * quantity, and vice versa.
 */
export function findCartLineForUnit<T extends { id: string; selectedSellingUnit?: CartSellingUnit }>(
  items: T[],
  productId: string,
  unitId: string | undefined
): T | undefined {
  return items.find((item) => item.id === productId && item.selectedSellingUnit?.id === unitId);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/unit/pos-cart-units.test.ts`
Expected: PASS, prints `✅ pos-cart-units tests passed`

- [ ] **Step 5: Register the test in the suite runner**

Open `tests/unit/run.ts`. Find the existing `import './selling-units.test';` line (line 60) and add
immediately after it:

```ts
import './pos-cart-units.test';
```

- [ ] **Step 6: Run the full unit suite to confirm nothing else broke**

Run: `npx tsx tests/unit/run.ts`
Expected: PASS (all tests, including the new one, print their own success line with no thrown errors)

- [ ] **Step 7: Commit**

```bash
git add lib/pos-cart-units.ts tests/unit/pos-cart-units.test.ts tests/unit/run.ts
git commit -m "feat: add pure selling-unit resolution helpers for the POS cart"
```

---

### Task 2: Cart line type + add-to-cart resolves a unit

**Files:**
- Modify: `app/(app)/pos/pos-content/pos-types.ts`
- Modify: `app/(app)/pos/pos-content/use-pos.ts`

**Interfaces:**
- Consumes: `CartSellingUnit`, `resolveSellingUnitForAdd`, `baseSellingUnitOf`, `findCartLineForUnit` from `lib/pos-cart-units.ts` (Task 1).
- Produces: `SaleItem.selectedSellingUnit?: CartSellingUnit`; `handleAddItem(product: any, matchedCode?: string): void` (new optional second parameter, callers from Task 3 pass the matched code).

- [ ] **Step 1: Add `selectedSellingUnit` to `SaleItem`**

In `app/(app)/pos/pos-content/pos-types.ts`, add the import and extend the type:

```ts
import type { Product } from '@/lib/types';
import type { CartSellingUnit } from '@/lib/pos-cart-units';
```

Change:

```ts
export type SaleItem = Product & {
  quantity: number;
  discount: number;
  discountType?: string;
  discountIdNumber?: string;
  discountHolderName?: string;
  name: string;
  taxType?: 'VAT' | 'NON_VAT' | 'ZERO_RATED' | 'VAT_EXEMPT';
};
```

to:

```ts
export type SaleItem = Product & {
  quantity: number;
  discount: number;
  discountType?: string;
  discountIdNumber?: string;
  discountHolderName?: string;
  name: string;
  taxType?: 'VAT' | 'NON_VAT' | 'ZERO_RATED' | 'VAT_EXEMPT';
  /**
   * The selling unit this line is priced and will be sold as. Defaults to
   * the product's base unit on add (see `resolveSellingUnitForAdd`).
   * Undefined for a service line, which carries no selling units at all.
   */
  selectedSellingUnit?: CartSellingUnit;
};
```

- [ ] **Step 2: Replace the module-level `baseSellingUnit` helper with the Task 1 import**

In `app/(app)/pos/pos-content/use-pos.ts`, replace:

```ts
import { calculateEffectivePriceForUnit } from '@/lib/pricing';
```

with (add the new import on its own line immediately after):

```ts
import { calculateEffectivePriceForUnit } from '@/lib/pricing';
import { resolveSellingUnitForAdd, baseSellingUnitOf, findCartLineForUnit } from '@/lib/pos-cart-units';
```

Then delete the now-redundant local helper (lines 18-24):

```ts
// POS has no unit-picker yet, so every cart line implicitly sells the
// product's base unit. This resolves that unit (falling back to the
// product's plain price only if a product is somehow missing its base
// entry, which Task 1/3's guarantees mean should never happen).
function baseSellingUnit(product: any) {
  return product.sellingUnits?.find((u: any) => u.isBase) ?? { price: product.price, priceLevels: [] };
}
```

Every remaining reference to `baseSellingUnit(...)` in this file (the re-pricing effect at line 581,
and inside `handleAddItem`/`updateQuantity`, touched in later steps of this task and in Task 6) becomes
`baseSellingUnitOf(...)` instead — same call signature, so this is a plain rename at each site.

- [ ] **Step 3: Rewrite `handleAddItem` to resolve and carry a unit**

Replace the existing `handleAddItem` (lines 589-629):

```ts
  const handleAddItem = (product: any | undefined) => {
    if (product) {
      const existing = items.find(item => item.id === product.id);
      // Adding an existing line (quantity bump) never changes the cart's
      // document type, so only check on a genuinely new line.
      if (!existing && items.length > 0) {
        const cartType = items[0].type === 'service' ? 'service' : 'standard';
        const newItemType = product.type === 'service' ? 'service' : 'standard';
        if (cartType !== newItemType) {
          toast({
            title: 'Cannot Mix Goods and Services',
            description: 'This sale already has a ' + (cartType === 'service' ? 'service' : 'goods') + ' item. Please complete this as two separate transactions.',
            variant: 'destructive',
          });
          setInputValue('');
          setTimeout(() => inputRef.current?.focus(), 0);
          return;
        }
      }
      setItems(prevItems => {
        const existing = prevItems.find(item => item.id === product.id);
        if (existing) {
          const newQty = existing.quantity + 1;
          const newPrice = calculateEffectivePriceForUnit(baseSellingUnit(product), newQty, activeLevelId, defaultLevelId);
          return prevItems.map(item => item.id === product.id ? { ...item, quantity: newQty, price: newPrice } : item);
        } else {
          const newItem: SaleItem = {
            ...product, quantity: 1, discount: 0, name: product.name,
            price: calculateEffectivePriceForUnit(baseSellingUnit(product), 1, activeLevelId, defaultLevelId),
            taxType: mapVatStatusToTaxType(product.vatStatus),
          };
          setSelectedItemId(newItem.id);
          return [...prevItems, newItem];
        }
      });
    } else {
      toast({ title: 'Error', description: 'Product not found', variant: 'destructive' });
    }
    setInputValue('');
    setTimeout(() => inputRef.current?.focus(), 0);
  };
```

with:

```ts
  const handleAddItem = (product: any | undefined, matchedCode?: string) => {
    if (product) {
      const unit = product.type === 'service' ? undefined : resolveSellingUnitForAdd(product, matchedCode);
      const existing = product.type === 'service'
        ? items.find(item => item.id === product.id)
        : findCartLineForUnit(items, product.id, unit?.id);
      // Adding an existing line (quantity bump) never changes the cart's
      // document type, so only check on a genuinely new line.
      if (!existing && items.length > 0) {
        const cartType = items[0].type === 'service' ? 'service' : 'standard';
        const newItemType = product.type === 'service' ? 'service' : 'standard';
        if (cartType !== newItemType) {
          toast({
            title: 'Cannot Mix Goods and Services',
            description: 'This sale already has a ' + (cartType === 'service' ? 'service' : 'goods') + ' item. Please complete this as two separate transactions.',
            variant: 'destructive',
          });
          setInputValue('');
          setTimeout(() => inputRef.current?.focus(), 0);
          return;
        }
      }
      setItems(prevItems => {
        const existingLine = product.type === 'service'
          ? prevItems.find(item => item.id === product.id)
          : findCartLineForUnit(prevItems, product.id, unit?.id);
        if (existingLine) {
          const newQty = existingLine.quantity + 1;
          const priceUnit = unit ?? baseSellingUnitOf(product);
          const newPrice = calculateEffectivePriceForUnit(priceUnit, newQty, activeLevelId, defaultLevelId);
          return prevItems.map(item => item === existingLine ? { ...item, quantity: newQty, price: newPrice } : item);
        } else {
          const priceUnit = unit ?? baseSellingUnitOf(product);
          const newItem: SaleItem = {
            ...product, quantity: 1, discount: 0, name: product.name,
            selectedSellingUnit: unit,
            price: calculateEffectivePriceForUnit(priceUnit, 1, activeLevelId, defaultLevelId),
            taxType: mapVatStatusToTaxType(product.vatStatus),
          };
          setSelectedItemId(newItem.id);
          return [...prevItems, newItem];
        }
      });
    } else {
      toast({ title: 'Error', description: 'Product not found', variant: 'destructive' });
    }
    setInputValue('');
    setTimeout(() => inputRef.current?.focus(), 0);
  };
```

Note the merge-key change from `item.id === product.id` (product-only) to `findCartLineForUnit` — a
service product has no `sellingUnits`/`selectedSellingUnit` at all, so it keeps merging on `item.id`
alone (the ternary above), while a standard product now merges on `(product.id, unit.id)` per the
Global Constraints.

- [ ] **Step 2: Run the full unit suite (regression check only — this task has no new pure-function
  tests of its own; Task 1's tests already cover the resolution logic this step wires in)**

Run: `npx tsx tests/unit/run.ts`
Expected: PASS

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "pos-types|use-pos"`
Expected: no output (no errors in either touched file). Note: `handleAddItem`'s call sites in
`PosCartTable.tsx` and `use-product-search.ts` still call it with one argument today — this is valid,
since `matchedCode` is optional — so no other file needs to change in this task.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/pos/pos-content/pos-types.ts" "app/(app)/pos/pos-content/use-pos.ts"
git commit -m "feat: cart lines resolve and carry a selected selling unit"
```

---

### Task 3: Barcode/SKU scan resolution checks selling-unit barcodes

**Files:**
- Modify: `app/(app)/pos/pos-content/use-pos.ts`
- Modify: `app/(app)/pos/pos-content/PosCartTable.tsx`

**Interfaces:**
- Consumes: `handleAddItem(product, matchedCode?)` from Task 2.
- Produces: no new exports — `findExactCodeMatch`, `rankMatches`/`getSearchSuggestions`, and
  `handleAddItemBySKU` keep their existing signatures; only their internal matching logic and their
  calls to `handleAddItem` change (now passing the matched code through).

- [ ] **Step 1: Extend `findExactCodeMatch` to also check selling-unit barcodes**

In `app/(app)/pos/pos-content/use-pos.ts`, replace (lines 665-674):

```ts
  const findExactCodeMatch = useCallback((query: string): any | undefined => {
    const q = query.trim().toLowerCase();
    if (!q) return undefined;
    const inLocal = (products || []).find(p => (p.sku || '').toLowerCase() === q || (p.barcode || '').toLowerCase() === q);
    if (inLocal) return inLocal;
    if (debouncedSearchQuery.trim().toLowerCase() === q) {
      return (serverSearchResults || []).find(p => (p.sku || '').toLowerCase() === q || (p.barcode || '').toLowerCase() === q);
    }
    return undefined;
  }, [products, serverSearchResults, debouncedSearchQuery]);
```

with:

```ts
  const matchesProductOrUnitCode = (p: any, q: string) =>
    (p.sku || '').toLowerCase() === q ||
    (p.barcode || '').toLowerCase() === q ||
    (p.sellingUnits || []).some((u: any) => !u.isBase && (u.barcode || '').toLowerCase() === q);

  const findExactCodeMatch = useCallback((query: string): any | undefined => {
    const q = query.trim().toLowerCase();
    if (!q) return undefined;
    const inLocal = (products || []).find(p => matchesProductOrUnitCode(p, q));
    if (inLocal) return inLocal;
    if (debouncedSearchQuery.trim().toLowerCase() === q) {
      return (serverSearchResults || []).find(p => matchesProductOrUnitCode(p, q));
    }
    return undefined;
  }, [products, serverSearchResults, debouncedSearchQuery]);
```

`matchesProductOrUnitCode` is defined once, above `findExactCodeMatch`, and reused by
`handleAddItemBySKU`'s remote fallback in Step 3 below — keeping the exact-match rule in one place so
the local, server, and remote-fallback paths can never silently diverge.

- [ ] **Step 2: Extend `rankMatches`'s exact-code classification**

Replace (lines 631-647):

```ts
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
      if (sku === q || barcode === q) exactCode.push(p);
      else if (name === q) exactName.push(p);
      else if (sku.includes(q) || barcode.includes(q) || name.includes(q)) partial.push(p);
    }
    return [...exactCode, ...exactName, ...partial].slice(0, limit);
  };
```

with:

```ts
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
    return [...exactCode, ...exactName, ...partial].slice(0, limit);
  };
```

- [ ] **Step 3: Extend `handleAddItemBySKU`'s remote fallback and pass the matched code through**

Replace (lines 681-701):

```ts
  const handleAddItemBySKU = async (sku: string) => {
    if (!sku) return;
    const local = findExactCodeMatch(sku) || getSearchSuggestions(sku, 1)[0];
    if (local) { handleAddItem(local); return; }

    const q = sku.trim();
    try {
      const response = await fetch(getApiUrl(`/products?search=${encodeURIComponent(q)}&limit=100`), { cache: 'no-store' });
      const result = await response.json();
      if (result.success) {
        const qLower = q.toLowerCase();
        const remote = (result.data || []).find((p: any) =>
          (p.sku || '').toLowerCase() === qLower || (p.barcode || '').toLowerCase() === qLower
        );
        if (remote) { handleAddItem(mapApiProduct(remote)); return; }
      }
    } catch {
      // Network/API failure — fall through to the "not found" toast below.
    }
    handleAddItem(undefined);
  };
```

with:

```ts
  const handleAddItemBySKU = async (sku: string) => {
    if (!sku) return;
    const local = findExactCodeMatch(sku) || getSearchSuggestions(sku, 1)[0];
    if (local) { handleAddItem(local, sku); return; }

    const q = sku.trim();
    try {
      const response = await fetch(getApiUrl(`/products?search=${encodeURIComponent(q)}&limit=100`), { cache: 'no-store' });
      const result = await response.json();
      if (result.success) {
        const qLower = q.toLowerCase();
        const remote = (result.data || []).find((p: any) => matchesProductOrUnitCode(p, qLower));
        if (remote) { handleAddItem(mapApiProduct(remote), sku); return; }
      }
    } catch {
      // Network/API failure — fall through to the "not found" toast below.
    }
    handleAddItem(undefined);
  };
```

Note `local` (from `findExactCodeMatch` or a ranked suggestion) is passed `sku` as the matched code
unconditionally — when `local` came from `getSearchSuggestions`'s partial/fuzzy branch (a name/SKU
substring match, not an exact barcode), `resolveSellingUnitForAdd` (Task 1) will simply find no
non-base-unit barcode equal to `sku` and fall through to the base unit, which is correct: a fuzzy
text match was never claiming to identify a specific unit.

- [ ] **Step 4: Pass the scanned code through in the auto-add effect**

In `app/(app)/pos/pos-content/PosCartTable.tsx`, replace (lines 61-68):

```ts
  useEffect(() => {
    const exactMatch = findExactCodeMatch(inputValue);
    if (exactMatch) {
      setIsSuggestOpen(false);
      justAutoAddedRef.current = true;
      handleAddItem(exactMatch);
    }
  }, [inputValue, findExactCodeMatch, handleAddItem]);
```

with:

```ts
  useEffect(() => {
    const exactMatch = findExactCodeMatch(inputValue);
    if (exactMatch) {
      setIsSuggestOpen(false);
      justAutoAddedRef.current = true;
      handleAddItem(exactMatch, inputValue);
    }
  }, [inputValue, findExactCodeMatch, handleAddItem]);
```

And update the `Props` type's `handleAddItem` signature (line 18) to match Task 2's new signature:

```ts
  handleAddItem: (product: any) => void;
```

becomes:

```ts
  handleAddItem: (product: any, matchedCode?: string) => void;
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "use-pos|PosCartTable"`
Expected: no output.

- [ ] **Step 6: Run the full unit suite**

Run: `npx tsx tests/unit/run.ts`
Expected: PASS (no unit tests target these functions directly — they're exercised through React
state/effects, out of scope for a plain-Node `assert` script; Task 1's tests already cover the
underlying resolution logic these steps now feed real codes into).

- [ ] **Step 7: Commit**

```bash
git add "app/(app)/pos/pos-content/use-pos.ts" "app/(app)/pos/pos-content/PosCartTable.tsx"
git commit -m "feat: resolve scanned/typed codes against selling-unit barcodes"
```

---

### Task 4: Cart line unit picker

**Files:**
- Modify: `app/(app)/pos/pos-content/PosCartTable.tsx`
- Modify: `app/(app)/pos/pos-content/use-pos.ts`
- Modify: `app/(app)/pos/page.tsx`

**Interfaces:**
- Consumes: `baseSellingUnitOf`, `findCartLineForUnit` from `lib/pos-cart-units.ts` (Task 1);
  `calculateEffectivePriceForUnit` from `lib/pricing.ts` (already imported in `use-pos.ts`).
- Produces: `onUnitChange(item: SaleItem, unitId: string): void`, exported from `usePOS()` and threaded
  through `page.tsx` into `PosCartTable`.

- [ ] **Step 1: Add `onUnitChange` to `use-pos.ts`**

Add this new handler immediately after `updateQuantity` (which ends at line 715):

```ts
  const onUnitChange = (item: SaleItem, unitId: string) => {
    const unit = item.sellingUnits?.find((u: any) => u.id === unitId);
    if (!unit) return;
    setItems(prevItems => {
      // If another line already holds this exact (product, unit) pair,
      // merge into it (sum quantity) instead of leaving two lines for the
      // same product+unit — same identity rule Task 2 applies on add.
      const target = findCartLineForUnit(prevItems, item.id, unitId);
      if (target && target !== item) {
        const mergedQty = target.quantity + item.quantity;
        return prevItems
          .filter(i => i !== item)
          .map(i => i === target
            ? { ...i, quantity: mergedQty, price: calculateEffectivePriceForUnit(unit, mergedQty, activeLevelId, defaultLevelId) }
            : i
          );
      }
      return prevItems.map(i =>
        i === item
          ? {
              ...i,
              selectedSellingUnit: unit,
              quantity: 1,
              price: calculateEffectivePriceForUnit(unit, 1, activeLevelId, defaultLevelId),
            }
          : i
      );
    });
  };
```

Add `onUnitChange` to the hook's return object (in the `// handlers` section, immediately after
`handleAddItem, handleAddItemBySKU, getSearchSuggestions, findExactCodeMatch, updateQuantity, handleUpdateItem,`):

```ts
    handleAddItem, handleAddItemBySKU, getSearchSuggestions, findExactCodeMatch, updateQuantity, handleUpdateItem, onUnitChange,
```

- [ ] **Step 2: Thread `onUnitChange` through `page.tsx` into `PosCartTable`**

In `app/(app)/pos/page.tsx`, find the `<PosCartTable` prop block (starts at line 90) and add, next to
the existing `handleAddItem={pos.handleAddItem}` line (line 97):

```tsx
              onUnitChange={pos.onUnitChange}
```

- [ ] **Step 3: Add the picker to `PosCartTable.tsx`**

Add to the `Props` type (after `handleAddItem: (product: any, matchedCode?: string) => void;`):

```ts
  onUnitChange: (item: SaleItem, unitId: string) => void;
```

Add to the component's destructured props (after `handleAddItem, handleDefaultTender,` on line 43):

```ts
  onUnitChange,
```

Add the `Select` import at the top of the file, alongside the existing UI imports:

```ts
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
```

Replace the static Unit cell (line 235):

```tsx
                    <TableCell className="text-left text-sm text-muted-foreground">{item.unitOfMeasure}</TableCell>
```

with:

```tsx
                    <TableCell className="text-left text-sm text-muted-foreground" onClick={(e) => e.stopPropagation()}>
                      {(item.sellingUnits?.length ?? 0) > 1 ? (
                        <Select
                          value={item.selectedSellingUnit?.id ?? ''}
                          onValueChange={(unitId) => onUnitChange(item, unitId)}
                        >
                          <SelectTrigger className="h-7 w-auto border-none bg-transparent px-1 text-sm text-muted-foreground shadow-none focus:ring-0">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {item.sellingUnits!.map((u) => (
                              <SelectItem key={u.id} value={u.id!}>
                                {u.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        item.unitOfMeasure
                      )}
                    </TableCell>
```

The `onClick={(e) => e.stopPropagation()}` on the `TableCell` matches the existing pattern used by the
Name/Price/Qty inline-edit cells in this same file (e.g. line 214, line 244, line 264) — without it,
opening the Select would also fire the row's `onClick={() => setSelectedItemId(item.id)}` handler
(line 203), which is harmless but inconsistent with how every other interactive cell in this table
already isolates its clicks.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "use-pos|PosCartTable|pos/page"`
Expected: no output.

- [ ] **Step 5: Run the full unit suite**

Run: `npx tsx tests/unit/run.ts`
Expected: PASS. (`onUnitChange`'s merge-on-switch logic reuses `findCartLineForUnit`, already covered
by Task 1's tests; the handler itself is React state wiring, not a pure function, so it has no
dedicated unit test — consistent with how `updateQuantity`/`handleUpdateItem` alongside it are also
untested at the unit level in this codebase.)

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/pos/pos-content/PosCartTable.tsx" "app/(app)/pos/pos-content/use-pos.ts" "app/(app)/pos/page.tsx"
git commit -m "feat: add selling-unit picker to POS cart lines"
```

---

### Task 5: Stock check and price-level re-pricing use the selected unit's factor

**Files:**
- Modify: `app/(app)/pos/pos-content/use-pos.ts`

**Interfaces:**
- Consumes: `baseSellingUnitOf` from `lib/pos-cart-units.ts` (Task 1, already imported in Task 2 Step 2).
- Produces: no new exports — fixes two existing behaviors in place.

- [ ] **Step 1: Fix the Insufficient Stock check to multiply by factor**

Replace (line 848):

```ts
        const lowStock = items.filter(item => item.type !== 'service' && item.quantity > item.stock);
```

with:

```ts
        const lowStock = items.filter(item => {
          if (item.type === 'service') return false;
          const factor = item.selectedSellingUnit?.factor ?? 1;
          return item.quantity * factor > item.stock;
        });
```

This is a latent-bug fix: today `factor` is always 1 in every reachable cart state, so the old and new
comparisons are identical for every cart the app could produce before this plan. Once Task 2-4 make a
non-base unit reachable, a factor > 1 must be accounted for here or a cashier could ring up more stock
than physically exists without tripping this dialog.

- [ ] **Step 2: Fix the price-level re-pricing effect to reprice from the selected unit**

Replace (line 581):

```ts
      const updated = currentItems.map(item => ({ ...item, price: calculateEffectivePriceForUnit(baseSellingUnit(item), item.quantity, activeLevelId, defaultLevelId) }));
```

with:

```ts
      const updated = currentItems.map(item => ({ ...item, price: calculateEffectivePriceForUnit(item.selectedSellingUnit ?? baseSellingUnitOf(item), item.quantity, activeLevelId, defaultLevelId) }));
```

Without this fix, switching the store's active price level (e.g. a customer with a Wholesale price
level is selected) would silently reprice every non-base-unit cart line back to its base-unit price,
discarding the cashier's unit selection — this must ship in the same change as Task 2/4, not as a
follow-up, since it is a direct and immediate consequence of adding `selectedSellingUnit`.

- [ ] **Step 3: Confirm `updateQuantity` also already uses the selected unit (verification, not a
  code change — Task 2 Step 2 already renamed this call site's `baseSellingUnit` to `baseSellingUnitOf`,
  but it still prices from the PRODUCT's base unit, not the line's SELECTED unit)**

Read the current state of `updateQuantity` (originally lines 703-715):

```ts
  const updateQuantity = (productId: string, newQuantity: number) => {
    if (newQuantity <= 0) {
      removeItem(productId);
    } else {
      setItems(prevItems => prevItems.map(item => {
        if (item.id === productId) {
          const original = products?.find(p => p.id === productId);
          return { ...item, quantity: newQuantity, price: calculateEffectivePriceForUnit(baseSellingUnitOf(original || item), newQuantity, activeLevelId, defaultLevelId) };
        }
        return item;
      }));
    }
  };
```

This still prices from `baseSellingUnitOf(original || item)` — always the base unit — so editing the
quantity of a Pack line via the qty field (F6, +/-, or typing a new quantity) would silently reprice it
back to the Piece's price. Fix it to price from the line's own selected unit:

```ts
  const updateQuantity = (productId: string, newQuantity: number) => {
    if (newQuantity <= 0) {
      removeItem(productId);
    } else {
      setItems(prevItems => prevItems.map(item => {
        if (item.id === productId) {
          const unit = item.selectedSellingUnit ?? baseSellingUnitOf(item);
          return { ...item, quantity: newQuantity, price: calculateEffectivePriceForUnit(unit, newQuantity, activeLevelId, defaultLevelId) };
        }
        return item;
      }));
    }
  };
```

This drops the now-unused `original` lookup (`products?.find(p => p.id === productId)`) — it existed
only to re-derive the base unit from the live product catalog; the line's own `selectedSellingUnit`
(or `item` itself as the `baseSellingUnitOf` fallback) is now the correct and sufficient source, and is
also more correct than the old code for a multi-line-per-product cart: `products?.find` by `productId`
alone could not have told two lines of the same product apart anyway.

**Caveat, addressed by Task 5.5, not this task:** like `handleAddItem`, `updateQuantity` is keyed by
`productId` alone (`item.id === productId`), so if two lines of the same product (different units) both
exist, calling `updateQuantity(productId, n)` updates BOTH. This task does not fix it — Task 5.5,
immediately following, gives every cart line a synthetic `lineId` and converts every `item.id`-keyed
selection/editing call site (in this file and in `PosCartTable.tsx`) to use it instead. Leave this
function's `productId`-keyed body exactly as shown above for this task; do not attempt a partial fix
here.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep "use-pos"`
Expected: no output.

- [ ] **Step 5: Run the full unit suite**

Run: `npx tsx tests/unit/run.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/pos/pos-content/use-pos.ts"
git commit -m "fix: stock check and re-pricing account for the selected selling unit's factor"
```

---

### Task 5.5: Synthetic per-line id (fixes cart-line selection/editing collisions)

**Why this task exists:** Task 4's review surfaced a real bug this plan's original text did not
account for. `SaleItem.id` is the *product* id (there is no separate cart-line id anywhere in this
codebase). Tasks 1-4 made it possible for two cart lines to share a `product.id` while differing only
in `selectedSellingUnit` (e.g. a Piece line and a Pack line of the same product). Every place that
selects, edits, scrolls to, or removes "the current line" — the React `key` on each row, row selection
(`selectedItemId`), every inline-edit lock (name/qty/price), void, discount-by-id, keyboard shortcuts,
`updateQuantity`, `removeItem` — is keyed by this shared `item.id`, so once two such lines coexist,
acting on "the id" silently acts on **both**, or on whichever one React/`.find()` happens to resolve
first. `onUnitChange` (Task 4) already dodges this by matching on object identity (`i === item`)
instead of by id — this task generalizes that same fix to the rest of the file.

**Files:**
- Modify: `app/(app)/pos/pos-content/pos-types.ts`
- Modify: `app/(app)/pos/pos-content/use-pos.ts`
- Modify: `app/(app)/pos/pos-content/PosCartTable.tsx`

**Interfaces:**
- Consumes: nothing new from earlier tasks.
- Produces: `SaleItem.lineId: string` (new, required, generated at add-time) — every function in
  `use-pos.ts` that currently takes an `itemId`/`productId` parameter meaning "which cart line" now
  means "that line's `lineId`," not its `id`. `removeItem`, `updateQuantity`, `handleUpdateItem`,
  `handleVoidLine`/`performVoidLine`, `handleApplyDiscount`, `commitInlineName`, `commitQty`,
  `commitInlinePrice`, `focusInlineQuantity`/`unlockInlineQty`, `unlockInlineName`, `unlockInlinePrice`,
  `requestQuantityDelta`, `startEditName`, `requestInlinePriceEdit` all keep their existing signatures
  (still `(itemId: string, ...)` etc.) — only what value flows into that parameter changes, from
  `item.id` to `item.lineId`, at every call site in `PosCartTable.tsx`. `selectedItem` now resolves by
  `lineId`, not `id`.

- [ ] **Step 1: Add `lineId` to `SaleItem`**

In `app/(app)/pos/pos-content/pos-types.ts`, add to the `SaleItem` type (after `selectedSellingUnit`):

```ts
export type SaleItem = Product & {
  quantity: number;
  discount: number;
  discountType?: string;
  discountIdNumber?: string;
  discountHolderName?: string;
  name: string;
  taxType?: 'VAT' | 'NON_VAT' | 'ZERO_RATED' | 'VAT_EXEMPT';
  selectedSellingUnit?: CartSellingUnit;
  /**
   * Unique per cart LINE, not per product — `id` is the product id and is
   * shared by two lines of the same product on different selling units.
   * Generated once when a line is created; never recomputed or reused.
   */
  lineId: string;
};
```

- [ ] **Step 2: Generate `lineId` wherever a new `SaleItem` is constructed**

In `app/(app)/pos/pos-content/use-pos.ts`, `handleAddItem`'s new-line branch constructs a `SaleItem`
literal. Add `lineId: crypto.randomUUID()` to it:

```ts
          const newItem: SaleItem = {
            ...product, quantity: 1, discount: 0, name: product.name,
            selectedSellingUnit: unit,
            lineId: crypto.randomUUID(),
            price: calculateEffectivePriceForUnit(priceUnit, 1, activeLevelId, defaultLevelId),
            taxType: mapVatStatusToTaxType(product.vatStatus),
          };
          setSelectedItemId(newItem.lineId);
          return [...prevItems, newItem];
```

(`setSelectedItemId(newItem.id)` becomes `setSelectedItemId(newItem.lineId)` — this is the only other
change inside `handleAddItem`.)

Search the rest of `use-pos.ts` for every other place a bare `SaleItem` object literal or spread is
constructed and added to `items`/`prevItems` via `setItems`. As of this task, the only other sites are:
- `confirmHold`/`handleRestore`/`handleClaimQueuedOrder`: these all move EXISTING `SaleItem[]` arrays
  (from `heldTransactions` or a queued order) back into `items` verbatim — the items already carry
  whatever `lineId` they had when held/queued (once this task ships), so no new `lineId` generation is
  needed at these sites. Do not add generation there.
- `window.crypto.randomUUID()` is available in every environment this app runs in (Electron/Chromium and
  modern browsers) — use the bare `crypto.randomUUID()` form already implied above, matching how the
  rest of this codebase references browser globals in client components (no polyfill import needed).

- [ ] **Step 3: Convert every id-keyed cart-line operation in `use-pos.ts` from `item.id` to `item.lineId`**

This is the bulk of the task: a mechanical but exhaustive find able of every place a cart line is
looked up, filtered, or mapped by what is currently `item.id`. Go through each of the following
functions and change every `item.id === X` / `item.id !== X` / `i.id === X` comparison against a
line-selection parameter (never against a genuine product id — see the one exception called out below)
to compare `item.lineId`/`i.lineId` instead:

```ts
const selectedItem = useMemo(() => items.find(item => item.lineId === selectedItemId) || null, [items, selectedItemId]);
```

```ts
  const commitInlineName = (itemId: string, rawValue: string) => {
    const item = items.find(i => i.lineId === itemId);
    if (item) {
      const newName = rawValue.trim();
      if (newName && newName !== item.name) handleUpdateItem(itemId, newName, item.quantity, item.price, item.discount);
    }
    setEditingNameItemId(null);
  };

  const commitQty = (itemId: string) => {
    setEditingQtyItemId(null);
    const item = items.find(i => i.lineId === itemId);
    if (!item) return;
    const q = parseFloat(qtyDraft);
    if (isNaN(q) || q <= 0) { setQtyDraft(String(item.quantity)); return; }
    if (q !== item.quantity) updateQuantity(itemId, q);
  };
```

```ts
        case '-': {
          const isInputFocused = document.activeElement === inputRef.current;
          const isInputEmpty = inputRef.current ? inputRef.current.value === '' : true;
          if (selectedItemId && (!isInputFocused || isInputEmpty) && !isDialogOpen) {
            e.preventDefault();
            const item = items.find(i => i.lineId === selectedItemId);
            if (item && item.quantity > 1) requestQuantityDelta(selectedItemId, -1);
          }
          break;
        }
```

```ts
        case 'ArrowUp': {
          const isInputFocused = document.activeElement === inputRef.current;
          const isInputEmpty = inputRef.current ? inputRef.current.value === '' : true;
          if (items.length > 0 && (!isInputFocused || isInputEmpty) && !isDialogOpen) {
            e.preventDefault();
            const idx = items.findIndex(i => i.lineId === selectedItemId);
            setSelectedItemId(items[idx <= 0 ? items.length - 1 : idx - 1].lineId);
          }
          break;
        }
        case 'ArrowDown': {
          const isInputFocused = document.activeElement === inputRef.current;
          const isInputEmpty = inputRef.current ? inputRef.current.value === '' : true;
          if (items.length > 0 && (!isInputFocused || isInputEmpty) && !isDialogOpen) {
            e.preventDefault();
            const idx = items.findIndex(i => i.lineId === selectedItemId);
            setSelectedItemId(items[idx >= items.length - 1 ? 0 : idx + 1].lineId);
          }
          break;
        }
```

```ts
  const updateQuantity = (lineId: string, newQuantity: number) => {
    if (newQuantity <= 0) {
      removeItem(lineId);
    } else {
      setItems(prevItems => prevItems.map(item => {
        if (item.lineId === lineId) {
          const unit = item.selectedSellingUnit ?? baseSellingUnitOf(item);
          return { ...item, quantity: newQuantity, price: calculateEffectivePriceForUnit(unit, newQuantity, activeLevelId, defaultLevelId) };
        }
        return item;
      }));
    }
  };
```

(Note: this is `updateQuantity` already incorporating Task 5's own fix from Step 3 of that task —
Task 5 runs before this one, so by the time you reach this step `updateQuantity`'s body already reads
as shown in Task 5's Step 3, using `item.selectedSellingUnit ?? baseSellingUnitOf(item)`. This task
only changes its match condition from `item.id === productId` to `item.lineId === lineId`, and renames
the parameter from `productId` to `lineId` for clarity. No other logic in this function changes.)

```ts
  const handleUpdateItem = (itemId: string, newName: string, newQty: number, newPrice: number, newDiscount: number) => {
    setItems(prev => prev.map(item => item.lineId === itemId ? { ...item, name: newName, quantity: newQty, price: newPrice, discount: newDiscount } : item));
  };
```

```ts
  const handleVoidLine = (itemId: string | null) => {
    if (!itemId) { toast({ title: 'No Item Selected', description: 'Please select an item to void.', variant: 'destructive' }); return; }
    if (enableLineVoidAuth) { setPendingVoidItemId(itemId); setIsLineVoidAuthOpen(true); }
    else performVoidLine(itemId);
  };

  const performVoidLine = (itemId: string) => {
    const item = items.find(i => i.lineId === itemId);
    if (!item) return;
    removeItem(itemId);
    if (selectedItemId === itemId) setSelectedItemId(null);
    setPendingVoidItemId(null);
    toast({ title: 'Line Voided', description: `Removed ${item.name} from the cart.` });
  };
```

```ts
  const requestQuantityDelta = (itemId: string, delta: number) => {
    if (businessSettings?.enableEditQtyAuth) {
      setSelectedItemId(itemId);
      setPendingQtyDelta(delta);
      setIsEditQtyAuthOpen(true);
    } else {
      const item = items.find(i => i.lineId === itemId);
      if (item) updateQuantity(itemId, item.quantity + delta);
    }
  };

  const handleEditQtyAuthSuccess = () => {
    setIsEditQtyAuthOpen(false);
    if (!selectedItemId) return;
    if (pendingQtyDelta !== null) {
      const item = items.find(i => i.lineId === selectedItemId);
      if (item) updateQuantity(selectedItemId, item.quantity + pendingQtyDelta);
      setPendingQtyDelta(null);
    } else {
      unlockInlineQty(selectedItemId);
    }
  };
```

```ts
  const removeItem = (lineId: string) => {
    setItems(items.filter(item => item.lineId !== lineId));
  };
```

```ts
  const handleApplyDiscount = (itemId: string | 'ALL', percentage: number, discountType?: string, discountDetails?: { idNumber?: string; holderName?: string }) => {
    const discountIdNumber = discountDetails?.idNumber;
    const discountHolderName = discountDetails?.holderName;
    if (itemId === 'ALL') {
      setItems(items.map(item => ({ ...item, discount: percentage, discountType, discountIdNumber, discountHolderName })));
      toast({ title: 'Global Discount Applied', description: `Applied ${percentage.toFixed(2)}% discount to all items.` });
    } else {
      setItems(items.map(item => item.lineId === itemId ? { ...item, discount: percentage, discountType, discountIdNumber, discountHolderName } : item));
      toast({ title: 'Discount Applied', description: `Discount updated to ${percentage.toFixed(2)}%` });
    }
```

```ts
  const commitInlinePrice = (itemId: string, rawValue: string) => {
    const item = items.find(i => i.lineId === itemId);
    if (item) {
      const newPrice = parseFloat(rawValue);
      if (!isNaN(newPrice) && newPrice >= 0 && newPrice !== item.price) handleUpdateItem(itemId, item.name, item.quantity, newPrice, item.discount);
    }
    setEditingPriceItemId(null);
  };
```

The remaining functions in this list (`unlockInlineName`, `startEditName`, `unlockInlineQty`,
`focusInlineQuantity`, `unlockInlinePrice`, `requestInlinePriceEdit`, `focusInlineField`) only ever take
an `itemId: string` parameter and pass it straight through to `setSelectedItemId`/`setEditingXItemId`
or into a DOM element id string (`` `${prefix}-${itemId}` ``) — they never compare it against
`item.id`/`item.lineId` themselves, so their bodies do not change at all. What changes is only what
their CALLERS pass in (Step 4 below, in `PosCartTable.tsx`).

**Explicit exception — do NOT rename these:** `handleAddItem`'s and `onUnitChange`'s internal use of
`product.id`/`item.id` to identify the PRODUCT (for the mixed-goods-services check, for
`findCartLineForUnit(items, product.id, ...)` calls, and for `onUnitChange`'s own `item.id` argument to
`findCartLineForUnit`) is correct as-is and must NOT be touched — those are genuinely about product
identity, not line identity, and `findCartLineForUnit`'s signature (`productId: string`) already
expects a product id. Only line-SELECTION and line-EDITING code (the functions listed above) changes.

- [ ] **Step 4: Update `document.getElementById` scroll-target and every DOM id string keyed by line**

The scroll-into-view effect and every `id={...}` attribute built from an item id must also switch from
product id to line id, since two lines can now share a product id (making
`document.getElementById(...)` resolve to whichever DOM node happens to match first — silently
scrolling to or targeting the wrong line):

```ts
  useEffect(() => {
    if (selectedItemId) {
      document.getElementById(`pos-item-${selectedItemId}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [selectedItemId]);
```

(This one needs no code change beyond what's already there — `selectedItemId` now HOLDS a `lineId`
value after Steps 2-3, so the string it's interpolated into is already correct. Listed here only to
confirm you've traced it, not because its own text changes.)

- [ ] **Step 5: Update `PosCartTable.tsx` to pass `lineId` instead of `id` at every call site**

Every one of the 20 occurrences of `item.id` in this file's row-rendering JSX (the `key`, the row `id`
attribute, `selectedItemId === item.id` comparisons, `editingNameItemId === item.id` /
`editingQtyItemId === item.id` / `editingPriceItemId === item.id` comparisons, and every call into
`setSelectedItemId`, `commitInlineName`, `startEditName`, `commitInlinePrice`, `requestInlinePriceEdit`,
`commitQty`, `focusInlineQuantity`) becomes `item.lineId`. This is a single, uniform find-and-replace of
`item.id` → `item.lineId` across the entire `items.map((item) => (...))` block (lines ~200-311 as of
Task 4's HEAD) — every one of the 20 occurrences listed changes the same way, with no exceptions inside
that block (there is no other kind of `item.id` usage inside the row-rendering JSX).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "pos-types|use-pos|PosCartTable"`
Expected: no output.

- [ ] **Step 7: Run the relevant unit tests**

Run: `npx tsx tests/unit/pos-cart-units.test.ts && npx tsx tests/unit/mixed-cart-validation.test.ts`
Expected: both PASS. Neither test exercises `use-pos.ts`/`PosCartTable.tsx` directly (they test the
pure `lib/pos-cart-units.ts` helpers and cart-mixing validation respectively), so this is a regression
check confirming this task hasn't broken anything they depend on — not a test of `lineId` itself, which
has no automated coverage (it's React state wiring, consistent with how `onUnitChange`,
`updateQuantity`, and the rest of this hook are already untested at the unit level in this codebase).

- [ ] **Step 8: Commit**

```bash
git add "app/(app)/pos/pos-content/pos-types.ts" "app/(app)/pos/pos-content/use-pos.ts" "app/(app)/pos/pos-content/PosCartTable.tsx"
git commit -m "fix: give cart lines a synthetic id so same-product different-unit lines never collide"
```

---

### Task 6: Checkout payload sends the selected unit

**Files:**
- Modify: `app/(app)/pos/tender/use-tender.ts`

**Interfaces:**
- Consumes: `SaleItem.selectedSellingUnit` (Task 2).
- Produces: no new exports — the checkout request body gains three fields per line item, read by the
  already-existing logic in `app/api/pos/checkout/route.ts:229-252` (unmodified by this plan).

- [ ] **Step 1: Add the three fields to the checkout payload**

In `app/(app)/pos/tender/use-tender.ts`, replace the `items:` block inside the `POST /pos/checkout`
body (lines 255-266):

```ts
          items: items.map(item => ({
            id: item.id,
            name: item.name,
            quantity: item.quantity,
            price: item.price,
            discount: item.discount,
            discountType: item.discountType,
            discountIdNumber: item.discountIdNumber,
            discountHolderName: item.discountHolderName,
            taxType: item.taxType || mapTax(item.vatStatus),
            cost: item.cost
          })),
```

with:

```ts
          items: items.map(item => ({
            id: item.id,
            name: item.name,
            quantity: item.quantity,
            price: item.price,
            discount: item.discount,
            discountType: item.discountType,
            discountIdNumber: item.discountIdNumber,
            discountHolderName: item.discountHolderName,
            taxType: item.taxType || mapTax(item.vatStatus),
            cost: item.cost,
            sellingUnitId: item.selectedSellingUnit?.id ?? null,
            sellingUnitName: item.selectedSellingUnit?.name ?? null,
            sellingUnitFactor: item.selectedSellingUnit?.factor ?? null,
          })),
```

`null` rather than omitting the keys: `route.ts:229-231` reads
`item.sellingUnitId ?? null` / `item.sellingUnitFactor ?? 0` — an explicit `null` and the field being
absent are handled identically by that `??`, but sending `null` for a service line (which has no
`selectedSellingUnit`) keeps the payload shape identical across every line item, standard or service,
rather than having the key's very presence vary by item type.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep "use-tender"`
Expected: no output.

- [ ] **Step 3: Run the full unit suite**

Run: `npx tsx tests/unit/run.ts`
Expected: PASS. In particular confirm `tests/unit/mixed-cart-validation.test.ts` still passes
unmodified — this task does not touch cart-mixing validation, only what accompanies each line to
checkout.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/pos/tender/use-tender.ts"
git commit -m "feat: send the selected selling unit in the POS checkout payload"
```

---

### Task 7: Manual verification against the running app

**Files:** none (no code changes — this task is a manual pass through `npm run dev`, confirming the
five behaviors the spec commits to before calling the feature done).

**Interfaces:** none.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev` (or confirm it is already running) and open `/pos`. Log in and start a shift on a
terminal with `enableNegativeInventory` off (default), so Step 4 below can be observed.

- [ ] **Step 2: Set up a test product with a non-base selling unit**

In the back office (`/products`), open a product with stock ≥ 20 and, in its Selling Units tab, add an
extra unit (e.g. "Pack" ×12) with its own barcode and a Retail price higher than 12× the base unit's
price (so a mispriced line is visually obvious). Save.

- [ ] **Step 3: Verify scan resolves the Pack unit**

In the POS cart, type/scan the Pack unit's barcode into the main input. Confirm: the cart gets a new
line named after the product, Unit column shows "Pack" (not the base unit's name), quantity 1, price
equal to the Pack's own price/price-level — not `12 × base price` and not the base unit's own price.

- [ ] **Step 4: Verify the unit picker, re-pricing, and line-selection isolation (Task 5.5's fix)**

Add the same product's base unit as a second, separate line (search by name and click the suggestion,
or scan the base barcode). Confirm two distinct lines exist for the same product (Piece and Pack).
Click to select the Piece line specifically, then edit its quantity via the qty field (F6 or clicking
the quantity) — confirm ONLY the Piece line's quantity and price change, and the Pack line is
untouched. Then click to select the Pack line and edit ITS quantity — confirm the reverse: only Pack
changes, Piece is untouched. (Before Task 5.5's fix, both lines shared the same underlying id, so
editing one could silently affect the other, or the wrong line's inline-edit field could open — this
step is specifically verifying that fix, not just that two lines can coexist.) Also confirm voiding one
line (F2 or the void action) removes only that specific line, leaving the other intact. On the Pack
line, open the Unit dropdown and switch it to Piece; confirm quantity resets to 1 and price updates to
the Piece's price. Confirm this switch merges into the existing Piece line (summing quantities) rather
than leaving two Piece lines.

- [ ] **Step 5: Verify the stock-check fix blocks an oversell**

With the product's stock at, say, 20 base units, add 2 Pack (factor 12 → 24 base units) to the cart and
attempt to tender. Confirm the Insufficient Stock dialog appears (it must, since 24 > 20) — before this
plan's Task 5 fix, this same cart would NOT have been blocked.

- [ ] **Step 6: Complete a real sale and confirm persistence**

Reduce the cart to a quantity that IS within stock, complete the sale (any tender method). In the
database (or via the back office's Recent Sales / Void screen if it surfaces this), confirm the
resulting `sale_items` row for that line has a non-NULL `selling_unit_id`/`selling_unit_name` matching
the Pack unit, and `selling_unit_factor = 12`. Confirm `products.stock` decreased by
`quantity_sold × 12`, not by `quantity_sold`.

- [ ] **Step 7: Report findings**

If all six checks pass, the feature is verified end-to-end. If any check fails, do not proceed to
`finishing-a-development-branch` — file the discrepancy against the specific task above whose code is
responsible, fix it there, and re-run this task's checks from Step 3.

No commit for this task (no code changes) — the plan proceeds directly to final review once Step 7
confirms all checks pass.
