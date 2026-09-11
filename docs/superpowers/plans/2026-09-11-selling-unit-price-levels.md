# Selling Unit Price Levels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move price levels from per-product to per-selling-unit, and make the base selling unit a visible, editable row in the product form.

**Architecture:** A new table `product_selling_unit_price_levels`, keyed by `selling_unit_id`, replaces `product_price_levels`. A migration copies every product's existing price levels onto its base unit, so nothing is lost. The client-side resolver `lib/pricing.ts:calculateEffectivePrice` — which is the actual pricing logic the POS cart calls, not a server route — is adapted to resolve per selling unit instead of per product, keeping its existing fallback-to-own-price behaviour.

**Tech Stack:** Next.js 16 (App Router, server actions), MySQL 8 via raw `mysql2/promise`, React with react-hook-form + zod, `node:assert/strict` unit tests, Playwright E2E.

**Spec:** `docs/superpowers/specs/2026-09-11-selling-unit-price-levels-design.md`

## Global Constraints

- **`product_price_levels` (the old, product-keyed table) is DROPPED once the migration completes.** Do not keep both tables "just in case" — that recreates the exact duplication this plan exists to remove.
- **A selling unit with no price-level row for the active level falls back to ITS OWN `price` column** — never the base unit's price, never a factor-multiplied figure. This is `lib/pricing.ts`'s existing `Math.min(candidates)` behaviour, applied per unit instead of per product; do not invent new fallback logic.
- **The base selling unit is visible, editable, and permanent.** Its `factor` is locked at `1` and cannot be edited; it has no delete action; its barcode/cost/price are editable like any other unit's row.
- **A newly created selling unit starts with zero price-level rows.** Nothing may auto-derive a Case's Wholesale price from its factor or from the base unit — a human sets it, or it falls back per the rule above.
- **The migration must not lose a single existing price-level row.** Every product has exactly one `is_base = 1` unit (guaranteed by the prior plan's backfill of all 15,987 products), so the join from `product_price_levels` to that unit can neither duplicate nor drop a row.
- MySQL only, raw SQL, no ORM. Transactions use `withTransaction` from `@/lib/mysql`.
- **Unit tests** are `node:assert/strict` files that self-execute on import and MUST be registered in `tests/unit/run.ts`. A test must exit non-zero on failure (`catch` → print → `process.exit(1)`) — never a bare `finally { process.exit(0) }`.
- **`npm run test:unit` cannot verify a new test here** — `tests/unit/business-date-lock-lifecycle.test.ts:67` aborts the suite before later imports. Use `npx tsx tests/unit/<file>.test.ts` directly.
- **The verification baseline is red independently of this work**: lint broken, typecheck has pre-existing errors, four `tests/e2e/products/price-levels.spec.ts` tests fail (that spec seeds no session). Compare before attributing a failure to this change.
- **The working tree may hold uncommitted files belonging to someone else.** Before starting any task, run `git status` and note anything already modified/untracked that your task's file list does not include — treat those as off-limits. Stage only your own files by explicit path; never `git add -A` / `git add .` / `git add -u` / `git commit -a`. Never run `git stash`, `git restore`, `git checkout -- <file>`, `git reset`, or `git clean`.

---

### Task 1: The `product_selling_unit_price_levels` table and data migration

**Files:**
- Create: `scripts/migrations/121_create_selling_unit_price_levels.ts`
- Modify: `scripts/migrations/index.ts`

**Interfaces:**
- Produces: table `product_selling_unit_price_levels(selling_unit_id, price_level_id, price, min_quantity, created_at, updated_at)`. Every later task depends on it.

**Read first:** `scripts/migrations/118_create_product_selling_units.ts` for the table-creation pattern this codebase uses (idempotency guard via `INFORMATION_SCHEMA.TABLES`, `registerMigration`), and `scripts/migrations/119_backfill_base_selling_units.ts` for the data-migration pattern (an `INSERT … SELECT … WHERE NOT EXISTS` that is safe to re-run). The newest existing migration is `120_add_selling_unit_to_line_items`, so this one is **121**.

- [ ] **Step 1: Write the migration**

Create `scripts/migrations/121_create_selling_unit_price_levels.ts`:

```typescript
import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

/**
 * Price levels move from per-PRODUCT to per-SELLING-UNIT.
 *
 * A product can now be sold as a Piece, a Box of 12, a Case of 60 — each with
 * its own price. A single product-level Wholesale price cannot express that a
 * Case's bulk price is not just 60x the Piece's Wholesale price.
 *
 * Every price a user has set today is preserved, attached to that product's
 * BASE unit — the unit those prices always described before selling units
 * existed. A unit created after this migration starts with zero price-level
 * rows; nothing here invents a price for it.
 */
const migration: Migration = {
  name: '121_create_selling_unit_price_levels',
  timestamp: '2026-09-11_10-00-00',

  async up(): Promise<void> {
    const existing: any = await query(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_selling_unit_price_levels'`
    );
    if (!existing[0]) {
      await query(`
        CREATE TABLE product_selling_unit_price_levels (
          selling_unit_id  VARCHAR(100)  NOT NULL,
          price_level_id   VARCHAR(50)   NOT NULL,
          price            DECIMAL(10,2) NOT NULL,
          min_quantity     INT           DEFAULT 0,
          created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (selling_unit_id, price_level_id),
          CONSTRAINT fk_sulp_selling_unit
            FOREIGN KEY (selling_unit_id) REFERENCES product_selling_units(id) ON DELETE CASCADE
        )
      `);
      console.log('✅ created product_selling_unit_price_levels');
    } else {
      console.log('⏭️  product_selling_unit_price_levels already exists, skipping create');
    }

    // Data migration: every existing product_price_levels row attaches to
    // that product's BASE unit. Re-runnable: a row already present for a
    // given (selling_unit_id, price_level_id) is skipped, never duplicated,
    // because that pair is the primary key.
    const oldTable: any = await query(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_price_levels'`
    );
    if (oldTable[0]) {
      const result: any = await query(`
        INSERT IGNORE INTO product_selling_unit_price_levels
          (selling_unit_id, price_level_id, price, min_quantity)
        SELECT u.id, ppl.price_level_id, ppl.price, ppl.min_quantity
        FROM product_price_levels ppl
        JOIN product_selling_units u
          ON u.product_id = ppl.product_id AND u.is_base = 1
      `);
      console.log(`✅ migrated ${result.affectedRows} price-level row(s) onto base units`);

      await query('DROP TABLE product_price_levels');
      console.log('✅ dropped product_price_levels');
    } else {
      console.log('⏭️  product_price_levels already gone, nothing to migrate or drop');
    }
  },

  async down(): Promise<void> {
    // Not reversible: product_price_levels is dropped by up(), and rebuilding
    // it from product_selling_unit_price_levels would require picking one
    // selling unit's price per product when a product now has several — a
    // decision this migration has no basis to make automatically.
    console.log('⏭️  121_create_selling_unit_price_levels is not reversible past the point product_price_levels is dropped');
    const existing: any = await query(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_selling_unit_price_levels'`
    );
    if (existing[0]) {
      await query('DROP TABLE product_selling_unit_price_levels');
      console.log('✅ dropped product_selling_unit_price_levels');
    }
  }
};

