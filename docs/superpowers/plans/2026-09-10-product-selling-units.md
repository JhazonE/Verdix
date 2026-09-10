# Product Selling Units Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the parent/child product family model with selling units — one product, one stock figure in base units, many barcoded ways to sell it.

**Architecture:** A new `product_selling_units` table holds each way a product can be sold (name, barcode, factor, cost, price), while `products.stock` stays the single stock figure in base units. Selling a unit deducts `quantity × factor` from that one number, so there is nothing to synchronise and `lib/family-sync.ts` is deleted rather than reworked. Line-item tables record which unit was sold, with the factor captured at sale time so past receipts cannot be rewritten by a later edit.

**Tech Stack:** Next.js 16 (App Router, server actions), MySQL 8 via raw `mysql2/promise`, React with `@tanstack/react-query`, shadcn/ui, `node:assert/strict` unit tests, Playwright E2E.

**Spec:** `docs/superpowers/specs/2026-09-10-product-selling-units-design.md`

## Global Constraints

- **`products.stock` is the ONLY stock figure, always in base units.** No selling unit carries stock. Any task that adds a per-unit stock column has misunderstood the design.
- **Selling deducts `quantity × factor` from `products.stock`.** One number, one write. Nothing cascades.
- **Product names are NEVER rewritten.** "Nescafe Classic Refill 20g 1cs 60s" keeps that exact name (spec §5.2). No migration, import, or UI may change a product's name.
- **No product is ever merged into another automatically.** The schema migration only creates one `is_base = 1` unit per existing product. Merging two products' stock is irreversible; it happens only through an explicit, previewed, user-confirmed import (spec §4).
- **Line items capture `selling_unit_name` and `factor` AT SALE TIME**, denormalised. Editing a unit's factor later must never change what a past receipt meant.
- **Existing line-item rows keep `NULL` selling_unit_id, meaning "base unit".** No historical sale changes meaning.
- **BIR-significant paths.** `app/api/pos/checkout/route.ts`, `app/api/sales/returns/route.ts`, `sales_invoice_items`, and `sale_items` feed Z-readings and tax filings (`CLAUDE.md`). The live DB holds 147 POS items, 141 invoice items, and **28 Z-readings**. Z-reading output must be byte-identical before and after for the same data. A backup was taken before this work began.
- **The `-624` stock row** (one existing family member) is carried across unchanged. Do not "correct" an inventory number nobody explained.
- MySQL only, raw SQL, no ORM. Transactions use `withTransaction` from `@/lib/mysql`.
- **Unit tests** are `node:assert/strict` files that self-execute on import and MUST be registered in `tests/unit/run.ts`. A test must `catch`, print, and `process.exit(1)` on failure — never a bare `finally { process.exit(0) }`, which makes a test incapable of failing.
- **`npm run test:unit` cannot verify a new test here** — `tests/unit/business-date-lock-lifecycle.test.ts:67` aborts the suite. Use `npx tsx tests/unit/<file>.test.ts`.
- **Baseline is red:** lint broken, typecheck has pre-existing errors, four `tests/e2e/products/price-levels.spec.ts` tests fail (that spec seeds no session). Compare before calling a failure yours.
- **Never run `git stash`, `git restore`, `git checkout -- <file>`, `git reset`, or `git clean`.** ~10 uncommitted files of a colleague's work sit in the tree. Stage only your own files by explicit path.

---

### Task 1: The `product_selling_units` table

**Files:**
- Create: `scripts/migrations/118_create_product_selling_units.ts`
- Modify: `scripts/migrations/index.ts`

**Interfaces:**
- Produces: table `product_selling_units` — every later task depends on it.

**Verified facts you can rely on:** `products.barcode` currently has **no** unique index, and there are **0 duplicate barcodes** in the live data, so a `UNIQUE` index on the new table's barcode will apply cleanly. The newest migration is `117_add_product_markup_percentage`.

- [ ] **Step 1: Write the migration**

Create `scripts/migrations/118_create_product_selling_units.ts`:

```typescript
import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

/**
 * Selling units: the ways one product can be sold.
 *
 * Packaging used to be encoded in product names ("… 1cs 60s") or modelled as
 * separate child products with their own stock, which meant selling a case did
 * not reduce the piece count. Here, `products.stock` stays the single stock
 * figure in BASE units and a selling unit only says how many base units one of
 * it is worth. Nothing to synchronise, so nothing can fall out of sync.
 *
 * barcode is UNIQUE: a scan must resolve to exactly one selling unit.
 */
const migration: Migration = {
  name: '118_create_product_selling_units',
  timestamp: '2026-09-10_12-00-00',

  async up(): Promise<void> {
    const existing: any = await query(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_selling_units'`
    );
    if (existing[0]) {
      console.log('⏭️  product_selling_units already exists, skipping');
      return;
    }

    await query(`
      CREATE TABLE product_selling_units (
        id          VARCHAR(100) NOT NULL PRIMARY KEY,
        product_id  VARCHAR(50)  NOT NULL,
        name        VARCHAR(100) NOT NULL,
        barcode     VARCHAR(100) NULL,
        factor      DECIMAL(12,4) NOT NULL,
        cost        DECIMAL(12,4) NULL,
        price       DECIMAL(12,4) NOT NULL,
        is_base     TINYINT(1) NOT NULL DEFAULT 0,
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_selling_unit_barcode (barcode),
        UNIQUE KEY uniq_product_unit_name (product_id, name),
        KEY idx_selling_unit_product (product_id),
        CONSTRAINT fk_selling_unit_product
          FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
      )
    `);
    console.log('✅ created product_selling_units');
  },

  async down(): Promise<void> {
    await query('DROP TABLE IF EXISTS product_selling_units');
    console.log('✅ dropped product_selling_units');
  }
};

