# POS Selling Units in the Cart — Design

**Date:** 2026-09-16
**Status:** Approved, ready for implementation planning
**Builds on:** `2026-09-10-product-selling-units-design.md` and `2026-09-11-selling-unit-price-levels-design.md`
(both shipped — the selling-units model and per-unit pricing this extends into the POS cart)

## Problem

A product can be sold multiple ways (Piece, Pack of 12, Box of 24), each with its own barcode, cost,
price, and price-level overrides — `product_selling_units` and `product_selling_unit_price_levels`
already model this, and the checkout route, void, and returns flows already read and act on a line's
`selling_unit_id`/`selling_unit_name`/`selling_unit_factor` correctly.

But the POS cart itself never populates those fields. `use-pos.ts`'s `baseSellingUnit()` helper always
resolves the base unit no matter what was scanned or searched; the barcode/SKU matchers only check a
product's own top-level `barcode`/`sku`, never `product.sellingUnits[].barcode`; and the cart's Unit
column is static display text with no picker. So today, scanning a Pack's barcode fails to resolve at
all, and there is no way for a cashier to ring up anything but a product's base unit.

## Goals

- Scanning or typing a non-base selling unit's barcode/SKU resolves and adds that unit directly to the
  cart, priced from that unit's own price/price-levels.
- A cart line for a product with more than one selling unit exposes a unit picker; switching units
  re-prices the line from the newly selected unit.
- The checkout request carries the selected unit's id/name/factor per line, so the already-correct
  backend (stock deduction, `sale_items`, `pos_transaction_items`, void, returns) receives real data
  instead of always defaulting to the base unit.
- The Insufficient Stock check compares the base-unit-equivalent quantity (`quantity × factor`) against
  available stock, not the raw cart quantity — this is a latent bug today, invisible only because
  factor is always 1 in practice.

## Non-goals

- No changes to the checkout route, `lib/batch-deduction.ts`, void, or returns — all four already
  handle `sellingUnitId`/`sellingUnitName`/`sellingUnitFactor` correctly when present; this plan only
  makes the cart actually send them.
- No changes to `product_selling_units`, `product_selling_unit_price_levels`, or
  `calculateEffectivePriceForUnit` — the data model and pricing resolver are already unit-agnostic by
  design (the resolver takes a unit, not a product).
- `sales_invoice_items` (the BIR-facing invoice-line table) has no selling-unit columns today, unlike
  `sale_items`/`pos_transaction_items`. This plan does not add them. It is a known, pre-existing gap:
  BIR invoice line items will keep showing quantity without a unit label. Fixing it means touching a
  table adjacent to BIR-numbered records, which CLAUDE.md flags as legally sensitive — out of scope
  here, called out explicitly rather than silently left inconsistent.
- No unit-conversion of an existing cart line's quantity when switching units (e.g. 24 Pieces does not
  become 2 Pack automatically). Switching units resets that line's quantity to 1.
- No new confirmation dialog on scan. A resolved non-base-unit barcode adds straight to the cart, same
  as a base-unit scan does today.

---

## 1. Cart line model

**File:** `app/(app)/pos/pos-content/pos-types.ts`

