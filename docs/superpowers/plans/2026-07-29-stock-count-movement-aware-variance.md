# Movement-Aware Stock Count Variance — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop stock counts from double-deducting inventory when POS sales happen between the snapshot and the count.

**Architecture:** Compare each counted quantity against what the system believed was on hand *at the moment the count was entered* (`snapshot + net movements in that window`) rather than against the stale snapshot. The resulting variance is applied as a delta through the existing family-sync path, so movements landing after the count need no special handling.

**Tech Stack:** TypeScript, Next.js 16 App Router, raw `mysql2/promise`, `tsx` migrations, `node:assert/strict` unit tests, Playwright E2E on `verdix_test`.

**Spec:** [`docs/superpowers/specs/2026-07-29-stock-count-movement-aware-variance-design.md`](../specs/2026-07-29-stock-count-movement-aware-variance-design.md)

## Global Constraints

- **MySQL only, raw SQL.** No ORM. Local pool via `query()` from `lib/mysql.ts`; transactional work via `withTransaction`.
- **Migrations** are numbered `tsx` files in `scripts/migrations/`, each calling `registerMigration({ name, timestamp, up, down })`, and MUST be added to `scripts/migrations/index.ts` or they never run.
- **Migrations must be idempotent** — check `information_schema.COLUMNS` before `ALTER`, following [`101_add_product_type.ts`](../../../scripts/migrations/101_add_product_type.ts).
- **Unit tests** use `node:assert/strict`, self-execute on import, take **no DB connection**, and MUST be registered in `tests/unit/run.ts`. Run with `npm run test:unit`.
- **E2E tests** are Playwright specs against `verdix_test` on port 3100, `workers: 1`. Use `testQuery` from `tests/e2e/helpers/db.ts` and `seedSession` from `tests/e2e/helpers/auth.ts`.
- **Comments in E2E specs are written in Cebuano** in this repo (see [`adjustment-expiration.spec.ts`](../../../tests/e2e/adjustment-expiration.spec.ts)). Match the surrounding style.
- **Never break BIR numbering.** Nothing in this plan touches `sales_invoice_number`; do not.
- **Epsilon for `DECIMAL` comparison is `0.0001`.**

---

## File Structure

| File | Responsibility |
|---|---|
| `scripts/migrations/103_stock_count_movement_aware_variance.ts` | Adds `counted_at`, `snapshot_at`; widens quantity columns to `DECIMAL(15,4)` |
| `scripts/migrations/index.ts` | Register migration 103 (modify) |
| `lib/stock-count-baseline.ts` | Baseline arithmetic (pure) + movement-window query |
| `tests/unit/stock-count-baseline.test.ts` | Unit tests for the pure arithmetic |
| `tests/unit/run.ts` | Register the new unit test (modify) |
| `app/api/inventory/stock-counts/[id]/items/route.ts` | Stamp `counted_at` only on real change (modify) |
| `src/core/inventory/domain/StockCount.ts` | Add `countedAt` / `snapshotAt` to entities (modify) |
| `src/infrastructure/repositories/MySqlStockCountRepository.ts` | Select the new timestamp columns (modify) |
| `src/core/inventory/application/CompleteStockCountUseCase.ts` | Use the baseline instead of the raw snapshot (modify) |
| `tests/e2e/stock-count-variance.spec.ts` | End-to-end proof the double-deduction is gone |

The baseline module is deliberately split into a **pure** function (`computeTrueVariance`) and a **DB-touching** function (`getNetMovementSince`). This repo's unit tests never open a connection, so all the decision logic lives in the pure half where it can be tested exhaustively; the query half stays thin enough to be covered by E2E.

---

### Task 1: Migration — timestamps and numeric precision

**Files:**
- Create: `scripts/migrations/103_stock_count_movement_aware_variance.ts`
- Modify: `scripts/migrations/index.ts:102`

**Interfaces:**
- Consumes: nothing.
- Produces: `stock_count_items.counted_at` (`TIMESTAMP NULL`), `stock_counts.snapshot_at` (`TIMESTAMP NULL`), and `stock_count_items.snapshot_quantity` / `counted_quantity` as `DECIMAL(15,4)`.

- [ ] **Step 1: Write the migration**

Create `scripts/migrations/103_stock_count_movement_aware_variance.ts`:

```ts
import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

/**
 * Movement-aware stock count variance.
 *
 * A count froze snapshot_quantity at creation and compared the physical count
 * against it at completion. Every POS sale in between was therefore treated as
 * variance and deducted a second time. Fixing that needs to know WHEN a line was
 * counted, so the movements inside that window can be cancelled out.
 *
 * counted_at is deliberately NOT updated_at: updated_at moves on any UPDATE,
 * including ones unrelated to counting, so it cannot anchor the baseline window.
 *
 * The INT -> DECIMAL widening rides along because family-sync divides by
 * factorToRoot and works in fractional root units, so INT columns silently
 * truncate counts of repacked goods.
 */
async function hasColumn(table: string, column: string): Promise<boolean> {
  const rows: any = await query(
    `SELECT COUNT(*) AS cnt
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return (rows?.[0]?.cnt ?? 0) > 0;
}

