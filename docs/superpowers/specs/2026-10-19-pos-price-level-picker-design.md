# POS Price Level Picker + Price Levels in Product Import

**Date:** 2026-10-19
**Status:** Approved for planning

## Intent and the why

Two gaps, both about the same thing: a price level that exists in the data but
cannot be reached in practice.

**At the counter.** POS resolves price through `calculateEffectivePriceForUnit`,
which takes ONE `activeLevelId` for the whole cart. That level comes from the
selected customer or from `selectedPriceLevelId` — and `selectedPriceLevelId` is
written exactly once, at startup, to the default level
(`use-pos.ts:419`). **No UI anywhere calls `setSelectedPriceLevelId`.** The
plumbing is complete and the picker was never built.

So today a cashier has only two ways to reach a non-default price:

1. Select a customer who carries a `priceLevelId`.
2. Hit a quantity tier — a `min_quantity` row that fires automatically.

A product with a Wholesale price and no tier is unreachable. The cashier can see
the Wholesale price in Price Inquiry and still cannot charge it. The only escape
is Edit Price (F7), typing the number in by hand from memory — which is exactly
the manual, error-prone step the price level feature was supposed to remove.

The owner's words: the price should change when you pick a price level, *bisan ug
walay min qty* — even with no min qty.

**At import.** The product import schema has one price field, `selling_price`
(`lib/import/entity-schemas.ts:36`), which lands on the base selling unit's
`price` column. A store importing its catalogue has no way to bring its
Wholesale or Dealer prices with it; every non-default price must be typed in
afterwards, per product, through the Selling Units tab.

**Success looks like:** a cashier can give any line any configured price level
from the Edit Price dialog, in one or two keystrokes, without typing a peso
amount; and a store can load its full price matrix from one spreadsheet.

## Goals

1. A price level picker inside the Edit Price (F7) dialog that sets the price
   for **one cart line**, ignoring `min_quantity` entirely.
2. That picker is enable/disable-able from **POS Setup** settings.
3. Product import accepts a price column per configured price level, writing
   **untiered** (`min_quantity = 0`) overrides.
4. The price level a line was sold at is **recorded on the sale**, captured at
   sale time.

## What F7 does today, and what it will do

**This is the correction that reframes the POS half of the work.** The original
draft of this document assumed `app/(app)/pos/price-edit/PriceEditDialog.tsx`
was the live Edit Price UI. It is not:

- `PriceEditDialog` is imported by **nothing**. Grep across `app/` and
  `components/` returns only its own file and its own types file. There is no
  `isPriceEditOpen` state anywhere. It is dead code, the same way
  `app/activate/page.tsx` is.
- The real F7 path is `handleRequestPriceEdit` (`use-pos.ts:1340`) →
  `unlockInlinePrice` (`:1349`), which sets `editingPriceItemId` and focuses an
  **inline `<Input>` in the cart table cell** (`PosCartTable.tsx:255-278`),
  committed by `commitInlinePrice` (`use-pos.ts:1357`). Clicking the price in the
  cart reaches the same cell (`PosCartTable.tsx:273`, `title="Edit price (F7)"`).