registerMigration(migration);
```

`INSERT IGNORE` is the re-run safety net: the primary key `(selling_unit_id, price_level_id)` makes a second run's INSERT a no-op for rows already migrated, so this migration is safe to run twice if it is interrupted between the CREATE and the DROP.

- [ ] **Step 2: Register it**

In `scripts/migrations/index.ts`, add directly after the `'./120_add_selling_unit_to_line_items'` import:

```typescript
import './121_create_selling_unit_price_levels';
```

- [ ] **Step 3: Capture the pre-migration counts**

Before running, record what must be preserved:

```bash
npx tsx -e "
const {query}=require('./lib/mysql');
(async()=>{
  const [{n}] = await query('SELECT COUNT(*) n FROM product_price_levels');
  console.log('product_price_levels rows before migration:', n);
  process.exit(0);
})();
"
```

- [ ] **Step 4: Run the migration**

Run: `npm run migrate`
Expected: `✅ created product_selling_unit_price_levels`, then `✅ migrated N price-level row(s) onto base units` where N matches Step 3's count exactly, then `✅ dropped product_price_levels`.

- [ ] **Step 5: Verify no row was lost**

```bash
npx tsx -e "
const {query}=require('./lib/mysql');
(async()=>{
  const [{n}] = await query('SELECT COUNT(*) n FROM product_selling_unit_price_levels');
  console.log('product_selling_unit_price_levels rows after migration:', n);
  const orphans = await query(
    \`SELECT COUNT(*) n FROM product_selling_unit_price_levels sulp
     LEFT JOIN product_selling_units u ON u.id = sulp.selling_unit_id
     WHERE u.id IS NULL\`
  );
  console.log('orphaned rows (should be 0):', orphans[0].n);
  process.exit(0);
})();
"
```
Expected: the row count matches Step 3's number exactly, and 0 orphans.

- [ ] **Step 6: Prove `down()` and re-apply**

Run: `npm run migrate:down`
Expected: `✅ dropped product_selling_unit_price_levels` (and the "not reversible past…" note, which is honest, not a bug).

Run: `npm run migrate`
Expected: the table is recreated, but since `product_price_levels` is already gone by now, expect `⏭️  product_price_levels already gone, nothing to migrate or drop`. **This is expected** — the data migration is one-way once the source table is dropped, exactly as `down()`'s comment says. Do not treat an empty table here as a bug; it is the honest consequence of `down()` being irreversible past that point, which the migration itself declares.

- [ ] **Step 7: Commit**

```bash
git add scripts/migrations/121_create_selling_unit_price_levels.ts scripts/migrations/index.ts
git commit -m "feat: add product_selling_unit_price_levels, migrate existing prices onto base units"
```

---

### Task 2: Per-selling-unit price resolution

**Files:**
- Modify: `lib/pricing.ts`
- Test: `tests/unit/pricing.test.ts` (new)
- Modify: `tests/unit/run.ts`

**Interfaces:**
- Consumes: `product_selling_unit_price_levels` (Task 1).
- Produces: `calculateEffectivePrice` gains a selling-unit-aware overload; later tasks (3, 4) call it with a selling unit's own price and price levels rather than the product's.

**Read first:** `lib/pricing.ts` in full — it is short (58 lines). The existing `calculateEffectivePrice(product, quantity, activeLevelId, defaultLevelId)` builds a list of price candidates (the product's own `price`, plus any matching price-level row) and returns `Math.min(...)` of them. **This exact fallback shape is what the spec requires per unit** — do not redesign it, adapt its inputs.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/pricing.test.ts`:

```typescript
import assert from 'node:assert/strict';
import { calculateEffectivePriceForUnit } from '../../lib/pricing';

/**
 * A selling unit with its own price-level rows, plus the fallback rule: no
 * row for the active level -> the unit's OWN price, never another unit's.
 */

const wholesaleLevel = 'wholesale-level';
const retailLevel = 'retail-level';

// --- a unit WITH a Wholesale override uses it ---
{
  const caseUnit = {
    price: 1591.5,
    priceLevels: [{ levelId: wholesaleLevel, price: 1400, minQuantity: 0 }],
  };
  const price = calculateEffectivePriceForUnit(caseUnit, 1, wholesaleLevel, retailLevel);
  assert.equal(price, 1400, 'a unit with a matching level override uses it');
}

// --- a unit WITHOUT a Wholesale override falls back to ITS OWN price ---
{
  const pieceUnit = { price: 27.05, priceLevels: [] };
  const price = calculateEffectivePriceForUnit(pieceUnit, 1, wholesaleLevel, retailLevel);
  assert.equal(price, 27.05, 'no override falls back to the unit\'s own price');
}

// --- CRUCIAL: a unit's missing override must NOT pull another unit's price ---
// This is the property the whole feature exists to guarantee — a Case's
// missing Wholesale price must never resolve to the Piece's Wholesale price,
// scaled or otherwise. The function only ever sees ONE unit's data, so it is
// structurally incapable of reaching across units; this test documents that
// as an explicit contract, not an accident of the signature.
{
  const caseUnitNoOverride = { price: 1591.5, priceLevels: [] };
  const pieceWholesale = 22; // a different unit's price — must never appear
  const price = calculateEffectivePriceForUnit(caseUnitNoOverride, 1, wholesaleLevel, retailLevel);
  assert.notEqual(price, pieceWholesale, 'never resolves to another unit\'s price');
  assert.equal(price, 1591.5, 'falls back to its own price exactly');
}

// --- tiered minimum-quantity overrides still work, per unit ---
{
  const bulkUnit = {
    price: 100,
    priceLevels: [{ levelId: retailLevel, price: 90, minQuantity: 10 }],
  };
  assert.equal(
    calculateEffectivePriceForUnit(bulkUnit, 5, retailLevel, retailLevel),
    100,
    'below the tier minimum, the tier price does not apply',
  );
  assert.equal(
    calculateEffectivePriceForUnit(bulkUnit, 10, retailLevel, retailLevel),
    90,
    'at the tier minimum, the tier price applies',
  );
}

console.log('✅ pricing tests passed');
```

- [ ] **Step 2: Register the test**

In `tests/unit/run.ts`, add at the end of the import list:

```typescript
import './pricing.test';
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx tsx tests/unit/pricing.test.ts`
Expected: FAIL — `calculateEffectivePriceForUnit is not a function`.

- [ ] **Step 4: Implement the selling-unit resolver**

In `lib/pricing.ts`, add a new exported function alongside the existing `calculateEffectivePrice` (do not delete or rename the original — Task 3 will decide whether callers migrate to the new one or the old one gets removed once nothing calls it):

```typescript
export type SellingUnitPriceLevel = { levelId: string; price: number; minQuantity?: number };
export type PricedSellingUnit = { price: number; priceLevels?: SellingUnitPriceLevel[] };

/**
 * Same resolution rule as calculateEffectivePrice, applied to ONE selling
 * unit instead of a product: the unit's own price levels are checked first,
 * and a level with no override for this unit falls back to the unit's own
 * `price` — never another unit's price, never a computed multiple.
 *
 * This function structurally cannot see another unit's data (it only takes
 * one unit's price and price levels), which is what makes "never pulls
 * another unit's price" a guarantee rather than a convention.
 */
export function calculateEffectivePriceForUnit(
  unit: PricedSellingUnit,
  quantity: number,
  activeLevelId?: string,
  defaultLevelId: string = 'retail-level'
): number {
  const qty = Number(quantity) || 0;
  const priceCandidates: number[] = [Number(unit.price)];

  if (unit.priceLevels && unit.priceLevels.length > 0) {
    unit.priceLevels.forEach(pl => {
      const minQty = Number(pl.minQuantity) || 0;
      const price = Number(pl.price);

      const isTierHit = minQty > 1 && qty >= minQty;
      const isDefaultTarget = pl.levelId === defaultLevelId && minQty <= 1;
      const isActiveTarget = activeLevelId && pl.levelId === activeLevelId && minQty <= 1;

      if (isTierHit || isDefaultTarget || isActiveTarget) {
        priceCandidates.push(price);
      }
    });
  }

  return priceCandidates.length > 0 ? Math.min(...priceCandidates) : Number(unit.price);
}
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `npx tsx tests/unit/pricing.test.ts`
Expected: `✅ pricing tests passed`

- [ ] **Step 6: Commit**

```bash
git add lib/pricing.ts tests/unit/pricing.test.ts tests/unit/run.ts
git commit -m "feat: add per-selling-unit price resolution"
```

---

### Task 3: `actions.ts` — read and write selling-unit price levels

**Files:**
- Modify: `app/(app)/products/actions.ts`

**Interfaces:**
- Consumes: `product_selling_unit_price_levels` (Task 1).
- Produces: `getChildProducts`-style helper is NOT touched (that dialog was removed in the prior plan); instead, `getProducts` returns each selling unit's own `priceLevels` array, and `addProduct`/`updateProduct` write them per unit. Task 4 (the UI) consumes exactly this shape.

**Read first:** every `product_price_levels` site in this file — search `grep -n "product_price_levels" "app/(app)/products/actions.ts"` and read each one before editing. At the time this plan was written there were reads at line ~321 (the bulk `SELECT * FROM product_price_levels` used to build `getProducts`'s response) and ~385 (attaching `priceLevels` onto each product), writes in `addProduct` (~666-668) and `updateProduct` (~844-847, ~977), and a read/write pair for the price-level-row-no-auto-recalc feature (~990-1005). **Line numbers have drifted since — find each by content, not by number.**

- [ ] **Step 1: Stop excluding the base unit, then attach price levels to every unit**

**Read this first — it changes what Step 1 actually does.** `getProducts`'s existing `sellingUnits` assembly has a deliberate filter: `sellingUnits: (suMap.get(product.id) || []).filter((su: any) => !su.isBase)`, with the comment *"Base unit excluded: it is edited through the product's own unit/price/cost fields, not as a row in the Selling Units tab."* That was correct under the OLD model, where the base unit had no price levels of its own to carry. It is no longer correct once Task 4 makes the base unit a real, editable row with its own price levels — if it stays filtered out here, the base unit's price-level overrides can never reach the client, and Task 4's UI has nothing to read or write.

**Remove that `.filter((su: any) => !su.isBase)`** so `sellingUnits` includes the base unit like any other row. Remove the now-inaccurate comment with it.

Then, where the code does `SELECT * FROM product_price_levels` and groups the results by `product_id` to attach onto each product object, change it to select from `product_selling_unit_price_levels` and attach each unit's own price levels onto that specific unit:

```typescript
const sulpSql = `SELECT * FROM product_selling_unit_price_levels`;
const allSulp = await query(sulpSql);
const sulpByUnit = new Map<string, any[]>();
for (const row of allSulp) {
  if (!sulpByUnit.has(row.selling_unit_id)) sulpByUnit.set(row.selling_unit_id, []);
  sulpByUnit.get(row.selling_unit_id)!.push({
    levelId: row.price_level_id,
    price: Number(row.price),
    minQuantity: row.min_quantity ?? 0,
  });
}
```

Then, wherever `sellingUnits` is assembled onto each product in `getProducts`'s mapping, attach `priceLevels: sulpByUnit.get(unit.id) ?? []` onto each unit.

**Remove the old product-level `priceLevels: productPriceLevels` assignment** from the returned product object — it no longer applies at the product level, and `lib/types.ts`'s `Product.priceLevels` field becomes obsolete for this purpose (leave the type field itself alone; Task 4 may still reference it for backward-compat display, but do not populate it from `product_price_levels`, which no longer exists).

- [ ] **Step 2: Write price levels per unit in `addProduct`**

Find where `addProduct` inserts into `product_price_levels` after creating the product (the loop over `formData.priceLevels`). Replace it: the form now submits price levels **nested under each selling unit** rather than as a flat product-level array (Task 4 defines the exact submitted shape as `sellingUnits[i].priceLevels`). Inside the same transaction, after each selling unit is inserted and its own id is known:

```typescript
if (unitData.priceLevels && unitData.priceLevels.length > 0) {
  for (const pl of unitData.priceLevels) {
    await connection.query(
      'INSERT INTO product_selling_unit_price_levels (selling_unit_id, price_level_id, price, min_quantity) VALUES (?, ?, ?, ?)',
      [sellingUnitId, pl.levelId, pl.price, pl.minQuantity || 0]
    );
  }
}
```

`sellingUnitId` here is the id generated for that unit at insert time — the same variable the surrounding selling-units insert code (added by the prior plan) already produces.

- [ ] **Step 3: Write price levels per unit in `updateProduct`**

Find the equivalent delete-then-reinsert pattern in `updateProduct` (`DELETE FROM product_price_levels WHERE product_id = ?` followed by reinserting `formData.priceLevels`). Replace with a per-unit version: for each selling unit being written (both units that already existed and are being updated, and newly added ones), delete that unit's existing price-level rows and reinsert:

```typescript
await connection.query(
  'DELETE FROM product_selling_unit_price_levels WHERE selling_unit_id = ?',
  [sellingUnitId]
);
if (unitData.priceLevels && unitData.priceLevels.length > 0) {
  for (const pl of unitData.priceLevels) {
    await connection.query(
      'INSERT INTO product_selling_unit_price_levels (selling_unit_id, price_level_id, price, min_quantity) VALUES (?, ?, ?, ?)',
      [sellingUnitId, pl.levelId, pl.price, pl.minQuantity || 0]
    );
  }
}
```

This delete-then-reinsert happens **only** for units present in the submitted form data — a unit deleted by the user is removed by the existing selling-units deletion logic, and `ON DELETE CASCADE` on `product_selling_unit_price_levels` cleans up its price-level rows automatically; do not add a separate delete for removed units.

- [ ] **Step 4: Handle the price-level-row-no-auto-recalc site**

There is a third site (search for `min_quantity IS NULL OR min_quantity = 0` in this file) that checks for an existing default-tier row before deciding to UPDATE vs INSERT, part of a prior feature (`docs/superpowers/plans/2026-08-04-price-level-row-no-auto-recalc.md`) that kept a manually-edited price-level row from being silently recalculated. Read that plan's description of the behaviour it protects, then reproduce the same check against `product_selling_unit_price_levels` keyed by `selling_unit_id` instead of `product_id`. Do not drop this protection — losing it would reintroduce the bug that plan fixed.

- [ ] **Step 5: Confirm nothing else relied on the base unit being excluded from `sellingUnits`**

Step 1 removed a deliberate filter (`!su.isBase`) that kept the base unit out of `product.sellingUnits`. Before assuming that is safe, check every consumer:

```bash
grep -rn "\.sellingUnits\b" app/ lib/ src/ --include=*.ts --include=*.tsx
```

For each hit outside this task and Task 4/5's files, confirm it does not assume "every entry in `sellingUnits` is deletable" or "every entry has a non-1 `factor`" — either assumption is now false for the base unit's entry. Note any such hit in your report rather than silently patching it; that expands scope beyond what this plan reviewed.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep "actions.ts"`
Expected: no NEW errors naming `actions.ts`. The repo baseline is red elsewhere — ignore pre-existing errors.

- [ ] **Step 7: Verify against the database**

Create a product through `addProduct` (or use the running app) with two selling units, each with a different Wholesale price. Confirm directly:

```bash
npx tsx -e "
const {query}=require('./lib/mysql');
(async()=>{
  const rows = await query(
    'SELECT u.name, sulp.price_level_id, sulp.price FROM product_selling_units u JOIN product_selling_unit_price_levels sulp ON sulp.selling_unit_id = u.id WHERE u.product_id = ? ORDER BY u.name',
    ['<the product id>']
  );
  console.table(rows);
  process.exit(0);
})();
"
```
Expected: each unit shows its own, independent price for the level — not the same number scaled by factor.

- [ ] **Step 7: Commit**

```bash
git add "app/(app)/products/actions.ts"
git commit -m "feat: read and write price levels per selling unit"
```

---

### Task 4: Base unit row and per-unit price levels in the product form

**Files:**
- Modify: `app/(app)/products/add-product/tabs/conversion-tab.tsx`
- Modify: `app/(app)/products/edit-product/tabs/conversion-tab.tsx`
- Modify: `app/(app)/products/add-product/use-add-product-form.ts`
- Modify: `app/(app)/products/edit-product/use-edit-product-form.ts`
- Modify: `app/(app)/products/add-product/product-schema.ts`
- Modify: `app/(app)/products/edit-product/product-schema.ts`
- Delete: `app/(app)/products/add-product/tabs/price-levels-tab.tsx`
- Delete: `app/(app)/products/edit-product/tabs/price-levels-tab.tsx`
- Modify: `app/(app)/products/add-product/add-product-dialog.tsx` (remove the Price Levels tab entry)
- Modify: `app/(app)/products/edit-product/edit-product-dialog.tsx` (same)

**Interfaces:**
- Consumes: `actions.ts`'s `sellingUnits[i].priceLevels` shape (Task 3), `calculateEffectivePriceForUnit` (Task 2, for any live price preview in the form).
- Produces: a `sellingUnits` field on both product schemas where each entry carries `{ name, factor, barcode, cost, price, isBase, priceLevels: { levelId, price, minQuantity }[] }`.

**Read first:** `app/(app)/products/add-product/tabs/conversion-tab.tsx` (the current Selling Units tab, built by the prior plan) and `app/(app)/products/add-product/tabs/price-levels-tab.tsx` (the tab being retired — read its `PriceLevelsTab` component, shown in the spec's exploration, for the row-add/remove UI pattern to reuse inside each selling-unit row).

- [ ] **Step 1: Show the base unit as a row**

In `conversion-tab.tsx` (both add and edit), the selling-units field array currently only lists units the user has explicitly added. Add the base unit as a permanent, non-removable first row: its `factor` input becomes `disabled` and its displayed value locked to `1`; its row carries a "Base" badge instead of a delete button. Its barcode/cost/price inputs remain editable, same as any other row.

Where the array is seeded on form load (for edit) or on submit (for add), ensure exactly one entry has `isBase: true` and `factor: 1` — reuse whatever mechanism the prior plan's Task 7b already uses to guarantee this on the server (`actions.ts`), so the client and server agree on which row is the base.

- [ ] **Step 2: Add the per-row price-level sub-table**

Each selling-unit row (base included) gets an expandable section listing one line per system price level (fetched the same way the old `PriceLevelsTab` did — via `priceLevels` / `isLoadingPriceLevels` from the form context), with a price input bound to `sellingUnits.${unitIndex}.priceLevels.${levelIndex}.price`. A blank input means no override for that unit/level — it must NOT default to `0` or to the unit's own price; leave it genuinely empty in form state so Task 3's write logic knows to skip it (an empty/undefined price for a level means: do not write a row for that level at all).

Add a helper in `product-schema.ts` for the nested shape:

```typescript
priceLevels: z.array(z.object({
  levelId: z.string(),
  price: z.number().min(0).optional(),
  minQuantity: z.number().min(0).optional(),
})).optional(),
```

nested inside each `sellingUnits` array entry.

- [ ] **Step 3: Delete the standalone Price Levels tab**

Delete both `price-levels-tab.tsx` files. Remove their entries from `add-product-dialog.tsx` and `edit-product-dialog.tsx`'s tab list, and remove now-unused imports (`PriceLevelsTab`, `priceLevelFields`/`appendPriceLevel`/`removePriceLevel` from the form contexts, if those become dead after this removal — check before deleting, since the base-unit price-level sub-table may reuse the same field-array pattern under a new name rather than the same hook return values).

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "add-product|edit-product"`
Expected: no NEW errors naming those files.

- [ ] **Step 5: Verify in the running app**

Run the dev server in the FOREGROUND on port 3000 and check:

1. Opening Add Product, the Selling Units tab shows a "Base" row with no delete button and `factor` locked to 1.
2. Expanding the base row's price levels and setting a Wholesale price, then adding a second unit (e.g. "Box of 12") with a *different* Wholesale price, then saving — both persist independently (confirm with Task 3's verification query).
3. A unit left with a blank Wholesale price: confirm in the DB that no row was written for that unit/level (not a `0` row).
4. The old Price Levels tab is gone from both dialogs.

If you have no browser tooling, say so plainly in your report and verify as far as you can via typecheck and the DB query in step 2 — do NOT claim a visual pass you did not perform.

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/products/add-product" "app/(app)/products/edit-product"
git commit -m "feat: show the base unit and per-unit price levels in the product form"
```

---

### Task 5: POS resolves price per selling unit

**Files:**
- Modify: `app/(app)/pos/pos-content/use-pos.ts`

**Interfaces:**
- Consumes: `calculateEffectivePriceForUnit` (Task 2), each product's `sellingUnits[i].priceLevels` (Task 3).

**Read first:** every call site of `calculateEffectivePrice` in `use-pos.ts` — search `grep -n "calculateEffectivePrice" "app/(app)/pos/pos-content/use-pos.ts"`. At the time this plan was written there were four: initial add-to-cart, quantity change, price-level switch, and the cart-recompute effect. **This is the file the prior plan's Task 5 (checkout, not POS UI) never touched** — the cart still operates entirely in terms of a bare `product`, with no selling-unit selection at all.

**This task's scope is deliberately narrow: make price resolution correct for whichever selling unit a cart line is already keyed to, WITHOUT building unit-selection UI.** The prior plan shipped checkout defaulting every sale to the base unit when no unit is specified; POS unit-picking UI (letting a cashier scan or choose a Case vs a Piece) is a separate, larger task not covered here — do not attempt it as part of this plan.

- [ ] **Step 1: Identify the base unit from the product's `sellingUnits`**

**This step depends on Task 3 Step 1's change.** Before this plan, `getProducts` deliberately excluded the base unit from `product.sellingUnits` (`filter((su) => !su.isBase)`) — Task 3 removed that filter, so the base unit is now a normal entry in the array, findable by `isBase: true`. If you are implementing this task and that filter is still present, stop and fix Task 3 first; this task cannot work without it.

Add a small helper at the top of `use-pos.ts` (or in `lib/pricing.ts` if that fits the existing import pattern better — check how other cart helpers are organised in this file first):

```typescript
function baseSellingUnit(product: any) {
  return product.sellingUnits?.find((u: any) => u.isBase) ?? { price: product.price, priceLevels: [] };
}
```

The fallback to `{ price: product.price, priceLevels: [] }` is defensive only — every product should have exactly one `isBase` entry per Task 1/3's guarantees, so this branch should never execute on correct data. It exists so a data inconsistency degrades to "use the product's plain price" instead of crashing the cart. If you ever see this fallback actually triggered in testing, that is a bug in Task 3's read path, not something to fix here — report it.

- [ ] **Step 2: Replace each `calculateEffectivePrice(product, …)` call**

At each of the four call sites found in Step 0, replace `calculateEffectivePrice(product, quantity, activeLevelId, defaultLevelId)` with:

```typescript
calculateEffectivePriceForUnit(baseSellingUnit(product), quantity, activeLevelId, defaultLevelId)
```

Import `calculateEffectivePriceForUnit` from `@/lib/pricing` alongside (or in place of) the existing `calculateEffectivePrice` import — check whether anything else in this file still needs the product-level function before removing that import.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep "use-pos"`
Expected: no NEW errors naming that file.

- [ ] **Step 4: Verify in the running app**

With the dev server running, open POS, add a product whose base unit has a Wholesale override (set in Task 4's verification) to the cart, switch the active price level to Wholesale, and confirm the cart price matches the override — not the product's plain `price`.

- [ ] **Step 5: Run the POS E2E**

Run: `npm run test:e2e:db`, then in the FOREGROUND with a generous timeout: `npx playwright test tests/e2e/pos-sale.spec.ts tests/e2e/pos-edit-qty-auth.spec.ts --reporter=line`. Compare against the known-red baseline (`tests/e2e/products/price-levels.spec.ts` fails independently of this work). Report only NEW failures.

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/pos/pos-content/use-pos.ts"
git commit -m "feat: resolve POS cart prices against the selling unit's own price levels"
```

---

### Task 6: Document the change

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Extend the "Selling units" entry**

`CLAUDE.md`'s **Selling units** entry (under Key Domain Patterns) currently says the migration left two things unfinished: `parent_id`/`conversion_factors` still existing, and `cost_at_sale` being per-base-unit. Append a sentence noting price levels are now per-selling-unit too, and correct anything that still implies a product has one price:

```markdown
Price levels are per SELLING UNIT, not per product: `product_selling_unit_price_levels`
(keyed by `selling_unit_id`) replaced the old product-keyed `product_price_levels`, so a
Case can carry a different Wholesale price than the Piece it's packed from. A unit with no
override for the active level falls back to its own `price` column — never another unit's
price, never a computed multiple of one. `lib/pricing.ts:calculateEffectivePriceForUnit`
is the resolver; the POS cart still only ever prices a line against a product's BASE unit —
letting a cashier choose a non-base unit in the cart is not built yet.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: describe per-selling-unit price levels"
```

---

## Done When

- `product_price_levels` is gone; every price it held survives on the corresponding product's base selling unit.
- The base selling unit is a visible, non-deletable, factor-locked row in both the Add and Edit Product forms, with its own editable price levels.
- A newly added selling unit has zero price-level rows until a human sets one.
- A selling unit with no override for the active price level resolves to its own `price`, verified both in a unit test and by checking the database directly — never another unit's price.
- The POS cart, when pricing a product's base unit, uses that unit's own price levels rather than a product-level list that no longer exists.
- `npx tsc --noEmit` shows no new errors in any touched file, and the POS E2E shows no new failures against the known-red baseline.