`SaleItem` gains one new field:

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
   * the product's base unit on add. Never undefined for a standard product
   * once in the cart — services carry no selling units at all, so this
   * stays undefined for them, matching how `sellingUnits` is already
   * `z.undefined()` on a service product's schema.
   */
  selectedSellingUnit?: {
    id?: string;
    name: string;
    factor: number;
    barcode?: string;
    cost?: number;
    price: number;
    isBase?: boolean;
    priceLevels?: { levelId: string; price: number; minQuantity?: number }[];
  };
};
```

The type is copied, not imported, from `Product['sellingUnits'][number]` — matching how every other
field on `Product` is already structurally duplicated into local component code in this file rather
than re-exported, and avoiding a dependency from `pos-types.ts` on an indexed-access type.

## 2. Resolving a unit on add

**File:** `app/(app)/pos/pos-content/use-pos.ts`

Replace the module-level `baseSellingUnit()` helper's exclusive use with a small resolution step at
every add-to-cart site. Add a sibling helper next to it:

```ts
// Resolves which selling unit a scanned/typed code or a plain product
// pick should use. `code` is the raw scanned/typed string; when it
// matches a non-base unit's own barcode, that unit wins. Otherwise (a
// name/SKU match, or a product-level barcode match) the base unit is
// used, same as today.
function resolveSellingUnitForAdd(product: any, code?: string) {
  const units: any[] = product.sellingUnits || [];
  if (code) {
    const trimmed = code.trim().toLowerCase();
    const byBarcode = units.find(
      (u) => !u.isBase && (u.barcode || '').toLowerCase() === trimmed
    );
    if (byBarcode) return byBarcode;
  }
  return baseSellingUnit(product);
}
```

`handleAddItem` (currently `use-pos.ts:589-629`) takes an optional second parameter, the raw code that
triggered the add (undefined for a plain suggestion-list/F9-dialog click):

```ts
const handleAddItem = useCallback((product: any, matchedCode?: string) => {
  const unit = resolveSellingUnitForAdd(product, matchedCode);
  // ...existing logic, but:
  //  - price: calculateEffectivePriceForUnit(unit, 1, activeLevelId, defaultLevelId)
  //  - new line also carries: selectedSellingUnit: unit
  //  - the existing-line re-add branch (line ~611-612) only bumps quantity
  //    when the matched unit is the SAME unit already on that line — see
  //    Section 3 for why a Pack scan must never merge into an existing
  //    Piece line for the same product.
}, [...]);
```

### Why matching-unit identity matters on re-add

Today, scanning the same product twice bumps the existing line's quantity (`use-pos.ts:611-612`) keyed
only by `product.id`. Once two different units of the same product can both be in the cart (a cashier
rings a loose Piece, then later scans a Pack of the same product), quantity-bump must be keyed by
`(product.id, selectedSellingUnit.id)`, not `product.id` alone — otherwise scanning a Pack barcode would
silently bump the Piece line's quantity by 1 instead of adding a separate Pack line. This is a
correctness requirement, not a preference: it is the same reasoning `sale_items` already encodes by
storing `selling_unit_id` per line rather than per product.

## 3. Barcode/SKU scan and search resolution

**File:** `app/(app)/pos/pos-content/use-pos.ts`

Three functions extend their matching to also check `sellingUnits[].barcode`:

None of these three functions need to resolve or return a unit object themselves — every one of them
already receives or produces the raw scanned/typed code string, and `resolveSellingUnitForAdd` (which
`handleAddItem` calls) does the actual barcode-to-unit lookup in one place. Each function's only change
is *what it treats as a match*, plus passing that same raw code string through to
`handleAddItem(product, matchedCode)` unchanged from what it already does today for a product-level
match:

- **`findExactCodeMatch`** (`use-pos.ts:665-674`) — after the existing `p.sku`/`p.barcode` check finds
  nothing, also scan each product's `sellingUnits` for a `barcode` match; on a hit, return that product
  (same return shape as today — a bare product, no signature change). Its one call site,
  `PosCartTable.tsx:61-68`, already passes `inputValue` (the scanned code) as `matchedCode` to
  `handleAddItem` — no change needed there beyond continuing to pass it.
- **`rankMatches`** (`use-pos.ts:631-647`) — extend the `exactCode` classification (not `partial`) to
  also check `sellingUnits[].barcode`, so a full barcode scan that lands in the search input (rather
  than the dedicated scan handler) still resolves to the right unit when the suggestion is selected.
  Fuzzy `.includes(...)` matching stays product-name/SKU/barcode only — matching partial text against
  every unit's barcode too would surface confusing unit-level partial hits for what should read as a
  product-name search.
- **`handleAddItemBySKU`** (`use-pos.ts:681-701`) — the remote-fallback match (lines ~692-694) gets the
  same `sellingUnits[].barcode` check added alongside the existing `p.sku`/`p.barcode` check, so a scan
  that only resolves via the server (product not yet in the local cache) still finds the right unit; the
  matched code (already in scope as the function's own input) is passed to `handleAddItem` the same way.

In every case, the raw code string that matched is what travels to `handleAddItem`; `handleAddItem`
alone is responsible for turning that code into a unit, via `resolveSellingUnitForAdd`. No caller needs
to know which unit matched — only that something matched, and what string it was.

**Suggestion dropdown / F9 dialog:** per your confirmed answer, these keep showing only the base unit's
name/price — no change to `rankMatches`'s partial-match branch or to `ProductSearchDialog.tsx`. Unit
selection for anything other than an exact barcode scan happens after the add, via the cart-line picker
in Section 4.

## 4. Cart line unit picker

**File:** `app/(app)/pos/pos-content/PosCartTable.tsx`

The Unit cell (currently `use-pos.ts` line 235: `<TableCell ...>{item.unitOfMeasure}</TableCell>`)
becomes conditional:

```tsx
<TableCell className="text-left text-sm text-muted-foreground">
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

A single-unit product (the common case — most products have only a base unit) renders exactly as
today: plain text, no dropdown, no visual change. This uses the existing `Select` primitive already
imported and used elsewhere in this codebase (e.g. `app/(app)/products/page.tsx`), not a new component.

`onUnitChange(item, unitId)` is a new handler in `use-pos.ts`, alongside `updateQuantity`:

```ts
const onUnitChange = useCallback((item: SaleItem, unitId: string) => {
  const unit = item.sellingUnits?.find((u) => u.id === unitId);
  if (!unit) return;
  setItems((prev) =>
    prev.map((line) =>
      line === item // identity match is safe: `item` is the exact object from `items`
        ? {
            ...line,
            selectedSellingUnit: unit,
            quantity: 1, // per your confirmed answer — no factor-ratio conversion
            price: calculateEffectivePriceForUnit(unit, 1, activeLevelId, defaultLevelId),
          }
        : line
    )
  );
}, [activeLevelId, defaultLevelId]);
```

Resetting quantity to 1 on unit switch (your confirmed answer) sidesteps the re-add merge-key question
from Section 2 for this path: after a switch, the line's `(product.id, selectedSellingUnit.id)` key is
already unique among cart lines, or if another line already holds that exact unit, the two lines should
merge — the same identity rule from Section 2 applies here too, so `onUnitChange` should check for an
existing line with the same `(product.id, unitId)` and merge into it (summing quantity) rather than
leave two lines for the same product+unit.

## 5. Stock check fix

**File:** `app/(app)/pos/pos-content/use-pos.ts`, line 848

```ts
// Before:
const lowStock = items.filter(item => item.type !== 'service' && item.quantity > item.stock);

// After:
const lowStock = items.filter(item => {
  if (item.type === 'service') return false;
  const factor = item.selectedSellingUnit?.factor ?? 1;
  return item.quantity * factor > item.stock;
});
```

This is a latent bug fix, not new behavior — today `factor` is always 1 in every reachable cart state,
so `item.quantity > item.stock` and `item.quantity * factor > item.stock` are identical. Once a Box
(factor 24) is reachable, comparing raw cart quantity against base-unit stock would let a cashier ring
up "2 Box" against 30 pieces of stock (a real shortfall of 18) without tripping the Insufficient Stock
dialog. Per your confirmed answer, checkout must block on this, not allow negative stock.

## 6. Checkout payload

**File:** `app/(app)/pos/pos-content/use-tender.ts` (request builder, ~line 255-266 per the
investigation)

Add three fields per line item, sourced from `item.selectedSellingUnit`:

```ts
{
  // ...existing fields (id, name, quantity, price, discount, ...)
  sellingUnitId: item.selectedSellingUnit?.id ?? null,
  sellingUnitName: item.selectedSellingUnit?.name ?? null,
  sellingUnitFactor: item.selectedSellingUnit?.factor ?? null,
}
```

`null` rather than omitting the keys: the checkout route's existing fallback
(`app/api/pos/checkout/route.ts:229-252`) already treats a missing/invalid `sellingUnitFactor` as "use
the base unit," and explicit `null` keeps that fallback path exercised identically for a service line
(which has no `selectedSellingUnit`) as it is today. No changes to the checkout route itself — this is
the one payload change that makes its already-correct resolution logic receive real unit data instead
of always falling through to `getBaseUnit()`.

## 7. Interaction with price-level switching

`use-pos.ts`'s existing price-level re-pricing effect (`use-pos.ts:577-586`, fires when `activeLevelId`
changes) currently re-prices every line via `calculateEffectivePriceForUnit(baseSellingUnit(product),
...)`. It must change to `calculateEffectivePriceForUnit(item.selectedSellingUnit ?? baseSellingUnit(item),
...)` — otherwise switching the store's active price level would silently reprice every non-base-unit
cart line back to its base-unit price, discarding the cashier's unit selection. This is a direct
consequence of Section 2's new field and must ship in the same change, not as a follow-up.

## 8. Returns / void

No changes. Both flows (`app/api/pos/void-transaction/route.ts:83-117`,
`app/api/sales/returns/route.ts:110-253`) already read `selling_unit_factor` from the persisted sale
line, not from any live cart or product state, and already handle the base-unit fallback for
pre-existing NULL rows. Once Section 6 makes checkout persist real non-base units, these flows apply
without modification — this was confirmed during investigation, not assumed.

---

## Summary of touched files

| File | Change |
|---|---|
| `app/(app)/pos/pos-content/pos-types.ts` | Add `selectedSellingUnit` to `SaleItem` |
| `app/(app)/pos/pos-content/use-pos.ts` | New `resolveSellingUnitForAdd`, `onUnitChange`; extend `handleAddItem`, `findExactCodeMatch`, `rankMatches`, `handleAddItemBySKU`; fix stock check (line 848); fix price-level re-pricing effect (line ~581) |
| `app/(app)/pos/pos-content/PosCartTable.tsx` | Unit cell becomes conditional picker |
| `app/(app)/pos/pos-content/use-tender.ts` | Checkout payload carries `sellingUnitId/Name/Factor` |

No backend files change. No database migration. No changes to `lib/pricing.ts`, `lib/selling-units.ts`,
`lib/batch-deduction.ts`, or any `app/api/pos/*` / `app/api/sales/returns/*` route.