registerMigration(migration);
```

Note: MySQL treats multiple `NULL`s as distinct in a `UNIQUE` index, so many units may have no barcode.

- [ ] **Step 2: Register it**

In `scripts/migrations/index.ts`, after the `'./117_add_product_markup_percentage'` import:

```typescript
import './118_create_product_selling_units';
```

- [ ] **Step 3: Run it**

Run: `npm run migrate`
Expected: `✅ created product_selling_units`

- [ ] **Step 4: Verify the shape, then the rollback**

Run:
```bash
npx tsx -e "require('./lib/mysql').query('SHOW COLUMNS FROM product_selling_units').then(r=>{console.table(r); process.exit(0)})"
```
Expected: `factor` and `price` NOT NULL; `barcode`, `cost` nullable; `is_base` defaults 0.

Then prove `down()` is real: `npm run migrate:down` (expect the drop), then `npm run migrate` again.

- [ ] **Step 5: Commit**

```bash
git add scripts/migrations/118_create_product_selling_units.ts scripts/migrations/index.ts
git commit -m "feat: add product_selling_units table"
```

---

### Task 2: Backfill one base unit per product

**Files:**
- Create: `scripts/migrations/119_backfill_base_selling_units.ts`
- Modify: `scripts/migrations/index.ts`

**Interfaces:**
- Consumes: the table from Task 1.
- Produces: every product has exactly one `is_base = 1` row. Checkout (Task 5) resolves against this.

**Why this is non-optional:** without a base unit, checkout has nothing to resolve for a product and every sale breaks. Spec §5.1: this runs over the entire table (~16,000 rows), not a handful.

- [ ] **Step 1: Write the migration**

Create `scripts/migrations/119_backfill_base_selling_units.ts`:

```typescript
import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

/**
 * Gives every existing product a base selling unit (factor 1), carrying its
 * current unit_of_measure, barcode, cost and price.
 *
 * Without this, checkout has no unit to resolve and every sale for that product
 * fails — so it runs over the whole table, not a subset.
 *
 * It does NOT rewrite names, does NOT merge products, and does NOT touch
 * products.stock. Barcodes move across as-is; the live data has no duplicates,
 * and any that appear later surface as a UNIQUE violation for a human to
 * resolve rather than being silently dropped.
 */
const migration: Migration = {
  name: '119_backfill_base_selling_units',
  timestamp: '2026-09-10_12-30-00',

  async up(): Promise<void> {
    const dupes: any = await query(`
      SELECT barcode, COUNT(*) AS n FROM products
      WHERE barcode IS NOT NULL AND barcode <> ''
      GROUP BY barcode HAVING n > 1
    `);
    if (dupes.length > 0) {
      console.error('❌ duplicate barcodes block the base-unit backfill:');
      for (const d of dupes) console.error(`   ${d.barcode} (${d.n} products)`);
      throw new Error(
        `${dupes.length} duplicate barcode(s). Resolve these in the products list, then re-run.`
      );
    }

    const result: any = await query(`
      INSERT INTO product_selling_units
        (id, product_id, name, barcode, factor, cost, price, is_base)
      SELECT
        CONCAT('psu_base_', p.id),
        p.id,
        COALESCE(NULLIF(TRIM(p.unit_of_measure), ''), 'Piece'),
        NULLIF(TRIM(p.barcode), ''),
        1,
        p.cost,
        COALESCE(p.price, 0),
        1
      FROM products p
      WHERE NOT EXISTS (
        SELECT 1 FROM product_selling_units u
        WHERE u.product_id = p.id AND u.is_base = 1
      )
    `);
    console.log(`✅ created ${result.affectedRows} base selling unit(s)`);
  },

  async down(): Promise<void> {
    const result: any = await query(
      "DELETE FROM product_selling_units WHERE is_base = 1 AND id LIKE 'psu_base_%'"
    );
    console.log(`✅ removed ${result.affectedRows} backfilled base unit(s)`);
  }
};

