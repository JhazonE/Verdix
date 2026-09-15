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

- [ ] **Step 6: (DO NOT RUN AGAINST THE LIVE DATABASE) `down()`'s honesty was already proven in Step 4/5**

**This step previously instructed running `migrate:down` then `migrate` again against the live database to "prove reversibility." Do not do that — it destroys real data and there is no way to get it back from inside the migration itself.**

Trace why: `up()` both migrates `product_price_levels`'s rows onto `product_selling_units` AND drops `product_price_levels` in the same call. Step 4/5 already ran `up()` once and proved it correctly migrated every row (pre-count matched post-count, 0 orphans) — that is the entire property worth proving. Running `migrate:down` afterward deletes the new table, and running `up()` a second time cannot repopulate it, because the source table `up()` read from no longer exists — it was dropped by the run that already succeeded. The second `up()` will report `⏭️  product_price_levels already gone, nothing to migrate or drop` and leave the table **empty**. That is not a bug in the code; it is data loss caused by testing a live, data-consuming migration as if it were a pure schema change.

**What to do instead:** nothing further. Step 4/5's successful `up()` run, with matching pre/post counts and 0 orphans, is the complete verification this migration needs. `down()`'s own code comment already documents the irreversibility honestly — that comment is the proof; you do not additionally need to trigger the data loss to confirm the comment is accurate.

If you want to confirm `down()` and a repeat `up()` behave as documented WITHOUT touching live data, do it against a disposable copy: `mysqldump` the two tables involved into a scratch database, run the cycle there, and discard it — never against `verdix`.

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
- Consumes: `actions.ts`'s `sellingUnits[i].priceLevels` shape for every EXTRA (non-base) unit, and the existing top-level `formData.priceLevels` field for the base unit's own overrides (Task 3 — see note below), plus `calculateEffectivePriceForUnit` (Task 2, for any live price preview in the form).
- Produces: a `sellingUnits` field on both product schemas where each EXTRA-unit entry carries `{ name, factor, barcode, cost, price, isBase, priceLevels: { levelId, price, minQuantity }[] }`. The base unit's row is NOT a `sellingUnits` array entry with a `priceLevels` sub-field in the submitted payload — its price/cost/barcode already post through the form's existing top-level product fields, and Task 3 wired its price-level overrides to the existing top-level `priceLevels` field the same way (see Note below).

**Note — base unit price levels are NOT symmetric with extra units (ruling, 2026-09-11):** Task 3's implementation (commit `6b773a4`) reads/writes the base unit's price-level overrides from the top-level `formData.priceLevels` field — the same field the old standalone Price Levels tab used — not from an entry inside `sellingUnits[]`. Every OTHER selling unit uses `sellingUnits[i].priceLevels` as originally planned. This was a deliberate choice made after Task 3 shipped: reworking Task 3 to force symmetry was rejected in favor of treating the base unit as one more structural special case in the form (it already gets a locked factor and no delete button, per Step 1 below). **Build the UI accordingly:**
- The base row's price-level sub-table binds its price inputs to the top-level `priceLevels.${levelIndex}.price` field (the same field/array the deleted `PriceLevelsTab` used to bind to) — reuse that binding, not a new `sellingUnits[baseIndex].priceLevels` one.
- Every extra unit's row binds to `sellingUnits.${unitIndex}.priceLevels.${levelIndex}.price` as described in Step 2 below.
- Both the base row's sub-table and each extra unit's sub-table should look and behave identically to the user (same "one line per system price level, blank = no override" UI) — only the underlying form-state path differs, and that difference is internal to this task's wiring.

**Read first:** `app/(app)/products/add-product/tabs/conversion-tab.tsx` (the current Selling Units tab, built by the prior plan) and `app/(app)/products/add-product/tabs/price-levels-tab.tsx` (the tab being retired — read its `PriceLevelsTab` component, shown in the spec's exploration, for the row-add/remove UI pattern to reuse inside each selling-unit row, AND for its existing top-level `priceLevels` field binding, which the base row's sub-table now reuses directly).

- [ ] **Step 1: Show the base unit as a row**