const migration: Migration = {
  name: '103_stock_count_movement_aware_variance',
  timestamp: '2026-07-29_09-00-00',

  async up(): Promise<void> {
    if (await hasColumn('stock_count_items', 'counted_at')) {
      console.log('• stock_count_items.counted_at already exists — skipping');
    } else {
      await query(`ALTER TABLE stock_count_items ADD COLUMN counted_at TIMESTAMP NULL AFTER counted_quantity`);
      console.log('✅ Added stock_count_items.counted_at');

      // Existing in-progress counts would otherwise have a null baseline anchor.
      // updated_at is the best available approximation for rows already counted.
      await query(`UPDATE stock_count_items SET counted_at = updated_at WHERE counted_quantity IS NOT NULL`);
      console.log('✅ Backfilled counted_at from updated_at');
    }

    if (await hasColumn('stock_counts', 'snapshot_at')) {
      console.log('• stock_counts.snapshot_at already exists — skipping');
    } else {
      await query(`ALTER TABLE stock_counts ADD COLUMN snapshot_at TIMESTAMP NULL AFTER created_at`);
      await query(`UPDATE stock_counts SET snapshot_at = created_at WHERE snapshot_at IS NULL`);
      console.log('✅ Added and backfilled stock_counts.snapshot_at');
    }

    // Widen quantities. MODIFY is idempotent — re-running lands on the same type.
    await query(`ALTER TABLE stock_count_items MODIFY COLUMN snapshot_quantity DECIMAL(15,4) NOT NULL`);
    await query(`ALTER TABLE stock_count_items MODIFY COLUMN counted_quantity DECIMAL(15,4) NULL`);
    await query(`ALTER TABLE stock_count_items MODIFY COLUMN variance DECIMAL(15,4) NULL`);
    console.log('✅ Widened stock count quantities to DECIMAL(15,4)');
  },

  async down(): Promise<void> {
    await query(`ALTER TABLE stock_count_items MODIFY COLUMN variance INT NULL`);
    await query(`ALTER TABLE stock_count_items MODIFY COLUMN counted_quantity INT NULL`);
    await query(`ALTER TABLE stock_count_items MODIFY COLUMN snapshot_quantity INT NOT NULL`);
    await query(`ALTER TABLE stock_counts DROP COLUMN snapshot_at`);
    await query(`ALTER TABLE stock_count_items DROP COLUMN counted_at`);
    console.log('✅ Reverted movement-aware stock count columns');
  }
};

registerMigration(migration);
```

- [ ] **Step 2: Register the migration**

In `scripts/migrations/index.ts`, after the line `import './102_unique_sales_order_reference';` add:

```ts
import './103_stock_count_movement_aware_variance';
```

- [ ] **Step 3: Run the migration**

Run: `npm run migrate`
Expected: output contains `✅ Added stock_count_items.counted_at`, `✅ Added and backfilled stock_counts.snapshot_at`, and `✅ Widened stock count quantities to DECIMAL(15,4)`.

- [ ] **Step 4: Verify the schema changed**

Run:

```bash
node -e "require('dotenv').config();const m=require('mysql2/promise');(async()=>{const c=await m.createConnection({host:process.env.DB_HOST||'127.0.0.1',port:+(process.env.DB_PORT||3306),user:process.env.DB_USER||'root',password:process.env.DB_PASSWORD||'',database:process.env.DB_NAME||'verdix'});const [r]=await c.query(\"SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND ((TABLE_NAME='stock_count_items' AND COLUMN_NAME IN ('counted_at','snapshot_quantity','counted_quantity')) OR (TABLE_NAME='stock_counts' AND COLUMN_NAME='snapshot_at'))\");console.table(r);await c.end();})()"
```

Expected: four rows — `counted_at` as `timestamp`, `snapshot_at` as `timestamp`, and both quantity columns as `decimal(15,4)`.

- [ ] **Step 5: Verify idempotency**

Run: `npm run migrate`
Expected: exits cleanly. (The `migrations` table already records 103, so it is skipped entirely; the `hasColumn` guards are insurance for hand-run cases.)

- [ ] **Step 6: Commit**

```bash
git add scripts/migrations/103_stock_count_movement_aware_variance.ts scripts/migrations/index.ts
git commit -m "feat(inventory): add stock count timing columns and decimal quantities"
```

---

### Task 2: Baseline module

**Files:**
- Create: `lib/stock-count-baseline.ts`
- Create: `tests/unit/stock-count-baseline.test.ts`
- Modify: `tests/unit/run.ts:25`

**Interfaces:**
- Consumes: `stock_movements` table (`product_id`, `quantity_change`, `reference_id`, `created_at`); `PoolConnection` from `mysql2/promise`.
- Produces:
  - `getNetMovementSince(productId: string, from: Date, to: Date, excludeReferenceId: string, connection: PoolConnection): Promise<number>`
  - `computeTrueVariance(input: BaselineInput): BaselineResult`
  - `type BaselineInput = { snapshotQuantity: number; countedQuantity: number; liveStock: number; netMovementToCount: number; netMovementToNow: number; }`
  - `type BaselineResult = { variance: number; baseline: number; usedFallback: boolean; }`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/stock-count-baseline.test.ts`:

```ts
import assert from 'node:assert/strict';
import { computeTrueVariance } from '../../lib/stock-count-baseline';

// The bug this whole change exists to fix: 100 on hand at snapshot, POS sells 10,
// counter finds the correct 90. Naive `counted - snapshot` yields -10 and deducts
// the sale a second time. With the movement window accounted for, variance is 0.
{
  const r = computeTrueVariance({
    snapshotQuantity: 100,
    countedQuantity: 90,
    liveStock: 90,
    netMovementToCount: -10,
    netMovementToNow: -10,
  });
  assert.equal(r.variance, 0, 'sale during count is not variance');
  assert.equal(r.baseline, 90, 'baseline shifted by the sale');
  assert.equal(r.usedFallback, false);
}

// A genuine shortage on top of a sale must still be caught, and must be exactly
// the shortage — not the shortage plus the sale.
{
  const r = computeTrueVariance({
    snapshotQuantity: 100,
    countedQuantity: 87,
    liveStock: 90,
    netMovementToCount: -10,
    netMovementToNow: -10,
  });
  assert.equal(r.variance, -3, 'only the real shortage applies');
}

// No movements at all — the original behaviour, which was correct.
{
  const r = computeTrueVariance({
    snapshotQuantity: 50,
    countedQuantity: 45,
    liveStock: 50,
    netMovementToCount: 0,
    netMovementToNow: 0,
  });
  assert.equal(r.variance, -5, 'plain variance still applies');
  assert.equal(r.baseline, 50);
}

// Receiving stock mid-count is the mirror case and used to over-add.
{
  const r = computeTrueVariance({
    snapshotQuantity: 20,
    countedQuantity: 50,
    liveStock: 50,
    netMovementToCount: 30,
    netMovementToNow: 30,
  });
  assert.equal(r.variance, 0, 'purchase during count is not variance');
}

// Movements landing AFTER the line was counted are already in live stock. They
// must shift neither the baseline nor the variance — the delta is applied to
// live stock, so it stays correct without them.
{
  const r = computeTrueVariance({
    snapshotQuantity: 100,
    countedQuantity: 90,
    liveStock: 85,
    netMovementToCount: -10,
    netMovementToNow: -15,
  });
  assert.equal(r.variance, 0, 'post-count sale is not variance');
  assert.equal(r.baseline, 90, 'baseline anchored at count time, not now');
}

// Safety net: if the movement log cannot explain the gap between snapshot and
// live stock, some write bypassed recordStockMovement. Trusting the baseline
// would corrupt stock, so fall back to live stock (today's effective behaviour).
{
  const r = computeTrueVariance({
    snapshotQuantity: 100,
    countedQuantity: 90,
    liveStock: 60,          // 40 short
    netMovementToCount: -10, // log only explains 10
    netMovementToNow: -10,
  });
  assert.equal(r.usedFallback, true, 'incomplete log detected');
  assert.equal(r.baseline, 60, 'falls back to live stock');
  assert.equal(r.variance, 30, 'variance measured against live stock');
}

// Fractional quantities must survive: repacked goods sync in fractional root
// units, which is why the columns became DECIMAL.
{
  const r = computeTrueVariance({
    snapshotQuantity: 10.5,
    countedQuantity: 8.25,
    liveStock: 10.5,
    netMovementToCount: 0,
    netMovementToNow: 0,
  });
  assert.equal(r.variance, -2.25, 'fractional variance preserved');
}

// Floating-point noise must not register as a variance and write a pointless
// adjustment movement.
{
  const r = computeTrueVariance({
    snapshotQuantity: 0.1 + 0.2, // 0.30000000000000004
    countedQuantity: 0.3,
    liveStock: 0.1 + 0.2,
    netMovementToCount: 0,
    netMovementToNow: 0,
  });
  assert.equal(r.variance, 0, 'sub-epsilon difference is not a variance');
  assert.equal(r.usedFallback, false, 'sub-epsilon drift is not a log gap');
}

console.log('stock-count-baseline: all assertions passed');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx tests/unit/stock-count-baseline.test.ts`
Expected: FAIL — cannot find module `../../lib/stock-count-baseline`.

- [ ] **Step 3: Write the implementation**

Create `lib/stock-count-baseline.ts`:

```ts
import { PoolConnection } from 'mysql2/promise';

/** DECIMAL(15,4) rounding slack. Differences below this are not real. */
const EPSILON = 0.0001;

export type BaselineInput = {
  /** Stock recorded when the count was created. */
  snapshotQuantity: number;
  /** What the counter physically found. */
  countedQuantity: number;
  /** products.stock right now, at completion time. */
  liveStock: number;
  /** Net stock_movements from snapshot until the line was counted. */
  netMovementToCount: number;
  /** Net stock_movements from snapshot until now. */
  netMovementToNow: number;
};

export type BaselineResult = {
  /** Delta to apply to live stock. Zero means nothing to do. */
  variance: number;
  /** What the system believed was on hand when the line was counted. */
  baseline: number;
  /** True when the movement log was incomplete and live stock was used instead. */
  usedFallback: boolean;
};

/**
 * Variance of a counted line against what the system believed was on hand at the
 * moment it was counted, rather than against the stale snapshot.
 *
 * Movements recorded AFTER the line was counted are intentionally ignored: they
 * are already reflected in live stock, and the caller applies `variance` as a
 * delta rather than setting an absolute value.
 */
export function computeTrueVariance(input: BaselineInput): BaselineResult {
  const { snapshotQuantity, countedQuantity, liveStock, netMovementToCount, netMovementToNow } = input;

  // If the log is complete, snapshot + everything since must equal live stock.
  // When it doesn't, a write bypassed recordStockMovement and the baseline is
  // untrustworthy — fall back to live stock, which is what the old code
  // effectively compared against once its delta was applied.
  const reconstructedNow = snapshotQuantity + netMovementToNow;
  const usedFallback = Math.abs(reconstructedNow - liveStock) > EPSILON;

  const baseline = usedFallback ? liveStock : snapshotQuantity + netMovementToCount;
  const rawVariance = countedQuantity - baseline;
  const variance = Math.abs(rawVariance) <= EPSILON ? 0 : rawVariance;

  return { variance, baseline, usedFallback };
}

/**
 * Net stock movement for a product within a window.
 *
 * Queries the product's OWN product_id, not the family root: addFamilyStock and
 * deductFamilyStock recurse and write a movement row per node, so each product's
 * movements are complete under its own id.
 *
 * Movements referencing the stock count itself are excluded so that a count
 * completed twice (or retried after a partial failure) cannot fold its own
 * adjustments into the baseline.
 */
export async function getNetMovementSince(
  productId: string,
  from: Date,
  to: Date,
  excludeReferenceId: string,
  connection: PoolConnection
): Promise<number> {
  const [rows]: any = await connection.query(
    `SELECT COALESCE(SUM(quantity_change), 0) AS net
     FROM stock_movements
     WHERE product_id = ?
       AND created_at > ?
       AND created_at <= ?
       AND (reference_id IS NULL OR reference_id <> ?)`,
    [productId, from, to, excludeReferenceId]
  );
  return Number(rows?.[0]?.net ?? 0);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx tests/unit/stock-count-baseline.test.ts`
