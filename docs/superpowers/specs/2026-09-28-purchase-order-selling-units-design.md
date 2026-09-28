# Purchase Order Selling Units — Design

**Date:** 2026-09-28
**Status:** Approved for planning

## Problem

Purchase orders today have no concept of selling units. `purchase_order_items.quantity`/`cost`/`selling_price` are always treated as base-unit (piece) values, and `processPurchaseOrderReceipt` feeds those numbers straight into `inventory_batches`, `products.cost`/`.price`, and the default price level — all of which are contractually per-base-unit (see CLAUDE.md's Selling Units section).

A user ordering a product that is normally received by the case (e.g. "2 Case" instead of "48 pcs") currently has no way to express that in the PO. They must manually compute the per-piece cost themselves and enter a base-unit quantity, which is error-prone and inconsistent with how selling units already work in the Edit Product form and POS.

## Goals

- Let a PO line be entered in terms of any of a product's selling units (e.g. Case), not just the base unit.
- Cost and sell price are entered **in that unit's own terms** (₱/Case), matching how `product_selling_units.cost`/`.price` already store per-unit values.
- Search/scan in the PO's product picker mirrors POS's existing per-unit suggestion pattern exactly, for consistency and code reuse of the underlying idea (not the POS code itself, which is React-hook-specific).
- Receiving a unit-priced PO line must still deposit the correct **base-unit** quantity and cost into `inventory_batches`, `products.stock`, `products.cost`/`.price`, and price levels — none of which change their contract.
- Existing (pre-migration) purchase order data keeps working with no behavior change (implicit base unit, factor 1).

## Non-goals

- Changing how POS carts price or add selling units (`app/(app)/pos` is untouched).
- Changing `inventory_batches`, FIFO deduction (`lib/batch-deduction.ts`), or `products.stock`'s base-unit-only contract.
- Retrofitting `product_price_levels`/`parent_id`/`conversion_factors` cleanup — out of scope, tracked separately per CLAUDE.md.
- Bad Orders' product selector (`app/(app)/purchases/bad-orders/record-bad-order/product-selector.tsx`) — a near-identical component, but bad-order returns are a separate flow and not part of this design. Note it as a candidate for the same treatment later.

## Data model changes

### `purchase_order_items` — new columns

```sql
ALTER TABLE purchase_order_items
  ADD COLUMN selling_unit_id VARCHAR(100) NULL,
  ADD COLUMN selling_unit_name VARCHAR(100) NULL,
  ADD COLUMN selling_unit_factor DECIMAL(12,4) NULL;
```

- Denormalized and snapshotted at order-creation time, exactly like `sale_items.selling_unit_id`/`selling_unit_name`/`selling_unit_factor`. A later edit to a product's selling units must not change what a previously placed PO meant.
- No FK constraint to `product_selling_units` (same reasoning as `sale_items`: the unit may be renamed or deleted after the order is placed; the snapshot is authoritative).
- `quantity`, `cost`, `selling_price`, `subtotal` columns are unchanged in type/meaning — they simply now express "per `selling_unit_factor`-sized unit" instead of implicitly "per piece."

### Backfill migration

A follow-up migration sets, for every existing `purchase_order_items` row, `selling_unit_id`/`selling_unit_name`/`selling_unit_factor` to that row's product's base selling unit (`product_selling_units WHERE product_id = ? AND is_base = 1`). Since every existing row's implicit unit was already the base unit (factor 1), this is a pure metadata fill — no `quantity`/`cost` values change. A product with no base selling unit row (pre-selling-units-migration edge case) leaves the columns NULL, which the receiving code below must treat identically to factor 1.

## Search / product picker

`app/(app)/purchases/add-purchase-order/product-selector.tsx` (and, structurally, its bad-order sibling — not touched by this design but the pattern should read as reusable) changes to mirror `app/(app)/pos/pos-content/use-pos.ts`'s existing `rankMatches` / `expandToUnitSuggestions` / `matchesProductOrUnitCode`:

- **Autocomplete list:** a product with more than one selling unit expands into one suggestion row per unit (e.g. "test9 — Piece" and "test9 — Case"), each row displaying that unit's own `cost` and `price` from `product.sellingUnits[]`. A product with only a base unit renders as today (single row).
- **Exact scan/enter match** (`handleScanOrPunch`): extends its equality check to also match `sellingUnits[].barcode` for non-base units, so scanning a Case's own barcode resolves directly to that unit — not just the base unit or the legacy `products.barcode` column.
- **Selection callback:** `onSelectProduct` gains a second argument: `onSelectProduct(product: Product, unit?: SellingUnit)`. `unit` is `undefined` only for a service (no selling units) or a product resolved via its base/legacy barcode.

This is new logic parallel to POS's, not a shared import — POS's version is entangled with cart-specific state (`items`, `activeLevelId`) that doesn't apply to a PO draft. Duplicating the *shape* of the matching/expansion logic is acceptable here the same way `record-bad-order/product-selector.tsx` and `add-purchase-order/product-selector.tsx` already duplicate each other.

## PO line seeding

`use-add-purchase-order.ts`'s `handleAddProduct` becomes `handleAddProduct(product: Product, unit?: SellingUnit)`:

- `sellingUnitId`/`sellingUnitName`/`sellingUnitFactor` are set from `unit` when provided, else from the product's base unit (`sellingUnits.find(u => u.isBase)`), else `undefined`/factor `1` (product has no selling units row at all — pre-migration edge case).
- `cost` seeds from `unit.cost ?? product.cost ?? 0`; `sellingPrice` seeds from `unit.price ?? product.price ?? 0`. This is the "no computed multiples" rule: a Case's prefilled cost is its own `product_selling_units.cost`, never `product.cost × factor`.
- The "bump existing line's quantity" path (`existingItemIndex`) matches on **`productId` AND `sellingUnitId`** — not `productId` alone — so a Piece line and a Case line for the same product are two distinct rows (mirrors `findCartLineForUnit` in POS).
- No per-row unit-switcher dropdown is added to the PO items table: the unit is fixed at add-time by which suggestion row was picked, per the approved design. Changing units means removing the line and re-adding it via search.

## Suggested price column

`calculateSuggestedPrice` (in `lib/purchase-utils.ts`) is not changed. The "Suggested" column's input `unitCost` is simply whatever the row's `cost` field holds — which is now the selling unit's own cost, not always the base unit's. The markup percentage resolution (`calculateMarkupPercentage`) is unit-agnostic already (it keys off product/category/brand/supplier, not unit), so a Case row's suggested price is `caseCost × (1 + markup%)`, consistent with "suggest the unit's own price" from the approved design — no factor multiplication anywhere in this path.

## Receiving pipeline conversion

Both `calculatePurchaseCosts` (`lib/purchase-utils.ts`) and `processPurchaseOrderReceipt` (`lib/purchase-actions.ts`) currently assume `quantity`/`cost` are per-base-unit. They gain one conversion step, applied once, as early as possible, so everything past it keeps working exactly as it does today:

```
factor = item.sellingUnitFactor ?? 1
basePieceQuantity   = item.quantity * factor
basePieceUnitCost   = item.cost / factor          // per-line cost, pre-shipping-allocation
```

Concretely:

- **`calculatePurchaseCosts`**: `PurchaseItem` gains an optional `sellingUnitFactor?: number`. Line totals, VAT, and shipping allocation continue to operate on the *entered* quantity/cost (a Case-priced line's subtotal is still `caseCost × caseQty`, and shipping is still split "equally by number of item lines" or "proportional to line value" — both unit-agnostic amounts). `lineTotal`, `shippingAllocation`, and `landedCostTotal` are UNCHANGED — they stay in "as-entered" (Case) terms, since they reconcile against `subtotal`/`grandTotal`, which are also as-entered. Only `landedCostPerUnit` is converted: computed as today (`landedCostTotal / item.quantity`, i.e. landed cost per Case), then divided by `factor` to land in per-piece terms — this is the one field that feeds `inventory_batches.unit_cost`, a base-unit-contracted column, so it is deliberately the odd one out in the return shape. Callers must not derive `landedCostTotal` back from `landedCostPerUnit × item.quantity` post-conversion; use `landedCostTotal` directly for anything display/reconciliation-related.
- **`processPurchaseOrderReceipt`**: `quantityAdded` becomes `toSafeNumber(receivedItem.quantity) * factor` before it's used for `inventory_batches.quantity_in`/`quantity_remaining` and `updateStockAndRecordMovement`. `sellingPrice` (used for `inventory_batches.selling_price` and the "highest wins" price comparison) is divided by `factor` before use. `landedCost` is already per-piece from the `calculatePurchaseCosts` change above, so it's used as-is.
- **"Highest wins" comparison**: unaffected in logic — it already compares against `products.cost`/`.price`, which are per-piece. It now simply receives already-converted per-piece values instead of assuming the raw PO fields were per-piece.
- **Default price level write**: unaffected — it already writes `finalPrice` (post-conversion, per-piece) onto the product's base selling unit's price level row.

This keeps the conversion in exactly two call sites, both already sitting at the boundary between "PO-entered values" and "base-unit-contracted tables," rather than threading factor-awareness through `inventory_batches`, stock movements, or FIFO deduction.

## Error handling / edge cases

- **Product with no selling units row** (shouldn't exist post-migration-119, but defensively): `sellingUnitFactor` treated as `1`, behavior identical to today.
- **`factor` of `0` or negative**: not possible by schema (`product_selling_units.factor` has no such constraint today, but `is_base=1` rows are always `1` and non-base rows are managed only through the Edit Product Selling Units tab, which is out of scope here to further validate). Not defended against in this feature; pre-existing data integrity concern.
- **Editing an existing PO** (`id` provided → `DELETE FROM purchase_order_items` then re-insert): the new columns are simply included in the re-insert, no special handling needed.
- **Reorder flow** (`reorderData` in `use-add-purchase-order.ts`) and **prefill-from-product** (`prefillProduct`): both call `handleAddProduct`; reorder should carry forward whatever `sellingUnitId` the original PO line had (read from the historical `purchase_order_items` row, not re-resolved from the current product state) so a reorder doesn't silently re-price against a since-changed unit. Prefill-from-product has no historical unit to carry, so it uses the base unit as today.

## Testing

- Unit tests for `calculatePurchaseCosts`: a Case line (factor 4) produces `landedCostPerUnit` at 1/4 the per-Case landed cost, while `subtotal`/`vatAmount`/`grandTotal` stay in Case-entered terms.
- Unit tests for `processPurchaseOrderReceipt`: receiving 2 Cases (factor 24) inserts `inventory_batches.quantity_in = 48`; a ₱1200/Case landed cost inserts `unit_cost = 50`.
- E2E: extend `tests/e2e/purchase-order.spec.ts` with a case ordering a product by a non-base selling unit end-to-end (create → receive → assert `products.stock` increased by the base-unit-converted amount, not the raw entered quantity).
- Backfill migration: a regression test asserting every pre-existing `purchase_order_items` row ends up with `selling_unit_factor = 1` and a non-null `selling_unit_id` when the product has a base unit.

## Open questions carried into planning

None — all decisions were resolved in brainstorming (see conversation): per-unit cost entry, base-unit default selection, backfill-not-NULL for existing data, base-unit comparison for "highest wins," and unit's-own-price for the Suggested column.
