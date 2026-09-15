# Parent/Child Product Reorganization — Design

**Date:** 2026-09-09
**Status:** Approved, ready for implementation planning

## Problem

Child products are hard to find and hard to price.

Today the products list renders families as an inline expandable tree: a chevron on
the parent row reveals indented child rows (`app/(app)/products/page.tsx`). Three
problems follow from this.

1. **Belonging is invisible.** When a filter or search is active the tree collapses
   to a flat list, so a child appears with no indication of which parent it belongs
   to. A user searching "Sugar 500g" cannot tell it is a unit of "Sugar 25kg".
2. **Managing a family means visiting many screens.** Adjusting the pricing of five
   child units means opening five separate Edit Product dialogs.
3. **Markup cannot be set per child.** Markup is resolved only from
   subcategory → category → brand → supplier → global default
   (`calculateMarkupPercentage`, `lib/purchase-utils.ts:124`). Every unit in a family
   inherits the same percentage, but a 25kg sack and a 500g repack do not carry the
   same margin in practice.

## Goals

- Each child product can carry its own markup percentage.
- The child list moves out of the main table into a dedicated dialog where markups
  can be edited together.
- A product shown outside its family displays which parent it belongs to.

## Non-goals

- Markup remains a **suggestion**. Nothing in this work writes to `products.price`.
  Setting a markup never changes what a product sells for; the user still enters the
  final price in the product form.
- No change to family stock sync (`lib/family-sync.ts`) or `conversion_factors`.
- No change to POS product search.

---

## 1. Data model

### Migration `117_add_product_markup_percentage.ts`

```sql
ALTER TABLE products
  ADD COLUMN markup_percentage DECIMAL(6,2) NULL DEFAULT NULL;
```

`down()` drops the column.

**NULL vs 0.** `NULL` means "inherit" — the product has no override and falls through
to the existing resolution chain. `0` is a real, deliberate value meaning "sell at
cost" and does **not** inherit. This distinction drives the UI: an empty markup cell
inherits, a typed `0` does not.

The column lives on `products` rather than on a parent/child link table, so it
applies to any product. For this work, only the child-units dialog writes to it.

### Resolver change — `lib/purchase-utils.ts`

`calculateMarkupPercentage` gains a `markupPercentage` field on its `product`
argument:

```ts
export function calculateMarkupPercentage(
  product: {
    markupPercentage?: number | null;
    category?: string;
    subcategory?: string;
    brand?: string;
    supplierId?: string;
  },
  settings: any,
  categories: any[] = [],
  subcategories: any[] = [],
  brands: any[] = [],
  suppliers: any[] = []
): { markup: number; source: string }
```

A per-product override short-circuits the chain and returns
`{ markup, source: 'Product' }`.

**This check runs before the `enableAutomaticMarkup` early return.** The toggle
governs whether the system *guesses* a markup from category/brand/supplier. A markup
typed against one specific product is not a guess — it is a deliberate entry, and
turning off automatic markup must not silently discard it.

Resulting order of precedence:

1. `product.markupPercentage` (when not null/undefined)
2. — everything below requires `enableAutomaticMarkup` —
3. subcategory / category / brand / supplier, ordered by `settings.markupPriority`
4. `settings.defaultMarkupPercentage`

### Call sites

Three call sites pass the new field through and display the existing
`markupSource` hint as `Calculated from Product Markup (X%)`:

- `app/(app)/products/add-product/use-add-product-form.ts:277`
- `app/(app)/products/edit-product/use-edit-product-form.ts:251`
- `app/(app)/purchases/add-purchase-order/add-purchase-order-dialog.tsx:342`

`Product` in `lib/types.ts` gains `markupPercentage?: number | null`, mapped from
`markup_percentage` in the product read paths.

---

## 2. Products list

### Backend — `app/(app)/products/actions.ts`

`getProducts` already restricts to `p.parent_id IS NULL` when no filters are active
(line 141), and `getProductsCount` already counts the same way (line 369).
**Pagination is already correct and needs no change** — children have never consumed
page slots.

The recursive CTE at lines 158–215 exists solely to hydrate descendants for the
inline tree. With children moving to a dialog it is **deleted**, along with its
try/catch fallback — roughly 55 lines of SQL and one query per page load.

Two scalar subqueries are added to the main `getProducts` select so the list can
render both badges without a second round trip:

```sql
(SELECT COUNT(*) FROM products c WHERE c.parent_id = p.id) AS child_count,
parent.name AS parent_name   -- via LEFT JOIN products parent ON p.parent_id = parent.id
```

`getProductsCount` is untouched.

### Frontend — `app/(app)/products/page.tsx`

Removed: `buildTree` (line 457), the `ProductWithChildren` type, the `depth` prop,
`indentStyle`, the chevron toggle, and the recursive child-row render (line 277).
`ProductRow` becomes a flat, non-recursive component.

**Child-count badge.** On rows where `child_count > 0`, a clickable badge beside the
product name reading `3 children` (singular `1 child`). Opens the child-units dialog.

**Parent badge.** On rows where `parent_name` is set, a muted, non-clickable badge
below the product name reading `↳ Sugar 25kg`. Because the unfiltered list is
top-level only, this appears only in filtered and search results — which is exactly
where a child would otherwise appear context-free.