In `conversion-tab.tsx` (both add and edit), the selling-units field array currently only lists units the user has explicitly added. Add the base unit as a permanent, non-removable first row: its `factor` input becomes `disabled` and its displayed value locked to `1`; its row carries a "Base" badge instead of a delete button. Its barcode/cost/price inputs remain editable, same as any other row — bind these to the form's existing top-level base price/cost/barcode fields (the ones `productData.price`/`productData.cost`/`productData.barcode` already post through in `actions.ts`), NOT to a new `sellingUnits[]` entry, since the base unit is not stored as one in the submitted payload.

Where the array is seeded on form load (for edit) or on submit (for add), the base row is rendered from the top-level fields plus whichever `sellingUnits` (or server-returned) entry has `isBase: true` (for display of its current price levels — see Step 2) — ensure exactly one entry has `isBase: true` and `factor: 1` where the server returns it, so the client and server agree on which row is the base.

- [ ] **Step 2: Add the per-row price-level sub-table**

Each selling-unit row gets an expandable section listing one line per system price level (fetched the same way the old `PriceLevelsTab` did — via `priceLevels` / `isLoadingPriceLevels` from the form context).

- For the base row: bind each price input to `priceLevels.${levelIndex}.price` — the same top-level field array the old `PriceLevelsTab` used. Reuse that field array/hook wiring rather than inventing a new one.
- For every extra unit's row: bind each price input to `sellingUnits.${unitIndex}.priceLevels.${levelIndex}.price`, as before.

In both cases a blank input means no override for that unit/level — it must NOT default to `0` or to the unit's own price; leave it genuinely empty in form state so Task 3's write logic knows to skip it (an empty/undefined price for a level means: do not write a row for that level at all).

Add a helper in `product-schema.ts` for the nested shape (used by extra units; the base row continues using the existing top-level `priceLevels` schema field, unchanged):

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

### Task 5.5: Fix `MySqlProductRepository` — POS's actual product-fetch path was broken by Task 1

**Added mid-plan, not in the original design.** Task 5's implementer discovered that `GET /api/products`
— the endpoint POS itself calls (`use-pos.ts:688`, via `hooks/use-api.ts`'s `useProducts`) — does NOT
go through `app/(app)/products/actions.ts`'s `getProducts` (the function every earlier task in this
plan has been correctly updating). It goes through a separate, older repository-pattern path:
`app/api/products/route.ts` → `GetProductsUseCase` → `MySqlProductRepository`
(`src/infrastructure/repositories/MySqlProductRepository.ts`). That repository still queries the
`product_price_levels` table Task 1 dropped (`SELECT * FROM product_price_levels` at line 104,
`INSERT INTO product_price_levels` at line 227) — so **every `GET /api/products` call has been
failing with a 500 since Task 1 merged**, and this repository never returned `sellingUnits` in the
first place, so this plan's entire per-selling-unit pricing feature (Tasks 1-5) has been inert in the
live POS app regardless. `git log` confirms this file predates this plan's work — it is a pre-existing
gap in both this plan and the prior selling-units migration plan, neither of which ever touched
`src/infrastructure/` or `src/core/`.

This is being fixed inside this plan, not deferred, because the severity (a production POS screen's
product list failing outright) outweighs staying within the plan's originally-scoped file list —
ruling recorded in the SDD ledger.

**Scope decision:** `MySqlProductRepository.findAll` (→ `GET /api/products`, called by POS) is the
only method confirmed to be live-called by application code — grepped, nothing in `app/` POSTs to
`/api/products` (product creation/editing goes through `actions.ts`'s server actions, not this REST
route). `create`/`update`/`delete`/`findById` on this repository are unreachable dead code from the
app's own UI today; still fix their `product_price_levels` references for correctness (a future caller
should not silently 500 or silently insert into a nonexistent table), but do not build out
`sellingUnits` support for them — only `findAll` needs to return that shape.

**Files:**
- Modify: `src/infrastructure/repositories/MySqlProductRepository.ts`
- Modify: `src/core/products/domain/Product.ts` (add `sellingUnits` to `ProductEntity`)
- Modify: `hooks/use-api.ts` (`mapApiProduct` must carry `sellingUnits` through to the client — it
  currently drops any field not explicitly listed)
- Investigate, fix if broken: `src/infrastructure/services/TransferStockService.ts` (lines ~125, ~132
  — same `product_price_levels` references; confirm whether this service is live-called before
  deciding its fix, the way `findAll` vs `create`/`update`/`delete` was decided above)

**Interfaces:**
- Consumes: `product_selling_unit_price_levels` (Task 1), the `sellingUnits[i].priceLevels` shape
  `actions.ts`'s `getProducts` already produces (Task 3) — this task ports the same read pattern into
  a different file, it does not invent a new shape.
