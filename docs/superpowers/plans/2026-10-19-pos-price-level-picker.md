# POS Price Level Picker + Price Levels in Product Import — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a cashier price any cart line at any configured price level regardless of quantity tiers, and let the product import carry a price column per price level.

**Architecture:** A new pure resolver in `lib/pricing.ts` resolves "this unit, this level, ignore tiers". A per-line `pickedPriceLevelId` on `SaleItem` is consulted by every path that re-prices a line, so the pick survives quantity changes, re-scans and the hold/queue JSON round trips. The dead `PriceEditDialog` is wired up as F7's destination and gains the picker. The import schema becomes a function of the configured price levels, so the existing `auto-map` → `classify` → `csv-out` pipeline carries level columns with no change to those three files.

**Tech Stack:** Next.js 16, TypeScript, raw `mysql2/promise`, React Query, shadcn/ui, `tsx` unit runner (`npm run test:unit`), Playwright E2E.

**Spec:** [docs/superpowers/specs/2026-10-19-pos-price-level-picker-design.md](../specs/2026-10-19-pos-price-level-picker-design.md)

## Global Constraints

- **`min_quantity = 0` is the only encoding of "no tier".** Collapse blank/negative/NULL to 0 on every write.
- **Price levels are keyed by `selling_unit_id`** in `product_selling_unit_price_levels`. `product_price_levels` is DROPPED — never write to it.
- **A level with no override row for a unit falls back to that unit's own `price`** — never another unit's price, never a computed multiple.
- **Existing min-qty tier behaviour must not change**, including the cross-level widening rule in `lib/pricing.ts:qualifies`. This work is additive.
- **Never write to `products.price` or `product_selling_unit_price_levels` from POS.** Picking a level prices one line of one sale.
- **Verification baseline is red:** `npm run lint` is unusable (`next lint` removed in Next 16, no eslint config), `npm run typecheck` is already failing on main. Capture a baseline before claiming any failure is yours.
- **Unit tests hang if a test imports `lib/mysql`** (cron side effect). Keep new unit tests on pure modules. Never call `process.exit(0)` from a test file.
- **Do not regress the 15k-row import path.** The wizard chunks at `BATCH = 50` because of remote-DB latency.
- Migrations are numbered TypeScript files with `up()`/`down()`; the latest is `141_add_batch_id_to_stock_adjustments.ts`, so this plan's migration is **142**.

## Review Focus

Input classes the spec implies but no task's happy path exercises. Each has its test pinned to the owning task.

1. **A picked level on a line whose unit has no row for that level** — must yield the unit's own price, not 0, not another unit's price. (Task 1)
2. **A cart held before this ships, restored after** — `pickedPriceLevelId` is `undefined` and the line must follow the cart-wide level as it does today, not throw or price at 0. (Task 4)
3. **A picked level whose price level row is later deleted** — a filed sale must still render its captured level name, and a live cart must fall back rather than price at 0. (Tasks 1, 6)
4. **An import column naming a level that does not exist** — reported at the mapping step, other rows still import. (Task 8)
5. **An import price cell that is blank vs `0`** — blank means "don't write a row", `0` means "sell at cost". Never coerce between them. (Task 9)

---

## File Structure

**POS pricing core**
- Modify `lib/pricing.ts` — add `resolvePriceForLevel` beside `qualifies`; pure, DB-free.
- Modify `app/(app)/pos/pos-content/pos-types.ts` — add `pickedPriceLevelId?: string` to `SaleItem`.

**POS re-pricing paths** (the Constraint 1 surface)
- Modify `app/(app)/pos/pos-content/use-pos.ts` — one shared line-pricing helper; the level-change effect, `updateQuantity`, `handleAddItem`, and the restore/claim/recall paths all route through it.

**Edit Price dialog**
- Modify `app/(app)/pos/price-edit/price-edit-types.ts` — props for levels + picked level.
- Modify `app/(app)/pos/price-edit/use-price-edit.ts` — picker state, level→price, save payload.
- Modify `app/(app)/pos/price-edit/PriceEditDialog.tsx` — render the picker.
- Modify `app/(app)/pos/pos-content/PosDialogs.tsx` — render the dialog.
- Modify `app/(app)/pos/pos-content/PosCartTable.tsx` — per-line level badge.

**Settings toggle** (6-point pattern)
- Create `scripts/migrations/142_add_pos_price_level_picker.ts`
- Modify `app/api/pos-settings/route.ts`, `app/(app)/settings/pos-setup/pos-setup-types.ts`, `app/(app)/settings/pos-setup/GeneralSettingsCard.tsx`, `lib/types.ts`

**Sale record**
- Create `scripts/migrations/143_add_price_level_to_sale_items.ts`
- Modify `lib/pos/process-sale-leg.ts`

