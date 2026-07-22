# Adjustment Expiration Dates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users optionally record an expiration date when adding stock through either adjustment UI, stored per inventory batch, for products marked perishable.

**Architecture:** A new `products.is_perishable` flag gates the UI. A new `inventory_batches.expiration_date` column is the source of truth. An optional `expirationDate` parameter is threaded from both adjustment UIs down through `lib/stock-movements.ts` and `lib/family-sync.ts` to the batch INSERT. `products.expiration_date` (already existing) is refreshed as a cache of the soonest upcoming expiry.

**Tech Stack:** Next.js 16 App Router, TypeScript, raw `mysql2/promise` (no ORM), shadcn/ui components, Playwright for E2E.

**Spec:** `docs/superpowers/specs/2026-07-22-adjustment-expiration-dates-design.md`

## Global Constraints

- **MySQL only, raw SQL.** No ORM, no query builder. Use `query()` / `withTransaction()` from `lib/mysql.ts`.
- **All new columns must be nullable or defaulted.** Existing INSERT statements that omit them must keep working.
- **`expirationDate` is optional at every layer.** Every new function parameter is `expirationDate?: string | null` and defaults to omitted. Existing callers must compile unchanged.
- **Date format is `YYYY-MM-DD`** (MySQL `DATE`). Normalize with `.slice(0, 10)` before binding, matching `app/api/purchase-orders/[id]/route.ts:158`.
- **Never block an adjustment on a missing expiry.** Blank is always valid and stores `NULL`.
- **REMOVE and TRANSFER modes never show or accept an expiry.** FIFO deduction stays untouched.
- **Migrations follow the `099_add_mc_number.ts` idiom**: `registerMigration`, `information_schema` existence guard before each `ALTER`, console log per step, matching `down()`.
- **E2E tests run on port 3100** against `verdix_test`, `workers: 1`. Run with `npm run test:e2e`.
- **DO NOT run `npm run lint`.** It is broken repo-wide (`next lint` in Next 16 misparses its
  argument: `Invalid project directory provided, no such directory: ...\lint`). It is not a gate.
- **`npm run typecheck` has 10 PRE-EXISTING source-file errors** recorded in
  `.superpowers/sdd/typecheck-baseline.txt`. A fully clean typecheck is impossible. The gate is
  **no NEW errors in the files your task touched** — compare against that baseline file. Do NOT
  attempt to fix pre-existing errors; they are out of scope.
  Note that 8 of them are in `app/(app)/products/*/tabs/*` — the exact files Task 8 edits.
- **E2E conventions are established — follow them, do not invent new ones:**
  - Seed fixtures centrally in `tests/e2e/fixtures/test-data.ts`, inserted by
    `tests/e2e/setup/prepare-test-db.ts`. Do not create products ad-hoc inside a spec.
  - Query the test DB with `testQuery()` from `tests/e2e/helpers/db.ts`. Do not open your own
    `mysql.createConnection`.
  - Authenticate with `seedSession(page, DEFAULT_ADMIN)` from `tests/e2e/helpers/auth.ts`.
  - `tests/e2e/inventory-adjust.spec.ts` is the reference spec for adjustment UI tests.
  - Spec comments in this repo are written in Cebuano; match the surrounding style.
- **The test DB is a SCHEMA CLONE of dev `verdix`**, not a migration replay
  (`prepare-test-db.ts` header explains why). Migration 100 must be applied to your local dev DB
  **before** `npm run test:e2e:db`, or the new columns will not exist in `verdix_test`.

---

## Critical Context For The Implementer

Read this before starting. It contains findings that are not obvious from the file paths alone.

### The batch INSERT is not in the adjustment routes

The adjustment API routes never touch `inventory_batches`. Batch creation is buried in two places
inside `lib/stock-movements.ts`, each hardcoding its own column list:

- `lib/stock-movements.ts:196` — inside **`recordAdjustmentMovement()`** (declared at line 131), uses
  the module-level `query()`
- `lib/stock-movements.ts:421` — inside `updateStockAndRecordMovement()` (declared at line 314), uses
  an optional `connection`

A third batch INSERT at `lib/purchase-actions.ts:212` handles PO receiving and is **out of scope**.

**Only the second one is on the path we are changing.** `recordAdjustmentMovement` has exactly two
callers — `createStockAdjustment` (`app/(app)/inventory/history/actions.ts:121`) and a backfill loop
(`:192`) — and `adjustStock()` calls **neither**. The live path is
`adjustStock` → `addFamilyStock` → `updateStockAndRecordMovement` → the line-421 INSERT.

`recordAdjustmentMovement` is still updated (Task 3), because `createStockAdjustment` is a public
export that other code may call, and leaving one batch-writing path unable to record expiry would be
an inconsistency waiting to bite. But it is **not** how the two adjustment UIs reach the database —
do not expect a UI-driven test to exercise it.

### `addFamilyStock` is the primary path, not an edge case

`adjustStock()` (`app/(app)/inventory/history/actions.ts:281-300`) routes **every** adjustment
through `addFamilyStock` / `deductFamilyStock` — even for a product with no family. So
`lib/family-sync.ts:163` `addFamilyStock` → `updateStockAndRecordMovement` →
`lib/stock-movements.ts:421` is the live path for the single-product dialog.

**Consequence:** the expiry parameter MUST be threaded through `addFamilyStock`, or the single-product
dialog silently drops it. The spec listed this as a "known limitation" for *child* products; Task 4
handles the direct product correctly and deliberately does NOT propagate to children (a 1kg bag and
its 250g sachets are physically the same goods, so inheriting is arguably right — but it is a
behavior change beyond this scope, and is left as a documented follow-up).

### There are three approval touch points, not one

1. `app/api/inventory/adjust/bulk/route.ts:71` — builds `approvalData` for bulk
2. `app/(app)/inventory/history/actions.ts:235` — builds a *separate* payload for single-product
3. `app/api/approvals/process/route.ts:127` — replays it via `adjustStock(..., true)`

`approvalData` is untyped JSON. A dropped field is **not** a compile error — it fails silently.

### Batch INSERTs are wrapped in silent try/catch

Both batch INSERTs sit inside `try { ... } catch (batchErr) { console.warn(...) }` — a pre-migration
guard. If the migration has not run, expiry writes fail **silently** with only a console warning.
Always confirm `npm run migrate` succeeded before testing.

---

## File Structure

**Created:**
- `scripts/migrations/100_add_expiration_tracking.ts` — schema
- `lib/expiration.ts` — `normalizeExpirationDate()`, `refreshProductExpirationCache()`
- `app/api/reports/expiring-soon/route.ts` — report endpoint
- `app/(app)/reports/expiring-soon/page.tsx` — report page
- `tests/e2e/adjustment-expiration.spec.ts` — E2E coverage

**Modified:**
- `scripts/migrations/index.ts` — register migration 100
- `lib/types.ts` — `Product.isPerishable`
- `lib/stock-movements.ts` — both batch INSERTs + two signatures
- `lib/family-sync.ts` — `addFamilyStock` signature + recursion
- `app/(app)/inventory/history/actions.ts` — `adjustStock` signature + approval payload
- `app/api/inventory/adjust/bulk/route.ts` — accept + forward + approval payload
- `app/api/approvals/process/route.ts` — replay expiry
- `app/(app)/inventory/stock-adjustment-dialog/use-stock-adjustment.ts` + `StockAdjustmentDialog.tsx`
- `app/(app)/inventory/bulk-adjustment/constants.ts`, `use-bulk-adjustment.ts`, `adjustment-table-row.tsx`, `adjustment-mobile-card.tsx`, `config-fields.tsx`, `BulkAdjustmentClient.tsx`
- `app/(app)/products/actions.ts` — select/persist `is_perishable`
- Product add/edit form — perishable toggle

**Task order rationale:** schema → helpers → data layer → API layer → UI → report. Each task leaves
the app working; the feature becomes user-visible at Task 8.

---

## Task 1: Migration — schema for expiration tracking

**Files:**
- Create: `scripts/migrations/100_add_expiration_tracking.ts`
- Modify: `scripts/migrations/index.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `products.is_perishable` (TINYINT(1) NOT NULL DEFAULT 0), `inventory_batches.expiration_date` (DATE NULL), index `idx_ib_expiration`

- [ ] **Step 1: Write the migration**

Create `scripts/migrations/100_add_expiration_tracking.ts`:

```typescript
import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

/**
 * Expiration tracking for stock adjustments.
 *
 *   1. products.is_perishable — gates whether expiry inputs appear for a product.
 *      Defaults to 0, so every existing product is non-perishable until marked.
 *   2. inventory_batches.expiration_date — the source of truth. Per-batch, so a
 *      June delivery and a July delivery of the same product keep separate dates,
 *      which is what the existing FIFO deduction already assumes.
 *
 * products.expiration_date already exists (migration 052) and is retained as a
 * denormalized cache of the soonest upcoming batch expiry, so screens already
 * reading it keep working.
 *
 * Historical batches are deliberately NOT backfilled — there is no data to infer
 * an expiry from, and guessing would make the expiring-soon report lie.
 */