**Decision (owner's): bring the dialog to life on F7.** F7 opens the
`PriceEditDialog` — price input plus price level picker — replacing the inline
cart cell as the F7 destination. This was chosen over squeezing a dropdown into
the table row (no space to show each level's price) and over adding a second
price-entry path (two places to change a price is a support problem).

Consequences the builder owns:

- **This changes existing cashier behaviour**, from in-place editing to a
  dialog. That is accepted, not accidental.
- The dialog must be wired in for real: state in `use-pos.ts`, render in
  `PosDialogs.tsx`, and `onUpdate` actually passed.
- `enablePriceEditAuth` currently gates `unlockInlinePrice` via
  `handlePriceEditAuthSuccess` (`use-pos.ts:1366`). That gate must end up in
  front of the dialog instead, or price edits silently lose their manager
  credential check — a security regression, not a cosmetic one.
- **Decide what happens to the inline cell and the clickable price.** Leaving
  both live means two price paths, which is what this decision rejected;
  removing the click-to-edit affordance changes a second habit. The dialog is
  the F7 destination either way. Builder's call, stated in the plan.

## Non-goals

- **Cart-wide price level switching.** Deliberately not built. The owner chose
  per-line: "pwede ang usa nga item Wholesale samtang ang uban Retail." A
  cart-wide picker would be a different feature and is not wanted now.
- **Quantity tiers in import.** Price only, no `min_quantity` column. The owner
  was asked directly and chose price-only.
- **Changing the existing min-qty tier behaviour.** The automatic quantity break
  stays exactly as it is, including the cross-level widening rule documented in
  `lib/pricing.ts`. This feature is additive.
- **Choosing a non-base selling unit in the cart.** Still not built, still out of
  scope (see CLAUDE.md).
- **Writing anything back to the product.** Picking a level at POS prices one
  line of one sale. It never touches `products.price` or
  `product_selling_unit_price_levels`. (Recording the level on `sale_items` is a
  goal — that is the sale record, not the product.)
- **Filling in price levels the import file did not mention.** Owner's call: the
  import writes only the levels present as columns. See "Import gaps" below.

## Anti-goals

Things that would make this a failure even if it technically works:

- **A picked level that silently reverts.** If the cashier picks Wholesale and
  then changes the quantity — or re-scans the item, bumping the line — and the
  price snaps back to Retail, the feature is worse than useless: it is a
  wrong-price bug at the till. See Constraint 1; this is the main engineering
  risk in the whole design.
- **A picked level that raises the price without the cashier understanding
  why.** The existing resolver takes the MINIMUM of qualifying candidates, so it
  can only ever lower a price. A direct level pick does NOT have that safety
  property — it is an explicit instruction, and it may well be higher than what
  the line shows. That is intended, but it must be visible: show the resulting
  price before it is committed.
- **Breaking the receipt or the margin.** A line priced by a picked level is
  still an ordinary sale line. `cost_at_sale`, VAT, discount, and
  `selling_unit_factor` must behave identically to any other line.
- **An import that half-applies.** A price-level column naming a level that does
  not exist should be reported, not silently dropped, and not abort the whole
  file.

## Constraints

### 1. A per-line level must survive re-pricing (the hard one)

Three code paths recompute a line's price from the cart-wide `activeLevelId` and
will destroy a per-line pick unless they are taught about it:

| Path | Location | When it fires |
|---|---|---|
| Price-level change effect | `use-pos.ts:620-629` | `activeLevelId` changes |
| Quantity change | `updateQuantity` (~`use-pos.ts:800-810`) | cashier edits qty |
| Re-scan / quantity bump | `handleAddItem` existing-line branch, `use-pos.ts:665` | same item scanned again |

The per-line level therefore has to live **on the cart line**, and every one of
these three call sites must resolve against *the line's own level if it has one,
otherwise the cart's* `activeLevelId`. A fix applied to only one or two of them
produces exactly the silent-revert anti-goal above, intermittently — which is
the worst possible failure mode for a till.

Note that `handleUpdateItem` (`use-pos.ts:820`) does NOT recompute price; it
assigns what it is handed. It is safe, but its signature carries no level, so it
needs a way to pass one.

**The cart also leaves and re-enters React state through four more doors**, and
the per-line level must survive all of them. **Owner's call: a picked level
persists** — a line held as Wholesale comes back as Wholesale.

| Door | Location |
|---|---|
| `localStorage pos_current_cart` | written on `items` change (`use-pos.ts:515`), restored at login (`:1252-1258`) |
| Hold / suspend / restore | `confirmHold` (`:1097`) → `handleRestore` (`:1101`), via `withLineIds(...)` |
| Queued order claim | `handleClaimQueuedOrder` (`:956`) |
| Queued order recall | `handleRecallQueuedOrder` (`:978`) |

The queue doors go through the **server** (`app/api/pos/queue/route.ts`, `items
JSON NOT NULL`, `JSON.stringify(items)`), so a plain scalar field on `SaleItem`
survives for free. Two things do not come for free:

- **Restore does not re-price**, while `activeLevelId` may have moved (a
  different customer selected, or a hold recalled on another terminal). Since a
  picked level persists, a restored line must keep its own level and must NOT be
  dragged to the new cart-wide level. Lines *without* a picked level follow the
  cart as they do today.
- **A cart held before this ships and restored after** has no field. `undefined`
  → fall back to `activeLevelId` is the correct and intended reading.

### 2. The Edit Price save path needs to carry a level

`handleUpdateItem(itemId, newName, newQty, newPrice, newDiscount)`
(`use-pos.ts:820`) is called by Edit Item (`use-pos.ts:295`) and
`commitInlinePrice` (`use-pos.ts:1361`). The revived dialog's `onUpdate` will be
a third caller and is the one that must also convey the picked level.
Extending the signature must not disturb the other two.

### 3. Manual price override and a picked level both exist

A cashier can type a price by hand (today's behaviour) *and* pick a level. These
are two ways to set one number. Decide which wins when both happen, and make the
dialog state coherent: picking a level should fill the price box so the cashier
sees the number before saving, and typing over it afterwards should be allowed.
This is deliberately left to the builder as a UI-coherence problem, but the
no-silent-surprise anti-goal governs it.

### 4. Price level data is already loaded; do not re-fetch per line

- `use-pos.ts:109` holds `priceLevels` (all configured levels, via
  `getPriceLevels()`).
- `MySqlProductRepository` already returns `priceLevels` per selling unit
  (`:133-160`), so each cart line's `selectedSellingUnit` carries its own
  override rows. The price for a picked level is resolvable client-side with no
  round trip.
- A level with **no override row** for that unit falls back to the unit's own
  `price` — never another unit's price, never a computed multiple
  (`lib/pricing.ts`). That rule holds here too: picking Wholesale on a unit with
  no Wholesale row yields the unit's own price, and the picker should make that
  legible rather than looking broken.

### 5. The settings toggle follows the established pattern

A new boolean POS setting is a known 6-point change (DB column, `GET` select
alias, `POST` write + key map, `PosSettings` type, default, card UI). See the
`showQuantityInSearch` / `enableNegativeInventory` precedent in
`GeneralSettingsCard.tsx` and `app/api/pos-settings/route.ts`. The project memory
note on config-driven POS toggles covers this; the `GET` route auto-adds columns.

### 6. Import must write through selling units

`product_price_levels` is **dropped**. Price levels are keyed by
`selling_unit_id` in `product_selling_unit_price_levels`. The import route
(`app/api/data-management/import/products/route.ts`) already creates/updates a
base selling unit (`:79-96`, `:135`) — level overrides attach to that unit's id,
after it exists. Writing to `product_price_levels` is the exact bug that bit
`purchase-actions.ts` and `price-list-import.ts` before.

### 7. The import pipeline is schema-locked, and level columns are dynamic

The original draft understated this. Level columns cannot simply be declared,
because `price_levels` is DB data while `ENTITY_SCHEMAS` is a module-level
`const`. Every stage derives from `schema.fields`:

- `lib/import/classify.ts:classifyRows` iterates **`schema.fields` only**
  (`for (const field of schema.fields)`). A column outside the schema never
  reaches `values`, so it never reaches the route. **There is no passthrough.**
- `components/import-wizard/use-import-wizard.ts` calls
  `autoMapColumns(pf.headers, schema.fields)` and builds both the mapping UI and
  the `requiredMapped` check from `schema.fields`. It chunks at `BATCH = 50`
  because of remote-DB round trips.
- `lib/import/csv-out.ts:buildTemplateCsv` and `exportColumns` derive from
  `schema.fields` with a hardcoded `SAMPLE` map, and its comment states export
  columns exist so that "export -> edit -> re-import round-trips cleanly."

So the builder must choose between an **augmented schema built at runtime**
(making the products schema a function of the configured levels — touches
`entity-schemas.ts`, `auto-map.ts`, `classify.ts`, `csv-out.ts`, the wizard hook
and UI, and the products export route, and changes a type customers/suppliers
imports also use) and a **separate passthrough path** for level columns
(contained to products, but duplicates mapping/coercion/validation and gives
level columns no mapping UI).

**Guidance, not a decision:** the augmented-schema route is preferred, because
the round-trip comment implies the template and the products export should each
gain a column per configured level, and a column with no mapping UI is a column
users cannot fix when it fails to match. The builder may choose otherwise with a
stated reason. Either way, do not regress the 15k-row path.

**Unmatched columns need a file-level warning surface that does not exist.**
`classify.ts`'s only reporting channel is a per-row `reason` that marks the row
`status: 'error'` — which would abort rows wholesale and violate the
half-apply anti-goal. The column list is known at the **mapping step**, before
any row is read, which is where an "unrecognised price level column" warning
belongs. Building that surface is part of this work.

### 8. Record the price level on the sale

Owner's call: yes. A line sold at Wholesale must be distinguishable from a
cashier typing 95.00 by hand, and this is cheap now and expensive to retrofit
(it would leave a blind period in the data).

This follows the convention CLAUDE.md already states for selling units: line
items carry a **denormalised** `selling_unit_name` and `selling_unit_factor`
"captured at sale time, so a later edit to a unit cannot change what a filed
receipt meant." A price level is the same shape of fact, so capture both the id
**and** the name — a level later renamed or deleted must not change what a filed
receipt meant.

Nothing in `app/api/pos/checkout/route.ts` or `lib/pos/process-sale-leg.ts`
references any price level today, and `sale_items` has no level column, so this
is a migration plus a write in `process-sale-leg.ts`. `NULL` means "not priced
by a picked level" and covers every existing row. Whether any report surfaces it
is out of scope — recording it is the goal, so the question becomes answerable.

### 9. Import gaps: write only what the file names

Owner's call. A file with a Wholesale column and no Dealer column writes the
Wholesale override and leaves Dealer alone. The import is **not** treated as a
complete statement of a product's price matrix.

This keeps the write count per row low (relevant to the 15k-row path) and avoids
overwriting prices the user never mentioned. It does mean a partially-imported
product has gaps the autopricer may later suggest into.

**Related risk the builder must check, not assume:**
`app/(app)/products/use-selling-unit-autopricing.ts` auto-fills every
price-level row of the base unit from the base cost, guarded by `adoptSavedRows`
— the Edit dialog passes it so saved rows are "all of record" and left alone;
Add does not. An imported override is a saved row and *should* therefore be
untouchable. Confirm that, because this area already produced one bug where DB
absence could not distinguish "deleted" from "never set" (fixed by policy on
reopen, not by data — see `lib/selling-unit-autoprice-cells.ts`). An imported
price that silently changes when the user opens the product would undo the
feature.

### 10. Two product read paths

Per CLAUDE.md: `app/(app)/products/actions.ts:getProducts` and
`MySqlProductRepository` are independent. This feature reads through the
repository (POS) and writes through the import route. If anything in the read
shape changes, both must change — but as specced, neither read path needs
modification.

## Decisions made

**Placement: revive the Edit Price dialog on F7.** The owner's call, made after
being shown that the dialog is dead code and F7 currently edits in place. See
"What F7 does today" above for the full consequence list. The dialog is a single
number input plus Update Price (`price-edit/PriceEditDialog.tsx`), so there is
room for a picker that shows each level's resulting price.

**Scope: per cart line.** The owner's call, stated explicitly.

**Toggle location: POS Setup.** The owner's call. `GeneralSettingsCard.tsx` is
the fitting card (behavioural on/off switches). `SecuritySettingsCard.tsx` is
table-driven for credential prompts and is NOT the right place — this toggle has
no username/password.

**Import: price per level, untiered.** The owner's call. Rows write
`min_quantity = 0`, which is the only encoding of "no tier".

**Ignoring min_quantity is the point, not an oversight.** When the cashier picks
a level directly, the level's override price applies at any quantity. The
quantity tier remains the mechanism for *automatic* breaks; the picker is the
mechanism for *deliberate* ones. Two different jobs, and the picker must not
consult the tier at all.

## Left to the builder

- **How the per-line level is stored on `SaleItem`** and how the three
  re-pricing call sites consult it. Constraint 1 says it must work; the shape is
  the builder's.
- **How the dialog's save carries the level** without breaking
  `handleUpdateItem`'s other two callers (Constraint 2) — extra optional
  parameter, separate callback, or a different decomposition.
- **What happens to the inline cart cell and the clickable price** once F7 opens
  the dialog (see "What F7 does today").
- **Whether a picked level needs a resolver function of its own.**
  `calculateEffectivePriceForUnit` applies the min-of-candidates rule and
  consults tiers, so it is the wrong tool for a direct pick. A small sibling in
  `lib/pricing.ts` that resolves "this unit, this level, ignore tiers, fall back
  to the unit's own price" is the obvious move, and keeping it next to
  `qualifies` keeps the pricing rules in one file. Unit-testable without a DB.
- **Dialog layout and keyboard flow.** The POS is keyboard-driven and the price
  input is `autoFocus`; the picker must not steal that focus or break the Enter
  key, which currently saves.
- **Whether the cart shows a per-line level indicator.** Not required, but a
  line priced off-level with nothing on screen saying so is a support call
  waiting to happen. Builder's call; a column or badge in `PosCartTable.tsx` is
  the natural spot. Keep it cheap.
- **Augmented schema vs separate passthrough** for dynamic level columns, per
  Constraint 7, which states the preference and the reason. Match columns on
  level **name**, case-insensitively and trimmed.
- **Import performance.** Per-row round trips against a remote DB already caused
  a product-import failure on Railway once; the price-level writes are extra
  statements per row. Batch them the way the existing route handles its other
  writes, and do not regress the 15k-row path.
- **Receipt behaviour.** A line priced by a picked level is an ordinary sale
  line, so VAT, discount, `selling_unit_factor` and `cost_at_sale` (per selling
  unit) should all be unchanged — confirm rather than assume. Whether the
  receipt *prints* the level is the builder's call; recording it on `sale_items`
  is required either way (Constraint 8).

## Verification notes

Per project memory: **lint is not a usable signal** (`next lint` removed in Next
16, no eslint config) and **typecheck is already red** on main. Unit tests hang if
they import `lib/mysql` (cron side effect) — use timeouts and read the pass line.
`bulk-price-update.spec.ts:87` is a known ~40% flake. Establish a baseline before
claiming any failure belongs to this work.

The pricing resolver is pure and DB-free, so the per-line level resolution and
the tier-ignoring rule should be covered by unit tests. **Constraint 1 is the
highest-value thing to test** — a test that picks a level, changes the quantity,
and asserts the price held would have caught the main anti-goal. Cover all three
in-session re-pricing paths *and* at least one serialization round trip
(hold → restore), since those are seven doors in total and a partial fix is a
wrong-price bug at the till.

Also verify by hand, since these are behavioural rather than unit-testable:

- `enablePriceEditAuth` still prompts before the dialog opens (a lost gate here
  is a security regression, not cosmetic).
- An imported level price does not change when the product is opened in Edit
  Product (Constraint 9's autopricer risk).
- An import file with a misspelled level column reports a warning at the mapping
  step and still imports its other rows.