**Import**
- Modify `lib/import/entity-schemas.ts` — dynamic level fields + `priceLevelFieldKey` helpers.
- Modify `components/import-wizard/use-import-wizard.ts` — fetch levels, build augmented schema, unmatched-column warning.
- Modify `components/import-wizard/ImportWizard.tsx` — render the warning.
- Modify `app/api/data-management/import/products/route.ts` — write level overrides.
- Modify `lib/import/csv-out.ts` — `SAMPLE` must not be the only source for dynamic keys.

**Tests**
- Create `tests/unit/pricing-picked-level.test.ts`, `tests/unit/import-price-level-fields.test.ts`
- Modify `tests/unit/import-schemas.test.ts` if the schema export shape changes.

---

### Task 1: The tier-ignoring resolver

**Files:**
- Modify: `lib/pricing.ts`
- Test: `tests/unit/pricing-picked-level.test.ts` (create)

**Interfaces:**
- Consumes: `PricedSellingUnit`, `SellingUnitPriceLevel` (already exported from `lib/pricing.ts`).
- Produces: `resolvePriceForLevel(unit: PricedSellingUnit, levelId: string): number` — the price for exactly that level on that unit, ignoring `minQuantity` entirely; the unit's own `price` when the unit has no row for the level.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/pricing-picked-level.test.ts` in the style of `tests/unit/pricing.test.ts` (`node:assert/strict`, bare blocks, no test framework):

```ts
import assert from 'node:assert/strict';
import { resolvePriceForLevel } from '../../lib/pricing';

const wholesale = 'wholesale-level';
const dealer = 'dealer-level';

// a matching override wins, at ANY quantity-irrelevant state
{
  const unit = { price: 120, priceLevels: [{ levelId: wholesale, price: 95 }] };
  assert.equal(resolvePriceForLevel(unit, wholesale), 95);
}

// THE POINT OF THE FEATURE: a tiered row applies even below its threshold
{
  const unit = { price: 120, priceLevels: [{ levelId: wholesale, price: 95, minQuantity: 12 }] };
  assert.equal(resolvePriceForLevel(unit, wholesale), 95,
    'a picked level ignores min_quantity — this is the whole feature');
}

// Review Focus 1: no row for that level -> the unit's OWN price
{
  const unit = { price: 27.05, priceLevels: [{ levelId: dealer, price: 20 }] };
  assert.equal(resolvePriceForLevel(unit, wholesale), 27.05,
    'no override falls back to the unit\'s own price, never another level\'s');
}

// a picked level may RAISE the price — unlike calculateEffectivePriceForUnit
{
  const unit = { price: 100, priceLevels: [{ levelId: wholesale, price: 150 }] };
  assert.equal(resolvePriceForLevel(unit, wholesale), 150,
    'a direct pick is an instruction, not a min-of-candidates');
}

// Review Focus 3: unknown/deleted level id -> the unit's own price, never 0
{
  const unit = { price: 55, priceLevels: [] };
  assert.equal(resolvePriceForLevel(unit, 'deleted-level'), 55);
}

// no priceLevels array at all
{
  assert.equal(resolvePriceForLevel({ price: 42 }, wholesale), 42);
}

console.log('✓ pricing-picked-level');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx tests/unit/pricing-picked-level.test.ts`
Expected: FAIL — `resolvePriceForLevel` is not exported.

- [ ] **Step 3: Implement `resolvePriceForLevel(unit: PricedSellingUnit, levelId: string): number` in `lib/pricing.ts`**

Place it directly after `calculateEffectivePriceForUnit`. Find the unit's row for `levelId` and return its price; return `Number(unit.price)` when there is none. Do not call `qualifies` — consulting it is the bug this function exists to avoid.

Document in a comment why it is NOT min-of-candidates: a direct pick is an explicit instruction and may be higher than the shelf price, whereas `calculateEffectivePriceForUnit` takes the minimum so an automatic tier can only ever lower a price.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx tsx tests/unit/pricing-picked-level.test.ts`
Expected: PASS (`✓ pricing-picked-level`)

- [ ] **Step 5: Confirm the existing resolver is untouched**

Run: `npx tsx tests/unit/pricing.test.ts`
Expected: PASS — the tier rules are unchanged.

- [ ] **Step 6: Commit**

```bash
git add lib/pricing.ts tests/unit/pricing-picked-level.test.ts
git commit -m "feat: add a tier-ignoring price level resolver"
```

---

### Task 2: POS Setup toggle

**Files:**
- Create: `scripts/migrations/142_add_pos_price_level_picker.ts`
- Modify: `app/api/pos-settings/route.ts`, `app/(app)/settings/pos-setup/pos-setup-types.ts`, `app/(app)/settings/pos-setup/GeneralSettingsCard.tsx`, `lib/types.ts`

**Interfaces:**
- Produces: `PosSettings.enablePriceLevelPicker?: boolean`, DB column `pos_settings.enable_price_level_picker`, default **false** (a new UI affordance stays off until a store turns it on).

No unit test — this is a mechanical config change with no pure logic. It is verified by Step 6.

- [ ] **Step 1: Write migration 142**

Create `scripts/migrations/142_add_pos_price_level_picker.ts` with `up()`/`down()`, following `141_add_batch_id_to_stock_adjustments.ts`. Add `enable_price_level_picker TINYINT(1) NOT NULL DEFAULT 0` to `pos_settings`. `up()` must be idempotent (check `information_schema.COLUMNS` before `ALTER`, as the neighbouring migrations do).

- [ ] **Step 2: Run the migration**

Run: `npm run migrate`
Expected: 142 applied, no error.

- [ ] **Step 3: Wire the 6 points**

1. `app/api/pos-settings/route.ts` GET select list: add `enable_price_level_picker AS enablePriceLevelPicker` beside `show_quantity_in_search AS showQuantityInSearch` (~line 129).
2. Same file, POST destructure (~line 259): add `enablePriceLevelPicker`.
3. Same file, INSERT column list + values: add the column and `enablePriceLevelPicker ?? false`.
4. Same file, `allowedFields` map (~line 390): `enablePriceLevelPicker: 'enable_price_level_picker'`.
5. `pos-setup-types.ts`: add `enablePriceLevelPicker?: boolean;` to `PosSettings` and `enablePriceLevelPicker: false` to the defaults object.
6. `lib/types.ts`: add `enablePriceLevelPicker?: boolean;` to the settings interface that already carries `enablePriceEditAuth` (~line 431).

- [ ] **Step 4: Add the Switch to `GeneralSettingsCard.tsx`**

Copy the `showQuantityInSearch` block (lines 21-29). Label: `Price Level Picker in Edit Price`. Description: `Let cashiers set a cart line's price from a price level, at any quantity`.