registerMigration(migration);
```

The `WHERE NOT EXISTS` makes it re-runnable. `down()` removes only rows this migration created (the `psu_base_` prefix), never a unit somebody added by hand.

- [ ] **Step 2: Register it**

In `scripts/migrations/index.ts`, after the Task 1 import:

```typescript
import './119_backfill_base_selling_units';
```

- [ ] **Step 3: Run and verify every product got exactly one base unit**

Run: `npm run migrate`

Then:
```bash
npx tsx -e "
const {query}=require('./lib/mysql');
(async()=>{
  const [{n:products}] = await query('SELECT COUNT(*) n FROM products');
  const [{n:bases}] = await query('SELECT COUNT(*) n FROM product_selling_units WHERE is_base=1');
  const missing = await query('SELECT COUNT(*) n FROM products p WHERE NOT EXISTS (SELECT 1 FROM product_selling_units u WHERE u.product_id=p.id AND u.is_base=1)');
  const multi = await query('SELECT COUNT(*) n FROM (SELECT product_id FROM product_selling_units WHERE is_base=1 GROUP BY product_id HAVING COUNT(*)>1) t');
  console.log({products, bases, missing: missing[0].n, multipleBases: multi[0].n});
  process.exit(0);
})();
"
```
Expected: `products === bases`, `missing: 0`, `multipleBases: 0`.

- [ ] **Step 4: Verify stock was not touched**

Run:
```bash
npx tsx -e "require('./lib/mysql').query('SELECT SUM(stock) s, MIN(stock) m FROM products').then(r=>{console.log(r[0]); process.exit(0)})"
```
Record the output in your report. `MIN` should still show the pre-existing negative (`-624`) — it is carried across deliberately, not corrected.

- [ ] **Step 5: Commit**

```bash
git add scripts/migrations/119_backfill_base_selling_units.ts scripts/migrations/index.ts
git commit -m "feat: backfill a base selling unit for every product"
```

---

### Task 3: Resolution helpers

**Files:**
- Create: `lib/selling-units.ts`
- Create: `tests/unit/selling-units.test.ts`
- Modify: `tests/unit/run.ts`

**Interfaces:**
- Produces:
  - `baseQuantity(quantity: number, factor: number): number` — base units for a sale line.
  - `resolveSellingUnit(barcode: string, connection?): Promise<SellingUnit | null>` — barcode → unit.
  - `getBaseUnit(productId: string, connection?): Promise<SellingUnit | null>`.
  - `export type SellingUnit = { id: string; productId: string; name: string; barcode: string | null; factor: number; cost: number | null; price: number; isBase: boolean }`.

  Tasks 5 and 6 consume all of these.

**Why a separate module:** checkout, returns, voids, transfers and adjustments all need the same conversion. One tested function beats six inline multiplications that can drift.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/selling-units.test.ts`:

```typescript
import assert from 'node:assert/strict';
import { baseQuantity } from '../../lib/selling-units';

// A case of 60: selling 2 cases moves 120 base units.
assert.equal(baseQuantity(2, 60), 120, '2 cases of 60 = 120 base units');

// The base unit itself is factor 1 — quantity passes through.
assert.equal(baseQuantity(7, 1), 7, 'factor 1 is a pass-through');

// Fractional quantities are legal (0.5 kg of a kilo unit).
assert.equal(baseQuantity(0.5, 1), 0.5, 'fractional base quantity');
assert.equal(baseQuantity(1.5, 12), 18, '1.5 x 12 = 18');

// Zero quantity moves nothing — a void line, not an error.
assert.equal(baseQuantity(0, 60), 0, 'zero quantity moves zero stock');

// A returned line is negative and must stay negative.
assert.equal(baseQuantity(-1, 60), -60, 'a return of one case restores 60');

// DECIMAL(12,4) rounding: three thirds of a 10-unit pack must not drift.
assert.equal(baseQuantity(3, 0.3333), 0.9999, 'no silent rounding');

// A non-finite factor is a programming error, not a silent zero — it would
// otherwise deduct nothing and leave stock quietly wrong.
assert.throws(() => baseQuantity(1, NaN), /factor/i, 'NaN factor throws');
assert.throws(() => baseQuantity(1, 0), /factor/i, 'zero factor throws');
assert.throws(() => baseQuantity(1, -5), /factor/i, 'negative factor throws');

console.log('✅ selling-units tests passed');
```

- [ ] **Step 2: Register it**

In `tests/unit/run.ts`, at the end of the import list:

```typescript
import './selling-units.test';
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx tsx tests/unit/selling-units.test.ts`
Expected: FAIL — `Cannot find module '../../lib/selling-units'`.

- [ ] **Step 4: Write the module**

Create `lib/selling-units.ts`:

```typescript
import { query } from './mysql';
import type { PoolConnection } from 'mysql2/promise';

export type SellingUnit = {
  id: string;
  productId: string;
  name: string;
  barcode: string | null;
  factor: number;
  cost: number | null;
  price: number;
  isBase: boolean;
};

function mapRow(r: any): SellingUnit {
  return {
    id: r.id,
    productId: r.product_id,
    name: r.name,
    barcode: r.barcode ?? null,
    factor: Number(r.factor),
    cost: r.cost === null || r.cost === undefined ? null : Number(r.cost),
    price: Number(r.price),
    isBase: r.is_base === 1,
  };
}

/**
 * Base units moved by selling `quantity` of a unit worth `factor` base units.
 *
 * Negative quantities are legal and stay negative — that is a return putting
 * stock back. A zero, NaN or negative FACTOR throws rather than returning 0,
 * because a silent zero would deduct nothing and leave stock quietly wrong.
 */
export function baseQuantity(quantity: number, factor: number): number {
  if (!Number.isFinite(factor) || factor <= 0) {
    throw new Error(`Invalid selling unit factor: ${factor}`);
  }
  return quantity * factor;
}

const SELECT_UNIT = `
  SELECT id, product_id, name, barcode, factor, cost, price, is_base
  FROM product_selling_units