Expected: PASS — prints `stock-count-baseline: all assertions passed`.

- [ ] **Step 5: Register the test in the runner**

In `tests/unit/run.ts`, after the line `import './manual-build.test';` add:

```ts
import './stock-count-baseline.test';
```

- [ ] **Step 6: Run the full unit suite**

Run: `npm run test:unit`
Expected: PASS, including `stock-count-baseline: all assertions passed`. No previously passing test may regress.

- [ ] **Step 7: Commit**

```bash
git add lib/stock-count-baseline.ts tests/unit/stock-count-baseline.test.ts tests/unit/run.ts
git commit -m "feat(inventory): add movement-aware stock count baseline"
```

---

### Task 3: Stamp `counted_at` only on real change

**Files:**
- Modify: `app/api/inventory/stock-counts/[id]/items/route.ts:27-32`

**Interfaces:**
- Consumes: `stock_count_items.counted_at` from Task 1.
- Produces: `counted_at` populated with the time a line's quantity actually changed.

**Why the conditional matters:** the client resends *every* counted item on each save, not just edited ones ([`use-count-detail.ts:64-66`](<../../../app/(app)/inventory/stock-counts/[id]/use-count-detail.ts>)), and `handleComplete` PUTs all items immediately before completing ([`use-count-detail.ts:93-99`](<../../../app/(app)/inventory/stock-counts/[id]/use-count-detail.ts>)). An unconditional `counted_at = NOW()` would stamp every line at completion time, collapse every window to zero, and silently reproduce the original bug while looking correct.

- [ ] **Step 1: Update the UPDATE statement**

In `app/api/inventory/stock-counts/[id]/items/route.ts`, replace the `await query(...)` call inside the `for` loop with:

```ts
         await query(
           `UPDATE stock_count_items
            SET counted_at = CASE
                  WHEN counted_quantity IS NULL OR counted_quantity <> ? THEN NOW()
                  ELSE counted_at
                END,
                counted_quantity = ?,
                variance = (? - snapshot_quantity)
            WHERE id = ? AND stock_count_id = ?`,
           [item.counted_quantity, item.counted_quantity, item.counted_quantity, item.id, id]
         );
```

**The clause order is load-bearing — `counted_at` MUST come first.** MySQL applies
`SET` clauses left to right, and each clause sees the values written by the clauses
before it. If `counted_quantity = ?` ran first, the `CASE` would compare the new
value against itself, never match, and never stamp — inverting the intended
behaviour exactly: a real edit would go unstamped while a no-op re-save kept the
old timestamp. Verified on MySQL 8.0.46; putting `counted_at` first makes the
`CASE` read the pre-update value, which is what it must compare against.

Add above the loop:

```ts
    // counted_at anchors the baseline window used at completion, so it may only
    // move when the quantity actually changes. The client resends every counted
    // line on each save (and again just before completing), so stamping
    // unconditionally would reset every window to zero and reintroduce the
    // double-deduction this column exists to prevent.
```

- [ ] **Step 2: Verify the conditional stamp by hand**

With the dev server running (`npm run dev`), run this script. It creates a count, saves a quantity, waits, re-saves the *same* quantity, and asserts `counted_at` did not move:

```bash
node -e "
require('dotenv').config();const m=require('mysql2/promise');
(async()=>{
  const base='http://localhost:3000/api/inventory/stock-counts';
  const c=await m.createConnection({host:process.env.DB_HOST||'127.0.0.1',port:+(process.env.DB_PORT||3306),user:process.env.DB_USER||'root',password:process.env.DB_PASSWORD||'',database:process.env.DB_NAME||'verdix'});
  const init=await (await fetch(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'counted_at probe '+Date.now(),createdBy:'probe'})})).json();
  const id=init.data.id;
  const [items]=await c.query('SELECT id FROM stock_count_items WHERE stock_count_id=? LIMIT 1',[id]);
  const itemId=items[0].id;
  const put=b=>fetch(base+'/'+id+'/items',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:[{id:itemId,counted_quantity:b}]})});
  await put(7);
  const [a]=await c.query('SELECT counted_at FROM stock_count_items WHERE id=?',[itemId]);
  await new Promise(r=>setTimeout(r,2000));
  await put(7);
  const [b]=await c.query('SELECT counted_at FROM stock_count_items WHERE id=?',[itemId]);
  await new Promise(r=>setTimeout(r,2000));
  await put(9);
  const [d]=await c.query('SELECT counted_at FROM stock_count_items WHERE id=?',[itemId]);
  console.log('first   :',a[0].counted_at);
  console.log('resave  :',b[0].counted_at,'->',String(a[0].counted_at)===String(b[0].counted_at)?'UNCHANGED (correct)':'MOVED (BUG)');
  console.log('changed :',d[0].counted_at,'->',String(a[0].counted_at)!==String(d[0].counted_at)?'MOVED (correct)':'UNCHANGED (BUG)');
  await c.query('DELETE FROM stock_count_items WHERE stock_count_id=?',[id]);
  await c.query('DELETE FROM stock_counts WHERE id=?',[id]);
  await c.end();
})()"
```