- Produces: `MySqlProductRepository.findAll`'s returned products carry a `sellingUnits` array
  identical in shape to what `actions.ts`'s `getProducts` returns, so `baseSellingUnit()` in
  `use-pos.ts` (Task 5) stops hitting its fallback branch on real data.

- [ ] **Step 1: Read the current broken read path**

Read `src/infrastructure/repositories/MySqlProductRepository.ts` in full (286 lines). Note the
`findAll` method's existing pattern: one query for products, one query for
`SELECT * FROM product_price_levels WHERE product_id IN (?)`, then a JS-side loop attaching
`product.priceLevels` and computing a default-level price override. This task replaces that middle
query and loop with the selling-unit-keyed equivalent.

- [ ] **Step 2: Replace the price-levels query with a selling-units query**

In `findAll`, after the main `products` query and before the `products.forEach` loop, replace:

```typescript
const priceLevelsSql = `SELECT * FROM product_price_levels WHERE product_id IN (?)`;
const priceLevels = await query(priceLevelsSql, [productIds]);
```

with a query for `product_selling_units` joined to `product_selling_unit_price_levels`, grouped in JS
by `product_id` and then by `selling_unit_id` — mirroring the exact pattern `actions.ts`'s `getProducts`
already uses (Task 3, `sulpByUnit` map):

```typescript
const suSql = `SELECT * FROM product_selling_units WHERE product_id IN (?)`;
const sellingUnitRows = await query(suSql, [productIds]);
const sellingUnitIds = sellingUnitRows.map((u: any) => u.id);

const sulpByUnit = new Map<string, any[]>();
if (sellingUnitIds.length > 0) {
  const sulpSql = `SELECT * FROM product_selling_unit_price_levels WHERE selling_unit_id IN (?)`;
  const sulpRows = await query(sulpSql, [sellingUnitIds]);
  for (const row of sulpRows) {
    if (!sulpByUnit.has(row.selling_unit_id)) sulpByUnit.set(row.selling_unit_id, []);
    sulpByUnit.get(row.selling_unit_id)!.push({
      levelId: row.price_level_id,
      price: Number(row.price),
      minQuantity: row.min_quantity ?? 0,
    });
  }
}

const suByProduct = new Map<string, any[]>();
for (const u of sellingUnitRows) {
  if (!suByProduct.has(u.product_id)) suByProduct.set(u.product_id, []);
  suByProduct.get(u.product_id)!.push({
    id: u.id,
    name: u.name,
    factor: Number(u.factor),
    barcode: u.barcode ?? undefined,
    cost: u.cost !== null ? Number(u.cost) : undefined,
    price: Number(u.price),
    isBase: !!u.is_base,
    priceLevels: sulpByUnit.get(u.id) ?? [],
  });
}
```

Guard the `IN (?)` queries the same way the existing code implicitly relies on `productIds` being
non-empty (the outer `if (products.length > 0)` block already covers this — keep the new queries
inside it).

- [ ] **Step 3: Attach `sellingUnits` in the per-product loop, and stop reading `product_price_levels`**

Inside the existing `products.forEach((product: any) => { ... })` loop, add:

```typescript
product.sellingUnits = suByProduct.get(product.id) ?? [];
```

Remove the old `product.priceLevels = productSpecificLevels.map(...)` assignment and the
`productSpecificLevels` variable it depended on — `product_price_levels` no longer exists, so nothing
here can read it. The existing default-price-override block below it (the one that overwrites
`product.price` from a matching retail-level row) must be re-derived from the BASE selling unit's
`priceLevels` instead of the old `productSpecificLevels` array:

```typescript
if (defaultLevelId) {
  const baseUnit = product.sellingUnits.find((u: any) => u.isBase);
  const baseOverrides = (baseUnit?.priceLevels ?? [])
    .filter((pl: any) => pl.levelId === defaultLevelId)
    .sort((a: any, b: any) => (a.minQuantity || 0) - (b.minQuantity || 0));
  if (baseOverrides.length > 0) {
    product.price = baseOverrides[0].price;
  }
}
```

This keeps the pre-existing "default-level override replaces the listed price" behavior for whatever
already consumes `findAll`'s plain `.price` field, now sourced from the base unit's own price levels
instead of the dropped product-level table — matching the resolution rule the rest of this plan
established (§4 of the spec: a unit falls back to its own price, an override replaces it).