`;

async function run(sql: string, params: any[], connection?: PoolConnection) {
  if (connection) {
    const [rows]: any = await connection.query(sql, params);
    return rows;
  }
  return query(sql, params);
}

/** The selling unit a scanned barcode identifies, or null. */
export async function resolveSellingUnit(
  barcode: string,
  connection?: PoolConnection,
): Promise<SellingUnit | null> {
  const trimmed = String(barcode ?? '').trim();
  if (!trimmed) return null;
  const rows: any = await run(`${SELECT_UNIT} WHERE barcode = ? LIMIT 1`, [trimmed], connection);
  return rows[0] ? mapRow(rows[0]) : null;
}

/** A product's base unit (factor 1). Every product has exactly one. */
export async function getBaseUnit(
  productId: string,
  connection?: PoolConnection,
): Promise<SellingUnit | null> {
  const rows: any = await run(
    `${SELECT_UNIT} WHERE product_id = ? AND is_base = 1 LIMIT 1`,
    [productId],
    connection,
  );
  return rows[0] ? mapRow(rows[0]) : null;
}
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `npx tsx tests/unit/selling-units.test.ts`
Expected: `✅ selling-units tests passed`

- [ ] **Step 6: Commit**

```bash
git add lib/selling-units.ts tests/unit/selling-units.test.ts tests/unit/run.ts
git commit -m "feat: add selling unit resolution helpers"
```

---

### Task 4: Record the sold unit on line items

**Files:**
- Create: `scripts/migrations/120_add_selling_unit_to_line_items.ts`
- Modify: `scripts/migrations/index.ts`

**Interfaces:**
- Produces: `selling_unit_id`, `selling_unit_name`, `selling_unit_factor` on `pos_transaction_items`, `sale_items`, `sales_invoice_items`, `sales_order_items`. Task 5 writes them; reporting reads them.

**Why denormalised:** the spec requires that editing a unit's factor later cannot change what a past receipt meant. Storing only an id would let a factor edit silently rewrite history — including BIR-filed invoices.

**These are BIR-facing tables.** The columns are all nullable with no default, so existing rows keep `NULL` = "base unit" and no historical sale changes meaning.

- [ ] **Step 1: Write the migration**

Create `scripts/migrations/120_add_selling_unit_to_line_items.ts`:

```typescript
import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

/**
 * Records WHICH selling unit a line was sold in.
 *
 * Without this, "1 case" and "1 piece" are indistinguishable in sales history,
 * so a report cannot show cases even when the stock deduction is right.
 *
 * name and factor are denormalised on purpose: a receipt must keep its meaning
 * when someone later edits the unit. These tables feed BIR filings, so history
 * is not ours to rewrite.
 *
 * Every column is nullable — existing rows stay NULL, meaning "base unit".
 */
const TABLES = [
  'pos_transaction_items',
  'sale_items',
  'sales_invoice_items',
  'sales_order_items',
];

async function hasColumn(table: string, column: string): Promise<boolean> {
  const rows: any = await query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column],
  );
  return Boolean(rows[0]);
}

const migration: Migration = {
  name: '120_add_selling_unit_to_line_items',
  timestamp: '2026-09-10_13-00-00',

  async up(): Promise<void> {
    for (const table of TABLES) {
      if (await hasColumn(table, 'selling_unit_id')) {
        console.log(`⏭️  ${table} already has selling unit columns, skipping`);
        continue;
      }
      await query(`
        ALTER TABLE ${table}
          ADD COLUMN selling_unit_id     VARCHAR(100)  NULL,
          ADD COLUMN selling_unit_name   VARCHAR(100)  NULL,
          ADD COLUMN selling_unit_factor DECIMAL(12,4) NULL
      `);
      console.log(`✅ ${table}: added selling unit columns`);
    }
  },

  async down(): Promise<void> {
    for (const table of TABLES) {
      if (!(await hasColumn(table, 'selling_unit_id'))) continue;
      await query(`
        ALTER TABLE ${table}
          DROP COLUMN selling_unit_id,
          DROP COLUMN selling_unit_name,
          DROP COLUMN selling_unit_factor
      `);
      console.log(`✅ ${table}: dropped selling unit columns`);
    }
  }
};