Expected: `resave` reports `UNCHANGED (correct)` and `changed` reports `MOVED (correct)`.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "app/api/inventory/stock-counts/[id]/items/route.ts"
git commit -m "feat(inventory): stamp counted_at only when a count line changes"
```

---

### Task 4: Surface the timestamps through the domain layer

**Files:**
- Modify: `src/core/inventory/domain/StockCount.ts:13,30`
- Modify: `src/infrastructure/repositories/MySqlStockCountRepository.ts:10,27,62,84-85`

**Interfaces:**
- Consumes: columns from Task 1.
- Produces: `StockCountEntity.snapshotAt?: string`, `StockCountItemEntity.countedAt?: string`, both populated by `MySqlStockCountRepository.findAll()` / `findById()`, and `stock_counts.snapshot_at` populated on every newly created count.

**Do NOT change the shape of any API response.** The stock count detail UI reads
snake_case fields straight off the API (`item.counted_quantity`,
`item.snapshot_quantity`, `item.product_cost`, `item.product_retail`,
`item.product_name`, `item.product_sku`, `item.product_barcode`). The GET
`[id]` route returns raw SQL rows to satisfy that contract. Switching it to
return repository entities renames every field to camelCase and drops the
joined product columns, which silently breaks the page. Leave that route alone.

- [ ] **Step 0: Populate `snapshot_at` when a count is created**

Migration 103 backfilled `snapshot_at` for existing rows, but `create()` never
writes it, so every NEW count gets `NULL` — and a null lower bound means Task 5
can compute no window at all and silently falls back to the buggy behaviour.

In `src/infrastructure/repositories/MySqlStockCountRepository.ts`, in `create()`,
change the `stock_counts` INSERT to set it:

```sql
            INSERT INTO stock_counts (id, name, warehouse_id, shelf_location_id, status, notes, created_by, snapshot_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), NOW())
```

The parameter array is unchanged — `snapshot_at` takes `NOW()` inline, matching
`created_at`. They are equal at creation by definition; `snapshot_at` exists as a
separate column so it keeps its meaning if `created_at` ever changes semantics.

- [ ] **Step 1: Add the entity fields**

In `src/core/inventory/domain/StockCount.ts`, add to `StockCountEntity` after `completedAt`:

```ts
  snapshotAt?: string;
```

and to `StockCountItemEntity` after `countedQuantity`:

```ts
  countedAt?: string;
```

- [ ] **Step 2: Select the columns**

In `src/infrastructure/repositories/MySqlStockCountRepository.ts`, in the `countsQuery` SELECT list, after `sc.completed_at as completedAt,` add:

```sql
             sc.snapshot_at as snapshotAt,
```

In the `itemsQuery` SELECT list, after `sci.counted_quantity as countedQuantity,` add:

```sql
             sci.counted_at as countedAt,
```

- [ ] **Step 3: Map the item field**

In the same file, inside `itemsRaw.forEach`, the pushed object currently spreads `...item` and then overrides parsed fields. `countedAt` arrives via the spread, so no change is needed there — but `snapshotQuantity` and `countedQuantity` are `parseFloat`-ed, which is now load-bearing because MySQL returns `DECIMAL` as a string. Confirm those two lines read:

```ts
        snapshotQuantity: parseFloat(item.snapshotQuantity || 0),
        countedQuantity: item.countedQuantity !== null ? parseFloat(item.countedQuantity) : undefined,
```

Leave them as-is if they already match.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Verify the fields reach the API**

With `npm run dev` running:

This probe **asserts** rather than printing — a null `snapshot_at` looks fine when
merely logged, but it is the exact failure that disables the whole fix.

```bash
node -e "
require('dotenv').config();
const m=require('mysql2/promise');
(async()=>{
  const base='http://localhost:3000/api/inventory/stock-counts';
  const init=await (await fetch(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'field probe '+Date.now(),createdBy:'probe'})})).json();
  const id=init.data.id;
  const fail=[];

  // 1. snapshot_at must be a real timestamp in the DB, not NULL.
  const c=await m.createConnection({host:process.env.DB_HOST,port:+process.env.DB_PORT,user:process.env.DB_USER,password:process.env.DB_PASSWORD||'',database:process.env.DB_NAME});
  const [rows]=await c.query('SELECT snapshot_at FROM stock_counts WHERE id=?',[id]);
  console.log('DB snapshot_at   :',rows[0].snapshot_at);
  if(!rows[0].snapshot_at) fail.push('snapshot_at is NULL in the DB — Task 5 can compute no window');

  // 2. The entity layer must expose it.
  const counts=await (await fetch(base)).json();
  const mine=counts.data.find(x=>x.id===id);
  console.log('entity snapshotAt:',mine&&mine.snapshotAt);
  if(!mine||!mine.snapshotAt) fail.push('snapshotAt missing from the repository entity');

  // 3. The detail route must KEEP its snake_case contract — the UI reads these.
  const d=await (await fetch(base+'/'+id)).json();
  const it=d.data.items[0]||{};
  console.log('detail item keys :',Object.keys(it).sort().join(', '));
  for(const k of ['counted_quantity','snapshot_quantity','product_cost','product_name'])
    if(!(k in it)) fail.push('detail route no longer returns '+k+' — the UI depends on it');

  await c.query('DELETE FROM stock_count_items WHERE stock_count_id=?',[id]);
  await c.query('DELETE FROM stock_counts WHERE id=?',[id]);
  await c.end();

  if(fail.length){console.error('\nFAILED:');fail.forEach(f=>console.error('  - '+f));process.exit(1);}
  console.log('\nAll assertions passed.');
})()"
```

Expected: exits 0 printing `All assertions passed.` A non-zero exit means either
`snapshot_at` is not being populated or the detail route's response shape changed.

- [ ] **Step 6: Commit**

```bash
git add src/core/inventory/domain/StockCount.ts src/infrastructure/repositories/MySqlStockCountRepository.ts
git commit -m "feat(inventory): expose stock count timing fields on entities"
```

---

### Task 5: Apply the baseline at completion

**Files:**
- Modify: `src/core/inventory/application/CompleteStockCountUseCase.ts:13-50`

**Interfaces:**
- Consumes: `computeTrueVariance`, `getNetMovementSince` from Task 2; `snapshotAt` / `countedAt` from Task 4.
- Produces: corrected stock adjustments. No signature change — `execute(stockCountId: string): Promise<void>` stays, so both callers ([`complete/route.ts:68`](<../../../app/api/inventory/stock-counts/[id]/complete/route.ts>) direct, [`stock-count-actions.ts:9`](../../../lib/stock-count-actions.ts) via approvals) are fixed by this one change.

- [ ] **Step 1: Rewrite the use case**

Replace the entire contents of `src/core/inventory/application/CompleteStockCountUseCase.ts` with:

```ts
import { StockCountRepository } from '../domain/IStockCountRepository';
import { PoolConnection } from 'mysql2/promise';
import { findUltimateRoot, addFamilyStock, deductFamilyStock } from '../../../../lib/family-sync';
import { computeTrueVariance, getNetMovementSince } from '../../../../lib/stock-count-baseline';

