# Remove tiered/quantity-break pricing (Min Qty)

## Context

The Selling Units tab (add/edit product) shows a "Min Qty" input next to
every price-level override row. The user's original request was to
remove it, on the assumption that it duplicates the selling unit's own
"Qty in Pieces" (conversion factor) field.

Investigation showed these are unrelated concepts:

- **Qty in Pieces** (selling unit row) — the conversion factor, e.g. 1
  Case = 60 Pieces.
- **Min Qty** (price level row) — a quantity-break trigger. If the sale
  quantity for a line reaches this threshold, that price level's price
  auto-applies regardless of which price level the cashier has active.
  The rule lives in `lib/pricing.ts` (`calculateEffectivePrice` and
  `calculateEffectivePriceForUnit`, the `isTierHit` branch) and is
  exercised live in the POS cart: `use-pos.ts`'s `updateQuantity` and
  `handleAddItem` recalculate price on every quantity edit, so bumping a
  line's quantity can currently cause its price to drop mid-sale.

Decision (confirmed with the user): remove the tiered-pricing feature
entirely, not just the UI field. This is a real, user-visible checkout
behavior change — the "type more, price drops" behavior disappears —
which the user has explicitly accepted.

While removing this, also drop `price_levels.min_quantity` — a second,
unrelated column found during investigation that is already dead: it
round-trips through `addPriceLevel`/`updatePriceLevel` in `actions.ts`
but no UI exposes it and no pricing logic ever reads it. It's directly
adjacent debris from the same feature area, so it's cleaned up in the
same pass rather than left for a separate task.

## Out of scope

- `schema.sql` / `verdix_install.sql` are already stale relative to the
  live schema (they predate migration 121 and don't even contain
  `product_selling_unit_price_levels`). That drift is pre-existing and
  not caused by or fixed by this change.
- No changes to `ManagePriceLevelsDialog` or `BulkPriceUpdateDrawer` —
  neither ever exposed `minQuantity` in their UI.

## Changes

### 1. Core pricing logic — `lib/pricing.ts`

Remove the `isTierHit` branch and the `minQty` variable from both
`calculateEffectivePrice` and `calculateEffectivePriceForUnit`. A price
level row now applies only when it matches the active level or is the
default level — never based on quantity. `SellingUnitPriceLevel` and
related types drop `minQuantity`.

### 2. Database migration — `scripts/migrations/128_drop_price_level_min_quantity.ts`

`up()`:
```sql
ALTER TABLE product_selling_unit_price_levels DROP COLUMN min_quantity;
ALTER TABLE price_levels DROP COLUMN min_quantity;
```

`down()`: re-add both columns as `INT DEFAULT 0` (matching their
original definitions from migration 121 / the legacy `price_levels`
table), for symmetry with the project's migration convention. Data is
not restored on rollback — that's consistent with how other
column-drop migrations in this codebase behave.

No NOT NULL/FK constraints exist on either column (confirmed), so this
is a clean drop with no data-migration step needed.

### 3. Write-path cleanup (stop passing the column)

- `app/(app)/products/actions.ts` — remove `min_quantity` from the
  INSERT column lists in `replaceSellingUnitPriceLevels`,
  `writeSellingUnits` (3 sites), and the `getPriceLevels`/
  `addPriceLevel`/`updatePriceLevel`/`deletePriceLevel` handling of
  `price_levels.min_quantity`. Simplify `updateProductPrice`'s
  `min_quantity IS NULL OR 0` branch check since there's no longer a
  tiered vs. default distinction to make — a selling unit's price
  levels become one row per level, full stop.
  Also drop `minQuantity` from `getProducts`' read/sort of
  `product_selling_unit_price_levels` (the row shape no longer has it).
- `src/infrastructure/repositories/MySqlProductRepository.ts` — drop
  the `min_quantity` read/sort.
- `lib/price-list-import.ts` — drop the hardcoded `min_quantity: 0`
  from both INSERTs.
- `src/infrastructure/services/TransferStockService.ts` — stop
  selecting/copying `min_quantity` when cloning price-level rows to
  the target selling unit.
- `lib/purchase-actions.ts` — drop `min_quantity` from its INSERT.
- `lib/price-level-seed.ts` — stop seeding `minQuantity: 0`.

### 4. Type cleanup

Remove the `minQuantity` field from:
- `lib/types.ts` (`Product.priceLevels[]`, `sellingUnits[].priceLevels[]`, `PriceLevel`)
- `src/core/products/domain/Product.ts` (`ProductEntity`/`ProductPriceLevel`)
- `src/core/products/application/CreateProductUseCase.ts` (`CreateProductRequest`)
- `app/(app)/products/edit-product/product-schema.ts` and
  `add-product/product-schema.ts` (drop the Zod field from both
  `priceLevels` shapes)

### 5. UI removal (3 touchpoints)

- `app/(app)/products/edit-product/tabs/conversion-tab.tsx` — remove
  the "Min Qty" `<Input>`, `setMinQuantity`, and the `minQuantity` field
  from `PriceLevelOverrides`' value shape. The Price input's row layout
  collapses back to a single full-width field (no more `flex gap-3`
  split with the 100px Min Qty column).
- `app/(app)/products/add-product/tabs/conversion-tab.tsx` — identical
  removal (this file is a near-duplicate of the edit-product version).
- `app/(app)/products/page.tsx` — remove the `(min N)` badge suffix
  rendered next to price-level badges, for both the base unit's row and
  each expanded extra selling unit.

### 6. Test updates

- `tests/unit/pricing.test.ts` — remove the tiered-override test
  case(s) that assert on `isTierHit` behavior (below/at tier minimum).
  Keep the tests that assert default/active-level resolution.
- `tests/unit/seed-default-price-level.test.ts` — drop the expected
  `minQuantity: 0` literal from the seeded row assertion.
- `setup_integration_test.ts` — stop seeding `min_quantity` into the
  legacy `product_price_levels` rows it sets up.

## Testing

- `npm run typecheck` — catches any remaining `minQuantity` references
  after the type/schema cleanup.
- `npm run migrate` then `npm run migrate:down` against a local DB to
  confirm the column drop and its rollback both run cleanly.
- `npm run test:e2e` for the product add/edit and POS checkout specs,
  to confirm price-level override editing and POS pricing still work
  with the field gone and that no test asserts on tiered pricing.
- Manual check in the running app: add a price-level override on a
  selling unit, confirm the row now shows only a Price input; run a POS
  sale and bump a line's quantity, confirm the price no longer changes
  based on quantity (only price-level switches change it).
