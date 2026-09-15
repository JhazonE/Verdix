# Selling Unit Price Levels — Design

**Date:** 2026-09-11
**Status:** Approved, ready for implementation planning
**Builds on:** `2026-09-10-product-selling-units-design.md` (shipped — the selling units model this extends)

## Problem

Price levels (Retail, Wholesale, …) are keyed to a **product**, one price per level. Now that a
product can have several selling units — Piece, Box of 12, Case of 60 — a single per-product price
cannot express that Wholesale on a Case is not simply 60× Wholesale on a Piece; bulk pricing has its
own economics per unit.

The base unit (factor 1) is also invisible in the product form's Selling Units tab today — it is
created automatically but has no row a user can see or edit, which makes the tab look incomplete the
moment a product has more than one way to be sold.

## Goals

- The base selling unit appears as a row in the Selling Units tab, editable like any other unit
  (barcode, cost, price), marked "Base", never deletable, factor fixed at 1.
- Price levels move from per-product to per-selling-unit: each unit's row exposes its own price per
  level, edited in the same tab. The separate Price Levels tab is retired.
- Every price level a product has today survives the migration, attached to that product's base unit.
- A selling unit with no price set for the active level falls back to its own base price — never to
  another unit's price, and never a computed multiple.

## Non-goals

- No change to how price levels themselves are defined (`price_levels` table, `calculation_base`,
  `adjustment_type`) — only to what they attach to.
- No change to `product_selling_units.price`, `.cost`, or `.barcode` semantics.
- No automatic derivation of a child unit's price level from its factor. A Case's Wholesale price is
  typed by a human, not computed from the Piece's.

---

## 1. Data model

```sql
CREATE TABLE product_selling_unit_price_levels (
  selling_unit_id  VARCHAR(100)  NOT NULL,
  price_level_id   VARCHAR(50)   NOT NULL,
  price            DECIMAL(10,2) NOT NULL,
  min_quantity     INT           DEFAULT 0,
  created_at       TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (selling_unit_id, price_level_id),
  FOREIGN KEY (selling_unit_id) REFERENCES product_selling_units(id) ON DELETE CASCADE
);
```

Keyed by `selling_unit_id`, not `product_id` — this is the whole point of the change. `ON DELETE
CASCADE` matches how `product_selling_units` itself cascades from `products`: deleting a unit deletes
its price-level rows with it, deleting a product deletes everything beneath it.

`product_price_levels` (the old, product-keyed table) is **dropped** once the migration completes.
Keeping both would recreate the exact "two sources of truth" problem the previous plan removed for
`conversion_factors` — a lesson from that work, not a new judgment call.

## 2. Migration

One data-preserving move, in the same migration that creates the table:

```sql
INSERT INTO product_selling_unit_price_levels (selling_unit_id, price_level_id, price, min_quantity)
SELECT u.id, ppl.price_level_id, ppl.price, ppl.min_quantity
FROM product_price_levels ppl
JOIN product_selling_units u ON u.product_id = ppl.product_id AND u.is_base = 1
```

Every product has exactly one `is_base = 1` row (guaranteed by the prior plan's backfill), so this
join can neither duplicate a price level nor drop one silently. Every price a user has set today
survives, attached to that product's base unit — the unit those prices were always describing before
selling units existed.

A new selling unit created after this migration starts with **no** price-level rows. That is
intentional: a Case's Wholesale price is not implied by anything, so nothing should invent one.

## 3. Add/Edit Product form

The base unit becomes a visible row in the Selling Units tab: labelled **Base**, its `factor` field
locked to `1` and not editable, and — unlike every other row — it carries no delete action. Its
barcode, cost, and price remain editable exactly like any other unit's.

Each row, base included, expands to a small sub-table of price levels: one line per level defined in
the system (Retail, Wholesale, …), with a price input. A row with no override for a level shows that
level's field blank, not zero and not a computed number — blank means "falls back to this unit's own
price," matching the resolution rule below.

The standalone **Price Levels** tab is retired; nothing else in the form references it.

## 4. Resolution at sale time

When the POS resolves a price for a selected selling unit under an active price level:

1. Look up `product_selling_unit_price_levels` for `(selling_unit_id, active_price_level_id)`.
2. If found, use that price.
3. **If not found, fall back to that selling unit's own `price` column** — never to the base unit's
   price, never to a factor-multiplied figure. A missing Case/Wholesale row must not silently charge
   the Piece/Wholesale price scaled up; it charges the Case's own listed price, which a human already
   set when the unit was created.

This mirrors exactly how base-unit pricing worked before this change (a product's own `price` was
always the retail fallback), now applied per unit instead of per product.

---

## Testing

**Unit:**
- The migration's INSERT: a product with two price levels produces exactly two rows on its base
  unit, none on any other unit of that product.
- A product with zero existing price levels produces zero rows — the join must not invent a default.
- Resolution: a unit with a level override returns that price; a unit without one returns its own
  `price`, never the base unit's.

**E2E:**
- The Selling Units tab shows the base row, labelled and undeletable, with editable barcode/cost/price.
- Setting a Wholesale price on a Case and a different one on a Piece persists both independently across
  a reload.
- A newly added unit with no Wholesale price set: selling it under Wholesale charges its own price,
  not the base unit's Wholesale price scaled by factor.

**Baseline note.** Verification here is red independently of this work — see prior specs for the
standing list (broken lint, pre-existing typecheck errors, the aborting unit-test file, unseeded
`price-levels.spec.ts`). Compare against that baseline before attributing a failure to this change.

---

## Files touched

| File | Change |
|---|---|
| New migration | `product_selling_unit_price_levels` table + data migration + drop `product_price_levels` |
| `app/(app)/products/add-product/tabs/conversion-tab.tsx` | base row, per-row price-level sub-table |
| `app/(app)/products/edit-product/tabs/conversion-tab.tsx` | same |
| `app/(app)/products/add-product/tabs/price-levels-tab.tsx` | deleted |
| `app/(app)/products/edit-product/tabs/price-levels-tab.tsx` | deleted |
| `app/(app)/products/actions.ts` | `addProduct`, `updateProduct`, `getProducts` — all `product_price_levels` queries become selling-unit-keyed |
| POS price resolution (server-side) | fallback rule per §4 |
