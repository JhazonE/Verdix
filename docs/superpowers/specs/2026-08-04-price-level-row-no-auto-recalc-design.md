# Stop Auto-Recalculating Existing Price-Level Rows — Design

**Date:** 2026-08-04
**Status:** Approved

## Problem

In both Add Product and Edit Product, an effect keyed on `watchedCost` /
category / subcategory / brand / supplier recomputes **every existing
price-level row's price** from `cost + markup` (via `calculateSuggestedPrice`)
and overwrites it with `form.setValue(priceLevels.${index}.price, ...)`.
This silently discards any manually-typed value in a price-level row the
moment cost (or category/brand) changes — including a value the user just
typed into that exact row. This became a concrete problem once price levels
could hold a Fixed Amount (2026-08-04 earlier today): a Fixed Amount row is
meant to be an independent, intentional value, not something perpetually
re-derived from a percentage-style formula.

## Goal

Stop the "recompute every existing price-level row" loop. Keep everything
else in the same effect (the main `price` field's cost+markup auto-suggestion)
and keep the separate, one-time suggestion that fires when a user picks a
level from a row's own dropdown (`calculatePriceLevelPrice`, called from
`price-levels-tab.tsx`'s `onValueChange` in both Add and Edit Product) —
that path is untouched by this change.

## Non-Goals

- No "locked once manually edited" tracking — the loop is removed outright,
  not made conditional per-row. Confirmed: full removal, not partial.
- The main `price` field's auto-suggestion-from-cost+markup stays exactly
  as-is in both forms — confirmed explicitly in scope discussion.
- No change to `calculatePriceLevelPrice` / `applyPriceLevelAdjustment`
  (2026-08-04's earlier work) — the *formula* is unaffected; only *when* it
  gets applied to already-populated rows changes.
- No change to the Manage Price Levels feature itself.

## Architecture

Remove the "Apply to all price levels" block from the shared-shape effect in
both `app/(app)/products/add-product/use-add-product-form.ts` and
`app/(app)/products/edit-product/use-edit-product-form.ts` — each currently
has an identical block (a leftover of the same duplication pattern already
partly addressed by the 2026-08-04 `lib/price-level-calc.ts` consolidation,
though this specific effect wasn't part of that consolidation and isn't
being consolidated now either — YAGNI, this is a deletion, not new shared
logic). The block being removed:

```ts
// Apply to all price levels
if (priceLevels.length > 0) {
    const currentFields = form.getValues('priceLevels') || [];
    const getFieldIndex = (levelId: string) => currentFields.findIndex((f: any) => f.levelId === levelId);

    priceLevels.forEach((level: any) => {
        const levelPrice = calculateSuggestedPrice(watchedCost, markup, 0, level);
        const index = getFieldIndex(level.id);
        if (index >= 0) {
            form.setValue(`priceLevels.${index}.price`, parseFloat(levelPrice.toFixed(2)));
        }
    });
}
```

Everything above it in the same `if (watchedCost && watchedCost > 0)` block
(computing `defaultLevel`, `suggestedMainPrice`, and `form.setValue('price', ...)`)
stays untouched.

## Testing

No new pure logic to unit test (this is a deletion of an effect side
effect, not a new calculation). Manual verification in the browser: open
Add Product, set a Cost, add a price-level row (any type), confirm it gets
an initial suggested value from the dropdown-pick path; manually edit that
row's price to something else; change Cost again; confirm the manually-set
value is **not** overwritten, while the main `price` field still updates.
Repeat for Edit Product on an existing product.