export class CompleteStockCountUseCase {
  constructor(private stockCountRepository: StockCountRepository) {}

  async execute(stockCountId: string): Promise<void> {
    const stockCount = await this.stockCountRepository.findById(stockCountId);
    if (!stockCount) throw new Error('Stock count not found');
    if (stockCount.status === 'completed') throw new Error('Stock count is already completed');

    await this.stockCountRepository.saveWithTransaction(stockCountId, async (connection: PoolConnection) => {
      const now = new Date();
      const snapshotAt = stockCount.snapshotAt ? new Date(stockCount.snapshotAt) : null;

      // 1. Update each product's stock and record movement
      for (const item of stockCount.items) {
        // Skip uncounted items
        if (item.countedQuantity === undefined || item.countedQuantity === null) continue;

        // Live stock is the arbiter of whether the movement log is complete, and
        // the fallback baseline when it isn't.
        const [stockRows]: any = await connection.query(
          'SELECT stock FROM products WHERE id = ?',
          [item.productId]
        );
        const liveStock = Number(stockRows?.[0]?.stock ?? 0);

        // Without both anchors there is no window to measure, so fall back to the
        // plain snapshot comparison — correct whenever nothing moved.
        let netMovementToCount = 0;
        let netMovementToNow = 0;
        if (snapshotAt && item.countedAt) {
          const countedAt = new Date(item.countedAt);
          netMovementToCount = await getNetMovementSince(
            item.productId, snapshotAt, countedAt, stockCountId, connection
          );
          netMovementToNow = await getNetMovementSince(
            item.productId, snapshotAt, now, stockCountId, connection
          );
        }

        const { variance, usedFallback } = computeTrueVariance({
          snapshotQuantity: item.snapshotQuantity,
          countedQuantity: item.countedQuantity,
          liveStock,
          netMovementToCount,
          netMovementToNow,
        });

        if (usedFallback) {
          console.warn(
            `[StockCount] Movement log incomplete for product ${item.productId} ` +
            `(snapshot ${item.snapshotQuantity} + movements ${netMovementToNow} != live ${liveStock}). ` +
            `Using live stock as the baseline.`
          );
        }

        if (variance === 0) continue;

        // Use family-sync logic to propagate the count adjustment
        const { rootId, factorToRoot } = await findUltimateRoot(item.productId, connection);
        const quantityInRootUnits = Math.abs(variance) / factorToRoot;

        if (variance > 0) {
          await addFamilyStock(
            rootId,
            quantityInRootUnits,
            stockCountId,
            'adjustment',
            item.adjustmentReason || 'System Adjustment from Stock Count',
            connection
          );
        } else {
          await deductFamilyStock(
            rootId,
            quantityInRootUnits,
            stockCountId,
            'adjustment',
            item.adjustmentReason || 'System Adjustment from Stock Count',
            connection
          );
        }
      }

      // 2. Mark stock count as completed
      await connection.query('UPDATE stock_counts SET status = "completed", completed_at = NOW(), updated_at = NOW() WHERE id = ?', [stockCountId]);
    });
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no new errors in the touched files.

- [ ] **Step 4: Commit**

```bash
git add src/core/inventory/application/CompleteStockCountUseCase.ts
git commit -m "fix(inventory): stop stock counts double-deducting mid-count sales"
```

---

### Task 6: End-to-end proof

**Files:**
- Create: `tests/e2e/stock-count-variance.spec.ts`

**Interfaces:**
- Consumes: everything above; `testQuery` (`tests/e2e/helpers/db.ts`), `TEST_PRODUCTS` (`tests/e2e/fixtures/test-data.ts`).
- Produces: regression coverage for the double-deduction bug.

These drive the real API routes over HTTP against `verdix_test`, so they cover the query half of Task 2 that the unit tests deliberately skip.

- [ ] **Step 1: Write the failing test**

Create `tests/e2e/stock-count-variance.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { testQuery } from './helpers/db';
import { TEST_PRODUCTS } from './fixtures/test-data';

/**
 * Stock count variance — kinahanglan dili doblehon ang pagkuha sa stock kung
 * naay POS sale sulod sa count window.
 *
 * Ang mga assert moadto sa DATABASE. Ang completion mo-report ug success bisan
 * sayop ang gi-apply nga variance, mao nga ang products.stock ra ang tinuod nga
 * makapamatuod.
 */

const PRODUCT = TEST_PRODUCTS[0];
const BASE = '/api/inventory/stock-counts';

/** Ibalik ang product sa usa ka kahibalo nga stock level. */
async function setStock(qty: number) {
  await testQuery('UPDATE products SET stock = ? WHERE id = ?', [qty, PRODUCT.id]);
}

async function getStock(): Promise<number> {
  const rows = await testQuery('SELECT stock FROM products WHERE id = ?', [PRODUCT.id]);
  return Number(rows[0].stock);
}

/**
 * I-simulate ang POS sale: i-deduct ang stock UG isulat ang movement row, sama sa
 * updateStockAndRecordMovement. Ang movement row mao ang gibase sa baseline —
 * kung kalimtan, mo-trigger ang fallback ug dili matestingan ang tinuod nga logic.
 */
async function simulateSale(qty: number) {
  const before = await getStock();
  await testQuery('UPDATE products SET stock = stock - ? WHERE id = ?', [qty, PRODUCT.id]);
  await testQuery(
    `INSERT INTO stock_movements
       (id, product_id, product_name, movement_type, quantity_change, previous_stock, new_stock, reference_id, reference_type, notes)
     VALUES (UUID(), ?, ?, 'sale', ?, ?, ?, ?, 'sale', 'E2E simulated sale')`,
    [PRODUCT.id, PRODUCT.name, -qty, before, before - qty, `e2e-sale-${Date.now()}`]
  );
}

/** Mugna ug count, unya ibalik ang item row para sa gi-target nga product. */
async function createCount(request: any, name: string) {
  const res = await request.post(BASE, {
    data: { name, notes: 'e2e variance', createdBy: 'e2e' },
  });
  expect(res.ok()).toBeTruthy();
  const { data } = await res.json();
  const rows = await testQuery(
    'SELECT id, snapshot_quantity FROM stock_count_items WHERE stock_count_id = ? AND product_id = ?',
    [data.id, PRODUCT.id]
  );
  expect(rows.length, 'naa ang target product sa count').toBe(1);
  return { countId: data.id, itemId: rows[0].id, snapshot: Number(rows[0].snapshot_quantity) };
}

async function saveCount(request: any, countId: string, itemId: string, qty: number) {
  const res = await request.put(`${BASE}/${countId}/items`, {
    data: { items: [{ id: itemId, counted_quantity: qty }] },
  });
  expect(res.ok()).toBeTruthy();
}

async function complete(request: any, countId: string) {
  const res = await request.post(`${BASE}/${countId}/complete`, {
    data: { completedBy: 'e2e' },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.success).toBeTruthy();
  // Kung naka-on ang approval, dili pa ma-apply ang stock — dili valid ang test.
  expect(body.pendingApproval, 'kinahanglan direct completion').toBeFalsy();
  return body;
}

test.describe('Stock count variance', () => {
  test.beforeEach(async () => {
    await setStock(100);
  });

  test('POS sale sulod sa count: dili ni variance', async ({ request }) => {
    const { countId, itemId, snapshot } = await createCount(request, `variance-sale-${Date.now()}`);
    expect(snapshot).toBe(100);

    // Nakabaligya ug 10 human sa snapshot.
    await simulateSale(10);
    expect(await getStock()).toBe(90);

    // Giihap sa tawo ang shelf: 90 — sakto na, walay nawala.
    await saveCount(request, countId, itemId, 90);
    await complete(request, countId);

    // Kung mo-double-deduct, mahimo ni 80.
    expect(await getStock(), 'walay double deduction').toBe(90);
  });

  test('tinuod nga kulang uban sa sale: ang kulang ra ang gi-apply', async ({ request }) => {
    const { countId, itemId } = await createCount(request, `variance-short-${Date.now()}`);

    await simulateSale(10); // 90
    // Giihap: 87 — tulo ang tinuod nga nawala.
    await saveCount(request, countId, itemId, 87);
    await complete(request, countId);

    // -3 lang, dili -13.
    expect(await getStock(), 'ang kulang ra').toBe(87);
  });

  test('walay movement: normal nga variance mo-apply gihapon', async ({ request }) => {
    const { countId, itemId } = await createCount(request, `variance-plain-${Date.now()}`);

    await saveCount(request, countId, itemId, 95);
    await complete(request, countId);

    expect(await getStock(), 'regression: normal nga variance').toBe(95);
  });

  test('sale HUMAN maihap: dili mabalik ang stock', async ({ request }) => {
    const { countId, itemId } = await createCount(request, `variance-late-${Date.now()}`);

    // Giihap ang 100 (walay problema sa shelf).
    await saveCount(request, countId, itemId, 100);
    // Unya pa nakabaligya ug 5 — apil na ni sa live stock.
    await simulateSale(5);
    expect(await getStock()).toBe(95);

    await complete(request, countId);

    // Kung i-set ang absolute 100, mabalik ang nabaligya. Delta lang dapat.
    expect(await getStock(), 'ang ulahi nga sale nagpabilin').toBe(95);
  });
});
```

- [ ] **Step 2: Prepare the test database**

The new columns must exist in `verdix_test`. Run: `npm run test:e2e:db`
Expected: completes without error.

Then confirm the columns landed:

```bash
node -e "require('dotenv').config();const m=require('mysql2/promise');(async()=>{const c=await m.createConnection({host:process.env.DB_HOST||'127.0.0.1',port:+(process.env.DB_PORT||3306),user:process.env.DB_USER||'root',password:process.env.DB_PASSWORD||'',database:'verdix_test'});const [r]=await c.query(\"SELECT TABLE_NAME,COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='verdix_test' AND COLUMN_NAME IN ('counted_at','snapshot_at')\");console.table(r);await c.end();})()"
```

Expected: both `counted_at` and `snapshot_at` are listed. If they are missing, the test DB was cloned from a schema predating Task 1 — re-run `npm run test:e2e:db` after confirming `npm run migrate` succeeded on the dev DB.

- [ ] **Step 3: Run the new spec**

Run: `npx playwright test tests/e2e/stock-count-variance.spec.ts`
Expected: 4 passed.

If `pendingApproval` assertions fail, `STOCK_COUNT` approvals are enabled in the test DB. Disable them for the run:

```bash
node -e "require('dotenv').config();const m=require('mysql2/promise');(async()=>{const c=await m.createConnection({host:process.env.DB_HOST||'127.0.0.1',port:+(process.env.DB_PORT||3306),user:process.env.DB_USER||'root',password:process.env.DB_PASSWORD||'',database:'verdix_test'});const [r]=await c.query(\"SELECT * FROM approval_settings WHERE transaction_type='STOCK_COUNT'\");console.log(r);await c.end();})()"
```

- [ ] **Step 4: Confirm the test actually catches the bug**

Temporarily revert the fix to prove the test is not vacuous. In `CompleteStockCountUseCase.ts`, replace the `computeTrueVariance` call's result with the old arithmetic:

```ts
        const variance = item.countedQuantity - item.snapshotQuantity;
        const usedFallback = false;
```

Run: `npx playwright test tests/e2e/stock-count-variance.spec.ts`
Expected: the first two tests FAIL (stock 80 instead of 90; 77 instead of 87).

Then restore the correct implementation with `git checkout src/core/inventory/application/CompleteStockCountUseCase.ts` and re-run — expected: 4 passed.

- [ ] **Step 5: Run the full E2E suite for regressions**

Run: `npm run test:e2e`
Expected: no test that passed before this branch now fails. Record any pre-existing failures separately — do not fix unrelated ones here.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/stock-count-variance.spec.ts
git commit -m "test(inventory): cover stock count double-deduction regression"
```

---

### Task 7: Document the behaviour in the manual

**Files:**
- Modify: `scripts/manual/content.ts:401-415`
- Modify: `docs/USER_GUIDE.md:96-103`

**Interfaces:**
- Consumes: behaviour from Task 5.
- Produces: user-facing documentation of counting while the POS is live.

The original question that started this work was whether the manual covers what happens to ongoing POS transactions during a count. It did not. Now that the system handles it correctly, say so — otherwise staff will keep assuming they must close the store to count.

- [ ] **Step 1: Add a note to the manual chapter**

In `scripts/manual/content.ts`, inside the `'Running a stock count'` section, after the `kind: 'steps'` block, add:

```ts
          {
            kind: 'note',
            variant: 'info',
            text: 'You can count while the store is open. The system records when each line was counted and ignores any sales, deliveries, or transfers that happen between starting the count and entering the quantity — those are already accounted for and are not treated as missing stock. Enter each quantity at the shelf as you count it, rather than writing quantities down and encoding them hours later, so the timing stays accurate.',
          },
```

Before adding, confirm `variant: 'info'` is supported: run `grep -n "variant:" scripts/manual/content.ts | sort -u`. If only `'warning'` appears, check the note renderer's type definition and use a supported variant.

- [ ] **Step 2: Add the same guidance to the user guide**

In `docs/USER_GUIDE.md`, after the `#### Run a Physical Stock Count` numbered list (line 103), add:

```markdown
> **Counting while open:** You do not need to close the POS to run a count. The
> system timestamps each line as you enter it and excludes sales or deliveries
> that occur during the count from the variance. Enter quantities at the shelf as
> you count them — encoding a paper tally hours later makes the timestamps
> inaccurate.
```

- [ ] **Step 3: Verify the manual still builds**

Run: `npm run test:unit`
Expected: PASS — `manual-content.test` validates the content tree and will reject an unsupported block shape.

- [ ] **Step 4: Commit**

```bash
git add scripts/manual/content.ts docs/USER_GUIDE.md
git commit -m "docs(inventory): document counting while the POS is live"
```

---

## Final Verification

- [ ] `npm run typecheck` — no errors
- [ ] `npm run lint` — no new errors
- [ ] `npm run test:unit` — all pass, including `stock-count-baseline`
- [ ] `npx playwright test tests/e2e/stock-count-variance.spec.ts` — 4 passed
- [ ] `npm run test:e2e` — no regressions against the pre-branch baseline
- [ ] Task 6 Step 4 was performed and the tests demonstrably failed without the fix

## Notes for the implementer

**`scripts/verify_stock_count_fix.ts`** is an HTTP smoke script ending in a manual-verification prompt; it asserts nothing about final stock and cannot catch this bug. Do not treat a clean run of it as evidence. It is left in place — replacing it is out of scope.

**Do not "fix" the client to send only changed items.** That would be a reasonable optimisation, but the `counted_at` guard in Task 3 must hold regardless of what the client sends. Changing both at once would hide a regression in the guard.