- [ ] **Step 5: Read the setting in `use-pos.ts`**

Add `const [enablePriceLevelPicker, setEnablePriceLevelPicker] = useState(false);` beside `showQuantityInSearch` (~line 186); set it from `result.data.enablePriceLevelPicker ?? false` in the settings fetch (~line 339); return it from the hook (~line 1518).

- [ ] **Step 6: Verify by hand**

Run `npm run dev`. In Settings → POS Setup → General, toggle it on, save, reload, and confirm it persists.

- [ ] **Step 7: Commit**

```bash
git add scripts/migrations/142_add_pos_price_level_picker.ts app/api/pos-settings/route.ts "app/(app)/settings/pos-setup/pos-setup-types.ts" "app/(app)/settings/pos-setup/GeneralSettingsCard.tsx" lib/types.ts "app/(app)/pos/pos-content/use-pos.ts"
git commit -m "feat: add the price level picker POS setting"
```

---

### Task 3: Per-line picked level on `SaleItem`, and one shared pricing helper

This is the Constraint 1 surface — the highest-risk task in the plan. A partial fix is a wrong-price bug at the till.

**Files:**
- Modify: `app/(app)/pos/pos-content/pos-types.ts`, `app/(app)/pos/pos-content/use-pos.ts`

**Interfaces:**
- Consumes: `resolvePriceForLevel` (Task 1).
- Produces: `SaleItem.pickedPriceLevelId?: string` — a plain string so it survives `JSON.stringify` through the queue API. `undefined` means "follow the cart-wide level".
- Produces (internal to `use-pos.ts`): `priceLineFor(item_or_product, unit, quantity, pickedPriceLevelId?)` → `number`. Every re-pricing site calls this and nothing else.

- [ ] **Step 1: Add the field**

In `pos-types.ts`, add to `SaleItem` with a comment stating: set when a cashier picks a level for THIS line; it overrides the cart-wide `activeLevelId` and ignores quantity tiers; `undefined` means follow the cart. Plain string so it survives the queue JSON round trip.

- [ ] **Step 2: Add the shared helper in `use-pos.ts`**

Define it near `defaultLevelId`/`activeLevelId` (~line 615):