**Row dropdown.** The `Add Child Product` item and its `QuickAddChildDialog` instance
are removed from `ProductRow`. A single `Manage Child Units` item replaces it,
opening the child-units dialog. This item shows for **every** product, including
those with no children, so a childless product still has a path to add its first
unit — the badge alone could not provide one, and showing an empty-state badge on
every one of ~15,000 rows would be noise.

### Accepted consequence

In the unfiltered view, child products become reachable only through the child-units
dialog or via search. Browsing the catalogue page by page no longer surfaces them.
This is the intent of the redesign, stated here so it is not later mistaken for a
regression.

---

## 3. Child units dialog

New files, following the structure of `bulk-price-update/`:

- `app/(app)/products/child-units/ChildUnitsDialog.tsx`
- `app/(app)/products/child-units/use-child-units.ts`

### Loading

Fetches through the existing `getChildProducts(parentId)`
(`actions.ts:2257`), extended to also select `markup_percentage` and a `child_count`
subquery. **Direct children only, not grandchildren.**

A child that has children of its own shows its own `2 children` badge; clicking it
re-targets the same dialog at that child, with a back button to return. Deep
hierarchies stay reachable without nesting a tree inside the dialog.

### Header

Parent name, unit of measure, and cost — the cost is shown because every suggested
price in the table derives from it.

### Table

| Column | Behavior |
|---|---|
| Name | read-only; child-count badge when the row has its own children |
| Unit | read-only |
| Conversion | read-only, from `conversion_factors` — how many child units per 1 parent unit |
| Stock | read-only |
| Cost | read-only |
| **Markup %** | **editable**; empty = inherit |
| Suggested | computed live, read-only |
| Current Price | read-only — what the product actually sells for today |

### Markup input

- Empty = `NULL` = inherit. A muted hint below the field shows the inherited value
  and its origin: `inherits 12% (Category)`, resolved with the same
  `calculateMarkupPercentage`.
- On change, the **Suggested** column recomputes immediately using
  `calculateSuggestedPrice(child.cost, markup, 0, defaultPriceLevel)` — the identical
  formula already used by the add and edit product forms. No new pricing math is
  introduced.
- **Current Price never changes.** Markup is a suggestion; the dialog does not write
  to `products.price`. Showing Suggested next to Current makes the gap visible so the
  user can act on it in the product form if they choose.
- Changed rows are visually highlighted. Save is disabled until something changes.

### Saving

New server action `updateChildMarkups(rows: { id: string; markupPercentage: number | null }[])`:

- Single transaction; one `UPDATE products SET markup_percentage = ? WHERE id = ?`
  per row.
- Validation: each value is `null`, or a number in `0`–`1000` inclusive. Negative
  values are rejected with an inline field error — selling below cost is expressed
  through a manual price, not a negative markup.
- Writes a `logActivity` entry, consistent with other product mutations.
- On success, invalidates the products list query so parent badge counts refresh.

### Footer

`+ Add Child Unit` on the left; `Cancel` and `Save Markups` on the right.

The Add button mounts the existing `QuickAddChildDialog` with `parentProduct`
preset — it already accepts controlled `open` / `onOpenChange` and hides its parent
selector when `parentProduct` is supplied, so no change to that component is needed.
Its `onChildAdded` callback refetches the dialog's child list, so a newly added unit
appears in the table ready for its markup.

Closing with unsaved changes prompts for confirmation.

---

## Testing

**Unit — markup resolution (`lib/purchase-utils.ts`):**

- A per-product markup overrides subcategory, category, brand, and supplier.
- `null` markup falls through to the existing chain unchanged.
- `0` markup resolves to 0 and does **not** inherit.
- A per-product markup applies when `enableAutomaticMarkup` is off; an inherited one
  does not.
- `source` reads `Product` for an override.

**Unit — `updateChildMarkups` validation:**

- Accepts `null` and values in `0`–`1000`.
- Rejects negatives and values above `1000`.
- A rejected row aborts the whole transaction; no partial write.

**E2E (`tests/e2e/`):**

- Open the dialog from the child-count badge; the parent's children are listed.
- Edit two markups, save, reopen — values persist.
- Search for a child product; the row shows the `↳ parent` badge.
- Add a child unit from inside the dialog; it appears in the list and the parent's
  badge count increments.

**Baseline note.** Verification in this repo is red before any of this work: lint is
broken, typecheck reports pre-existing errors, and the E2E suite has known failures
(including a bulk-price-update spec that fails intermittently). Any failure observed
during implementation must be checked against the baseline before being attributed
to these changes.

---

## Files touched

| File | Change |
|---|---|
| `scripts/migrations/117_add_product_markup_percentage.ts` | new — adds the column |
| `lib/purchase-utils.ts` | per-product override in `calculateMarkupPercentage` |
| `lib/types.ts` | `markupPercentage` on `Product` |
| `app/(app)/products/actions.ts` | drop recursive CTE; add `child_count`/`parent_name`; extend `getChildProducts`; new `updateChildMarkups` |
| `app/(app)/products/page.tsx` | flat rows; two badges; `Manage Child Units` menu item |
| `app/(app)/products/child-units/ChildUnitsDialog.tsx` | new |
| `app/(app)/products/child-units/use-child-units.ts` | new |
| `app/(app)/products/add-product/use-add-product-form.ts` | pass markup through |
| `app/(app)/products/edit-product/use-edit-product-form.ts` | pass markup through |
| `app/(app)/purchases/add-purchase-order/add-purchase-order-dialog.tsx` | pass markup through |