- [ ] **Step 4: Fix `create`, `update`, and remove the dead `priceLevels` write**

In `create` (~line 224-232), the `product_price_levels` INSERT loop writes to a table that no longer
exists. Since this repository's `create`/`update` are confirmed unreachable from live app code (see
Scope decision above — nothing calls `POST /api/products`), remove that INSERT loop rather than
porting it to the new schema; there being no live caller with a `priceLevels` payload to test against
makes a real per-unit port unverifiable and out of proportion to this task. Leave a short comment
explaining why (dead code path, `product_price_levels` no longer exists, port to per-selling-unit
writes if this method ever gains a real caller). Do the same for any `product_price_levels` reference
in `update` (there is none currently — confirm, don't assume).

- [ ] **Step 5: Add `sellingUnits` to the `ProductEntity` domain type**

In `src/core/products/domain/Product.ts`, add a field to `ProductEntity` matching the shape Step 3
now populates:

```typescript
sellingUnits?: {
  id?: string;
  name: string;
  factor: number;
  barcode?: string;
  cost?: number;
  price: number;
  isBase?: boolean;
  priceLevels?: { levelId: string; price: number; minQuantity?: number }[];
}[];
```

- [ ] **Step 6: Carry `sellingUnits` through the client-side mapper**

In `hooks/use-api.ts`, `mapApiProduct` builds a `Product` object field-by-field and silently drops
anything not explicitly listed — this is why `sellingUnits` was being lost even before reaching
`use-pos.ts`. Add one line to the returned object:

```typescript
sellingUnits: item.sellingUnits || [],
```

- [ ] **Step 7: Investigate `TransferStockService.ts`**

Read `src/infrastructure/services/TransferStockService.ts` around lines 125 and 132 (the
`product_price_levels` SELECT and INSERT). Determine whether this service is actually invoked by any
current API route or UI action (grep for its class name / import sites). If it IS live-called, its
`product_price_levels` references are an equally real production bug — port them to
`product_selling_unit_price_levels` following the same base-unit-keyed pattern as Step 2, scoped only
as far as this service's existing behavior requires (do not expand its feature set). If it is NOT
live-called (dead/unused code, same as `create`/`update`/`delete` above), state that finding in your
report and leave it with a comment noting the dead reference, matching Step 4's treatment — do not
silently expand this task's scope beyond what a live caller requires.

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "MySqlProductRepository|Product\.ts|use-api|TransferStockService"`
Expected: no NEW errors naming those files.

- [ ] **Step 9: Verify against the database and the running app**

```bash
npx tsx -e "
const {query}=require('./lib/mysql');
(async()=>{
  const rows = await query('SELECT id FROM products LIMIT 1');
  console.log(rows[0]);
  process.exit(0);
})();
"
```

Then, with the dev server running in the FOREGROUND: hit `GET /api/products?limit=5` directly (e.g.
`curl http://localhost:3000/api/products?limit=5` or open it in a browser) and confirm (a) the
response is `success: true` with no 500, and (b) at least one returned product has a non-empty
`sellingUnits` array with an `isBase: true` entry. Then open POS itself and confirm products actually
load (this was completely broken before this task). If a product has a Wholesale override set on its
base unit (from Task 4's verification), confirm switching to Wholesale in POS now shows that price —
this is the point where Task 5's already-correct code finally takes effect.

If you have no way to run the dev server or hit it over HTTP, say so plainly and verify as far as
possible via the DB query and typecheck alone — do NOT claim a live pass you did not perform.

- [ ] **Step 10: Commit**

```bash
git add "src/infrastructure/repositories/MySqlProductRepository.ts" "src/core/products/domain/Product.ts" "hooks/use-api.ts"
git commit -m "fix: repoint MySqlProductRepository off the dropped product_price_levels table"
```

If Step 7 required changes to `TransferStockService.ts`, commit it separately:

```bash
git add "src/infrastructure/services/TransferStockService.ts"
git commit -m "fix: migrate TransferStockService off the dropped product_price_levels table"
```

---

### Task 5.6: Fix two more live callers of the dropped `product_price_levels` table

**Added mid-plan, same class of bug as Task 5.5.** Task 5.5's implementer swept the repo for any
remaining reference to `product_price_levels` and found two more live, unfixed call sites, deliberately
left out of that task's scope:

- `lib/purchase-actions.ts:238-244` — inside `receivePurchaseOrder`'s per-item loop, an
  `INSERT ... ON DUPLICATE KEY UPDATE` against `product_price_levels`, **not wrapped in a try/catch**
  (unlike the batch-costing insert a few lines above it, which deliberately is). Since this runs inside
  the same `withTransaction` as the rest of purchase-order receiving, this statement throwing rolls back
  the ENTIRE receipt — stock movement, cost/price update, and PO status change all included. **Any
  purchase order received today, for a product where a default price level exists, fails outright.**
- `lib/price-list-import.ts:316-325` (the `price` field branch) and `:328-338` (the `priceLevel` field
  branch) — inside the bulk price-list "apply" chunk loop. Per this file's own comment (`lines 283-289`),
  a chunk that throws stops the whole apply immediately and reports a bare error, while earlier chunks'
  changes have already committed — so a price-list import that touches ANY row triggering these lines
  fails partway through, with the caller seeing an opaque error instead of a completed import.

Both are genuinely production-breaking, not theoretical — confirmed live and confirmed unfixed by
Task 5.5's implementer, independently corroborated by direct read during this plan's controller review.

**Files:**
- Modify: `lib/purchase-actions.ts`
- Modify: `lib/price-list-import.ts`

**Interfaces:**
- Consumes: `product_selling_units` (to resolve a product's base selling unit id),
  `product_selling_unit_price_levels` (Task 1).
- Produces: nothing new — this task ports two existing write sites onto the schema every other task in
  this plan already uses. No shape changes for anything downstream.

- [ ] **Step 1: Fix `purchase-actions.ts`**

At `lib/purchase-actions.ts:236-244`, replace the per-product `product_price_levels` upsert with a
selling-unit-keyed one. The product's base selling unit id must be resolved first — reuse the same
`SELECT id FROM product_selling_units WHERE product_id = ? AND is_base = 1 LIMIT 1` pattern used
elsewhere in this plan (`actions.ts`, `TransferStockService.ts`). Since `receivePurchaseOrder` already
runs everything inside one transaction (`connection` is already in scope in this loop), do the lookup
on the same connection:

```typescript
// Update default price level — use finalPrice so it stays consistent with the
// master products.price under the "highest wins" rule. Price levels are per
// selling unit now (product_selling_unit_price_levels); this writes onto the
// product's BASE selling unit, matching how every other write path in this
// codebase treats "the product's own price level" after the selling-units
// migration.
if (defaultLevelId && finalPrice > 0) {
  const [baseUnitRows]: any = await connection.query(
    'SELECT id FROM product_selling_units WHERE product_id = ? AND is_base = 1 LIMIT 1',
    [receivedItem.productId],
  );
  if (baseUnitRows.length > 0) {
    await connection.query(`
      INSERT INTO product_selling_unit_price_levels (selling_unit_id, price_level_id, price, min_quantity)
      VALUES (?, ?, ?, 0)
      ON DUPLICATE KEY UPDATE price = VALUES(price)
    `, [baseUnitRows[0].id, defaultLevelId, finalPrice]);
  }
}
```

The `if (baseUnitRows.length > 0)` guard is deliberate: every product created through this codebase's
normal paths has a base selling unit (Task 1's backfill guarantees it for existing products, `actions.ts`
guarantees it for new ones), so this should always be true in practice — but silently skipping when it
isn't is safer than throwing and rolling back a real purchase-order receipt over a data-consistency
issue this task did not cause. Do not add error logging beyond what already exists in this function for
comparable cases — check the surrounding code's own convention (e.g. the batch-costing try/catch above)
before deciding whether this needs one; if you add one, match that existing style.

- [ ] **Step 2: Fix `price-list-import.ts`'s two branches**

At `lib/price-list-import.ts:316-325` (the `price` field branch), replace:

```typescript
if (defaultLevelId) {
  await connection.query(
    'UPDATE product_price_levels SET price = ? WHERE product_id = ? AND price_level_id = ?',
    [newValue, item.productId, defaultLevelId],
  );
}
```

with a selling-unit-keyed UPDATE. This branch's original comment says "Keep an existing default-level
price-level row in sync... Never creates one" — preserve that exact semantic (UPDATE only, no upsert)
by scoping the UPDATE to the base unit's existing row:

```typescript
if (defaultLevelId) {
  await connection.query(
    `UPDATE product_selling_unit_price_levels sulp
     JOIN product_selling_units su ON su.id = sulp.selling_unit_id
     SET sulp.price = ?
     WHERE su.product_id = ? AND su.is_base = 1 AND sulp.price_level_id = ?`,
    [newValue, item.productId, defaultLevelId],
  );
}
```

At `lib/price-list-import.ts:328-338` (the `priceLevel` field branch), replace:

```typescript
await connection.query(
  `INSERT INTO product_price_levels (product_id, price_level_id, price, min_quantity)
   VALUES (?, ?, ?, 0)
   ON DUPLICATE KEY UPDATE price = VALUES(price)`,
  [item.productId, item.priceLevelId, newValue],
);
```

with the base-unit-keyed upsert, resolving the base unit id first (same pattern as Step 1, on the same
`connection`):

```typescript
const [baseUnitRows]: any = await connection.query(
  'SELECT id FROM product_selling_units WHERE product_id = ? AND is_base = 1 LIMIT 1',
  [item.productId],
);
if (baseUnitRows.length > 0) {
  await connection.query(
    `INSERT INTO product_selling_unit_price_levels (selling_unit_id, price_level_id, price, min_quantity)
     VALUES (?, ?, ?, 0)
     ON DUPLICATE KEY UPDATE price = VALUES(price)`,
    [baseUnitRows[0].id, item.priceLevelId, newValue],
  );
} else {
  skipped.push({ productId: item.productId, productName: item.productName, reason: 'Product has no base selling unit' });
  continue;
}
```

The `else` branch here differs deliberately from Step 1's silent skip: this file already has a
`skipped` array and a `reason` field as its established pattern for "this row didn't apply, here's why"
(see the two existing `skipped.push(...)` calls above in this same function) — use it instead of
silently doing nothing, since a caller here is explicitly asking to see what didn't apply and why.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "purchase-actions|price-list-import"`
Expected: no NEW errors naming those files.

- [ ] **Step 4: Verify against the database**

Pick a real product with a base selling unit and a default price level configured. Simulate both paths
directly (do not fabricate a fake purchase order or a fake price-list file if the real flow is
reachable via a script calling these functions directly, mirroring how Task 5.5's implementer verified
`MySqlProductRepository` — via direct in-process exercise against the local `verdix` DB, cleaning up
test data afterward):

```bash
npx tsx -e "
const {query}=require('./lib/mysql');
(async()=>{
  const rows = await query(
    'SELECT su.id, sulp.price_level_id, sulp.price FROM product_selling_units su LEFT JOIN product_selling_unit_price_levels sulp ON sulp.selling_unit_id = su.id WHERE su.product_id = ? AND su.is_base = 1',
    ['<a real product id>']
  );
  console.table(rows);
  process.exit(0);
})();
"
```

Confirm: before your fix, the old code path would have thrown against a dropped table (you can confirm
this ahead of time with `SHOW TABLES LIKE 'product_price_levels'` returning empty); after your fix, a
receipt/apply through the real function updates `product_selling_unit_price_levels` correctly and does
NOT throw. If you exercise the actual `receivePurchaseOrder` or the price-list apply function against
real data, use ROLLED-BACK transactions or fully clean up afterward — this plan's branch has a
documented prior incident of a verification step destroying live data (see the ledger); do not repeat
that pattern. If you have no way to safely exercise the real functions, static-trace the change instead
and say so plainly in your report.

- [ ] **Step 5: Commit**

```bash
git add "lib/purchase-actions.ts" "lib/price-list-import.ts"
git commit -m "fix: migrate purchase receiving and price-list import off the dropped product_price_levels table"
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

**Two separate product read paths exist, and only one was migrated to selling units.**
`app/(app)/products/actions.ts`'s `getProducts` (used by the Products back-office pages) and
`src/infrastructure/repositories/MySqlProductRepository.ts` (used by `GET /api/products`, which
POS itself calls) are independent implementations that happened to diverge before this feature
existed. This plan updated both, but be aware they are NOT the same code path — a future schema
change to product reads must be applied to both, or POS silently falls back to stale/incomplete
data the way it did here until Task 5.5 fixed it. `create`/`update`/`delete` on
`MySqlProductRepository` are unreachable from the app's own UI (product writes go through
`actions.ts`'s server actions instead) — dead code, not a second write path to keep in sync.
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