- when `pickedPriceLevelId` is set → `resolvePriceForLevel(unit, pickedPriceLevelId)`
- otherwise → `calculateEffectivePriceForUnit(unit, quantity, activeLevelId, defaultLevelId)` (today's behaviour, unchanged)

- [ ] **Step 3: Route all three in-session re-pricing sites through it**

Each currently calls `calculateEffectivePriceForUnit` directly and must pass the line's `pickedPriceLevelId`:

| Site | Location |
|---|---|
| Price-level change effect | `use-pos.ts:620-629` |
| `handleAddItem` existing-line branch (re-scan bump) | `use-pos.ts:665` |
| `handleAddItem` new-line branch | `use-pos.ts:673` (new lines have no pick — pass `undefined`) |
| `updateQuantity` | `use-pos.ts:~801` and `~808` (the merge branch) |

The level-change effect must NOT move a line that has a pick: with `pickedPriceLevelId` set, `priceLineFor` returns the same price, so the existing `changed` guard already leaves it alone. Verify that rather than assuming it.

- [ ] **Step 4: Preserve the pick across the four serialization doors**

`localStorage pos_current_cart` (`:515` write, `:1252-1258` restore), `handleRestore` (`:1101`), `handleClaimQueuedOrder` (`:956`), `handleRecallQueuedOrder` (`:978`).

A plain string field survives JSON for free, so the work here is to confirm nothing **strips or overwrites** it: check that `withLineIds` and the restore/claim/recall mappers spread the item rather than rebuilding it field-by-field, and that none of them re-price. Per the spec, a restored line keeps its own level and is NOT dragged to the new cart-wide level.

- [ ] **Step 5: Verify by hand (this is the anti-goal test)**

Run `npm run dev`, open `/pos`, start a shift, and with the picker from Task 5 not yet built, temporarily set `pickedPriceLevelId` on a line via React DevTools — or defer this step until after Task 5 and do it through the UI. Either way confirm:

1. Pick Wholesale on one line → price changes.
2. Change that line's quantity → **price holds**.
3. Scan the same item again → price holds.
4. Select a customer with a different price level → the picked line holds, other lines move.
5. Hold the sale, restore it → price holds.
6. Send to queue, recall it → price holds.

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/pos/pos-content/pos-types.ts" "app/(app)/pos/pos-content/use-pos.ts"
git commit -m "feat: keep a per-line picked price level through every re-pricing path"
```

---

### Task 4: Pre-existing carts and deleted levels in the cart

Covers Review Focus 2 and the live half of Review Focus 3. Separated from Task 3 so a reviewer can reject the fallback behaviour without rejecting the plumbing.

**Files:**
- Modify: `app/(app)/pos/pos-content/use-pos.ts`
- Test: `tests/unit/pricing-picked-level.test.ts` (extend)

**Interfaces:**
- Consumes: `resolvePriceForLevel` (Task 1), `priceLineFor` (Task 3).

- [ ] **Step 1: Extend the test**

Append to `tests/unit/pricing-picked-level.test.ts`, asserting the two fallbacks at resolver level:

```ts
// Review Focus 2: a cart held before this feature shipped has no pick.
// priceLineFor must then use calculateEffectivePriceForUnit — assert the
// resolver is not what runs by checking a tiered row still needs its qty.
{
  const unit = { price: 120, priceLevels: [{ levelId: wholesale, price: 95, minQuantity: 12 }] };
  assert.equal(calculateEffectivePriceForUnit(unit, 1, retailLevel, retailLevel), 120,
    'an undefined pick falls back to tier rules, which do not fire below threshold');
}

// Review Focus 3 (live cart): a pick naming a deleted level prices at the
// unit's own price, never 0.
{
  const unit = { price: 88, priceLevels: [{ levelId: dealer, price: 70 }] };
  assert.equal(resolvePriceForLevel(unit, 'since-deleted'), 88);
}
```

Add `calculateEffectivePriceForUnit` and `retailLevel` to the imports/consts at the top if not already there.

- [ ] **Step 2: Run it to verify it fails or passes**

Run: `npx tsx tests/unit/pricing-picked-level.test.ts`
Expected: PASS if Task 1 was implemented correctly — these assert properties Task 1's implementation should already have. If either fails, Task 1's fallback is wrong; fix `lib/pricing.ts`, not the test.

- [ ] **Step 3: Guard the picker UI against a deleted level**

In `use-pos.ts`, where `priceLevels` is held (`:109`): a line whose `pickedPriceLevelId` is not in `priceLevels` must still render. The badge (Task 6) shows nothing rather than `undefined`, and the price is already safe via Step 2. Do not silently clear the field — a filed sale's captured name (Task 7) is the record, and clearing it would lose why the line is priced as it is.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/pricing-picked-level.test.ts "app/(app)/pos/pos-content/use-pos.ts"
git commit -m "test: pin picked-level fallbacks for old carts and deleted levels"
```

---

### Task 5: Revive the Edit Price dialog on F7 with the picker

**Files:**
- Modify: `app/(app)/pos/price-edit/price-edit-types.ts`, `app/(app)/pos/price-edit/use-price-edit.ts`, `app/(app)/pos/price-edit/PriceEditDialog.tsx`, `app/(app)/pos/pos-content/PosDialogs.tsx`, `app/(app)/pos/pos-content/use-pos.ts`

**Interfaces:**
- Consumes: `resolvePriceForLevel` (Task 1), `SaleItem.pickedPriceLevelId` (Task 3), `enablePriceLevelPicker` (Task 2).
- Produces: `onUpdate(itemId, newName, newQuantity, newPrice, newDiscount, pickedPriceLevelId?)` — a **sixth optional parameter** on `handleUpdateItem`, so its two existing callers (`use-pos.ts:295` Edit Item, `:1361` `commitInlinePrice`) compile and behave unchanged.

- [ ] **Step 1: Extend `handleUpdateItem` in `use-pos.ts`**

Add the optional 6th parameter (`use-pos.ts:820`). When it is `undefined`, leave the line's existing `pickedPriceLevelId` **as is** — Edit Item and inline price edit must not clear a pick. Use a distinct sentinel if "clear the pick" ever needs expressing; it does not in this plan.

- [ ] **Step 2: Add dialog state and the F7 route in `use-pos.ts`**

Add `isPriceEditOpen` state. Change `unlockInlinePrice` usage so F7 opens the dialog: in `handleRequestPriceEdit` (`:1340`) and `handlePriceEditAuthSuccess` (`:1366`), open the dialog instead of unlocking the inline cell.

**The `enablePriceEditAuth` gate must stay in front.** It currently guards `unlockInlinePrice`; after this change it guards the dialog. Losing it is a security regression, not a cosmetic one.

When `enablePriceLevelPicker` is false the dialog still opens (it is the price-edit UI now) but renders no picker.

- [ ] **Step 3: Extend the dialog props**

In `price-edit-types.ts`, add to `PriceEditDialogProps`: `priceLevels: {id: string; name: string}[]`, `showPriceLevelPicker: boolean`, and the 6th param on `onUpdate`.

- [ ] **Step 4: Add picker state to `use-price-edit.ts`**

Hold the picked level id, seeded from `item.pickedPriceLevelId` when the dialog opens (extend the existing `isOpen` effect). Picking a level calls `resolvePriceForLevel(item.selectedSellingUnit ?? baseUnit, levelId)` and **writes the result into the `price` state**, so the cashier sees the number before saving; typing over it afterwards is allowed and keeps the picked level (the level is why, the number is what). `save()` passes both.

For a service line (`selectedSellingUnit` is `undefined`), there are no selling units and no level rows — render no picker.

- [ ] **Step 5: Render the picker in `PriceEditDialog.tsx`**

Below the price input, above "Original Price". Each level shows its name and its resulting price for this unit so the cashier can compare — that is what the dialog placement was chosen for. Mark the currently picked one.

Preserve the existing keyboard flow: the price input keeps `autoFocus`, and Enter still saves. The picker must not steal focus on open.

- [ ] **Step 6: Render the dialog in `PosDialogs.tsx`**

Add a `<PriceEditDialog>` block following the `ProductSearchDialog` pattern (`:57-69`): pass `pos.isPriceEditOpen`, `pos.selectedItem`, `pos.priceLevels`, `pos.enablePriceLevelPicker`, `pos.handleUpdateItem`, and restore focus to `pos.inputRef` on close as the neighbouring dialogs do.

- [ ] **Step 7: Decide the inline cell's fate**

F7 now opens the dialog. Decide whether the clickable price in `PosCartTable.tsx:270-277` still opens the inline editor or also opens the dialog, and say which you chose in the commit message. Two price-entry paths is what the placement decision rejected, so prefer routing the click to the dialog too.

- [ ] **Step 8: Verify by hand**

Run `npm run dev`, open `/pos`, start a shift, add an item:

1. F7 opens the dialog (not the inline cell).
2. With `enablePriceEditAuth` on, the credential prompt still appears first.
3. Picking a level fills the price box and shows each level's price.
4. Enter saves; Cancel leaves the line untouched.
5. With `enablePriceLevelPicker` off, the dialog opens with no picker.
6. Now run **all six checks from Task 3 Step 5** through the real UI.

- [ ] **Step 9: Commit**

```bash
git add "app/(app)/pos/price-edit/" "app/(app)/pos/pos-content/PosDialogs.tsx" "app/(app)/pos/pos-content/use-pos.ts" "app/(app)/pos/pos-content/PosCartTable.tsx"
git commit -m "feat: open the Edit Price dialog on F7 with a price level picker"
```

---

### Task 6: Per-line level indicator in the cart

**Files:**
- Modify: `app/(app)/pos/pos-content/PosCartTable.tsx`

**Interfaces:**
- Consumes: `SaleItem.pickedPriceLevelId` (Task 3), `priceLevels` from `use-pos.ts`.

- [ ] **Step 1: Render a badge on lines with a pick**

A line priced off-level with nothing on screen saying so is a support call. Show the level name as a small badge beside the price in the price cell (`PosCartTable.tsx:254-279`). Keep it cheap — no new column.

Per Task 4 Step 3, a pick naming a level no longer in `priceLevels` renders no badge rather than `undefined`.

- [ ] **Step 2: Verify by hand**

Pick Wholesale on one line of a two-line cart: that line shows the badge, the other does not.

- [ ] **Step 3: Commit**

```bash
git add "app/(app)/pos/pos-content/PosCartTable.tsx"
git commit -m "feat: show the picked price level on the cart line"
```

---

### Task 7: Record the price level on the sale

**Files:**
- Create: `scripts/migrations/143_add_price_level_to_sale_items.ts`
- Modify: `lib/pos/process-sale-leg.ts`

**Interfaces:**
- Consumes: `SaleItem.pickedPriceLevelId` (Task 3).
- Produces: `sale_items.price_level_id` (nullable VARCHAR), `sale_items.price_level_name` (nullable VARCHAR). `NULL` means "not priced by a picked level" and covers every existing row.

- [ ] **Step 1: Write migration 143**

Two nullable columns on `sale_items`, following the idempotent `information_schema` guard pattern. No index — nothing queries by level in this plan.

- [ ] **Step 2: Run it**

Run: `npm run migrate`
Expected: 143 applied.

- [ ] **Step 3: Write both columns in `process-sale-leg.ts`**

Extend the `INSERT INTO sale_items` at `lib/pos/process-sale-leg.ts:128-145`: add `price_level_id, price_level_name` to the column list, two `?` to the VALUES, and the values to the array.

**Capture the name denormalised**, exactly as `selling_unit_name` is (CLAUDE.md: captured at sale time so a later edit cannot change what a filed receipt meant). A level later renamed or deleted must not change the filed receipt — this is Review Focus 3's filed-sale half.

The name must come from the price level list, not from the cart line's product. If the id has no matching level, write the id with a `NULL` name rather than failing the sale.

- [ ] **Step 4: Confirm nothing else changed**

A line priced by a picked level is an ordinary sale line. Verify `cost_at_sale` is still `weightedAvgCost * factor` (per selling unit), and that VAT, discount and `selling_unit_factor` are untouched.

- [ ] **Step 5: Verify by hand**

Complete a sale with one picked-level line and one ordinary line. Query `sale_items` and confirm the first row carries both columns and the second has `NULL`. Confirm the receipt prints correctly.

- [ ] **Step 6: Commit**

```bash
git add scripts/migrations/143_add_price_level_to_sale_items.ts lib/pos/process-sale-leg.ts
git commit -m "feat: record the picked price level on the sale line"
```

---

### Task 8: Dynamic price level columns in the import schema

**Files:**
- Modify: `lib/import/entity-schemas.ts`, `lib/import/csv-out.ts`, `components/import-wizard/use-import-wizard.ts`, `components/import-wizard/ImportWizard.tsx`
- Test: `tests/unit/import-price-level-fields.test.ts` (create)

**Interfaces:**
- Produces: `priceLevelFieldKey(levelName: string): string` — the `FieldDef.key` for a level's column, e.g. `price_level_wholesale`; stable and reversible enough to map back to a level.
- Produces: `withPriceLevelFields(schema: EntitySchema, levels: {id: string; name: string}[]): EntitySchema` — the products schema plus one `number` `FieldDef` per level, each with aliases matching the level name case-insensitively and trimmed.
- Produces: `unmatchedPriceLevelColumns(headers: string[], levels): string[]` — headers that look like a price level column but match no configured level.

The augmented-schema approach means `auto-map.ts` and `classify.ts` need **no changes**: both iterate `schema.fields`, so a dynamic `FieldDef` flows through mapping, coercion and validation for free.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/import-price-level-fields.test.ts`, same bare-assert style:

```ts
import assert from 'node:assert/strict';
import { ENTITY_SCHEMAS } from '../../lib/import/entity-schemas';
import { withPriceLevelFields, priceLevelFieldKey, unmatchedPriceLevelColumns } from '../../lib/import/entity-schemas';
import { autoMapColumns } from '../../lib/import/auto-map';
import { classifyRows } from '../../lib/import/classify';

const levels = [{ id: 'retail-level', name: 'Retail' }, { id: 'wl', name: 'Wholesale' }];

// one field per configured level, appended not replacing
{
  const base = ENTITY_SCHEMAS.products;
  const aug = withPriceLevelFields(base, levels);
  assert.equal(aug.fields.length, base.fields.length + 2);
  assert.ok(aug.fields.some(f => f.key === priceLevelFieldKey('Wholesale')));
  assert.ok(aug.fields.every(f => f.required !== true || base.fields.some(b => b.key === f.key)),
    'no dynamic field is required');
}

// a header matches its level case-insensitively and trimmed
{
  const aug = withPriceLevelFields(ENTITY_SCHEMAS.products, levels);
  const mapping = autoMapColumns(['name', '  WHOLESALE  '], aug.fields);
  assert.equal(mapping[priceLevelFieldKey('Wholesale')], '  WHOLESALE  ');
}

// Review Focus 5: blank is NOT 0 — a blank cell leaves the key unset
{
  const aug = withPriceLevelFields(ENTITY_SCHEMAS.products, levels);
  const key = priceLevelFieldKey('Wholesale');
  const mapping = autoMapColumns(['name', 'Wholesale'], aug.fields);
  const rows = classifyRows([{ name: 'Milo', Wholesale: '' }], mapping, aug, new Set());
  assert.equal(rows[0].values[key], undefined, 'a blank price cell writes no row');

  const zero = classifyRows([{ name: 'Milo', Wholesale: '0' }], mapping, aug, new Set());
  assert.equal(zero[0].values[key], 0, '0 means sell at cost and must survive');
}

// Review Focus 4: a column naming no configured level is reported
{
  assert.deepEqual(unmatchedPriceLevelColumns(['name', 'Wholesale', 'Dealerr'], levels), ['Dealerr']);
  assert.deepEqual(unmatchedPriceLevelColumns(['name', 'barcode'], levels), [],
    'an ordinary product column is not an unmatched level');
}

console.log('✓ import-price-level-fields');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx tests/unit/import-price-level-fields.test.ts`
Expected: FAIL — the three helpers are not exported.

- [ ] **Step 3: Implement the three helpers in `lib/import/entity-schemas.ts`**

Dynamic fields are `type: 'number'`, never `required`, and carry **no `default`**.

This matters more than it looks. `classify.ts`'s `isEmpty` branch returns *before* `coerceValue` is reached, and only assigns a value when `field.default !== undefined` — so omitting the default is the single thing that makes a blank cell leave the key unset. Note that `coerceValue('number', '')` returns `0` (`lib/import/coerce.ts`), so a `default: 0` — or any change that routes blanks through coercion — would silently turn "don't touch this level" into "sell at cost" on every product with an empty cell. That is Review Focus 5, and it would be a mass price corruption on a 15k-row import. Do not give these fields a default.

`unmatchedPriceLevelColumns` must not flag ordinary product columns: a header counts as a candidate level column only if it does not match any static field key or alias.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx tsx tests/unit/import-price-level-fields.test.ts`
Expected: PASS

- [ ] **Step 5: Keep `csv-out.ts` working for dynamic keys**

`buildTemplateCsv` reads a hardcoded `SAMPLE` map; a dynamic key is absent and already emits `''` via `SAMPLE[k] ?? ''`, which is correct. Confirm `exportColumns` and `buildEntityExportCsv` therefore round-trip the augmented schema with no change, and only change the file if they do not.

- [ ] **Step 6: Build the augmented schema in the wizard hook**

In `components/import-wizard/use-import-wizard.ts`: fetch the configured levels (`getPriceLevels()` from `app/(app)/products/actions`, as `use-pos.ts:415` does) and replace `const schema = ENTITY_SCHEMAS[entity]` (`:30`) with a memo that applies `withPriceLevelFields` for `entity === 'products'` and returns the static schema otherwise.

`getPriceLevels` is a `'use server'` action that imports `lib/mysql`, which is fine from this client hook. It must **not** be imported by any unit test — that is the cron-worker hang named in the global constraints, which is why Task 8's helpers take `levels` as a plain argument instead of fetching.

Because `mapping`, `classified`, `requiredMapped` (`:71`) and `downloadTemplate` (`:142`) all derive from `schema`, they pick this up for free. Verify `requiredMapped` is unaffected — no dynamic field is required.

- [ ] **Step 7: Surface unmatched columns at the mapping step**

Per the spec: the column list is known before any row is read, so this belongs at mapping, not in `classify.ts` — whose only channel is a per-row `reason` that marks rows `status: 'error'` and would abort them, violating the half-apply anti-goal.

Expose `unmatchedPriceLevelColumns(parsed.headers, levels)` from the hook and render it in `ImportWizard.tsx` as a non-blocking warning naming each column: it did not match a configured price level and will be ignored. The import must still proceed.

- [ ] **Step 8: Commit**

```bash
git add lib/import/entity-schemas.ts lib/import/csv-out.ts components/import-wizard/ tests/unit/import-price-level-fields.test.ts
git commit -m "feat: add dynamic price level columns to the product import schema"
```

---

### Task 9: Write imported price level overrides

**Files:**
- Modify: `app/api/data-management/import/products/route.ts`

**Interfaces:**
- Consumes: `priceLevelFieldKey` (Task 8); row `values` carrying `price_level_*` keys.

- [ ] **Step 1: Write the overrides after the base selling unit exists**

The route already resolves a base selling unit on both paths — update at `:79-96`, insert at `:135`. Level overrides are keyed by `selling_unit_id`, so they attach to that unit's id **after** it exists.

For each `price_level_*` key present in the row, upsert `product_selling_unit_price_levels (selling_unit_id, price_level_id, price, min_quantity)` with **`min_quantity = 0`** — untiered, per the spec and the global constraint.

**Never write to `product_price_levels`.** It is dropped; this is the exact bug that bit `purchase-actions.ts` and `price-list-import.ts`.

Per spec Constraint 9, write **only** the levels present as columns. A level absent from the file is left untouched — the import is not a complete statement of the price matrix.

A key absent from `values` (blank cell) writes nothing; a value of `0` writes `0`. Never coerce between them.

- [ ] **Step 2: Keep the write count per row low**

Batch the level upserts into a single multi-row statement per product rather than one round trip each. Per-row round trips against a remote DB already caused a product-import failure on Railway, and the wizard chunks at `BATCH = 50` for that reason.

- [ ] **Step 3: Verify by hand — a fresh import**

Build a small CSV with `name`, `barcode`, `selling_price`, `Wholesale`, and one deliberately misspelled level column. Import it and confirm: the Wholesale overrides land on the base selling unit with `min_quantity = 0`; the misspelled column is warned about at mapping and ignored; the other rows import.

- [ ] **Step 4: Verify by hand — the autopricer does not clobber it**

Open an imported product in **Edit Product** → Selling Units. Confirm the imported Wholesale price is still there and unchanged.

This is spec Constraint 9's named risk: `use-selling-unit-autopricing.ts` auto-fills level rows from base cost, guarded by `adoptSavedRows` (Edit passes it, Add does not). An imported override is a saved row and should be untouchable — but this area already produced one bug where DB absence could not distinguish "deleted" from "never set". If the imported price changes on open, stop and fix the autopricer guard; a price that silently changes undoes the feature.

- [ ] **Step 5: Verify by hand — POS sees the imported price**

Open `/pos`, add the imported product, F7, pick Wholesale, and confirm the imported price appears.

This crosses the two independent product read paths (CLAUDE.md): the import writes, `MySqlProductRepository` reads for `GET /api/products` which POS calls. This step is what proves the write reached the path POS actually uses.

- [ ] **Step 6: Commit**

```bash
git add app/api/data-management/import/products/route.ts
git commit -m "feat: write imported price level overrides to selling units"
```

---

### Task 10: Full verification and branch review

**Files:** none modified unless verification finds a defect.

- [ ] **Step 1: Capture the baseline**

Run on a clean checkout of `main` first, and keep the output:

```bash
git stash list && npm run typecheck 2>&1 | tail -30
```

`npm run lint` is not a usable signal. `npm run typecheck` is already red on main — the baseline is how you prove a failure is not yours.

- [ ] **Step 2: Run the unit suite**

Run: `npm run test:unit`
Expected: the new tests pass; pre-existing failures match the baseline. Pass markers vary (`✓`, `✅`, `passed`, `ok`) — do not grep for one pattern. Use a timeout; a test that imports `lib/mysql` hangs on cron workers.

- [ ] **Step 3: Run typecheck and diff against the baseline**

Run: `npm run typecheck 2>&1 | tail -30`
Expected: no NEW errors versus Step 1.

- [ ] **Step 4: Run the E2E suite**

Run: `npm run test:e2e`
Expected: pre-existing failures only. `bulk-price-update.spec.ts:87` flakes ~40% on unchanged code — never call it a regression from one run; re-run before concluding anything.

- [ ] **Step 5: Walk the six Constraint 1 checks one final time**

Task 3 Step 5's list, through the real UI, on a build with the setting on. These are the anti-goal: a picked level that silently reverts is a wrong-price bug at the till.

- [ ] **Step 6: Request review**

Use `superpowers:requesting-code-review` for a whole-branch review. Point the reviewer at the spec's anti-goals and Review Focus, and specifically at: the `enablePriceEditAuth` gate surviving the dialog move, the seven re-pricing/serialization doors, and the `product_price_levels` prohibition.

- [ ] **Step 7: Commit any fixes**

```bash
git add -A
git commit -m "fix: address review findings"
```

---

## Self-Review

**1. Spec coverage.** Goal 1 → Tasks 1, 3, 5. Goal 2 → Task 2. Goal 3 → Tasks 8, 9. Goal 4 → Task 7. "What F7 does today" (dialog revival, auth gate, inline cell fate) → Task 5 Steps 2, 7. Constraint 1's seven doors → Task 3 Steps 3-4. Constraint 2 (`onUpdate` 6th param) → Task 5 Step 1. Constraint 4 (no per-line fetch) → Tasks 1, 5 use already-loaded data. Constraint 5 (6-point toggle) → Task 2. Constraint 6 (write through selling units) → Task 9 Step 1. Constraint 7 (schema-locked pipeline) → Task 8. Constraint 8 (sale record) → Task 7. Constraint 9 (import gaps + autopricer) → Task 9 Steps 1, 4. Constraint 10 (two read paths) → Task 9 Step 5. Receipt/`cost_at_sale` confirmation → Task 7 Step 4. Builder's-call items are stated where they arise (Task 5 Step 7, Task 6). No gaps found.

**2. Step scan.** Tasks 2, 6, 9 carry no unit tests by design — config wiring, a badge, and a DB write path, none of which is pure logic; each is pinned by a named by-hand check instead. Code bodies appear only in test steps, where the assertions and the spec's exact values are the decision.

**3. Type consistency.** `resolvePriceForLevel(unit, levelId)` — Tasks 1, 3, 4, 5. `pickedPriceLevelId` — Tasks 3, 4, 5, 6, 7. `priceLineFor` — Tasks 3, 4. `priceLevelFieldKey` / `withPriceLevelFields` / `unmatchedPriceLevelColumns` — Tasks 8, 9. `enablePriceLevelPicker` — Tasks 2, 5. Migration numbers 142, 143 are distinct and sequential from 141. Consistent.

**4. Review Focus.** All five are pinned: 1 → Task 1 Step 1; 2 → Task 4 Step 1; 3 → Task 4 Step 1 (live) and Task 7 Step 3 (filed); 4 → Task 8 Steps 1, 7; 5 → Task 8 Steps 1, 3 and Task 9 Step 1.

**5. Proportion.** Ten tasks over a spec with four goals and ten constraints. Code blocks are test assertions and two shell snippets; no implementation body is transcribed. The plan is shorter than the code it describes.