const migration: Migration = {
  name: '100_add_expiration_tracking',
  timestamp: '2026-07-22_12-00-00',

  async up(): Promise<void> {
    const [perishableCol]: any = await query(`
      SELECT COUNT(*) AS cnt
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'products'
        AND COLUMN_NAME = 'is_perishable'
    `);
    if (perishableCol?.cnt > 0) {
      console.log('• products.is_perishable already exists — skipping');
    } else {
      await query(`
        ALTER TABLE products
        ADD COLUMN is_perishable TINYINT(1) NOT NULL DEFAULT 0
      `);
      console.log('✅ Added products.is_perishable');
    }

    const [expiryCol]: any = await query(`
      SELECT COUNT(*) AS cnt
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'inventory_batches'
        AND COLUMN_NAME = 'expiration_date'
    `);
    if (expiryCol?.cnt > 0) {
      console.log('• inventory_batches.expiration_date already exists — skipping');
      return;
    }

    await query(`
      ALTER TABLE inventory_batches
      ADD COLUMN expiration_date DATE NULL
    `);
    console.log('✅ Added inventory_batches.expiration_date');

    // Indexed because the expiring-soon report filters on a date range across
    // every batch in the system.
    await query(`
      CREATE INDEX idx_ib_expiration
      ON inventory_batches (expiration_date)
    `);
    console.log('✅ Added idx_ib_expiration');
  },

  async down(): Promise<void> {
    await query(`DROP INDEX idx_ib_expiration ON inventory_batches`);
    await query(`ALTER TABLE inventory_batches DROP COLUMN expiration_date`);
    console.log('✅ Dropped inventory_batches.expiration_date');

    await query(`ALTER TABLE products DROP COLUMN is_perishable`);
    console.log('✅ Dropped products.is_perishable');
  }
};

registerMigration(migration);
```

- [ ] **Step 2: Register the migration**

In `scripts/migrations/index.ts`, find the line `import './099_add_mc_number';` and add directly below it:

```typescript
import './100_add_expiration_tracking';
```

- [ ] **Step 3: Run the migration**

Run: `npm run migrate`
Expected: output contains `✅ Added products.is_perishable`, `✅ Added inventory_batches.expiration_date`, `✅ Added idx_ib_expiration`

- [ ] **Step 4: Verify the schema landed**

Run:
```bash
node -e "require('dotenv').config();const m=require('mysql2/promise');(async()=>{const c=await m.createConnection({host:process.env.DB_HOST,port:process.env.DB_PORT,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});const [r]=await c.query(\"SELECT TABLE_NAME,COLUMN_NAME,IS_NULLABLE,COLUMN_DEFAULT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND ((TABLE_NAME='products' AND COLUMN_NAME='is_perishable') OR (TABLE_NAME='inventory_batches' AND COLUMN_NAME='expiration_date'))\");console.table(r);await c.end();})()"
```
Expected: two rows — `products.is_perishable` (NO, `0`) and `inventory_batches.expiration_date` (YES, `NULL`).

- [ ] **Step 5: Verify rollback works, then re-apply**

Run: `npm run migrate:down`
Expected: `✅ Dropped inventory_batches.expiration_date` and `✅ Dropped products.is_perishable`

Run: `npm run migrate`
Expected: both columns re-added. This proves `down()` is correct — do not skip it.

- [ ] **Step 6: Commit**

```bash
git add scripts/migrations/100_add_expiration_tracking.ts scripts/migrations/index.ts
git commit -m "feat(inventory): add expiration tracking columns

products.is_perishable gates the UI; inventory_batches.expiration_date
is the per-batch source of truth."
```

---

## Task 2: Expiration helper module

**Files:**
- Create: `lib/expiration.ts`
- Test: `tests/e2e/adjustment-expiration.spec.ts` (created in Task 10; this task is unit-testable via node)

**Interfaces:**
- Consumes: `query` from `lib/mysql`
- Produces:
  - `normalizeExpirationDate(input?: string | null): string | null`
  - `refreshProductExpirationCache(productId: string, connection?: mysql.PoolConnection | mysql.Pool): Promise<void>`

- [ ] **Step 1: Write the helper**

Create `lib/expiration.ts`:

```typescript
import type mysql from 'mysql2/promise';

import { query } from './mysql';

/**
 * Normalizes a user-supplied expiration date to a MySQL DATE literal.
 *
 * Returns null for blank/absent input — expiry is always optional, so "no date"
 * is a valid answer, not an error. Returns null for unparseable input too: the
 * UI uses a native date picker, so a malformed value can only arrive from a
 * direct API call, and silently dropping it is safer than writing garbage into
 * a column the expiring-soon report reads.
 *
 * Mirrors the normalization already used for purchase orders
 * (app/api/purchase-orders/[id]/route.ts:158).
 */
export function normalizeExpirationDate(input?: string | null): string | null {
  if (input === null || input === undefined) return null;
  const trimmed = String(input).trim();
  if (trimmed === '') return null;

  const parsed = new Date(trimmed);
  if (isNaN(parsed.getTime())) return null;

  return parsed.toISOString().slice(0, 10);
}

/**
 * Recomputes products.expiration_date as the soonest expiry still in stock.
 *
 * products.expiration_date is a denormalized cache — inventory_batches is the
 * source of truth. Only batches with stock remaining count, so a fully depleted
 * batch stops driving the product's displayed expiry.
 *
 * Never throws: a stale cache must not fail the adjustment that triggered it.
 */
export async function refreshProductExpirationCache(
  productId: string,
  connection?: mysql.PoolConnection | mysql.Pool
): Promise<void> {
  const sql = `
    UPDATE products p
    SET p.expiration_date = (
      SELECT MIN(b.expiration_date)
      FROM inventory_batches b
      WHERE b.product_id = p.id
        AND b.quantity_remaining > 0
        AND b.expiration_date IS NOT NULL
    )
    WHERE p.id = ?
  `;

  try {
    if (connection) {
      await connection.query(sql, [productId]);
    } else {
      await query(sql, [productId]);
    }
  } catch (err) {
    console.warn('[Expiration] Could not refresh product expiration cache:', err);
  }
}
```

- [ ] **Step 2: Verify normalization behavior**

Run:
```bash
npx tsx -e "import {normalizeExpirationDate as n} from './lib/expiration';console.log([n(undefined),n(null),n(''),n('   '),n('2026-12-31'),n('not-a-date')]);"
```
Expected: `[ null, null, null, null, '2026-12-31', null ]`

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/expiration.ts
git commit -m "feat(inventory): add expiration date normalize + cache refresh helpers"
```

---

## Task 3: Thread expiry through `lib/stock-movements.ts`

**Files:**
- Modify: `lib/stock-movements.ts:131-137` (signature of `recordAdjustmentMovement`)
- Modify: `lib/stock-movements.ts:196-202` (batch INSERT in `recordAdjustmentMovement`)
- Modify: `lib/stock-movements.ts:314-322` (signature of `updateStockAndRecordMovement`)
- Modify: `lib/stock-movements.ts:421-441` (batch INSERT in `updateStockAndRecordMovement`)

**Interfaces:**
- Consumes: `normalizeExpirationDate`, `refreshProductExpirationCache` from `lib/expiration`
- Produces:
  - `recordAdjustmentMovement(adjustmentId, productId, productName, quantityChange, reason, expirationDate?)`
  - `updateStockAndRecordMovement(productId, quantityChange, movementType, referenceId?, referenceType?, notes?, connection?, expirationDate?)` — `expirationDate` added **after** `connection` so existing positional callers are unaffected

**Note:** `updateStockAndRecordMovement` is the one that matters for both UIs (see Critical Context).
`recordAdjustmentMovement` is updated for consistency, not because the adjustment UIs reach it.

- [ ] **Step 1: Add the import**

At the top of `lib/stock-movements.ts`, alongside the existing imports, add:

```typescript
import { normalizeExpirationDate, refreshProductExpirationCache } from './expiration';
```

- [ ] **Step 2: Add the parameter to `recordAdjustmentMovement`**

Change the signature at `lib/stock-movements.ts:131-137` from:

```typescript
export async function recordAdjustmentMovement(
  adjustmentId: string,
  productId: string,
  productName: string,
  quantityChange: number,
  reason: string
): Promise<StockMovement> {
```

to:

```typescript
export async function recordAdjustmentMovement(
  adjustmentId: string,
  productId: string,
  productName: string,
  quantityChange: number,
  reason: string,
  expirationDate?: string | null
): Promise<StockMovement> {
```

- [ ] **Step 3: Update the `recordAdjustmentMovement` batch INSERT**

Find this block at `lib/stock-movements.ts:196-202`:

```typescript
      await query(`
        INSERT INTO inventory_batches
          (id, product_id, received_date, quantity_in, quantity_remaining, unit_cost, selling_price, source_type, notes)
        VALUES (?, ?, CURDATE(), ?, ?, ?, ?, 'adjustment', ?)
      `, [
        batchId, productId, quantityChange, quantityChange, unitCost, sellingPrice, `Auto-generated from adjustment: ${reason}`
      ]);
```

Replace it with:

```typescript
      const normalizedExpiry = normalizeExpirationDate(expirationDate);

      await query(`
        INSERT INTO inventory_batches
          (id, product_id, received_date, quantity_in, quantity_remaining, unit_cost, selling_price, source_type, notes, expiration_date)
        VALUES (?, ?, CURDATE(), ?, ?, ?, ?, 'adjustment', ?, ?)
      `, [
        batchId, productId, quantityChange, quantityChange, unitCost, sellingPrice, `Auto-generated from adjustment: ${reason}`, normalizedExpiry
      ]);

      if (normalizedExpiry) {
        await refreshProductExpirationCache(productId);
      }
```

