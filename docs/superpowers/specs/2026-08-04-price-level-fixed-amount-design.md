# Price Level Fixed Amount Adjustment — Design

**Date:** 2026-08-04
**Status:** Approved

## Problem

Price levels (Manage Price Levels — Retail, Wholesale, etc.) can only be
defined as a **percentage** adjustment over a base (Retail price or Cost):
`basePrice * (1 + percentageAdjustment / 100)`. There is no way to define a
level as a flat peso amount (e.g., "always ₱20 more than cost," rather than
"always 15% more than cost") — useful for levels where a consistent
absolute markup makes more sense than a consistent percentage across
dissimilarly-priced items.

## Goal

Let a price level be defined with an **Adjustment Type** of either
`Percentage` (existing behavior, unchanged) or `Fixed Amount` (new): a
positive peso value added on top of the chosen base (Retail or Cost).

## Non-Goals

- Negative/discount values for Fixed Amount — confirmed out of scope; both
  adjustment types stay positive-only, matching the existing Percentage
  validation. "Cheaper than retail" is still reachable via `Base On: Cost`
  for either type, same trick Percentage already relies on.
- Bulk Price Update's own `field: 'priceLevel'` target is **unaffected** —
  it writes an arbitrary caller-computed value straight into
  `product_price_levels.price` (via its own `percentage`/`fixed`/`exact`
  adjustment types chosen in that drawer) and never reads a price level's
  *definition* (`percentage_adjustment`/`calculation_base`) at all. This
  design only changes how a level's price gets **auto-suggested** in the
  Add/Edit Product forms — not how Bulk Price Update writes prices.
- No changes to `lib/price-level-seed.ts` (the Edit Product dialog's
  auto-seed-a-default-row fix from earlier today) — it seeds from the
  product's live `price` directly, not from a level's adjustment formula.
- The legacy `app/api/price-levels/route.ts` REST endpoint is dead code
  (the real UI uses the `addPriceLevel`/`updatePriceLevel` server actions in
  `app/(app)/products/actions.ts`, confirmed by tracing
  `use-manage-price-levels.ts`'s imports) — left untouched.

## Architecture

**Schema:** one new column, `price_levels.adjustment_type
ENUM('percentage','fixed') DEFAULT 'percentage'`. The existing
`percentage_adjustment` column is **reused** to hold the value regardless of
type — a percent when `adjustment_type = 'percentage'`, a peso amount when
`'fixed'`. No second column, no data migration for existing rows (all
implicitly `'percentage'`, unaffected).

**Formula:**
- `percentage` (unchanged): `basePrice * (1 + value / 100)`
- `fixed` (new): `basePrice + value`

Both read the same `Base On` selector (Retail or Cost) to pick `basePrice`.

**Consolidation:** `calculatePriceLevelPrice` currently exists as two
independent, identical copies (`app/(app)/products/add-product/use-add-product-form.ts:44`
and `app/(app)/products/edit-product/use-edit-product-form.ts:31`), and a
third structurally-similar branch lives inside `calculateSuggestedPrice`
(`lib/purchase-utils.ts:209-233`). All three need the same
`adjustment_type` branching. Extract one shared, type-aware function into a
new `lib/price-level-calc.ts`; both hook files import it instead of
defining their own copy, and `calculateSuggestedPrice` calls it internally
for the price-level portion of its calculation instead of inlining the
formula a third time.

## Components

- **Migration** (new `scripts/migrations/108_...ts`, registered in
  `scripts/migrations/index.ts`): adds `adjustment_type` to `price_levels`,
  idempotent (`INFORMATION_SCHEMA.COLUMNS` guard), matching the pattern in
  migration 107.
- **`lib/types.ts`** (modify): `PriceLevel.adjustmentType?: 'percentage' |
  'fixed'`.
- **`lib/price-level-calc.ts`** (new): exports the shared, type-aware
  calculation function (replacing the two duplicated
  `calculatePriceLevelPrice` copies) — pure, unit-testable, no DB/React
  imports, matching the pattern already established by
  `lib/price-update-math.ts` and `lib/price-level-seed.ts`.
- **`app/(app)/products/add-product/use-add-product-form.ts`** (modify):
  remove the local `calculatePriceLevelPrice`, import the shared one.
- **`app/(app)/products/edit-product/use-edit-product-form.ts`** (modify):
  same — remove the local copy, import the shared one.
- **`lib/purchase-utils.ts`** (modify): `calculateSuggestedPrice`'s
  price-level branch calls the shared function instead of inlining
  `adjustment / 100`.
- **`app/(app)/products/actions.ts`** (modify): `getPriceLevels`,
  `addPriceLevel`, `updatePriceLevel` read/write `adjustment_type`
  alongside the existing `percentage_adjustment`/`calculation_base`.
- **`app/(app)/products/price-levels/use-price-level-form.ts`** (modify):
  add `adjustmentType` state; validation message adapts to the selected
  type ("Markup percentage" vs. "Fixed amount") but keeps the same
  positive-only rule for both.
- **`app/(app)/products/price-levels/price-level-form.tsx`** (modify): new
  "Adjustment Type" selector; the value input's label/prefix/suffix adapts
  (`Markup %` + `%` suffix vs. `Fixed Amount` + `₱` prefix); the "Base On"
  helper text rewords per type.
- **`app/(app)/products/price-levels/price-level-row.tsx`** (modify): list
  row shows `₱X` instead of `X%` for fixed-type levels.

## Data Flow

1. User creates/edits a price level in Manage Price Levels, picks
   `Adjustment Type: Fixed Amount`, enters a peso value, picks `Base On`.
2. `addPriceLevel`/`updatePriceLevel` persists `adjustment_type = 'fixed'`
   and the value in `percentage_adjustment`.
3. `getPriceLevels` (and every other read of the `price_levels` table used
   by the Add/Edit Product forms) returns `adjustmentType: 'fixed'` on that
   level's object.
4. Anywhere a level's suggested price is computed — Add Product's
   auto-markup-calc effect, Edit Product's equivalent effect, either one's
   manual "pick a level" price-level row — calls the shared
   `lib/price-level-calc.ts` function, which branches on `adjustmentType`
   and returns `basePrice + value` instead of `basePrice * (1 + value/100)`.
5. The computed value still lands in the product's own
   `product_price_levels.price` as a plain number — same as today, still
   freely overridable per product, still whatever downstream consumers
   (Products table, Bulk Price Update, Edit dialog's Price Levels tab)
   already expect. Nothing downstream of the stored price needs to know or
   care which adjustment type produced it.

## Error Handling

- Same positive-only validation for both types, reworded per type
  (`"Markup percentage must be a valid positive number."` /
  `"Fixed amount must be a valid positive number."`).
- `adjustmentType` defaults to `'percentage'` at every read layer (DB
  column default, and defensively in the shared calc function) so any row
  written before this migration — or a malformed/missing value — behaves
  exactly as it does today.

## Testing

- Unit tests for `lib/price-level-calc.ts` (both formulas, both bases, a
  missing/invalid `adjustmentType` falling back to percentage behavior),
  following the existing `tests/unit/*.test.ts` convention.
- Manual verification in the browser (no automated E2E for this — matches
  how the existing Manage Price Levels feature has no E2E coverage today):
  create a Fixed Amount level, confirm the list row shows `₱X`, open Add
  Product, change cost, confirm the auto-suggested price for that level is
  `cost + X` (or `retail + X` per Base On), repeat for Edit Product.