registerMigration(migration);
```

No foreign key on `selling_unit_id`: a deleted unit must not cascade into a filed invoice, and the denormalised name/factor keep the row readable regardless.

- [ ] **Step 2: Register it**

```typescript
import './120_add_selling_unit_to_line_items';
```

- [ ] **Step 3: Run it and prove no existing row changed**

Before running, capture the current state:
```bash
npx tsx -e "
const {query}=require('./lib/mysql');
(async()=>{
  for (const t of ['pos_transaction_items','sale_items','sales_invoice_items','sales_order_items']) {
    const [{n}] = await query(\`SELECT COUNT(*) n FROM \${t}\`);
    const [{s}] = await query(\`SELECT COALESCE(SUM(quantity),0) s FROM \${t}\`);
    console.log(t, 'rows=', n, 'sum(quantity)=', s);
  }
  process.exit(0);
})();
"
```

Run: `npm run migrate`

Then run the same snippet again. Expected: **identical row counts and quantity sums.** Paste both into your report — this is the evidence that a BIR-facing table was widened without disturbing its contents.

- [ ] **Step 4: Confirm existing rows read as NULL**

```bash
npx tsx -e "require('./lib/mysql').query('SELECT COUNT(*) n FROM pos_transaction_items WHERE selling_unit_id IS NOT NULL').then(r=>{console.log('non-null:', r[0].n); process.exit(0)})"
```
Expected: `non-null: 0`.

- [ ] **Step 5: Commit**

```bash
git add scripts/migrations/120_add_selling_unit_to_line_items.ts scripts/migrations/index.ts
git commit -m "feat: record the sold selling unit on line items"
```

---

### Task 5: Checkout sells in units and deducts in base

**Files:**
- Modify: `app/api/pos/checkout/route.ts` (the family-sync block, currently ~lines 275-313)

**Interfaces:**
- Consumes: `baseQuantity`, `getBaseUnit` from `@/lib/selling-units` (Task 3); the line-item columns (Task 4).
- Produces: checkout writing `selling_unit_id` / `selling_unit_name` / `selling_unit_factor` on each line.

**This is the highest-risk task in the plan. Read all of it before editing.**

The current block walks the family tree: `findUltimateRoot` climbs to the root, then `deductFamilyStock` cascades a deduction down every descendant. Read it first — it is roughly lines 275-313, but find it by content (`deductFamilyStock`), not line number.

It is replaced by a single deduction:

```typescript
const factor = Number(item.sellingUnitFactor ?? 1);
const qtyInBase = baseQuantity(item.quantity, factor);
await updateStockAndRecordMovement(
  soldProd.id, -qtyInBase, 'sale', saleId, 'sale',
  `POS Sale: ${saleId}`, connection,
);
```

**Do NOT delete `lib/family-sync.ts` in this task.** Other callers still import it; it goes in Task 7 once they are all converted. Removing it now breaks the build.

**Incoming items may not carry a selling unit yet** (the POS UI is not part of this plan). Default to the base unit: when `item.sellingUnitId` is absent, call `getBaseUnit(soldProd.id, connection)` and use its id/name/factor. A product with no base unit is a data error — throw with the product id rather than silently deducting nothing.

- [ ] **Step 1: Replace the deduction**

Swap the `findUltimateRoot`/`deductFamilyStock` block for the single deduction above, resolving the unit first:

```typescript
// One product, one stock figure, in base units. A selling unit only says how
// many base units one of it is worth, so a sale is a single deduction — there
// is no family to cascade through any more.
let unitId: string | null = item.sellingUnitId ?? null;
let unitName: string | null = item.sellingUnitName ?? null;
let factor = Number(item.sellingUnitFactor ?? 0);

if (!unitId || !Number.isFinite(factor) || factor <= 0) {
  const base = await getBaseUnit(soldProd.id, connection);
  if (!base) {
    throw new Error(`Product ${soldProd.id} has no base selling unit — cannot record this sale.`);
  }
  unitId = base.id;
  unitName = base.name;
  factor = base.factor;
}

const qtyInBase = baseQuantity(item.quantity, factor);
await updateStockAndRecordMovement(
  soldProd.id,
  -qtyInBase,
  'sale',
  saleId,
  'sale',
  `POS Sale: ${saleId}${factor !== 1 ? ` (${item.quantity} × ${unitName})` : ''}`,
  connection,
);
```

Remove the now-unused `findUltimateRoot` / `deductFamilyStock` import from this file only.

- [ ] **Step 2: Write the resolved unit onto the line items**

The `sale_items` insert is around line 248 and lists its columns explicitly. Add the three new columns and their values (`unitId`, `unitName`, `factor`). Do the same for the `pos_transaction_items` insert in this file.

Capture the values resolved in Step 1 — not a fresh lookup — so the row records what was actually used.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep "checkout"`
Expected: no errors naming that file.

- [ ] **Step 4: Prove a sale still works and moves the right stock**

This is BIR-facing code, so verify against the real behaviour rather than by inspection. Write a throwaway tsx script (scratchpad or deleted before commit) that:

1. picks a product, records its `stock`,
2. gives it a second selling unit with `factor = 12` (insert directly),
3. calls the checkout route's logic — or, if the route is impractical to invoke directly, inserts a sale through the same code path the route uses — selling **1** of that unit,
4. asserts stock dropped by exactly **12**, not 1,
5. asserts the written line item carries `selling_unit_factor = 12` and the unit's name,
6. cleans up every row it created.

Print the before/after stock. If you cannot drive the route directly, say so plainly and verify the deduction helper plus the insert columns instead — do not claim an end-to-end pass you did not run.

- [ ] **Step 5: Run the POS E2E**

Run: `npm run test:e2e:db`
Then: `npx playwright test tests/e2e/pos-sale.spec.ts tests/e2e/pos-edit-qty-auth.spec.ts --reporter=line`

(Those are the real POS specs — I verified the filenames. `pos-search-focus.spec.ts` is UI-only and unaffected.)

Expected: the same pass/fail set as before your change. Any newly failing test is yours. `pos-sale.spec.ts` is the one that matters — it drives a real sale through checkout, which is exactly the path you changed.

- [ ] **Step 6: Commit**

```bash
git add app/api/pos/checkout/route.ts
git commit -m "feat: checkout deducts base units via the sold selling unit"
```

---

### Task 6: Convert the remaining family-sync callers

**Files:**
- Modify: `app/api/pos/void-transaction/route.ts`
- Modify: `app/api/sales/returns/route.ts`
- Modify: `app/api/sales/invoices/[id]/void/route.ts`
- Modify: `app/api/sales/orders/[id]/route.ts`
- Modify: `app/api/sales/orders/[id]/deliver/route.ts`
- Modify: `app/api/inventory/adjust/bulk/route.ts`
- Modify: `app/api/inventory/transfer/bulk/route.ts`
- Modify: `app/api/stock-adjustments/route.ts`
- Modify: `app/(app)/inventory/history/actions.ts`
- Modify: `lib/bad-order-actions.ts`

**Interfaces:**
- Consumes: `baseQuantity`, `getBaseUnit` (Task 3).
- Produces: no remaining importers of `lib/family-sync.ts` outside that file itself.

**These are the same shape as Task 5**, which is why they are batched: each currently calls `deductFamilyStock` / `addFamilyStock` / `findUltimateRoot` and each becomes one `updateStockAndRecordMovement` with `baseQuantity`.

**Voids and returns ADD stock back.** Use `addFamilyStock`'s replacement carefully: the sign is positive, and where a line item recorded a `selling_unit_factor`, use THAT recorded factor — not the unit's current one. A unit edited since the sale must not change how much stock a return restores.

- [ ] **Step 1: Enumerate the call sites**

Run: `grep -rn "deductFamilyStock\|addFamilyStock\|findUltimateRoot\|syncFamilyStockDuringTransfer" app/ lib/ --include=*.ts --include=*.tsx`

Work the list top to bottom. Report the full list in your report so the reviewer can check none was missed.

- [ ] **Step 2: Convert each caller**

For a deduction:

```typescript
const factor = Number(row.selling_unit_factor ?? 1);
await updateStockAndRecordMovement(
  productId, -baseQuantity(quantity, factor), 'sale', refId, 'sale', notes, connection,
);
```

For a restoration (void, return), the same with a positive quantity and the appropriate movement type (`'return'`, `'adjustment'`, `'transfer'`).

Where the old code called `findUltimateRoot` to convert into root units, that conversion disappears — the product IS the stock holder now.

For transfers, `syncFamilyStockDuringTransfer` moved a whole family between warehouses. It becomes a single move of `baseQuantity(quantity, factor)` for the one product.

- [ ] **Step 3: Confirm nothing still imports family-sync**

Run: `grep -rn "family-sync" app/ lib/ src/ --include=*.ts --include=*.tsx`
Expected: no matches (the file itself is deleted in Task 7).

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "returns|void|orders|adjust|transfer|stock-adjustments|bad-order|inventory/history"`
Expected: no NEW errors naming those files.

- [ ] **Step 5: Run the inventory and sales E2E**

Run: `npm run test:e2e:db`
Then: `npx playwright test tests/e2e/stock-count-variance.spec.ts tests/e2e/product-reassign.spec.ts --reporter=line`

Plus any spec touching returns, voids, or transfers (`ls tests/e2e` to find them). Compare against the known-red baseline; report only NEW failures.

- [ ] **Step 6: Commit**

```bash
git add app/api lib/bad-order-actions.ts "app/(app)/inventory/history/actions.ts"
git commit -m "feat: convert stock movements to selling-unit base quantities"
```

---

### Task 7: Delete the family model

**Files:**
- Delete: `lib/family-sync.ts`
- Delete: `app/(app)/products/child-units/` (dialog, hook, add-existing dialog)
- Modify: `app/(app)/products/actions.ts` — remove `updateChildConversions`, `updateChildMarkups`, `getChildProducts`, `reassignParent`, `clearStockAndReassign`, and the child-count/parent-name query pieces
- Modify: `app/(app)/products/page.tsx` — remove the child badge and `Manage Child Units`
- Modify: `app/(app)/products/view-product/view-product-dialog.tsx` — remove the "Child of X" line
- Delete: `lib/product-tree.ts` and its test, `tests/unit/child-conversions.test.ts`, `tests/unit/clear-stock-and-reassign.test.ts`, `tests/e2e/child-units.spec.ts`, `tests/e2e/product-reassign.spec.ts`
- Create: `scripts/migrations/121_drop_product_family_columns.ts`

**Interfaces:**
- Consumes: Task 6 having removed every family-sync caller.
- Produces: a codebase with one stock model.

**Do this task LAST and only when Task 6's grep is clean.** Deleting earlier breaks the build.

**Order matters:** delete the code first, get a clean typecheck, and only then drop the columns. A dropped column with code still reading it is a runtime error rather than a compile error.

- [ ] **Step 1: Delete the UI and library files**

```bash
git rm -r "app/(app)/products/child-units"
git rm lib/family-sync.ts lib/product-tree.ts
git rm tests/unit/product-tree.test.ts tests/unit/child-conversions.test.ts tests/unit/clear-stock-and-reassign.test.ts
git rm tests/e2e/child-units.spec.ts tests/e2e/product-reassign.spec.ts
```

Remove their imports from `tests/unit/run.ts`.

- [ ] **Step 2: Remove the server actions and UI references**

In `app/(app)/products/actions.ts`, delete `updateChildConversions`, `updateChildMarkups`, `getChildProducts`, `reassignParent`, `reassignParentOnConnection`, `clearStockAndReassign`, and the `child_count` / `parent_name` selections in `getProducts`.

In `page.tsx` remove the child-count badge, the `Manage Child Units` menu item, and the `manageChildrenProduct` state. In `view-product-dialog.tsx` remove the "Child of X — Manage" block and its callback prop.

**Keep `products.markup_percentage` and the markup resolver** — markup is unrelated to families and is set in the Edit Product form.

- [ ] **Step 3: Typecheck until clean**

Run: `npx tsc --noEmit 2>&1 | grep -E "child-units|family-sync|product-tree|reassign"`
Expected: no matches. Fix every leftover before continuing — this is what makes Step 4 safe.

- [ ] **Step 4: Write the column-drop migration**

Create `scripts/migrations/121_drop_product_family_columns.ts`:

```typescript
import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

/**
 * Removes the parent/child family model. Selling units replaced it: one
 * product, one stock figure, many barcoded ways to sell it.
 *
 * conversion_factors and products.parent_id both go. Run this only after every
 * caller is converted — a dropped column with live readers is a runtime error.
 */
const migration: Migration = {
  name: '121_drop_product_family_columns',
  timestamp: '2026-09-10_14-00-00',

  async up(): Promise<void> {
    const col: any = await query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'parent_id'`
    );
    if (col[0]) {
      const fks: any = await query(
        `SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products'
           AND COLUMN_NAME = 'parent_id' AND REFERENCED_TABLE_NAME IS NOT NULL`
      );
      for (const fk of fks) {
        await query(`ALTER TABLE products DROP FOREIGN KEY \`${fk.CONSTRAINT_NAME}\``);
      }
      await query('ALTER TABLE products DROP COLUMN parent_id');
      console.log('✅ dropped products.parent_id');
    }

    await query('DROP TABLE IF EXISTS conversion_factors');
    console.log('✅ dropped conversion_factors');
  },

  async down(): Promise<void> {
    // Not reversible: the family relationships and their factors are gone, and
    // the selling units that replaced them carry no parent_id to rebuild from.
    console.log('⏭️  121_drop_product_family_columns is not reversible');
  }
};

registerMigration(migration);
```

Register it in `scripts/migrations/index.ts`.

- [ ] **Step 5: Run it and confirm the app still starts**

Run: `npm run migrate`

Then start the dev server in the FOREGROUND on port 3000 and confirm `/products` returns 200 and renders. A missed reference surfaces here as a 500.

- [ ] **Step 6: Run the full E2E suite**

Run: `npm run test:e2e:db`
Then: `npx playwright test --reporter=line`

Compare against the known-red baseline (four `products/price-levels` failures from missing session seeding, plus `developer-page-toggles`). Report only NEW failures. The two deleted specs will no longer appear — that is expected.

- [ ] **Step 7: Commit**

```bash
git add -u
git commit -m "refactor: remove the parent/child family model"
```

(`git add -u` stages deletions of tracked files. Verify with `git status` first that it stages ONLY this task's files and none of the colleague's uncommitted work — if it would sweep anything else in, stage each path explicitly instead.)

---

### Task 7b: Replace the Add/Edit Product "Conversion Factors" tab with Selling Units

**Files:**
- Modify: `app/(app)/products/add-product/tabs/conversion-tab.tsx`
- Modify: `app/(app)/products/edit-product/tabs/conversion-tab.tsx`
- Modify: `app/(app)/products/add-product/use-add-product-form.ts`
- Modify: `app/(app)/products/edit-product/use-edit-product-form.ts`
- Modify: `app/(app)/products/add-product/product-schema.ts`
- Modify: `app/(app)/products/actions.ts` — `addProduct`'s child-creation branch (~line 554)

**Interfaces:**
- Consumes: `product_selling_units` (Task 1), `baseQuantity`/`getBaseUnit` (Task 3).
- Produces: products created with their selling units in one step.

**Why this task exists.** The user asked for it directly: *"wala man nimu gtangal ang parent ug child
na features then pulihanan atong sa conversion factor nga naa sa add products."* Tasks 5–7 remove the
family model from the *runtime*, but the Add Product form is where a user actually *creates* one —
leaving it untouched would mean the UI still offers to build a model the backend no longer honours.

**What the tab does today** (read it before editing):
- An **"Auto-create Child Unit"** switch. When on, `addProduct` inserts a second product with
  `parentId` set (`actions.ts:554`, via `formData.__childProduct`) — this is the family model's
  creation path and it goes away entirely.
- A **Conversion Factors** list where each row has only **Unit Name** and **Quantity**. There is
  nowhere to enter a barcode, a cost, or a price — which is exactly why packaging ended up encoded in
  product names.

**What it becomes:** a **Selling Units** tab. Each row: **Unit Name**, **Quantity** (the factor),
**Barcode**, **Cost**, **Price**. The "Auto-create Child Unit" switch is deleted — there is no child
to create. The product's own unit becomes its base unit (factor 1) automatically, as Task 2's
backfill already does for existing products.

- [ ] **Step 1: Rework the add-product tab**

Rename the section heading to **Selling Units** and delete the "Auto-create Child Unit" block
outright (the `Switch`, its `Label`, and the `autoCreateChild` state feeding it).

Extend each row from two fields to five. Keep the existing `useFieldArray` wiring and the unit-name
`Select`; add three inputs bound to `sellingUnits.${index}.barcode`, `.cost`, and `.price`.

Rename the field array from `conversionFactors` to `sellingUnits` in the form, the schema, and the
tab, so nothing still calls these "conversion factors" — the name is what made them feel like a
property of the parent rather than a thing you sell.

- [ ] **Step 2: Validate each row**

Per row: unit name required and unique within the product; **factor > 0** (reject `0` — a zero factor
would make every synced quantity zero); price required and `>= 0`; cost optional; barcode optional.

A duplicate barcode must be caught and surfaced clearly: `product_selling_units.barcode` is UNIQUE
across the whole table and already holds ~16,000 values from the base-unit backfill, so a collision
is likely, not theoretical. Catch `ER_DUP_ENTRY` and name the offending barcode — never let it
surface as a raw SQL error.

- [ ] **Step 3: Write the units in `addProduct`**

Replace the `__childProduct` branch (`actions.ts:~554`) — which inserted a second product with a
`parentId` — with an insert of one `product_selling_units` row per entered unit, inside the same
transaction that creates the product.

Also insert the **base unit** for the new product: name from its `unit_of_measure`, `factor = 1`,
`is_base = 1`, carrying its own barcode/cost/price. Every product must have one, exactly as Task 2
guarantees for existing products.

Do the equivalent in the edit-product path: added units insert, removed units delete, changed units
update. The base unit may have its barcode/cost/price edited but its `factor` stays 1 and its
`is_base` stays 1.

- [ ] **Step 4: Verify against the database**

Create a product through the form with two extra selling units. Then confirm directly:

```bash
npx tsx -e "
const {query}=require('./lib/mysql');
(async()=>{
  const rows = await query(\"SELECT name, barcode, factor, cost, price, is_base FROM product_selling_units WHERE product_id = ? ORDER BY is_base DESC\", ['<the new product id>']);
  console.table(rows); process.exit(0);
})();"
```
Expected: exactly one `is_base = 1, factor = 1` row plus the two you entered, each with its own
barcode/cost/price. No second row in `products` — the family model created one; this must not.

- [ ] **Step 5: Confirm no child product was created**

```bash
npx tsx -e "require('./lib/mysql').query('SELECT COUNT(*) n FROM products WHERE parent_id IS NOT NULL').then(r=>{console.log('children:', r[0].n); process.exit(0)})"
```
Expected: `0` once Task 7 has dropped `parent_id`; before that, unchanged from its prior value. Either
way it must NOT have grown from creating a product through the reworked form.

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/products/add-product" "app/(app)/products/edit-product" "app/(app)/products/actions.ts"
git commit -m "feat: create selling units from the product form"
```

---

### Task 8: Document the new model

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Replace the family entries**

`CLAUDE.md` has a **Product families in the UI** entry and a `lib/family-sync.ts` bullet under Stock / Inventory. Both describe a model that no longer exists. Replace them with:

```markdown
**Selling units** — a product has ONE stock figure in `products.stock`, always in base
units, and one row per way it can be sold in `product_selling_units` (name, barcode,
factor, cost, price; exactly one `is_base = 1` with factor 1). Selling deducts
`quantity × factor` from that single figure — there is nothing to synchronise, which is
why the old `lib/family-sync.ts` and `products.parent_id` were removed. Barcodes are
UNIQUE across selling units so a scan resolves to exactly one. Line items record
`selling_unit_id` plus a denormalised `selling_unit_name` and `selling_unit_factor`
captured at sale time, so a later edit to a unit cannot change what a filed receipt
meant; rows with `NULL` predate this and mean the base unit. Sales reports show the unit
sold (1 case); inventory moves in base units (60 pieces).
```

Delete the `lib/family-sync.ts` bullet and the whole **Product families in the UI** entry.

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: describe the selling units model"
```

---

## Done When

- Every product has exactly one base selling unit; `products.stock` is unchanged by the migration, negative rows included.
- Selling one case of 60 deducts 60 base units and records `selling_unit_factor = 60` on the line.
- No code imports `lib/family-sync.ts`; the file, `products.parent_id`, and `conversion_factors` are gone.
- Existing line items still read `NULL` for the new columns, and no historical sale changed meaning.
- Product names were never rewritten, and no two products were merged.
- The full E2E suite shows no NEW failures against the known-red baseline.