- [ ] **Step 4: Add the parameter to `updateStockAndRecordMovement`**

Find the signature at `lib/stock-movements.ts:314-322` and add `expirationDate` after `connection`:

```typescript
export async function updateStockAndRecordMovement(
  productId: string,
  quantityChange: number,
  movementType: 'sale' | 'purchase' | 'adjustment' | 'return' | 'transfer',
  referenceId?: string,
  referenceType?: 'sale' | 'purchase' | 'adjustment' | 'return' | 'transfer',
  notes?: string,
  connection?: mysql.PoolConnection | mysql.Pool,
  expirationDate?: string | null
): Promise<StockMovement> {
```

- [ ] **Step 5: Update the second batch INSERT**

Find this block at `lib/stock-movements.ts:421-441`:

```typescript
        const batchSql = `
          INSERT INTO inventory_batches
            (id, product_id, received_date, quantity_in, quantity_remaining, unit_cost, selling_price, source_type, notes)
          VALUES (?, ?, CURDATE(), ?, ?, ?, ?, ?, ?)
        `;
        const batchParams = [
          batchId, 
          productId, 
          numericChange, 
          numericChange, 
          unitCost, 
          sellingPrice, 
          movementType, 
          notes ? `Auto-batch for ${movementType}: ${notes}` : `Auto-batch for ${movementType}`
        ];

        if (connection) {
          await connection.query(batchSql, batchParams);
        } else {
          await query(batchSql, batchParams);
        }
```

Replace it with:

```typescript
        const normalizedExpiry = normalizeExpirationDate(expirationDate);

        const batchSql = `
          INSERT INTO inventory_batches
            (id, product_id, received_date, quantity_in, quantity_remaining, unit_cost, selling_price, source_type, notes, expiration_date)
          VALUES (?, ?, CURDATE(), ?, ?, ?, ?, ?, ?, ?)
        `;
        const batchParams = [
          batchId, 
          productId, 
          numericChange, 
          numericChange, 
          unitCost, 
          sellingPrice, 
          movementType, 
          notes ? `Auto-batch for ${movementType}: ${notes}` : `Auto-batch for ${movementType}`,
          normalizedExpiry
        ];

        if (connection) {
          await connection.query(batchSql, batchParams);
        } else {
          await query(batchSql, batchParams);
        }

        if (normalizedExpiry) {
          await refreshProductExpirationCache(productId, connection);
        }
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors. Every existing caller omits the new trailing optional parameter and still compiles.

- [ ] **Step 7: Commit**

```bash
git add lib/stock-movements.ts
git commit -m "feat(inventory): thread optional expiry through stock movement batch inserts"
```

---

## Task 4: Thread expiry through `lib/family-sync.ts`

**Files:**
- Modify: `lib/family-sync.ts:163-208` (`addFamilyStock`)

**Interfaces:**
- Consumes: `updateStockAndRecordMovement(..., connection, expirationDate?)` from Task 3
- Produces: `addFamilyStock(nodeId, qty, refId, refType, notes, connection, depth?, expirationDate?)`

**Why this task exists:** `adjustStock()` routes every single-product adjustment through
`addFamilyStock` (`app/(app)/inventory/history/actions.ts:291` and `:298`), even for products with no
family. Without this task the single-product dialog silently drops the expiry.

- [ ] **Step 1: Add the parameter and pass it to the direct node**

In `lib/family-sync.ts`, find the `addFamilyStock` signature at line 163:

```typescript
export async function addFamilyStock(
  nodeId: string,
  qty: number,
  refId: string,
  refType: 'sale' | 'purchase' | 'adjustment' | 'return' | 'transfer',
  notes: string,
  connection: PoolConnection,
  depth = 0
): Promise<void> {
```

Add `expirationDate` as the final parameter:

```typescript
export async function addFamilyStock(
  nodeId: string,
  qty: number,
  refId: string,
  refType: 'sale' | 'purchase' | 'adjustment' | 'return' | 'transfer',
  notes: string,
  connection: PoolConnection,
  depth = 0,
  expirationDate?: string | null
): Promise<void> {
```

- [ ] **Step 2: Forward the expiry to the batch write, but only at depth 0**

Find the `updateStockAndRecordMovement` call at `lib/family-sync.ts:176-184`:

```typescript
  await updateStockAndRecordMovement(
    nodeId,
    numericQty,
    refType,
    refId,
    refType,
    `${notes}${depth > 0 ? ` (Depth ${depth} family sync)` : ''}`,
    connection
  );
```

Replace it with:

```typescript
  await updateStockAndRecordMovement(
    nodeId,
    numericQty,
    refType,
    refId,
    refType,
    `${notes}${depth > 0 ? ` (Depth ${depth} family sync)` : ''}`,
    connection,
    // Only the directly-adjusted product carries the expiry. Cascaded child
    // batches (a 1kg bag's 250g sachets) are left NULL rather than inheriting a
    // date nobody entered for them — see the follow-up note in the spec.
    depth === 0 ? expirationDate : null
  );
```

- [ ] **Step 3: Leave the recursive call unchanged**

The recursive `addFamilyStock` call at `lib/family-sync.ts:198-206` must NOT be given the expiry —
omitting it means children default to `undefined` → `null`. Confirm it still reads:

```typescript
    await addFamilyStock(
      child.id,
      childAddition,
      refId,
      refType,
      notes,
      connection,
      depth + 1
    );
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/family-sync.ts
git commit -m "feat(inventory): carry expiry through family stock sync at depth 0"
```

---

## Task 5: Thread expiry through `adjustStock()` and its approval payload

**Files:**
- Modify: `app/(app)/inventory/history/actions.ts:217` (signature)
- Modify: `app/(app)/inventory/history/actions.ts:235-245` (approval payload)
- Modify: `app/(app)/inventory/history/actions.ts:281-302` (family sync calls)

**Interfaces:**
- Consumes: `addFamilyStock(..., depth, expirationDate?)` from Task 4
- Produces: `adjustStock(productId, quantity, reason, userId?, isInternalFinalization?, expirationDate?)`

- [ ] **Step 1: Add the parameter**

Change the signature at `app/(app)/inventory/history/actions.ts:217` from:

```typescript
export async function adjustStock(productId: string, quantity: number, reason: string, userId: string = 'system', isInternalFinalization: boolean = false) {
```

to:

```typescript
export async function adjustStock(productId: string, quantity: number, reason: string, userId: string = 'system', isInternalFinalization: boolean = false, expirationDate?: string | null) {
```

- [ ] **Step 2: Include expiry in the approval payload**

Find the `submitToApprovalQueue` call at `app/(app)/inventory/history/actions.ts:235-245` and add
`expirationDate` to the object literal:

```typescript
      const { queueId, pendingApproval } = await submitToApprovalQueue('STOCK_ADJUSTMENT', { 
        productId, 
        quantity, 
        reason,
        productName: productInfo.name,
        productSku: productInfo.sku,
        productBarcode: productInfo.barcode,
        warehouseName: productInfo.warehouse_name,
        shelfName: productInfo.shelf_name,
        currentStock: parseInt(productInfo.stock || 0),
        expirationDate: expirationDate || null
      }, userId);
```

- [ ] **Step 3: Forward expiry to both `addFamilyStock` calls**

Find the transaction block at `app/(app)/inventory/history/actions.ts:281-302`. Update **only** the two
`addFamilyStock` calls (leave both `deductFamilyStock` calls untouched — removals carry no expiry):

```typescript
      if (factorToRoot > 1 || rootId !== productId) {
        // This product is NOT the root — convert to root units and sync from root
        const rootQty = Math.abs(quantity) / factorToRoot;
        if (quantity < 0) {
          await deductFamilyStock(rootId, rootQty, adjustmentId, 'adjustment', reason, connection);
        } else {
          await addFamilyStock(rootId, rootQty, adjustmentId, 'adjustment', reason, connection, 0, expirationDate);
        }
      } else {
        // This IS the root — propagate down through all descendants
        if (quantity < 0) {
          await deductFamilyStock(productId, Math.abs(quantity), adjustmentId, 'adjustment', reason, connection);
        } else {
          await addFamilyStock(productId, quantity, adjustmentId, 'adjustment', reason, connection, 0, expirationDate);
        }
      }
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/inventory/history/actions.ts"
git commit -m "feat(inventory): accept optional expiry in adjustStock + approval payload"
```

---

## Task 6: Thread expiry through the bulk adjustment API and approval replay

**Files:**
- Modify: `app/api/inventory/adjust/bulk/route.ts:35` (destructure per-item expiry)
- Modify: `app/api/inventory/adjust/bulk/route.ts:71-84` (approval payload)
- Modify: `app/api/inventory/adjust/bulk/route.ts:173-181` (family sync call)
- Modify: `app/api/approvals/process/route.ts:127` (replay expiry)

**Interfaces:**
- Consumes: `addFamilyStock(..., depth, expirationDate?)` from Task 4; `adjustStock(..., expirationDate?)` from Task 5
- Produces: bulk endpoint accepts `adjustments[].expirationDate`

- [ ] **Step 1: Destructure the per-item expiry**

In `app/api/inventory/adjust/bulk/route.ts`, change line 35 from:

```typescript
        const { productId, quantity, reason, targetProductId: itemTargetProductId } = adj;
```

to:

```typescript
        const { productId, quantity, reason, targetProductId: itemTargetProductId, expirationDate } = adj;
```

- [ ] **Step 2: Include expiry in the approval payload**

In the same file, find the `approvalData` object literal at lines 71-84 and add a final property:

```typescript
          const approvalData: any = {
            productId,
            quantity: finalQuantity, // Correctly signed quantity
            reason: finalReason,
            productName: product.name,
            productSku: product.sku,
            productBarcode: product.barcode,
            currentStock: currentStock,
            warehouseId,
            warehouseName: resolvedWarehouseName,
            referenceNo,
            supplierId,
            adjustmentType,
            expirationDate: expirationDate || null
          };
```

- [ ] **Step 3: Forward expiry to `addFamilyStock`**

Find the family sync block at lines 173-181 and update **only** the `addFamilyStock` branch:

```typescript
        const syncQty = Math.abs(finalQuantity) / factorToRoot;
        if (finalQuantity < 0) {
          await deductFamilyStock(rootId, syncQty, adjustmentId, 'adjustment', finalReason, connection);
        } else {
          await addFamilyStock(rootId, syncQty, adjustmentId, 'adjustment', finalReason, connection, 0, expirationDate);
        }
```

- [ ] **Step 4: Replay expiry on approval**

In `app/api/approvals/process/route.ts`, change line 127 from:

```typescript
            const adjResult = await adjustStock(txData.productId, adjQty, txData.reason, item.created_by, true);
```

to:

```typescript
            const adjResult = await adjustStock(txData.productId, adjQty, txData.reason, item.created_by, true, txData.expirationDate || null);
```

- [ ] **Step 5: Typecheck (no new errors)**

Run: `npm run typecheck 2>&1 | grep -E "^[^ ].*error TS" | grep -v "^.next" | sort > .superpowers/sdd/tc-now.txt; diff .superpowers/sdd/typecheck-baseline.txt .superpowers/sdd/tc-now.txt`
Expected: no lines starting with `>` (no NEW errors). Pre-existing errors are expected — do not fix them.

- [ ] **Step 6: Commit**

```bash
git add app/api/inventory/adjust/bulk/route.ts app/api/approvals/process/route.ts
git commit -m "feat(inventory): accept expiry in bulk adjust API and replay it on approval"
```

---

## Task 7: Perishable flag on the product type and actions

**Files:**
- Modify: `lib/types.ts:26` (add `isPerishable`)
- Modify: `app/(app)/products/actions.ts:290` (map the column)

**Interfaces:**
- Consumes: `products.is_perishable` from Task 1
- Produces: `Product.isPerishable?: boolean`

- [ ] **Step 1: Add the field to the Product type**

In `lib/types.ts`, find line 26 (`expirationDate?: string;`) inside `interface Product` and add
directly below it:

```typescript
  expirationDate?: string;
  isPerishable?: boolean;
```

- [ ] **Step 2: Map the column in the product read path**

In `app/(app)/products/actions.ts`, find line 290 (`expirationDate: product.expiration_date,`) and add
directly below it:

```typescript
        expirationDate: product.expiration_date,
        isPerishable: Boolean(product.is_perishable),
```

- [ ] **Step 3: Confirm no SELECT list needs updating**

All three product queries in this file (lines 66, 162, 184) use `SELECT p.*`, so `is_perishable`
reaches the mapper automatically — no column list to edit.

Run: `grep -n "SELECT p\.\*" "app/(app)/products/actions.ts"`
Expected: three matches. If any query instead enumerates columns explicitly, add `is_perishable` to it.

- [ ] **Step 4: Verify a product round-trips the flag**

Run:
```bash
node -e "require('dotenv').config();const m=require('mysql2/promise');(async()=>{const c=await m.createConnection({host:process.env.DB_HOST,port:process.env.DB_PORT,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});const [r]=await c.query('SELECT id,name,is_perishable FROM products LIMIT 3');console.table(r);await c.end();})()"
```
Expected: three rows, `is_perishable` = 0 for all (default).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/types.ts "app/(app)/products/actions.ts"
git commit -m "feat(products): expose is_perishable on the Product type"
```

---

## Task 8: Perishable toggle in the product form

**Files:**
- Modify: `app/(app)/products/add-product/product-schema.ts`
- Modify: `app/(app)/products/add-product/use-add-product-form.ts`
- Modify: `app/(app)/products/add-product/tabs/loyalty-tab.tsx`
- Modify: `app/(app)/products/edit-product/product-schema.ts`
- Modify: `app/(app)/products/edit-product/use-edit-product-form.ts`
- Modify: `app/(app)/products/edit-product/tabs/loyalty-tab.tsx`
- Modify: the product create/update API route (locate in Step 3)

**Interfaces:**
- Consumes: `Product.isPerishable` from Task 7
- Produces: users can mark a product perishable; `products.is_perishable` persists

**Note:** the product form is split across add- and edit- variants that mirror each other. `earnsPoints`
is the closest existing analogue — an optional boolean product flag — so mirror its pattern in **both**.
Missing the add-product side means new perishable products cannot be created as perishable.

- [ ] **Step 1: Review the existing `earnsPoints` pattern**

Run: `grep -rn "earnsPoints" "app/(app)/products"`
Expected: hits in the six files listed above. Read
`app/(app)/products/edit-product/tabs/loyalty-tab.tsx` — it is the reference implementation, using
`FormField` + `FormItem` + `Switch` inside a `flex flex-row items-center justify-between rounded-lg
border p-4 col-span-2` container.

The perishable toggle belongs on the same tab as `earnsPoints` unless the form has an inventory tab
that fits better — check the tab list before placing it.

- [ ] **Step 2: Add the field to the schema and form**

In the zod schema file found in Step 1, next to the `earnsPoints` entry, add:

```typescript
  isPerishable: z.boolean().optional(),
```

In the form's `defaultValues`, next to `earnsPoints`, add:

```typescript
      isPerishable: product?.isPerishable ?? false,
```

In the form JSX, immediately after the `earnsPoints` field block, add a matching toggle. Mirror the
exact `FormField` / `Switch` structure used by `earnsPoints` in that file, substituting:

```tsx
<FormField
  control={form.control}
  name="isPerishable"
  render={({ field }) => (
    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
      <div className="space-y-0.5">
        <FormLabel>Perishable</FormLabel>
        <FormDescription>
          Track expiration dates when adding stock for this product.
        </FormDescription>
      </div>
      <FormControl>
        <Switch checked={field.value} onCheckedChange={field.onChange} />
      </FormControl>
    </FormItem>
  )}
/>
```

- [ ] **Step 3: Persist the flag in the product API**

Run: `grep -rn "earns_points" app/api/products/`
Expected: shows the INSERT and UPDATE column lists.

In each INSERT and UPDATE found, add `is_perishable` alongside `earns_points`, binding
`body.isPerishable ? 1 : 0`. Match the surrounding parameter style exactly.

- [ ] **Step 4: Verify end to end**

Run: `npm run dev`

In the browser: open an existing product for edit, toggle **Perishable** on, save. Then run:

```bash
node -e "require('dotenv').config();const m=require('mysql2/promise');(async()=>{const c=await m.createConnection({host:process.env.DB_HOST,port:process.env.DB_PORT,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});const [r]=await c.query('SELECT id,name,is_perishable FROM products WHERE is_perishable=1');console.table(r);await c.end();})()"
```
Expected: the product you toggled appears with `is_perishable` = 1.

Keep this product — later tasks use it as the perishable test fixture.

- [ ] **Step 5: Typecheck (no new errors)**

Run: `npm run typecheck 2>&1 | grep -E "^[^ ].*error TS" | grep -v "^.next" | sort > .superpowers/sdd/tc-now.txt; diff .superpowers/sdd/typecheck-baseline.txt .superpowers/sdd/tc-now.txt`
Expected: no lines starting with `>` (no NEW errors). Pre-existing errors are expected — do not fix them.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(products): add perishable toggle to the product form"
```

---

## Task 9: Expiration field in the single-product Adjust Stock dialog

**Files:**
- Modify: `app/(app)/inventory/stock-adjustment-dialog/use-stock-adjustment.ts`
- Modify: `app/(app)/inventory/stock-adjustment-dialog/StockAdjustmentDialog.tsx:169-171`

**Interfaces:**
- Consumes: `adjustStock(..., expirationDate?)` from Task 5; `Product.isPerishable` from Task 7
- Produces: dialog sends `expirationDate` when adding stock to a perishable product

- [ ] **Step 1: Add expiry state to the hook**

In `use-stock-adjustment.ts`, after the `adjustmentType` state declaration (line 46), add:

```typescript
  const [expirationDate, setExpirationDate] = useState('');
```

- [ ] **Step 2: Derive visibility and the past-date warning**

Directly below the `isPhysicalCountMode` declaration (line 53), add:

```typescript
  // Expiry applies only when receiving new stock into a perishable product.
  // Removals deduct oldest-first via FIFO, and a physical count reconciles
  // stock that already exists — neither receives a new date.
  const showExpirationField =
    Boolean(product.isPerishable) && adjustmentType === 'add' && !isPhysicalCountMode;

  // Recording already-expired stock found during a count is legitimate, so this
  // warns without blocking.
  const isExpirationInPast = useMemo(() => {
    if (!expirationDate) return false;
    const today = new Date().toISOString().slice(0, 10);
    return expirationDate < today;
  }, [expirationDate]);
```

- [ ] **Step 3: Reset expiry when the dialog opens**

In the reset `useEffect` (lines 95-104), add `setExpirationDate('');` alongside the other resets:

```typescript
  useEffect(() => {
    if (isOpen) {
      setReason(defaultReason || '');
      setCustomReason('');
      setQuantity(0);
      setAdjustmentType('add');
      setPhysicalCount(Number(product.stock));
      setChildProducts([]);
      setExpirationDate('');
    }
  }, [isOpen, defaultReason, product.stock]);
```

- [ ] **Step 4: Pass expiry to `adjustStock`**

In `processAdjustment`, change line 173 from:

```typescript
      const parentResult = await adjustStock(product.id, adjustment, finalReason, userId);
```

to:

```typescript
      const parentResult = await adjustStock(
        product.id,
        adjustment,
        finalReason,
        userId,
        false,
        showExpirationField && expirationDate ? expirationDate : null
      );
```

- [ ] **Step 5: Export the new values**

Add to the hook's returned object (alongside `projectedStock`):

```typescript
    expirationDate,
    setExpirationDate,
    showExpirationField,
    isExpirationInPast,
```

- [ ] **Step 6: Destructure them in the dialog**

In `StockAdjustmentDialog.tsx`, add to the destructuring at lines 35-59 (alongside `projectedStock`):

```typescript
    expirationDate,
    setExpirationDate,
    showExpirationField,
    isExpirationInPast,
```

- [ ] **Step 7: Render the field**

In `StockAdjustmentDialog.tsx`, insert between the quantity block (ends line 169) and the reason block
(starts line 171):

```tsx
              {showExpirationField && (
                <div className="space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
                  <Label htmlFor="expirationDate" className="text-sm font-medium">
                    Expiration Date <span className="text-muted-foreground font-normal">(Optional)</span>
                  </Label>
                  <Input
                    id="expirationDate"
                    type="date"
                    value={expirationDate}
                    onChange={(e) => setExpirationDate(e.target.value)}
                    className="h-11"
                  />
                  {isExpirationInPast && (
                    <p className="text-xs text-amber-600 dark:text-amber-500">
                      This date is in the past. The stock will be recorded as already expired.
                    </p>
                  )}
                </div>
              )}

```

- [ ] **Step 8: Verify in the browser**

Run: `npm run dev`

Check all four cases:
1. Perishable product, **Add Stock** → date field visible.
2. Same product, switch to **Remove Stock** → field disappears.
3. Non-perishable product, **Add Stock** → field never appears.
4. Perishable product, add 5 units with expiry `2027-01-31`, confirm.

Then run:
```bash
node -e "require('dotenv').config();const m=require('mysql2/promise');(async()=>{const c=await m.createConnection({host:process.env.DB_HOST,port:process.env.DB_PORT,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});const [r]=await c.query(\"SELECT id,product_id,quantity_in,expiration_date,source_type FROM inventory_batches WHERE expiration_date IS NOT NULL ORDER BY created_at DESC LIMIT 5\");console.table(r);await c.end();})()"
```
Expected: newest row shows `expiration_date` = `2027-01-31`.

- [ ] **Step 9: Verify blank expiry still works**

In the browser, add 3 more units to the same perishable product leaving the date blank. Expect success
with no error. Confirm a new batch row exists with `expiration_date` = `NULL`.

- [ ] **Step 10: Typecheck (no new errors)**

Run: `npm run typecheck 2>&1 | grep -E "^[^ ].*error TS" | grep -v "^.next" | sort > .superpowers/sdd/tc-now.txt; diff .superpowers/sdd/typecheck-baseline.txt .superpowers/sdd/tc-now.txt`
Expected: no lines starting with `>` (no NEW errors). Pre-existing errors are expected — do not fix them.

- [ ] **Step 11: Commit**

```bash
git add "app/(app)/inventory/stock-adjustment-dialog"
git commit -m "feat(inventory): optional expiration date in Adjust Stock dialog"
```

---

## Task 10: Expiration column in the Bulk Adjustment page

**Files:**
- Modify: `app/(app)/inventory/bulk-adjustment/constants.ts` (`AdjustmentItem` type)
- Modify: `app/(app)/inventory/bulk-adjustment/use-bulk-adjustment.ts` (state + submit payload)
- Modify: `app/(app)/inventory/bulk-adjustment/adjustment-table-row.tsx:79-87` (new cell)
- Modify: `app/(app)/inventory/bulk-adjustment/adjustment-mobile-card.tsx` (mobile input)
- Modify: `app/(app)/inventory/bulk-adjustment/BulkAdjustmentClient.tsx` (header cell)

**Interfaces:**
- Consumes: bulk endpoint's `adjustments[].expirationDate` from Task 6; `Product.isPerishable` from Task 7
- Produces: per-row expiry captured and submitted

- [ ] **Step 1: Add the field to the item type**

In `constants.ts`, find the `AdjustmentItem` interface and add:

```typescript
  expirationDate?: string;
```

- [ ] **Step 2: Derive column visibility**

In `use-bulk-adjustment.ts`, alongside the other derived values, add:

```typescript
  // The column only earns its width when it can actually be used: adding stock,
  // with at least one perishable product in the batch.
  const showExpirationColumn =
    adjustmentType === 'add' && adjustments.some(a => Boolean(a.product.isPerishable));
```

The mode state is `adjustmentType` (declared at `use-bulk-adjustment.ts:32`), and the items array is
`adjustments` (`:39`). Place this after both declarations.

- [ ] **Step 3: Add a bulk-apply helper**

In the same hook, add:

```typescript
  // One delivery usually shares a single expiry, so let the user stamp them all
  // at once instead of typing the same date on every row.
  const applyExpirationToAll = (date: string) => {
    setAdjustments(prev =>
      prev.map(a => (a.product.isPerishable ? { ...a, expirationDate: date } : a))
    );
  };
```

- [ ] **Step 4: Include expiry in the submit payload**

At `use-bulk-adjustment.ts:136-140`, the mapping currently reads:

```typescript
        adjustments: adjustments.map(a => ({
          productId: a.product.id,
          quantity: a.quantity,
          reason: a.reason || note || 'Bulk Stock Adjustment',
        })),
```

Add `expirationDate` as a fourth property, keeping the existing `reason` fallback chain exactly as-is:

```typescript
        adjustments: adjustments.map(a => ({
          productId: a.product.id,
          quantity: a.quantity,
          reason: a.reason || note || 'Bulk Stock Adjustment',
          expirationDate: a.product.isPerishable && adjustmentType === 'add' ? (a.expirationDate || null) : null,
        })),
```

- [ ] **Step 5: Export the new values**

Add `showExpirationColumn` and `applyExpirationToAll` to the hook's returned object.

- [ ] **Step 6: Add the table cell**

In `adjustment-table-row.tsx`, add `showExpirationColumn` to the component props:

```typescript
export function AdjustmentTableRow({
  adj,
  onUpdate,
  onRemove,
  showExpirationColumn,
}: {
  adj: AdjustmentItem;
  onUpdate: (productId: string, updates: Partial<AdjustmentItem>) => void;
  onRemove: (productId: string) => void;
  showExpirationColumn?: boolean;
}) {
```

Then insert a new `<TableCell>` between the IMPACT cell (ends line 79) and the NOTE cell (starts line 80):

```tsx
      {showExpirationColumn && (
        <TableCell className="py-4">
          {adj.product.isPerishable ? (
            <Input
              type="date"
              className="h-8 text-xs w-[150px]"
              value={adj.expirationDate || ''}
              onChange={e => onUpdate(adj.product.id, { expirationDate: e.target.value })}
            />
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          )}
        </TableCell>
      )}
```

- [ ] **Step 7: Add the header cell and pass the prop**

In `BulkAdjustmentClient.tsx`, find the header row containing `IMPACT` and `NOTE`. Insert between them:

```tsx
              {showExpirationColumn && <TableHead>EXPIRY</TableHead>}
```

Match the surrounding `TableHead` className style exactly. Then pass the prop where
`AdjustmentTableRow` is rendered:

```tsx
                  showExpirationColumn={showExpirationColumn}
```

Destructure `showExpirationColumn` and `applyExpirationToAll` from the hook in this component.

- [ ] **Step 8: Add the mobile input**

In `adjustment-mobile-card.tsx`, add the same `showExpirationColumn` prop, and render an expiry input
after the note input, mirroring the note field's markup:

```tsx
      {showExpirationColumn && adj.product.isPerishable && (
        <div className="space-y-1">
          <label className="text-[10px] uppercase text-muted-foreground font-semibold">Expiry (Optional)</label>
          <Input
            type="date"
            className="h-8 text-xs w-full"
            value={adj.expirationDate || ''}
            onChange={e => onUpdate(adj.product.id, { expirationDate: e.target.value })}
          />
        </div>
      )}
```

Pass `showExpirationColumn` where the mobile card is rendered in `BulkAdjustmentClient.tsx`.

- [ ] **Step 9: Add the bulk-apply control**

In `config-fields.tsx`, add a control in the Batch Configuration panel below the existing fields. Accept
`showExpirationColumn` and `applyExpirationToAll` as props and render:

```tsx
      {showExpirationColumn && (
        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase text-muted-foreground">
            Expiry For All Perishables
          </label>
          <Input
            type="date"
            className="h-9"
            onChange={e => applyExpirationToAll(e.target.value)}
          />
          <p className="text-[10px] text-muted-foreground">
            Sets this date on every perishable item in the batch.
          </p>
        </div>
      )}
```

Wire both props through from `BulkAdjustmentClient.tsx`.

- [ ] **Step 10: Verify in the browser**

Run: `npm run dev`

Navigate to the bulk adjustment page and check:
1. Add a non-perishable product only, mode ADD → no EXPIRY column.
2. Add a perishable product → EXPIRY column appears; perishable row has a date input, non-perishable
   row shows `—`.
3. Switch mode to REMOVE → column disappears.
4. Back to ADD, set `2027-03-15` via "Expiry For All Perishables" → perishable row fills in.
5. Apply the adjustment.

Then run:
```bash
node -e "require('dotenv').config();const m=require('mysql2/promise');(async()=>{const c=await m.createConnection({host:process.env.DB_HOST,port:process.env.DB_PORT,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});const [r]=await c.query(\"SELECT product_id,quantity_in,expiration_date FROM inventory_batches ORDER BY created_at DESC LIMIT 5\");console.table(r);await c.end();})()"
```
Expected: the perishable product's batch carries `2027-03-15`; the non-perishable one is `NULL`.

- [ ] **Step 11: Typecheck (no new errors)**

Run: `npm run typecheck 2>&1 | grep -E "^[^ ].*error TS" | grep -v "^.next" | sort > .superpowers/sdd/tc-now.txt; diff .superpowers/sdd/typecheck-baseline.txt .superpowers/sdd/tc-now.txt`
Expected: no lines starting with `>` (no NEW errors). Pre-existing errors are expected — do not fix them.

- [ ] **Step 12: Commit**

```bash
git add "app/(app)/inventory/bulk-adjustment"
git commit -m "feat(inventory): optional expiry column in bulk adjustment"
```

---

## Task 11: Show expiry in batch history views

**Files:**
- Modify: the batch listing component (located in Step 1)

**Interfaces:**
- Consumes: `inventory_batches.expiration_date` from Task 1
- Produces: users can see recorded expiry dates

- [ ] **Step 1: Locate the batch listing**

Run: `grep -rln "inventory_batches\|quantity_remaining" app/ --include=*.tsx --include=*.ts | grep -v node_modules`
Expected: lists the batch/FIFO views. Pick the component that renders batches for a single product
(typically under `app/(app)/inventory/` or the product detail view).

- [ ] **Step 2: Add expiry to the SELECT**

In the route or action feeding that component, add `expiration_date as expirationDate` to the
`inventory_batches` SELECT column list.

- [ ] **Step 3: Render the column**

Add a header cell labeled `EXPIRY` and a matching body cell, mirroring the surrounding cells' markup:

```tsx
<TableCell className="text-xs">
  {batch.expirationDate
    ? new Date(batch.expirationDate).toLocaleDateString()
    : <span className="text-muted-foreground/50">—</span>}
</TableCell>
```

- [ ] **Step 4: Verify in the browser**

Run: `npm run dev`

Open the batch view for the perishable product used in Task 9. Expect the batch created there to show
`1/31/2027`, and the blank-expiry batch to show `—`.

- [ ] **Step 5: Typecheck (no new errors)**

Run: `npm run typecheck 2>&1 | grep -E "^[^ ].*error TS" | grep -v "^.next" | sort > .superpowers/sdd/tc-now.txt; diff .superpowers/sdd/typecheck-baseline.txt .superpowers/sdd/tc-now.txt`
Expected: no lines starting with `>` (no NEW errors). Pre-existing errors are expected — do not fix them.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(inventory): show batch expiration dates in history view"
```

---

## Task 12: Expiring Soon report

**Files:**
- Create: `app/api/reports/expiring-soon/route.ts`
- Create: `app/(app)/reports/expiring-soon/page.tsx`

**Interfaces:**
- Consumes: `inventory_batches.expiration_date` from Task 1
- Produces: `GET /api/reports/expiring-soon?days=<n>` → `{ success, days, items: ExpiringBatch[] }`

where `ExpiringBatch` is:

```typescript
{
  batchId: string;
  productId: string;
  productName: string;
  sku: string | null;
  quantityRemaining: number;
  expirationDate: string;   // YYYY-MM-DD
  daysUntilExpiry: number;  // negative = already expired
  isExpired: boolean;
}
```

- [ ] **Step 1: Write the API route**

Create `app/api/reports/expiring-soon/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/mysql';

/**
 * Expiring Soon report.
 *
 * Lists inventory batches with stock remaining whose expiration falls inside the
 * requested window, plus everything already expired. Batches with no expiry are
 * excluded — expiry is optional, and a NULL means "unknown", not "expires today".
 */
export async function GET(request: NextRequest) {
  try {
    const daysParam = request.nextUrl.searchParams.get('days');
    const parsedDays = daysParam ? parseInt(daysParam, 10) : 30;
    const days = Number.isFinite(parsedDays) && parsedDays > 0 ? Math.min(parsedDays, 365) : 30;

    const rows: any[] = await query(`
      SELECT
        b.id                  AS batchId,
        b.product_id          AS productId,
        p.name                AS productName,
        p.sku                 AS sku,
        b.quantity_remaining  AS quantityRemaining,
        DATE_FORMAT(b.expiration_date, '%Y-%m-%d') AS expirationDate,
        DATEDIFF(b.expiration_date, CURDATE())     AS daysUntilExpiry
      FROM inventory_batches b
      JOIN products p ON p.id = b.product_id
      WHERE b.expiration_date IS NOT NULL
        AND b.quantity_remaining > 0
        AND DATEDIFF(b.expiration_date, CURDATE()) <= ?
      ORDER BY b.expiration_date ASC
    `, [days]);

    const items = rows.map(r => ({
      ...r,
      quantityRemaining: Number(r.quantityRemaining),
      daysUntilExpiry: Number(r.daysUntilExpiry),
      isExpired: Number(r.daysUntilExpiry) < 0,
    }));

    return NextResponse.json({ success: true, days, items });
  } catch (error: any) {
    console.error('Expiring soon report error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to load expiring stock' },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Verify the endpoint**

Run: `npm run dev`

In another terminal:
```bash
curl -s "http://localhost:3000/api/reports/expiring-soon?days=3650" | head -c 600
```
Expected: `{"success":true,"days":365,"items":[...]}` including the batches created in Tasks 9 and 10.
(`days` clamps to 365 — that is intentional.)

- [ ] **Step 3: Write the report page**

Create `app/(app)/reports/expiring-soon/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface ExpiringBatch {
  batchId: string;
  productId: string;
  productName: string;
  sku: string | null;
  quantityRemaining: number;
  expirationDate: string;
  daysUntilExpiry: number;
  isExpired: boolean;
}

export default function ExpiringSoonPage() {
  const [items, setItems] = useState<ExpiringBatch[]>([]);
  const [days, setDays] = useState('30');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/reports/expiring-soon?days=${days}`)
      .then(r => r.json())
      .then(d => setItems(d.success ? d.items : []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [days]);

  const expired = items.filter(i => i.isExpired);
  const upcoming = items.filter(i => !i.isExpired);

  const renderRows = (rows: ExpiringBatch[]) =>
    rows.map(item => (
      <TableRow key={item.batchId}>
        <TableCell className="font-medium">{item.productName}</TableCell>
        <TableCell className="text-xs font-mono text-muted-foreground">{item.sku || '—'}</TableCell>
        <TableCell className="tabular-nums">{item.quantityRemaining}</TableCell>
        <TableCell className="tabular-nums">{item.expirationDate}</TableCell>
        <TableCell>
          <Badge variant={item.isExpired ? 'destructive' : 'secondary'}>
            {item.isExpired
              ? `Expired ${Math.abs(item.daysUntilExpiry)}d ago`
              : `${item.daysUntilExpiry}d left`}
          </Badge>
        </TableCell>
      </TableRow>
    ));

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Expiring Soon</h1>
          <p className="text-sm text-muted-foreground">Stock on hand approaching its expiration date.</p>
        </div>
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Next 7 days</SelectItem>
            <SelectItem value="30">Next 30 days</SelectItem>
            <SelectItem value="90">Next 90 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No stock expiring in this window.
          </CardContent>
        </Card>
      ) : (
        <>
          {expired.length > 0 && (
            <Card className="border-destructive/30">
              <CardHeader><CardTitle className="text-destructive text-base">Already Expired ({expired.length})</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead><TableHead>SKU</TableHead>
                      <TableHead>Qty</TableHead><TableHead>Expires</TableHead><TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>{renderRows(expired)}</TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {upcoming.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Expiring Soon ({upcoming.length})</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead><TableHead>SKU</TableHead>
                      <TableHead>Qty</TableHead><TableHead>Expires</TableHead><TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>{renderRows(upcoming)}</TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Verify the page**

Run: `npm run dev`, open `http://localhost:3000/reports/expiring-soon`

Expected: the 90-day filter shows nothing (test dates are 2027), and the empty state renders. To prove
the table path works, temporarily set a batch to expire soon:

```bash
node -e "require('dotenv').config();const m=require('mysql2/promise');(async()=>{const c=await m.createConnection({host:process.env.DB_HOST,port:process.env.DB_PORT,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});await c.query(\"UPDATE inventory_batches SET expiration_date=DATE_ADD(CURDATE(), INTERVAL 5 DAY) WHERE expiration_date='2027-01-31' LIMIT 1\");console.log('done');await c.end();})()"
```

Reload: the batch appears under "Expiring Soon" with a `5d left` badge.

- [ ] **Step 5: Add the report to navigation**

Run: `grep -rn "reports/" components/ app/\(app\)/layout.tsx --include=*.tsx | grep -i "nav\|sidebar\|menu" | head -20`

Add an "Expiring Soon" entry pointing at `/reports/expiring-soon`, matching the surrounding entries'
structure. If the reports nav is generated from a list, add to that list.

- [ ] **Step 6: Typecheck (no new errors)**

Run: `npm run typecheck 2>&1 | grep -E "^[^ ].*error TS" | grep -v "^.next" | sort > .superpowers/sdd/tc-now.txt; diff .superpowers/sdd/typecheck-baseline.txt .superpowers/sdd/tc-now.txt`
Expected: no lines starting with `>` (no NEW errors). Pre-existing errors are expected — do not fix them.

- [ ] **Step 7: Commit**

```bash
git add app/api/reports/expiring-soon "app/(app)/reports/expiring-soon" -A
git commit -m "feat(reports): add expiring soon report"
```

---

## Task 13: E2E coverage

**Files:**
- Modify: `tests/e2e/fixtures/test-data.ts` (add `PERISHABLE_PRODUCT` fixture)
- Modify: `tests/e2e/setup/prepare-test-db.ts` (seed the fixture)
- Create: `tests/e2e/adjustment-expiration.spec.ts`

**Interfaces:**
- Consumes: everything above
- Produces: regression coverage for the expiry flow

**Follow the repo's E2E conventions — do NOT invent new ones.** Read
`tests/e2e/inventory-adjust.spec.ts` first; it is the reference spec for adjustment-dialog tests and
this task mirrors its structure. Use `testQuery()` from `tests/e2e/helpers/db.ts` for DB assertions
and `seedSession()` from `tests/e2e/helpers/auth.ts` for auth. Comments in this repo's specs are
written in Cebuano — match that style.

- [ ] **Step 1: Add the perishable fixture**

In `tests/e2e/fixtures/test-data.ts`, directly after the `INVENTORY_PRODUCT` declaration, add:

```typescript
/**
 * Dedicated nga PERISHABLE product para sa expiration-date test. Bulag gikan sa
 * INVENTORY_PRODUCT aron ang is_perishable flag dili makaguba sa existing
 * inventory-adjust spec (nga wala nagdahom ug expiry field sa dialog).
 */
export const PERISHABLE_PRODUCT: FullProduct = {
  id: 'test-perishable-1',
  name: 'Perishable Stock Item',
  sku: 'PERISH-001',
  description: 'Product para sa expiration-date test.',
  price: 45,
  stock: 50,
  brand: TEST_BRAND.name,
  category: TEST_CATEGORY.name,
  unitOfMeasure: TEST_UNIT.name,
};
```

- [ ] **Step 2: Seed the fixture**

In `tests/e2e/setup/prepare-test-db.ts`, add `PERISHABLE_PRODUCT` to the import list from
`../fixtures/test-data` (alongside `INVENTORY_PRODUCT`).

The existing loop at roughly line 154 reads:

```typescript
  for (const p of [EDITABLE_PRODUCT, DELETABLE_PRODUCT, INVENTORY_PRODUCT]) {
    await conn.query(
      `INSERT INTO products (id, name, price, stock, sku, description, brand, category, unit_of_measure, availability)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Available')`,
      [p.id, p.name, p.price, p.stock, p.sku, p.description, p.brand, p.category, p.unitOfMeasure],
    );
  }
```

Leave that loop alone and add a separate insert directly after it, because this product needs the
`is_perishable` flag the shared loop does not set:

```typescript
  // Perishable product — managlahi ang insert kay kinahanglan niya ang is_perishable flag.
  await conn.query(
    `INSERT INTO products (id, name, price, stock, sku, description, brand, category, unit_of_measure, availability, is_perishable)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Available', 1)`,
    [
      PERISHABLE_PRODUCT.id, PERISHABLE_PRODUCT.name, PERISHABLE_PRODUCT.price,
      PERISHABLE_PRODUCT.stock, PERISHABLE_PRODUCT.sku, PERISHABLE_PRODUCT.description,
      PERISHABLE_PRODUCT.brand, PERISHABLE_PRODUCT.category, PERISHABLE_PRODUCT.unitOfMeasure,
    ],
  );
```

- [ ] **Step 3: Re-seed the test database**

The test DB is a **schema clone of your local dev `verdix`**, so migration 100 must already be applied
locally (Task 1) or `is_perishable` will not exist and this insert will fail.

Run: `npm run test:e2e:db`
Expected: completes without error.

Verify the column and the fixture landed:
```bash
node -e "require('dotenv').config();const m=require('mysql2/promise');(async()=>{const c=await m.createConnection({host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT)||3306,user:process.env.DB_USER||'root',password:process.env.DB_PASSWORD||'',database:'verdix_test'});const [r]=await c.query(\"SELECT id,name,is_perishable FROM products WHERE id IN ('test-perishable-1','test-inventory-1')\");console.table(r);const [b]=await c.query(\"SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='verdix_test' AND TABLE_NAME='inventory_batches' AND COLUMN_NAME='expiration_date'\");console.log('batch expiry col:',b[0].cnt);await c.end();})()"
```
Expected: `test-perishable-1` with `is_perishable` = 1, `test-inventory-1` with 0, and `batch expiry col: 1`.

**If `batch expiry col: 0`, stop.** Migration 100 has not been applied to your dev DB — run
`npm run migrate`, then `npm run test:e2e:db` again.

- [ ] **Step 4: Write the spec**

Create `tests/e2e/adjustment-expiration.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';
import { seedSession, DEFAULT_ADMIN } from './helpers/auth';
import { testQuery } from './helpers/db';
import { INVENTORY_PRODUCT, PERISHABLE_PRODUCT } from './fixtures/test-data';

/**
 * Expiration date sa stock adjustment — i-drive ang Adjust Stock dialog ug ang
 * bulk endpoint batok sa verdix_test.
 *
 * Ang mga assert mo-adto sa DATABASE, dili lang sa UI, kay ang batch INSERT naa
 * sulod sa silent try/catch (pre-migration guard) — kung maguba ang write,
 * mogawas gihapon ang success toast bisan walay na-save. DB read ra ang
 * makapamatuod nga tinuod nga na-persist.
 */

/** Kuhaa ang pinakabag-o nga batch sa usa ka product. */
async function latestBatch(productId: string) {
  const rows = await testQuery(
    `SELECT id, quantity_in, expiration_date
     FROM inventory_batches
     WHERE product_id = ?
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [productId],
  );
  return rows[0] || null;
}

/** I-normalize ang MySQL DATE ngadto sa YYYY-MM-DD string. */
function toDateString(value: any): string | null {
  if (value === null || value === undefined) return null;
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

test.describe('Adjustment expiration dates', () => {
  test('perishable product: makabutang ug expiry pinaagi sa Adjust Stock dialog', async ({ page }) => {
    await seedSession(page, DEFAULT_ADMIN);
    await page.goto('/inventory');

    await page.getByPlaceholder(/search products by name or sku/i).fill(PERISHABLE_PRODUCT.sku);

    await page.getByRole('button', { name: 'Actions' }).first().click();
    await page.getByRole('menuitem', { name: 'Adjust Stock' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Adjust Stock')).toBeVisible();

    await dialog.getByLabel(/quantity to add/i).fill('5');

    // Ang expiry field motungha ra para sa perishable nga product sa Add mode.
    const expiryInput = dialog.getByLabel(/expiration date/i);
    await expect(expiryInput).toBeVisible();
    await expiryInput.fill('2027-06-30');

    await dialog.getByRole('combobox').click();
    await page.getByRole('option', { name: 'New Shipment' }).click();

    await dialog.getByRole('button', { name: 'Confirm Adjustment' }).click();
    await expect(dialog).toBeHidden();

    await expect(async () => {
      const batch = await latestBatch(PERISHABLE_PRODUCT.id);
      expect(batch, 'naay batch nga na-create').toBeTruthy();
      expect(toDateString(batch.expiration_date)).toBe('2027-06-30');
    }).toPass({ timeout: 10_000 });
  });

  test('non-perishable product: walay expiry field sa dialog', async ({ page }) => {
    await seedSession(page, DEFAULT_ADMIN);
    await page.goto('/inventory');

    await page.getByPlaceholder(/search products by name or sku/i).fill(INVENTORY_PRODUCT.sku);

    await page.getByRole('button', { name: 'Actions' }).first().click();
    await page.getByRole('menuitem', { name: 'Adjust Stock' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Adjust Stock')).toBeVisible();

    // Dili gyud motungha ang expiry field para sa dili-perishable.
    await expect(dialog.getByLabel(/expiration date/i)).toHaveCount(0);
  });

  test('perishable + Remove mode: gitago ang expiry field', async ({ page }) => {
    await seedSession(page, DEFAULT_ADMIN);
    await page.goto('/inventory');

    await page.getByPlaceholder(/search products by name or sku/i).fill(PERISHABLE_PRODUCT.sku);

    await page.getByRole('button', { name: 'Actions' }).first().click();
    await page.getByRole('menuitem', { name: 'Adjust Stock' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel(/expiration date/i)).toBeVisible();

    await dialog.getByRole('tab', { name: /remove stock/i }).click();
    await expect(dialog.getByLabel(/expiration date/i)).toHaveCount(0);
  });

  test('bulk endpoint: gi-save ang expiry sa batch', async ({ request }) => {
    const res = await request.post('/api/inventory/adjust/bulk', {
      data: {
        adjustments: [{
          productId: PERISHABLE_PRODUCT.id,
          quantity: 7,
          reason: 'E2E bulk expiry',
          expirationDate: '2027-09-15',
        }],
        adjustmentType: 'add',
        userId: 'test-admin-uid',
      },
    });
    expect(res.ok()).toBeTruthy();

    await expect(async () => {
      const batch = await latestBatch(PERISHABLE_PRODUCT.id);
      expect(batch).toBeTruthy();
      expect(toDateString(batch.expiration_date)).toBe('2027-09-15');
    }).toPass({ timeout: 10_000 });
  });

  test('blank nga expiry: NULL ang batch, walay error', async ({ request }) => {
    const res = await request.post('/api/inventory/adjust/bulk', {
      data: {
        adjustments: [{
          productId: PERISHABLE_PRODUCT.id,
          quantity: 3,
          reason: 'E2E walay expiry',
          expirationDate: null,
        }],
        adjustmentType: 'add',
        userId: 'test-admin-uid',
      },
    });
    expect(res.ok()).toBeTruthy();

    await expect(async () => {
      const batch = await latestBatch(PERISHABLE_PRODUCT.id);
      expect(batch).toBeTruthy();
      expect(batch.expiration_date).toBeNull();
    }).toPass({ timeout: 10_000 });
  });

  test('products.expiration_date cache: ang pinakaduol nga petsa ang gigamit', async ({ request }) => {
    // Duha ka batch: ang ulahi nga gi-add mas sayo mo-expire → siya dapat ang cache.
    for (const date of ['2028-01-31', '2027-02-28']) {
      const res = await request.post('/api/inventory/adjust/bulk', {
        data: {
          adjustments: [{
            productId: PERISHABLE_PRODUCT.id,
            quantity: 2,
            reason: 'E2E cache',
            expirationDate: date,
          }],
          adjustmentType: 'add',
          userId: 'test-admin-uid',
        },
      });
      expect(res.ok()).toBeTruthy();
    }

    await expect(async () => {
      const rows = await testQuery('SELECT expiration_date FROM products WHERE id = ?', [PERISHABLE_PRODUCT.id]);
      expect(toDateString(rows[0]?.expiration_date)).toBe('2027-02-28');
    }).toPass({ timeout: 10_000 });
  });

  test('expiring-soon report: makita ang duol na mo-expire nga batch', async ({ request }) => {
    const res = await request.post('/api/inventory/adjust/bulk', {
      data: {
        adjustments: [{
          productId: PERISHABLE_PRODUCT.id,
          quantity: 4,
          reason: 'E2E report',
          expirationDate: '2027-12-31',
        }],
        adjustmentType: 'add',
        userId: 'test-admin-uid',
      },
    });
    expect(res.ok()).toBeTruthy();

    // I-pull ang petsa palapit aron mosulod sa 30-day window.
    await testQuery(
      `UPDATE inventory_batches SET expiration_date = DATE_ADD(CURDATE(), INTERVAL 5 DAY)
       WHERE product_id = ? AND expiration_date = '2027-12-31'`,
      [PERISHABLE_PRODUCT.id],
    );

    const report = await request.get('/api/reports/expiring-soon?days=30');
    expect(report.ok()).toBeTruthy();
    const body = await report.json();
    expect(body.success).toBeTruthy();
    expect(body.items.some((i: any) => i.productId === PERISHABLE_PRODUCT.id)).toBeTruthy();
  });
});
```

- [ ] **Step 5: Run the new spec**

Run: `npx playwright test tests/e2e/adjustment-expiration.spec.ts --reporter=list`
Expected: 7 passed.

If the dialog tests fail on the `Actions` menu, confirm the search actually narrowed to one card —
copy exactly what `tests/e2e/inventory-adjust.spec.ts` does.

Do NOT weaken an assertion to make it pass. If expiry is not persisting, trace it: confirm migration
100 applied to `verdix_test` (Step 3), then check whether the batch INSERT is swallowing an error in
its `catch`.

- [ ] **Step 6: Run the full suite for regressions**

Run: `npm run test:e2e`
Expected: no NEW failures versus baseline. Pay particular attention to
`tests/e2e/inventory-adjust.spec.ts` — it drives the same dialog this feature modified, and is the
most likely place to have broken something.

Record which specs failed BEFORE your changes if you did not already; report new failures only.

- [ ] **Step 7: Typecheck (no new errors)**

Run: `npm run typecheck 2>&1 | grep -E "^[^ ].*error TS" | grep -v "^.next" | sort > .superpowers/sdd/tc-now.txt; diff .superpowers/sdd/typecheck-baseline.txt .superpowers/sdd/tc-now.txt`
Expected: no lines starting with `>` (no NEW errors). Pre-existing errors are expected — do not fix them.

- [ ] **Step 8: Commit**

```bash
git add tests/e2e/adjustment-expiration.spec.ts tests/e2e/fixtures/test-data.ts tests/e2e/setup/prepare-test-db.ts
git commit -m "test(inventory): E2E coverage for adjustment expiration dates"
```

---


## Task 14: Manual verification of the approval path

**Files:** none — verification only

**Interfaces:**
- Consumes: Tasks 5, 6

**Why manual:** approval routing depends on `pos_settings.require_adjustment_confirmation` and
configured approval levels, which the E2E seed does not set up. `approvalData` is untyped JSON, so a
dropped field fails silently — this must be confirmed by hand.

- [ ] **Step 1: Enable adjustment approvals**

Run: `npm run dev`

In Settings, enable the adjustment approval requirement (the `require_adjustment_confirmation`
setting) and confirm at least one approval level exists.

- [ ] **Step 2: Submit an adjustment with an expiry**

Add 7 units to a perishable product with expiry `2027-08-15`. Expect the "pending approval" toast.

- [ ] **Step 3: Confirm the expiry is in the queued payload**

Run:
```bash
node -e "require('dotenv').config();const m=require('mysql2/promise');(async()=>{const c=await m.createConnection({host:process.env.DB_HOST,port:process.env.DB_PORT,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});const [r]=await c.query(\"SELECT id,transaction_type,transaction_data FROM approval_queue WHERE transaction_type='STOCK_ADJUSTMENT' ORDER BY created_at DESC LIMIT 1\");console.log(JSON.stringify(r[0],null,2));await c.end();})()"
```
Expected: `transaction_data` contains `"expirationDate": "2027-08-15"`.

**If it is missing, stop.** Re-check Task 5 Step 2 and Task 6 Step 2 — the payload is untyped, so this
is the only place the omission surfaces.

- [ ] **Step 4: Approve and verify the batch**

Approve the item in the Approval Center, then run:
```bash
node -e "require('dotenv').config();const m=require('mysql2/promise');(async()=>{const c=await m.createConnection({host:process.env.DB_HOST,port:process.env.DB_PORT,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});const [r]=await c.query(\"SELECT product_id,quantity_in,expiration_date FROM inventory_batches ORDER BY created_at DESC LIMIT 3\");console.table(r);await c.end();})()"
```
Expected: newest batch has `quantity_in` = 7 and `expiration_date` = `2027-08-15`.

- [ ] **Step 5: Restore the setting**

Turn `require_adjustment_confirmation` back to its original value so later work is not routed through
approvals unexpectedly.

- [ ] **Step 6: Record the result**

No commit — this task produces no files. Report the outcome of Steps 3 and 4 explicitly, including the
observed `expiration_date` values.

---

## Final Verification

- [ ] `npm run typecheck` — no errors
- [ ] `npm run test:e2e` — no new failures vs. baseline
- [ ] `npm run migrate:down && npm run migrate` — rollback and re-apply both clean
- [ ] Task 14 approval path confirmed by hand

## Known Limitations (documented, not bugs)

1. **Child products in a family do not inherit expiry.** Adding a dated 1kg bag creates child sachet
   batches with `NULL` expiry (Task 4, Step 2). Threading it down is a one-line change to the
   recursive call, deliberately deferred.
2. **Purchase-order receiving still does not carry expiry to batches.** `purchase_order_items.expiration_date`
   is captured but `lib/purchase-actions.ts:212` ignores it. Now a small follow-up since the column exists.
3. **Existing batches have no expiry.** Not backfilled — there is no data to infer it from.
