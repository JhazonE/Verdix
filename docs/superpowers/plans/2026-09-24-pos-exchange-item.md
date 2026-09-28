# POS Exchange Item Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 1-for-1 "Exchange for Another Item" action to the POS Merchandise Credit flow — the old item returns to stock, a replacement item is sold through the normal FIFO batch path, and any price difference is settled by cash/card payment or added to the customer's store credit.

**Architecture:** A new `POST /api/sales/exchanges` route wraps a return-leg and a sale-leg in one DB transaction, reusing extracted logic from the existing `/api/sales/returns` and `/api/pos/checkout` routes rather than duplicating their selling-unit-resolution and batch-costing code. Both legs write to `pos_transactions` using the existing `'return'`/`'sale'` values of `transaction_type` (never a new value), linked by a new `exchange_group_id` column, so every existing report keeps working unmodified. The POS UI adds two new steps to the existing `useReturnSales` state machine: pick a replacement product (reusing `ProductSearchDialog`), then a minimal balance-settlement step, before printing one combined Exchange Slip.

**Tech Stack:** Next.js 16 API routes, raw `mysql2/promise` via `lib/mysql.ts`, React client components under `app/(app)/pos/return-sales/`, Playwright E2E tests.

**Spec:** `docs/superpowers/specs/2026-09-24-pos-exchange-item-design.md`

## Global Constraints

- No new `pos_transactions.transaction_type` value — only `'return'` and `'sale'` (spec: "Why two linked existing transaction types, not a new one").
- New item's sale leg: no discounts, no loyalty points, no charge-to-account. Cash or card only, no split payments (spec Goals).
- New item's sale leg MUST go through `deductFromBatches` (FIFO batch costing) — this is core inventory accounting, never skipped for simplicity (spec Goals).
- Balance < 0 (new item cheaper) may only credit `customers.credit_balance` when the original sale has a customer attached; walk-in sales are blocked from this path in the UI, not silently defaulted (spec Goals, UI Flow).
- v1 is strictly 1-for-1: one returned line, one replacement line (spec Non-goals).
- Service products are rejected from either leg of an exchange (spec Error handling).
- Training-mode sales skip both SI and MC numbering, exactly like checkout already does (spec Error handling).
- Auth gate (`enableReturnAuth`) is checked once per exchange, at dialog open — never re-triggered mid-flow (spec UI Flow).
- The return-leg and sale-leg logic extracted from `/api/sales/returns` and `/api/pos/checkout` must not change behavior for those two existing routes (spec Architecture: "Extracted shared modules").

## Review Focus

- **Oversell-blocked replacement item**: `pos_settings.batch_costing_oversell_block = 1` and the chosen replacement has no batch stock left — the whole exchange must roll back (old item stays sold, no stock movements written, no numbers permanently consumed), not partially commit the return while failing the sale.
- **Walk-in sale, downsell exchange**: original sale has no `customer_id` and the replacement item is cheaper — the UI must block this combination outright rather than silently dropping the difference or crediting a `null` customer.
- **Same product, different selling unit**: returning 1 Case and replacing with 3 Piece of the *same* product — must resolve stock correctly on both legs independently (this is two ordinary selling-unit resolutions, not a special "net stock" shortcut) and not double-count or cancel out the batch deduction.
- **Partially-returned original sale line**: the return leg must still respect existing `returnedQuantity`/remaining-quantity bookkeeping — an exchange must not let a line be returned twice by re-selecting an already-fully-returned line.
- **Rolled-back exchange leaves no SI/MC gap illusion**: `getNextSINumber`/`getNextMCNumber` are called on the transaction's own connection, so a thrown error before commit must leave the counters exactly as if the exchange never started — verified by an integration test, not just inferred from the connection-sharing pattern.

---

## Task 1: Migration — `exchange_group_id` column

**Files:**
- Create: `scripts/migrations/127_add_exchange_group_id_to_pos_transactions.ts`
- Test: manual verification via `npm run migrate` / `npm run migrate:down` (no dedicated unit test file — this project's migrations are verified by running them, matching the pattern in `scripts/migrations/126_backfill_base_unit_barcode_from_sku.ts`)

**Interfaces:**
- Produces: `pos_transactions.exchange_group_id VARCHAR(50) NULL`, indexed as `idx_exchange_group_id`. Later tasks write and read this column directly via `mysql2` queries — no ORM/model layer exists in this codebase.

- [ ] **Step 1: Write the migration**

```typescript
import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

const migration: Migration = {
  name: '127_add_exchange_group_id_to_pos_transactions',
  timestamp: new Date().toISOString().replace(/T/, '_').replace(/\..+/, '').replace(/:/g, '-'),

  async up(): Promise<void> {
    const existingColumns: any = await query(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'pos_transactions' AND TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'exchange_group_id'"
    );
    if (!existingColumns || existingColumns.length === 0) {
      await query('ALTER TABLE pos_transactions ADD COLUMN exchange_group_id VARCHAR(50) NULL');
      await query('ALTER TABLE pos_transactions ADD INDEX idx_exchange_group_id (exchange_group_id)');
      console.log('✅ Added exchange_group_id column + index to pos_transactions');
    } else {
      console.log('ℹ️  exchange_group_id already exists on pos_transactions, skipping');
    }
  },

  async down(): Promise<void> {
    const existingColumns: any = await query(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'pos_transactions' AND TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'exchange_group_id'"
    );
    if (existingColumns && existingColumns.length > 0) {
      await query('ALTER TABLE pos_transactions DROP INDEX idx_exchange_group_id');
      await query('ALTER TABLE pos_transactions DROP COLUMN exchange_group_id');
      console.log('✅ Dropped exchange_group_id column + index from pos_transactions');
    }
  }
};

registerMigration(migration);
```

- [ ] **Step 2: Register the migration in the index**

Open `scripts/migrations/index.ts`, find where `126_backfill_base_unit_barcode_from_sku` is imported/registered, and add the equivalent import line for `127_add_exchange_group_id_to_pos_transactions` immediately after it, following the exact existing pattern in that file (read the file first — do not guess the import style).

- [ ] **Step 3: Run the migration against the dev DB**

Run: `npm run migrate`
Expected: Console shows `✅ Added exchange_group_id column + index to pos_transactions` and no errors.

- [ ] **Step 4: Verify the column exists**

Run (via a throwaway Node script or `mysql` CLI):
```sql
SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'pos_transactions' AND COLUMN_NAME = 'exchange_group_id';
```
Expected: One row, `DATA_TYPE = 'varchar'`, `IS_NULLABLE = 'YES'`.

- [ ] **Step 5: Verify rollback works cleanly**

Run: `npm run migrate:down`
Expected: Console shows the drop messages, no errors. Then run `npm run migrate` again to re-apply before continuing (later tasks assume the column exists).

- [ ] **Step 6: Commit**

```bash
git add scripts/migrations/127_add_exchange_group_id_to_pos_transactions.ts scripts/migrations/index.ts
git commit -m "feat: add exchange_group_id column to pos_transactions

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: Extract shared return-leg logic into `lib/pos/process-return-leg.ts`

**Files:**
- Create: `lib/pos/process-return-leg.ts`
- Modify: `app/api/sales/returns/route.ts` (replace the per-item loop body with a call into the new shared function)
- Modify: `tests/unit/run.ts` (register the new test file)
- Test: `tests/unit/process-return-leg.test.ts`

**IMPORTANT — this codebase's unit test convention:** There is no vitest/jest and no mocking library. `tests/unit/*.test.ts` files are plain scripts using only `node:assert/strict`, run via `tsx tests/unit/run.ts` (see `package.json`'s `test:unit` script), each imported once from `tests/unit/run.ts` and each printing `console.log('✓ <name>')` on success (a thrown error fails the whole run with a non-zero exit). Tests that touch the database do so against the REAL dev database through `withTransaction` from `lib/mysql.ts`, then roll back by throwing a sentinel error at the end and swallowing only that specific error — see `tests/unit/bir-or-number.test.ts` for the exact pattern to copy. Do NOT introduce `vitest`, `@testing-library/react`, or any mock/stub library — write plain async scripts against the real dev DB, wrapped in a rolled-back transaction.

**Interfaces:**
- Consumes: `deductFromBatches` is NOT used here (returns never deduct batches — they only add stock back, exactly as today). Uses existing `baseQuantity`, `getBaseUnit` from `lib/selling-units.ts`, and `updateStockAndRecordMovement` from `lib/stock-movements.ts`.
- Produces:
  ```typescript
  export interface ReturnLegItem {
    productId: string;
    productName: string;
    quantity: number;
    price: number;
    sellingUnitId?: string | null;
    sellingUnitName?: string | null;
    sellingUnitFactor?: number | null;
  }

  export interface ReturnLegResult {
    saleItemId: string;
    unitId: string | null;
    unitName: string | null;
    factor: number;
  }

  export async function processReturnLeg(
    connection: mysql.PoolConnection,
    params: {
      saleId: string;
      item: ReturnLegItem;
      posTransId: string;
      itemIndex: number; // used to build deterministic IDs, e.g. `${posTransId}-ITEM-${itemIndex + 1}`
    }
  ): Promise<ReturnLegResult>;
  ```
  Task 4 (`process-sale-leg.ts`) and Task 5 (`/api/sales/exchanges`) call this directly. It does NOT insert the `pos_transactions` header row or the `pos_transaction_items` row — those stay in the caller, because `/api/sales/returns` and `/api/sales/exchanges` build slightly different `pos_transactions` rows (different `total_amount` sign context, different `exchange_group_id`). `processReturnLeg` only owns: selling-unit resolution, the `sale_items` insert, and the `updateStockAndRecordMovement` call.

- [ ] **Step 1: Read the current selling-unit-resolution block to extract verbatim**

Re-read `app/api/sales/returns/route.ts` lines 91–256 (the per-item loop body). This is the exact logic to move — do not rewrite its behavior, only its location. Pay attention to the three-tier resolution order (caller-named unit → recorded sale-line unit → base unit) and the ambiguous-unit warning log.

- [ ] **Step 2: Write the failing unit test**

Create `tests/unit/process-return-leg.test.ts`, following the real-DB-plus-rollback pattern from `tests/unit/bir-or-number.test.ts`. It seeds a throwaway product + base selling unit + a fake original sale line inside the transaction, calls `processReturnLeg` on the same connection, asserts the resolved unit/stock outcome, then rolls back so nothing persists:

```typescript
import assert from 'node:assert/strict';
import { withTransaction } from '../../lib/mysql';
import { processReturnLeg } from '../../lib/pos/process-return-leg';

(async () => {
  await withTransaction(async (connection) => {
    const productId = 'TEST-RETLEG-PROD-1';
    const saleId = 'TEST-RETLEG-SALE-1';

    await connection.query(
      `INSERT INTO products (id, name, sku, stock, cost, price, type, unit_of_measure, created_at, updated_at)
       VALUES (?, 'Test Return Leg Widget', 'TEST-RETLEG-SKU-1', 10, 5, 10, 'good', 'Piece', NOW(), NOW())`,
      [productId]
    );
    await connection.query(
      `INSERT INTO product_selling_units (id, product_id, name, factor, cost, price, is_base, created_at, updated_at)
       VALUES (?, ?, 'Piece', 1, 5, 10, 1, NOW(), NOW())`,
      ['TEST-RETLEG-UNIT-1', productId]
    );
    // No sale_items row is seeded for this saleId/productId — this exercises
    // the "no recorded selling unit" branch, which must fall back to the
    // product's base unit rather than defaulting to factor 1 blindly.

    const result = await processReturnLeg(connection, {
      saleId,
      item: { productId, productName: 'Test Return Leg Widget', quantity: 2, price: 10 },
      posTransId: 'TEST-RETLEG-PT-1',
      itemIndex: 0,
    });

    assert.equal(result.unitId, 'TEST-RETLEG-UNIT-1', 'falls back to the product base unit');
    assert.equal(result.unitName, 'Piece');
    assert.equal(result.factor, 1);
    assert.equal(result.saleItemId, 'TEST-RETLEG-PT-1-ITEM-1');

    const [stockRows]: any = await connection.query('SELECT stock FROM products WHERE id = ?', [productId]);
    assert.equal(Number(stockRows[0].stock), 12, 'returning 2 units adds them back to stock (10 + 2)');

    // Unknown selling unit named by the caller must throw, not silently
    // fall back to the base unit (that would restore the wrong quantity
    // under a unit name that never existed).
    await assert.rejects(
      () => processReturnLeg(connection, {
        saleId,
        item: { productId, productName: 'Test Return Leg Widget', quantity: 1, price: 10, sellingUnitId: 'GHOST-UNIT' },
        posTransId: 'TEST-RETLEG-PT-2',
        itemIndex: 0,
      }),
      /Unknown selling unit GHOST-UNIT/,
      'rejects a selling unit id that does not belong to this product'
    );

    throw new Error('__TEST_ROLLBACK__');
  }).catch((e: any) => {
    if (e.message !== '__TEST_ROLLBACK__') throw e;
  });

  console.log('✓ process-return-leg');
  process.exit(0);
})().catch((e) => {
  console.error('Test failed:', e);
  process.exit(1);
});
```

- [ ] **Step 3: Register the test and run it to verify it fails**

Add `import './process-return-leg.test';` to `tests/unit/run.ts` in the same alphabetized/grouped style as the surrounding imports (place it near the other `process-*`/`price-*`/`pos-*` entries — read the current file to pick a sensible spot).

Run: `npm run test:unit`
Expected: FAIL — `Cannot find module '../../lib/pos/process-return-leg'`.

- [ ] **Step 4: Create `lib/pos/process-return-leg.ts` by extracting the logic**

```typescript
import mysql from 'mysql2/promise';
import { baseQuantity, getBaseUnit } from '../selling-units';
import { updateStockAndRecordMovement } from '../stock-movements';

export interface ReturnLegItem {
  productId: string;
  productName: string;
  quantity: number;
  price: number;
  sellingUnitId?: string | null;
  sellingUnitName?: string | null;
  sellingUnitFactor?: number | null;
}

export interface ReturnLegResult {
  saleItemId: string;
  unitId: string | null;
  unitName: string | null;
  factor: number;
}

/**
 * Restores one returned line to stock: resolves the selling unit it was
 * originally sold in, writes the negative sale_items row, and adds the
 * quantity back via updateStockAndRecordMovement.
 *
 * Extracted from app/api/sales/returns/route.ts so /api/sales/exchanges can
 * reuse the exact same selling-unit resolution rules without a second copy
 * drifting from this one. Behavior must stay identical to the original
 * inline loop this replaced.
 */
export async function processReturnLeg(
  connection: mysql.PoolConnection,
  params: {
    saleId: string;
    item: ReturnLegItem;
    posTransId: string;
    itemIndex: number;
  }
): Promise<ReturnLegResult> {
  const { saleId, item, posTransId, itemIndex } = params;
  const saleItemId = `${posTransId}-ITEM-${itemIndex + 1}`;

  const returnedQty = Number(item.quantity);
  if (!Number.isFinite(returnedQty)) {
    throw new Error(`Invalid return quantity for product ${item.productId}: ${item.quantity}`);
  }

  let unitId: string | null = item.sellingUnitId ?? null;
  let unitName: string | null = item.sellingUnitName ?? null;
  let factor = Number(item.sellingUnitFactor ?? 0);

  const [originalLines]: any = unitId
    ? await connection.query(
        `SELECT selling_unit_id, selling_unit_name, selling_unit_factor
         FROM sale_items
         WHERE sale_id = ? AND product_id = ? AND quantity > 0
           AND selling_unit_id = ?
         ORDER BY created_at ASC`,
        [saleId, item.productId, unitId]
      )
    : await connection.query(
        `SELECT selling_unit_id, selling_unit_name, selling_unit_factor
         FROM sale_items
         WHERE sale_id = ? AND product_id = ? AND quantity > 0
         ORDER BY created_at ASC`,
        [saleId, item.productId]
      );

  if (originalLines && originalLines.length > 0) {
    if (!unitId) {
      const distinctFactors = Array.from(
        new Set(originalLines.map((r: any) => Number(r.selling_unit_factor ?? 1)))
      );
      if (distinctFactors.length > 1) {
        console.warn(
          `[Returns] Ambiguous selling unit for product ${item.productId} on sale ${saleId}: ` +
          `the sale has lines in ${distinctFactors.length} different units (factors ` +
          `${distinctFactors.join(', ')}). No sellingUnitId was supplied, so the OLDEST line ` +
          `(factor ${Number(originalLines[0].selling_unit_factor ?? 1)}) was used to restore stock. ` +
          `Supply sellingUnitId on the return line to choose explicitly.`
        );
      }
    }

    const line = originalLines[0];
    const recordedFactor = Number(line.selling_unit_factor ?? 1);
    if (Number.isFinite(recordedFactor) && recordedFactor > 0) {
      unitId = line.selling_unit_id ?? unitId;
      unitName = line.selling_unit_name ?? unitName;
      factor = recordedFactor;
    }
  }

  if ((!Number.isFinite(factor) || factor <= 0) && unitId) {
    const [namedUnit]: any = await connection.query(
      'SELECT id, name, factor FROM product_selling_units WHERE id = ? AND product_id = ? LIMIT 1',
      [unitId, item.productId]
    );
    if (namedUnit && namedUnit.length > 0) {
      const namedFactor = Number(namedUnit[0].factor);
      if (Number.isFinite(namedFactor) && namedFactor > 0) {
        unitName = namedUnit[0].name ?? unitName;
        factor = namedFactor;
      }
    } else {
      throw new Error(
        `Unknown selling unit ${unitId} for product ${item.productId} on return for sale ${saleId}`
      );
    }
  }

  if (!Number.isFinite(factor) || factor <= 0) {
    const base = await getBaseUnit(item.productId, connection);
    if (base) {
      unitId = base.id;
      unitName = base.name;
      factor = base.factor;
    } else {
      unitId = unitId ?? null;
      unitName = unitName ?? null;
      factor = 1;
    }
  }

  const insertSaleItemSql = `
    INSERT INTO sale_items (
      id, sale_id, product_id, product_name, quantity, price,
      selling_unit_id, selling_unit_name, selling_unit_factor, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
  `;
  await connection.query(insertSaleItemSql, [
    saleItemId,
    saleId,
    item.productId,
    item.productName,
    -returnedQty,
    item.price,
    unitId,
    unitName,
    factor,
  ]);

  const [soldProdResult]: any = await connection.query(
    'SELECT id, name FROM products WHERE id = ?',
    [item.productId]
  );

  if (soldProdResult && soldProdResult.length > 0) {
    const soldProd = soldProdResult[0];
    await updateStockAndRecordMovement(
      soldProd.id,
      baseQuantity(returnedQty, factor),
      'return',
      posTransId,
      'return',
      `Return for Sale: ${saleId}${factor !== 1 ? ` (${returnedQty} × ${unitName})` : ''}`,
      connection
    );
  }

  return { saleItemId, unitId, unitName, factor };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:unit`
Expected: PASS — output includes `✓ process-return-leg` and every previously-passing test still prints its own `✓` line (this runner has no per-test isolation; a thrown error anywhere fails the whole run, so a regression elsewhere would also show up here).

- [ ] **Step 6: Wire `app/api/sales/returns/route.ts` to call the extracted function**

Replace the inline loop body (the block that starts at the selling-unit-resolution comment and ends right before the `pos_transaction_items` insert) with a call to `processReturnLeg`. The route still owns: allocating `mcNumber`, inserting the `pos_transactions` header row, and inserting the `pos_transaction_items` row (which needs the `unitId`/`unitName`/`factor` returned by `processReturnLeg`). Concretely, inside the existing `for` loop in `app/api/sales/returns/route.ts`, replace the block from the `// --- SELLING UNIT RESOLUTION ---` comment through `// --- Inventory Addition ---` and its body with:

```typescript
        const { unitId, unitName, factor } = await processReturnLeg(connection, {
          saleId,
          item,
          posTransId,
          itemIndex: i,
        });

        const returnedQty = Number(item.quantity);
```

Add the import at the top of the file:
```typescript
import { processReturnLeg } from '@/lib/pos/process-return-leg';
```

Keep the existing `pos_transaction_items` insert immediately after (it already references `unitId`, `unitName`, `factor`, and `returnedQty` — these names must match exactly what's destructured above).

- [ ] **Step 7: Run the existing returns E2E test to confirm no regression**

Run: `npm run test:e2e -- --grep "return"`
Expected: PASS — all existing return-related Playwright tests still pass unchanged (this is the regression guard the spec calls for: "`/api/sales/returns` and `/api/pos/checkout` behavior is byte-for-byte unchanged after extraction").

- [ ] **Step 8: Commit**

```bash
git add lib/pos/process-return-leg.ts app/api/sales/returns/route.ts tests/unit/process-return-leg.test.ts tests/unit/run.ts
git commit -m "refactor: extract return-leg logic into lib/pos/process-return-leg.ts

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: Extract shared sale-leg logic into `lib/pos/process-sale-leg.ts`

**Files:**
- Create: `lib/pos/process-sale-leg.ts`
- Modify: `app/api/pos/checkout/route.ts` (replace the per-item batch-costing/stock-deduction/sale_items-insert block with a call into the new shared function)
- Modify: `tests/unit/run.ts` (register the new test file)
- Test: `tests/unit/process-sale-leg.test.ts`

Same test convention as Task 2: plain `node:assert/strict`, real dev DB via `withTransaction`, rolled back at the end. No vitest, no mocks.

**Interfaces:**
- Consumes: `deductFromBatches`, `getBatchCostingSettings` from `lib/batch-deduction.ts`; `baseQuantity`, `getBaseUnit` from `lib/selling-units.ts`; `updateStockAndRecordMovement` from `lib/stock-movements.ts`; `isService` from `lib/product-type.ts`.
- Produces:
  ```typescript
  export interface SaleLegItem {
    id: string;            // product id
    name: string;
    quantity: number;
    price: number;
    discount?: number;     // percent, 0-100; exchanges always pass 0
    sellingUnitId?: string | null;
    sellingUnitName?: string | null;
    sellingUnitFactor?: number | null;
  }

  export interface SaleLegResult {
    itemId: string;
    unitId: string | null;
    unitName: string | null;
    factor: number;
    costAtSale: number | null;
    batchSource: string | null;
    isServiceItem: boolean;
  }

  export async function processSaleLeg(
    connection: mysql.PoolConnection,
    params: {
      item: SaleLegItem;
      saleId: string;
      itemIndex: number; // builds `${saleId}-ITEM-${itemIndex + 1}`
      oversellBlock: boolean; // caller fetches once via getBatchCostingSettings and passes it in
    }
  ): Promise<SaleLegResult>;
  ```
  Task 5 (`/api/sales/exchanges`) calls this for the single replacement item. `/api/pos/checkout` is refactored to call it once per cart item inside its existing loop.

- [ ] **Step 1: Read the current batch-costing block to extract verbatim**

Re-read `app/api/pos/checkout/route.ts` lines 203–362 (the per-item loop: selling-unit resolution, batch costing, `sale_items` insert, stock deduction). This is what moves — behavior must not change, including the loyalty-points accumulation which STAYS in `checkout/route.ts` (it is not part of `processSaleLeg` — the spec excludes loyalty from the exchange's sale leg, so it must not be baked into the shared function).

- [ ] **Step 2: Write the failing unit test**

Create `tests/unit/process-sale-leg.test.ts`, seeding a throwaway product with a base selling unit and one `inventory_batches` row inside the transaction, then rolling back:

```typescript
import assert from 'node:assert/strict';
import { withTransaction } from '../../lib/mysql';
import { processSaleLeg } from '../../lib/pos/process-sale-leg';

(async () => {
  await withTransaction(async (connection) => {
    const productId = 'TEST-SALELEG-PROD-1';

    await connection.query(
      `INSERT INTO products (id, name, sku, stock, cost, price, type, unit_of_measure, category, earns_points, created_at, updated_at)
       VALUES (?, 'Test Sale Leg Gadget', 'TEST-SALELEG-SKU-1', 10, 5, 8, 'good', 'Piece', NULL, 1, NOW(), NOW())`,
      [productId]
    );
    await connection.query(
      `INSERT INTO product_selling_units (id, product_id, name, factor, cost, price, is_base, created_at, updated_at)
       VALUES (?, ?, 'Piece', 1, 5, 8, 1, NOW(), NOW())`,
      ['TEST-SALELEG-UNIT-1', productId]
    );
    await connection.query(
      `INSERT INTO inventory_batches (id, product_id, received_date, quantity_in, quantity_remaining, unit_cost, selling_price, source_type, created_at, updated_at)
       VALUES (?, ?, CURDATE(), 5, 5, 5, 8, 'purchase', NOW(), NOW())`,
      ['TEST-SALELEG-BATCH-1', productId]
    );

    const result = await processSaleLeg(connection, {
      item: { id: productId, name: 'Test Sale Leg Gadget', quantity: 2, price: 8 },
      saleId: 'TEST-SALELEG-SALE-1',
      itemIndex: 0,
      oversellBlock: false,
    });

    assert.equal(result.itemId, 'TEST-SALELEG-SALE-1-ITEM-1');
    assert.equal(result.unitId, 'TEST-SALELEG-UNIT-1');
    assert.equal(result.factor, 1);
    assert.equal(result.isServiceItem, false);
    assert.ok(Math.abs((result.costAtSale ?? 0) - 5) < 1e-6, `costAtSale should be 5, got ${result.costAtSale}`);

    const [stockRows]: any = await connection.query('SELECT stock FROM products WHERE id = ?', [productId]);
    assert.equal(Number(stockRows[0].stock), 8, 'selling 2 units deducts them from stock (10 - 2)');

    const [batchRows]: any = await connection.query('SELECT quantity_remaining FROM inventory_batches WHERE id = ?', ['TEST-SALELEG-BATCH-1']);
    assert.equal(Number(batchRows[0].quantity_remaining), 3, 'FIFO batch deduction removed 2 units from the batch (5 - 2)');

    // A product with no base selling unit configured must fail loudly rather
    // than silently deduct nothing.
    const brokenProductId = 'TEST-SALELEG-PROD-BROKEN';
    await connection.query(
      `INSERT INTO products (id, name, sku, stock, cost, price, type, unit_of_measure, created_at, updated_at)
       VALUES (?, 'Broken Product', 'TEST-SALELEG-SKU-BROKEN', 0, 1, 1, 'good', 'Piece', NOW(), NOW())`,
      [brokenProductId]
    );
    await assert.rejects(
      () => processSaleLeg(connection, {
        item: { id: brokenProductId, name: 'Broken Product', quantity: 1, price: 1 },
        saleId: 'TEST-SALELEG-SALE-2',
        itemIndex: 0,
        oversellBlock: false,
      }),
      /has no base selling unit/
    );

    throw new Error('__TEST_ROLLBACK__');
  }).catch((e: any) => {
    if (e.message !== '__TEST_ROLLBACK__') throw e;
  });

  console.log('✓ process-sale-leg');
  process.exit(0);
})().catch((e) => {
  console.error('Test failed:', e);
  process.exit(1);
});
```

- [ ] **Step 3: Register the test and run it to verify it fails**

Add `import './process-sale-leg.test';` to `tests/unit/run.ts` next to the `process-return-leg.test` import added in Task 2.

Run: `npm run test:unit`
Expected: FAIL — `Cannot find module '../../lib/pos/process-sale-leg'`.

- [ ] **Step 4: Create `lib/pos/process-sale-leg.ts` by extracting the logic**

```typescript
import mysql from 'mysql2/promise';
import { baseQuantity, getBaseUnit } from '../selling-units';
import { updateStockAndRecordMovement } from '../stock-movements';
import { deductFromBatches } from '../batch-deduction';
import { isService } from '../product-type';

export interface SaleLegItem {
  id: string;
  name: string;
  quantity: number;
  price: number;
  discount?: number;
  sellingUnitId?: string | null;
  sellingUnitName?: string | null;
  sellingUnitFactor?: number | null;
}

export interface SaleLegResult {
  itemId: string;
  unitId: string | null;
  unitName: string | null;
  factor: number;
  costAtSale: number | null;
  batchSource: string | null;
  isServiceItem: boolean;
}

/**
 * Sells one line: resolves its selling unit, runs FIFO batch costing, writes
 * the sale_items row, and deducts stock.
 *
 * Extracted from app/api/pos/checkout/route.ts's per-item loop so
 * /api/sales/exchanges can sell the replacement item through the exact same
 * batch-costing path as a normal checkout. Deliberately excludes loyalty
 * points accrual — checkout/route.ts still owns that separately, since the
 * exchange's sale leg must not earn points (spec: no loyalty on exchange v1).
 */
export async function processSaleLeg(
  connection: mysql.PoolConnection,
  params: {
    item: SaleLegItem;
    saleId: string;
    itemIndex: number;
    oversellBlock: boolean;
  }
): Promise<SaleLegResult> {
  const { item, saleId, itemIndex, oversellBlock } = params;
  const itemId = `${saleId}-ITEM-${itemIndex + 1}`;

  const [soldProdResult]: any = await connection.query(`
    SELECT
      p.id, p.parent_id, p.unit_of_measure, p.name, p.stock, p.type, p.cost,
      c.markup_percentage, p.category, p.earns_points
    FROM products p
    LEFT JOIN categories c ON p.category = c.name
    WHERE p.id = ?
  `, [item.id]);

  const soldProd = soldProdResult?.[0];
  const itemIsService = soldProd ? isService(soldProd) : false;

  let unitId: string | null = item.sellingUnitId ?? null;
  let unitName: string | null = item.sellingUnitName ?? null;
  let factor = Number(item.sellingUnitFactor ?? 0);

  if (soldProd && !itemIsService) {
    if (!unitId || !Number.isFinite(factor) || factor <= 0) {
      const base = await getBaseUnit(soldProd.id, connection);
      if (!base) {
        throw new Error(
          `Product ${soldProd.id} has no base selling unit — cannot record this sale.`
        );
      }
      unitId = base.id;
      unitName = base.name;
      factor = base.factor;
    }
  } else if (!Number.isFinite(factor) || factor <= 0) {
    unitId = unitId ?? null;
    unitName = unitName ?? null;
    factor = 1;
  }

  const soldQty = Number(item.quantity);
  if (!Number.isFinite(soldQty)) {
    throw new Error(`Invalid quantity for product ${item.id}: ${item.quantity}`);
  }
  const qtyInBase = baseQuantity(soldQty, factor);

  let costAtSale: number | null = null;
  let batchSource: string | null = null;

  if (itemIsService) {
    costAtSale = soldProd?.cost != null ? parseFloat(soldProd.cost) : 0;
    batchSource = null;
  } else {
    try {
      const deduction = await deductFromBatches(item.id, qtyInBase, oversellBlock, connection as any);
      costAtSale = deduction.weightedAvgCost * factor;
      batchSource = JSON.stringify(deduction.splits);
    } catch (batchErr: any) {
      if (batchErr.message && batchErr.message.startsWith('Batch stock exhausted')) {
        throw batchErr;
      }
      console.warn('[BatchCosting] Could not deduct batch (migration pending?):', batchErr.message);
    }
  }

  await connection.query(`
    INSERT INTO sale_items (
      id, sale_id, product_id, product_name, quantity, price, cost_at_sale, batch_source,
      selling_unit_id, selling_unit_name, selling_unit_factor, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
  `, [
    itemId,
    saleId,
    item.id,
    item.name,
    item.quantity,
    item.price * (1 - (item.discount || 0) / 100),
    costAtSale,
    batchSource,
    unitId,
    unitName,
    factor,
  ]);

  if (soldProd && !itemIsService) {
    await updateStockAndRecordMovement(
      soldProd.id,
      -qtyInBase,
      'sale',
      saleId,
      'sale',
      `POS Sale: ${saleId}${factor !== 1 ? ` (${soldQty} × ${unitName})` : ''}`,
      connection
    );
  }

  return { itemId, unitId, unitName, factor, costAtSale, batchSource, isServiceItem: itemIsService };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:unit`
Expected: PASS — output includes `✓ process-sale-leg` and every other test's `✓` line still appears.

- [ ] **Step 6: Wire `app/api/pos/checkout/route.ts` to call the extracted function**

Inside the existing per-item `for` loop in `checkout/route.ts` (the one currently spanning roughly lines 203–362), replace the selling-unit-resolution + batch-costing + `sale_items`-insert + stock-deduction block with:

```typescript
        const legResult = await processSaleLeg(connection, {
          item,
          saleId,
          itemIndex: i,
          oversellBlock: (await getBCS()).oversellBlock,
        });
        resolvedUnits[i] = { id: legResult.unitId, name: legResult.unitName, factor: legResult.factor };

        // Loyalty Points Calculation — unaffected by the refactor, stays here.
        if (soldProd) { // soldProd must still be fetched for the loyalty block below
```

Since `soldProd` (used for the loyalty-points markup check right after) is now fetched *inside* `processSaleLeg` and not returned, keep a local product-info fetch in `checkout/route.ts` for the loyalty block specifically — do NOT try to extend `SaleLegResult` to carry loyalty-irrelevant product fields; that would leak sale-specific concerns into the shared function. Concretely, keep this small standalone query in `checkout/route.ts` right where `soldProd` was previously used for loyalty, immediately after the `processSaleLeg` call:

```typescript
        const [loyaltyProdResult]: any = await connection.query(
          'SELECT markup_percentage, earns_points FROM products p LEFT JOIN categories c ON p.category = c.name WHERE p.id = ?',
          [item.id]
        );
        const loyaltyProd = loyaltyProdResult?.[0];
        if (loyaltyProd) {
          const hasFivePercentMarkup = Math.abs((loyaltyProd.markup_percentage || 0) - 5) < 0.01;
          const earnsPointsEnabled = loyaltyProd.earns_points !== 0 && loyaltyProd.earns_points !== false;
          const isExcluded = hasFivePercentMarkup || !earnsPointsEnabled;
          if (!isExcluded) {
            eligiblePointsAmount += item.price * item.quantity;
          }
        }
```

Add the import at the top of the file:
```typescript
import { processSaleLeg } from '@/lib/pos/process-sale-leg';
```

Remove the now-dead original inline block and its now-unused local variables in that loop, but leave `resolvedUnits[i]` assignment (still needed by the code after the loop that inserts `sales_invoice_items`/`pos_transaction_items`).

- [ ] **Step 7: Run the checkout E2E/integration tests to confirm no regression**

Run: `npm run test:e2e -- --grep "checkout|purchase-order|pos"`
Expected: PASS — no behavior change for existing checkout flows. Pay particular attention to `tests/e2e/purchase-order.spec.ts` (noted in CLAUDE.md as exercising the product-creation path) and any POS sale E2E specs.

- [ ] **Step 8: Commit**

```bash
git add lib/pos/process-sale-leg.ts app/api/pos/checkout/route.ts tests/unit/process-sale-leg.test.ts tests/unit/run.ts
git commit -m "refactor: extract sale-leg logic into lib/pos/process-sale-leg.ts

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: `POST /api/sales/exchanges` route

**Files:**
- Create: `app/api/sales/exchanges/route.ts`
- Test: `tests/e2e/pos-exchange-api.spec.ts` (API-level Playwright test hitting the route directly, following the pattern used by other `tests/e2e/*.spec.ts` files that call `request.post`)

**Interfaces:**
- Consumes: `processReturnLeg` (Task 2), `processSaleLeg` (Task 3), `getNextMCNumber`, `getNextSINumber`, `withTransaction` from `lib/mysql.ts`, `getBatchCostingSettings` from `lib/batch-deduction.ts`, `isService` from `lib/product-type.ts`, `saveEJournalFiles` from `lib/ejournal/ejournal-writer.ts`.
- Produces: the HTTP contract consumed by Task 6 (`use-return-sales.ts`):
  ```
  POST /api/sales/exchanges
  Request: {
    saleId: string;
    returnItem: { productId, productName, quantity, price, sellingUnitId?, sellingUnitName?, sellingUnitFactor? };
    newItem: { productId, productName, quantity, price, sellingUnitId?, sellingUnitName?, sellingUnitFactor? };
    balancePayment?: { method: string; amountTendered: number; reference?: string };
    terminalId?: string;
    userId: string;
    shiftId?: string;
    customerId?: string | null;
  }
  Response success: {
    success: true,
    data: {
      exchangeGroupId: string;
      returnPosTransId: string;
      salePosTransId: string;
      mcNumber: string;
      siNumber: string | null;
      balance: number; // newItem total - returnItem total; positive = collected, negative = credited, 0 = even
    }
  }
  Response failure: { success: false, error: string } with appropriate status code
  ```

- [ ] **Step 1: Write the failing E2E test for the happy path (even exchange)**

Create `tests/e2e/pos-exchange-api.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';
import { testQuery, resetPosState } from './helpers/db';
import { seedSession, DEFAULT_ADMIN } from './helpers/auth';

test.describe('POST /api/sales/exchanges', () => {
  test.beforeEach(async () => {
    await resetPosState();
  });

  test('even exchange (balance = 0) returns old item to stock and sells new item via FIFO batch', async ({ request, page }) => {
    // Seed two products with known stock/cost via testQuery, seed a completed
    // sale for productA with a known sale_items row, seed a shift.
    // (Exact seed helper calls to be filled in by reading tests/e2e/setup/global-setup.ts
    // and an existing returns-focused spec, e.g. any test that exercises
    // /api/sales/returns today, for the seeding conventions this codebase uses.)

    await seedSession(page, DEFAULT_ADMIN);

    const res = await request.post('/api/sales/exchanges', {
      data: {
        saleId: 'SEEDED-SALE-1',
        returnItem: { productId: 'SEEDED-PRODUCT-A', productName: 'Product A', quantity: 1, price: 50 },
        newItem: { productId: 'SEEDED-PRODUCT-B', productName: 'Product B', quantity: 1, price: 50 },
        userId: DEFAULT_ADMIN.uid,
        terminalId: 'TERMINAL-1',
      },
    });

    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.balance).toBe(0);
    expect(body.data.mcNumber).toMatch(/^MC-\d{6}$/);
    expect(body.data.siNumber).toMatch(/^\d{6}$/);

    const rows: any[] = await testQuery(
      'SELECT transaction_type, exchange_group_id FROM pos_transactions WHERE exchange_group_id = ?',
      [body.data.exchangeGroupId]
    );
    expect(rows).toHaveLength(2);
    expect(rows.map(r => r.transaction_type).sort()).toEqual(['return', 'sale']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:e2e -- pos-exchange-api`
Expected: FAIL with a 404 (route doesn't exist yet).

- [ ] **Step 3: Implement `app/api/sales/exchanges/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { withTransaction, getNextMCNumber, getNextSINumber, query } from '@/lib/mysql';
import { processReturnLeg } from '@/lib/pos/process-return-leg';
import { processSaleLeg } from '@/lib/pos/process-sale-leg';
import { getBatchCostingSettings } from '@/lib/batch-deduction';
import { isService } from '@/lib/product-type';
import { ensureCustomerCreditColumn } from '@/lib/ensure-customer-credit';
import { saveEJournalFiles } from '@/lib/ejournal/ejournal-writer';

export async function POST(request: NextRequest) {
  try {
    await ensureCustomerCreditColumn();
    const body = await request.json();
    const {
      saleId,
      returnItem,
      newItem,
      balancePayment,
      terminalId,
      userId,
      shiftId,
      customerId,
    } = body;

    if (!saleId || !returnItem || !newItem) {
      return NextResponse.json({ success: false, error: 'saleId, returnItem, and newItem are required' }, { status: 400 });
    }
    if (!userId) {
      return NextResponse.json({ success: false, error: 'User ID is required' }, { status: 400 });
    }

    const returnTotal = Number(returnItem.quantity) * Number(returnItem.price);
    const newTotal = Number(newItem.quantity) * Number(newItem.price);
    const balance = Math.round((newTotal - returnTotal) * 100) / 100;

    if (balance > 0) {
      const tendered = Number(balancePayment?.amountTendered ?? 0);
      if (!balancePayment || !Number.isFinite(tendered) || tendered < balance) {
        return NextResponse.json({ success: false, error: `Insufficient payment for balance of ${balance.toFixed(2)}` }, { status: 400 });
      }
    }
    if (balance < 0 && !customerId) {
      return NextResponse.json({ success: false, error: 'A customer must be attached to the original sale to credit a downsell balance' }, { status: 400 });
    }

    const productTypeRows: any = await query(
      'SELECT id, type FROM products WHERE id IN (?, ?)',
      [returnItem.productId, newItem.productId]
    );
    const typeById = new Map(productTypeRows.map((r: any) => [r.id, r.type]));
    if (isService({ type: typeById.get(returnItem.productId) }) || isService({ type: typeById.get(newItem.productId) })) {
      return NextResponse.json({ success: false, error: 'Exchanges do not support service products in v1' }, { status: 400 });
    }

    const [posSettingsRows]: any = await query('SELECT is_training_mode FROM pos_settings LIMIT 1');
    const isTrainingMode = posSettingsRows?.[0]?.is_training_mode || false;

    const returnPosTransId = `RTN-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    const salePosTransId = `PT-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    const newSaleId = `SALE-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    const exchangeGroupId = `EXG-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;

    const result = await withTransaction(async (connection) => {
      let finalUserId = userId;
      const [userResult]: any = await connection.query('SELECT uid FROM users WHERE uid = ? LIMIT 1', [userId]);
      if (!userResult || userResult.length === 0) {
        const [anyUser]: any = await connection.query('SELECT uid FROM users LIMIT 1');
        finalUserId = anyUser?.[0]?.uid || 'system';
      }

      let finalShiftId = shiftId || null;
      if (!finalShiftId && terminalId) {
        const [openShift]: any = await connection.query(
          "SELECT id FROM shifts WHERE terminal_id = ? AND status = 'active' ORDER BY start_time DESC LIMIT 1",
          [terminalId]
        );
        finalShiftId = openShift?.[0]?.id || null;
      }

      const mcNumber = await getNextMCNumber(connection);
      const siNumber = isTrainingMode ? null : await getNextSINumber(connection);

      // --- RETURN LEG ---
      await connection.query(
        `INSERT INTO pos_transactions (
          id, sale_id, shift_id, user_id, terminal_id, transaction_type, mc_number,
          subtotal, tax_amount, discount_amount, total_amount, payment_method,
          payment_status, notes, exchange_group_id, transaction_time, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'return', ?, ?, 0, 0, ?, 'Return', 'completed', ?, ?, NOW(), NOW(), NOW())`,
        [
          returnPosTransId, saleId, finalShiftId, finalUserId, terminalId || null,
          mcNumber, -returnTotal, -returnTotal,
          'Exchange (return leg)', exchangeGroupId,
        ]
      );

      const returnLegResult = await processReturnLeg(connection, {
        saleId,
        item: returnItem,
        posTransId: returnPosTransId,
        itemIndex: 0,
      });

      await connection.query(
        `INSERT INTO pos_transaction_items (
          id, pos_transaction_id, sale_item_id, product_id, product_name,
          quantity, unit_price, line_total,
          selling_unit_id, selling_unit_name, selling_unit_factor, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          `${returnPosTransId}-DETAIL-1`, returnPosTransId, returnLegResult.saleItemId,
          returnItem.productId, returnItem.productName,
          -Number(returnItem.quantity), returnItem.price, -(Number(returnItem.quantity) * returnItem.price),
          returnLegResult.unitId, returnLegResult.unitName, returnLegResult.factor,
        ]
      );

      // --- SALE LEG ---
      const bcs = await getBatchCostingSettings(connection as any);
      const saleLegResult = await processSaleLeg(connection, {
        item: { ...newItem, discount: 0 },
        saleId: newSaleId,
        itemIndex: 0,
        oversellBlock: bcs.oversellBlock,
      });

      const isCharge = false; // exchanges never charge-to-account in v1
      await connection.query(
        `INSERT INTO sales_transactions (
          id, reference, receipt_number, si_number, bir_or_number, customer_id, invoice_date, date, total, payment_method, status, transaction_source, notes, is_training, created_at, updated_at
        ) VALUES (?, ?, NULL, ?, NULL, ?, CURDATE(), CURDATE(), ?, ?, 'Paid', 'POS', ?, ?, NOW(), NOW())`,
        [
          newSaleId, `EXG-REF-${newSaleId}`, siNumber,
          customerId || null, newTotal, balancePayment?.method || 'CASH',
          'Exchange (sale leg)', isTrainingMode,
        ]
      );

      await connection.query(
        `INSERT INTO pos_transactions (
          id, sale_id, shift_id, user_id, terminal_id, transaction_type, si_number,
          subtotal, tax_amount, discount_amount, total_amount, payment_method,
          payment_status, notes, is_training, exchange_group_id, transaction_time, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'sale', ?, ?, 0, 0, ?, ?, 'completed', ?, ?, ?, NOW(), NOW(), NOW())`,
        [
          salePosTransId, newSaleId, finalShiftId, finalUserId, terminalId || null,
          siNumber, newTotal, newTotal, balancePayment?.method || 'CASH',
          'Exchange (sale leg)', isTrainingMode, exchangeGroupId,
        ]
      );

      await connection.query(
        `INSERT INTO pos_transaction_items (
          id, pos_transaction_id, sale_item_id, product_id, product_name,
          quantity, unit_price, line_total,
          selling_unit_id, selling_unit_name, selling_unit_factor, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          `${salePosTransId}-DETAIL-1`, salePosTransId, saleLegResult.itemId,
          newItem.productId, newItem.productName,
          Number(newItem.quantity), newItem.price, newTotal,
          saleLegResult.unitId, saleLegResult.unitName, saleLegResult.factor,
        ]
      );

      // --- BALANCE SETTLEMENT ---
      if (balance < 0 && customerId) {
        await connection.query(
          'UPDATE customers SET credit_balance = COALESCE(credit_balance, 0) + ?, updated_at = NOW() WHERE id = ?',
          [Math.abs(balance), customerId]
        );
      }

      const [meta]: any = await connection.query(
        `SELECT DATE(transaction_time) AS d, terminal_id AS t FROM pos_transactions WHERE id = ? LIMIT 1`,
        [salePosTransId]
      );

      return {
        exchangeGroupId,
        returnPosTransId,
        salePosTransId,
        mcNumber,
        siNumber,
        balance,
        d: meta?.[0]?.d ? String(meta[0].d) : null,
        t: meta?.[0]?.t ?? 'all',
      };
    });

    if (result.d) {
      saveEJournalFiles(result.d, result.t).catch((e) => console.error('e-journal auto-save failed:', e));
    }

    return NextResponse.json({
      success: true,
      data: {
        exchangeGroupId: result.exchangeGroupId,
        returnPosTransId: result.returnPosTransId,
        salePosTransId: result.salePosTransId,
        mcNumber: result.mcNumber,
        siNumber: result.siNumber,
        balance: result.balance,
      },
    });
  } catch (error: any) {
    console.error('Error processing exchange:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to process exchange' },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 4: Fill in the test's seed setup**

Read `tests/e2e/setup/global-setup.ts` and one existing spec that seeds a sale + product for a return scenario (search for a spec file that posts to `/api/sales/returns` in `tests/e2e/`). Replace the placeholder comment in Step 1's test with real `testQuery` INSERT statements seeding: a product A (with a base selling unit and one `inventory_batches` row), a product B (same), a completed `sales_transactions`/`sale_items` row for product A, and a `shifts` row with `status = 'active'` for `TERMINAL-1`. Use IDs matching what the test asserts against (`SEEDED-PRODUCT-A`, `SEEDED-PRODUCT-B`, `SEEDED-SALE-1`).

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:e2e -- pos-exchange-api`
Expected: PASS.

- [ ] **Step 6: Add and run the oversell-block rollback test**

Add a second test to `tests/e2e/pos-exchange-api.spec.ts`:

```typescript
  test('rolls back entirely when the replacement item has no batch stock and oversell is blocked', async ({ request, page }) => {
    await testQuery("UPDATE pos_settings SET batch_costing_oversell_block = 1");
    // Seed product B with an inventory_batches row of quantity_remaining = 0.

    await seedSession(page, DEFAULT_ADMIN);

    const before: any[] = await testQuery('SELECT stock FROM products WHERE id = ?', ['SEEDED-PRODUCT-A']);
    const refBefore: any[] = await testQuery('SELECT si_number, mc_number FROM transaction_references WHERE id = 1');

    const res = await request.post('/api/sales/exchanges', {
      data: {
        saleId: 'SEEDED-SALE-1',
        returnItem: { productId: 'SEEDED-PRODUCT-A', productName: 'Product A', quantity: 1, price: 50 },
        newItem: { productId: 'SEEDED-PRODUCT-B', productName: 'Product B', quantity: 100, price: 50 },
        userId: DEFAULT_ADMIN.uid,
        terminalId: 'TERMINAL-1',
      },
    });

    expect(res.ok()).toBe(false);
    const body = await res.json();
    expect(body.success).toBe(false);

    const after: any[] = await testQuery('SELECT stock FROM products WHERE id = ?', ['SEEDED-PRODUCT-A']);
    expect(after[0].stock).toBe(before[0].stock); // return leg rolled back too

    const rows: any[] = await testQuery("SELECT * FROM pos_transactions WHERE sale_id = 'SEEDED-SALE-1' AND transaction_type = 'return'");
    expect(rows).toHaveLength(0); // nothing committed

    // getNextSINumber/getNextMCNumber ran on the same connection as the
    // failed transaction, so a rollback must leave the shared counters
    // exactly where they were — a real filed SI/MC sequence must never show
    // a gap for a transaction that never actually happened.
    const refAfter: any[] = await testQuery('SELECT si_number, mc_number FROM transaction_references WHERE id = 1');
    expect(refAfter[0].si_number).toBe(refBefore[0].si_number);
    expect(refAfter[0].mc_number).toBe(refBefore[0].mc_number);
  });
```

Run: `npm run test:e2e -- pos-exchange-api`
Expected: PASS — confirms the "Review Focus" rollback requirement.

- [ ] **Step 7: Add and run the same-product-different-selling-unit test**

Add a third test to `tests/e2e/pos-exchange-api.spec.ts`, seeding a product with two selling units (a base "Piece" at factor 1, and a "Case" at factor 12) and a sale that sold 1 Case of it:

```typescript
  test('exchanging the same product for a different selling unit resolves each leg independently', async ({ request, page }) => {
    // Seed SEEDED-PRODUCT-C with a base "Piece" unit (factor 1) and a "Case"
    // unit (factor 12), stock = 24 (2 cases worth), and a sale_items row
    // recording 1 Case sold against SEEDED-SALE-CASE.

    await seedSession(page, DEFAULT_ADMIN);

    const before: any[] = await testQuery('SELECT stock FROM products WHERE id = ?', ['SEEDED-PRODUCT-C']);

    const res = await request.post('/api/sales/exchanges', {
      data: {
        saleId: 'SEEDED-SALE-CASE',
        returnItem: {
          productId: 'SEEDED-PRODUCT-C', productName: 'Product C', quantity: 1, price: 600,
          sellingUnitId: 'SEEDED-UNIT-CASE', sellingUnitName: 'Case', sellingUnitFactor: 12,
        },
        newItem: {
          productId: 'SEEDED-PRODUCT-C', productName: 'Product C', quantity: 3, price: 50,
          sellingUnitId: 'SEEDED-UNIT-PIECE', sellingUnitName: 'Piece', sellingUnitFactor: 1,
        },
        userId: DEFAULT_ADMIN.uid,
        terminalId: 'TERMINAL-1',
      },
    });

    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.success).toBe(true);
    // Returning 1 Case (12 base units) adds 12 back; selling 3 Piece (3 base
    // units) deducts 3. Net change: +12 - 3 = +9. Each leg must apply its OWN
    // factor — a bug that nets the quantities before converting would instead
    // compute (1 - 3) * some-shared-factor and get this wrong.
    const after: any[] = await testQuery('SELECT stock FROM products WHERE id = ?', ['SEEDED-PRODUCT-C']);
    expect(after[0].stock).toBe(before[0].stock + 9);
  });
```

Run: `npm run test:e2e -- pos-exchange-api`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add app/api/sales/exchanges/route.ts tests/e2e/pos-exchange-api.spec.ts
git commit -m "feat: add POST /api/sales/exchanges route

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: `use-return-sales.ts` state machine — add exchange steps

**Files:**
- Create: `lib/pos/exchange-balance.ts` (the pure balance-calculation logic, extracted so it can be unit-tested without rendering the hook — this codebase has no React hook-rendering test setup: no `@testing-library/react`, no `vitest`, nothing that can call `renderHook`. Existing "hook logic" tests here work by extracting the pure calculation into a plain function and testing THAT — see how `lib/price-level-calc.ts` is tested by `tests/unit/price-level-calc.test.ts` rather than rendering whatever component uses it.)
- Modify: `app/(app)/pos/return-sales/use-return-sales.ts` (imports and calls `lib/pos/exchange-balance.ts`, adds the new step/state/handlers)
- Modify: `app/(app)/pos/return-sales/return-sales-types.ts`
- Modify: `tests/unit/run.ts` (register the new test file)
- Test: `tests/unit/exchange-balance.test.ts` (plain `node:assert/strict`, no DB, no mocks — pure arithmetic)

The interactive step-transition behavior (`handleStartExchange` moving `step` to `'pick_replacement'`, etc.) is NOT separately unit-tested — this codebase verifies POS UI flows exclusively through Playwright E2E (see every `.spec.ts` under `tests/e2e/`), and Task 8 covers this hook's behavior that way. Only the pure, non-React balance math gets a `tests/unit/` test here.

**Interfaces:**
- Consumes: `POST /api/sales/exchanges` (Task 4's contract).
- Produces: new state and handlers consumed by Task 6's UI components:
  ```typescript
  // New step values added to the existing step union:
  type Step = 'loading' | 'auth' | 'input_so' | 'select_items'
    | 'pick_replacement' | 'settle_balance' | 'exchange_success' | 'success';

  // New state exposed by the hook:
  replacementItem: { product: Product; quantity: number; sellingUnitId?: string } | null;
  exchangeBalance: number | null; // newTotal - returnTotal, null until replacement picked
  exchangeResult: { mcNumber: string; siNumber: string | null; balance: number } | null;

  // New handlers:
  handleStartExchange: (item: SaleItem) => void; // called from SelectItemsView with the ONE selected line
  handlePickReplacement: (product: Product, quantity: number, sellingUnitId?: string) => void;
  handleSettleBalance: (payment?: { method: string; amountTendered: number; reference?: string }) => Promise<void>;
  handleBackFromReplacement: () => void;
  ```

- [ ] **Step 1: Write the failing unit test for the pure balance calculation**

Create `tests/unit/exchange-balance.test.ts`:

```typescript
import assert from 'node:assert/strict';
import { calculateExchangeBalance } from '../../lib/pos/exchange-balance';

assert.equal(
  calculateExchangeBalance({ quantity: 1, price: 20 }, { quantity: 1, price: 35 }),
  15,
  'upsell: newTotal - returnTotal is positive'
);
assert.equal(
  calculateExchangeBalance({ quantity: 1, price: 50 }, { quantity: 1, price: 30 }),
  -20,
  'downsell: newTotal - returnTotal is negative'
);
assert.equal(
  calculateExchangeBalance({ quantity: 2, price: 10 }, { quantity: 1, price: 20 }),
  0,
  'even exchange across different quantities/unit prices nets to zero'
);
// Floating-point guard: 0.1 + 0.2 style errors must not leak into the UI as
// a non-zero balance that blocks an otherwise-even exchange.
assert.equal(
  calculateExchangeBalance({ quantity: 3, price: 0.1 }, { quantity: 1, price: 0.3 }),
  0,
  'rounds to the nearest centavo so float drift does not produce a fake balance'
);

console.log('✓ exchange-balance');
```

- [ ] **Step 2: Register the test and run it to verify it fails**

Add `import './exchange-balance.test';` to `tests/unit/run.ts`.

Run: `npm run test:unit`
Expected: FAIL — `Cannot find module '../../lib/pos/exchange-balance'`.

- [ ] **Step 3: Extend `return-sales-types.ts` with the new step/state shapes**

Open `app/(app)/pos/return-sales/return-sales-types.ts` and add (alongside the existing `ReturnSalesDialogProps` interface):

```typescript
export interface ExchangeReplacementItem {
  product: import('@/lib/types').Product;
  quantity: number;
  sellingUnitId?: string;
}

export interface ExchangeResult {
  mcNumber: string;
  siNumber: string | null;
  balance: number;
}
```

- [ ] **Step 3.5: Implement `lib/pos/exchange-balance.ts`**

```typescript
/**
 * The amount owed by (positive) or credited to (negative) the customer when
 * swapping returnItem for newItem. Rounded to the nearest centavo so
 * floating-point drift (e.g. 0.1 + 0.2) never surfaces as a fake non-zero
 * balance that blocks what should be an even exchange.
 */
export function calculateExchangeBalance(
  returnItem: { quantity: number; price: number },
  newItem: { quantity: number; price: number }
): number {
  const returnTotal = returnItem.quantity * returnItem.price;
  const newTotal = newItem.quantity * newItem.price;
  return Math.round((newTotal - returnTotal) * 100) / 100;
}
```

- [ ] **Step 4: Implement the new state and handlers in `use-return-sales.ts`**

Modify the `step` state type at the top of the hook:

```typescript
const [step, setStep] = useState<'loading' | 'auth' | 'input_so' | 'select_items' | 'pick_replacement' | 'settle_balance' | 'exchange_success' | 'success'>('loading');
```

Add new state (near the existing `mcNumber`/`returnedItems` state):

```typescript
  const [exchangeReturnItem, setExchangeReturnItem] = useState<SaleItem | null>(null);
  const [replacementItem, setReplacementItem] = useState<ExchangeReplacementItem | null>(null);
  const [exchangeResult, setExchangeResult] = useState<ExchangeResult | null>(null);

  const exchangeBalance = replacementItem && exchangeReturnItem
    ? calculateExchangeBalance(
        { quantity: exchangeReturnItem.quantity, price: exchangeReturnItem.price },
        { quantity: replacementItem.quantity, price: replacementItem.product.price }
      )
    : null;
```

Add the import for `ExchangeReplacementItem`/`ExchangeResult` types and `calculateExchangeBalance` at the top of the file:

```typescript
import { calculateExchangeBalance } from '@/lib/pos/exchange-balance';
```

Add the new handlers (near `handleReturnItems`):

```typescript
  const handleStartExchange = useCallback((item: SaleItem) => {
    setExchangeReturnItem(item);
    setStep('pick_replacement');
  }, []);

  const handleBackFromReplacement = useCallback(() => {
    setReplacementItem(null);
    setStep('select_items');
  }, []);

  const handlePickReplacement = useCallback((product: any, quantity: number, sellingUnitId?: string) => {
    setReplacementItem({ product, quantity, sellingUnitId });
  }, []);

  const handleSettleBalance = useCallback(async (payment?: { method: string; amountTendered: number; reference?: string }) => {
    if (!selectedSale || !exchangeReturnItem || !replacementItem) return;

    setIsLoading(true);
    try {
      const response = await fetch(getApiUrl('/sales/exchanges'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          saleId: selectedSale.id,
          returnItem: {
            productId: exchangeReturnItem.product.id,
            productName: exchangeReturnItem.product.name,
            quantity: exchangeReturnItem.quantity,
            price: exchangeReturnItem.price,
            sellingUnitId: exchangeReturnItem.sellingUnitId,
            sellingUnitName: exchangeReturnItem.sellingUnitName,
            sellingUnitFactor: exchangeReturnItem.sellingUnitFactor,
          },
          newItem: {
            productId: replacementItem.product.id,
            productName: replacementItem.product.name,
            quantity: replacementItem.quantity,
            price: replacementItem.product.price,
            sellingUnitId: replacementItem.sellingUnitId,
          },
          balancePayment: payment,
          terminalId: terminalId || posSettings?.terminalId,
          userId: currentUser?.uid || currentUser?.id || null,
          shiftId: typeof window !== 'undefined' ? localStorage.getItem('pos_current_shift_id') : null,
          customerId: selectedSale.customer?.id && selectedSale.customer.id !== 'walk-in' ? selectedSale.customer.id : null,
        }),
      });

      const result = await response.json();
      if (result.success) {
        setExchangeResult({
          mcNumber: result.data.mcNumber,
          siNumber: result.data.siNumber,
          balance: result.data.balance,
        });
        setStep('exchange_success');
      } else {
        toast({ title: 'Exchange Failed', description: result.error || 'Failed to process exchange', variant: 'destructive' });
      }
    } catch (err) {
      console.error('Error processing exchange:', err);
      toast({ title: 'Exchange Failed', description: 'Error processing exchange. Please try again.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [selectedSale, exchangeReturnItem, replacementItem, terminalId, posSettings, currentUser, toast]);
```

Reset the new state in the existing `isOpen` effect that already resets `mcNumber`, `returnedItems`, etc.:

```typescript
      setExchangeReturnItem(null);
      setReplacementItem(null);
      setExchangeResult(null);
```

Add the new state and handlers to the hook's return object:

```typescript
    exchangeReturnItem,
    replacementItem,
    exchangeBalance,
    exchangeResult,
    handleStartExchange,
    handleBackFromReplacement,
    handlePickReplacement,
    handleSettleBalance,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:unit`
Expected: PASS — output includes `✓ exchange-balance`.

- [ ] **Step 6: Commit**

```bash
git add lib/pos/exchange-balance.ts app/(app)/pos/return-sales/use-return-sales.ts app/(app)/pos/return-sales/return-sales-types.ts tests/unit/exchange-balance.test.ts tests/unit/run.ts
git commit -m "feat: add exchange state machine steps to useReturnSales

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6: UI components — replacement picker, balance step, success view

**Files:**
- Modify: `app/(app)/pos/return-sales/SelectItemsView.tsx` (add "Exchange for Another Item" button)
- Modify: `app/(app)/pos/return-sales/ReturnSalesDialog.tsx` (wire new steps, render `ProductSearchDialog` for replacement picking, render new balance/success views)
- Create: `app/(app)/pos/return-sales/ExchangeBalanceView.tsx`
- Create: `app/(app)/pos/return-sales/ExchangeSuccessView.tsx`
- Modify: `app/(app)/pos/pos-content/PosDialogs.tsx` (pass `paymentMethods`, `warehouseId`, `activeLevelId` props into `ReturnSalesDialog`)
- Test: manual verification via `npm run electron-dev` (this is a UI wiring task; the state-machine logic is already unit-tested in Task 5, and the full flow gets an E2E test in Task 7) — no new automated test in this task.

**Interfaces:**
- Consumes: `useReturnSales`'s new fields/handlers from Task 5; `ProductSearchDialog` from `app/(app)/pos/product-search/ProductSearchDialog.tsx` (existing `onSelectProduct: (product, explicitUnitId?) => void` callback); `PaymentInputs`-style minimal cash input (built inline in `ExchangeBalanceView.tsx`, NOT the full `PaymentInputs.tsx` component set, since those are designed for split-tender multi-method flows — spec calls for a focused minimal step instead).
- Produces: nothing consumed by later tasks — this is a leaf UI task. Task 7's E2E test drives it through the browser.

- [ ] **Step 1: Add the "Exchange for Another Item" button to `SelectItemsView.tsx`**

In `app/(app)/pos/return-sales/SelectItemsView.tsx`, add a new prop `onExchangeItem: (item: SaleItem) => void` to `SelectItemsViewProps`, and in the footer (next to the existing "Issue Credit" button), add:

```tsx
        <Button
          variant="outline"
          className="border-amber-600 text-amber-700 hover:bg-amber-50"
          disabled={selectedItems.size !== 1}
          title={selectedItems.size !== 1 ? 'Select exactly one item to exchange' : undefined}
          onClick={() => {
            const only = sale.items.find(item => selectedItems.has(item.product.id));
            if (only) {
              onExchangeItem({ ...only, quantity: returnQuantities[only.product.id] || only.quantity });
            }
          }}
        >
          Exchange for Another Item
        </Button>
```

Place this button before the existing "Issue Credit" button in the `SheetFooter`.

- [ ] **Step 2: Create `ExchangeBalanceView.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SheetFooter } from '@/components/ui/sheet';
import { ArrowLeftRight, Loader2 } from 'lucide-react';
import { peso } from './return-sales-utils';

interface ExchangeBalanceViewProps {
  returnItemLabel: string;
  returnTotal: number;
  newItemLabel: string;
  newTotal: number;
  balance: number; // newTotal - returnTotal
  hasCustomer: boolean;
  paymentMethods: { id: string; name: string; isReferenceRequired?: boolean }[];
  isLoading: boolean;
  onConfirm: (payment?: { method: string; amountTendered: number; reference?: string }) => void;
  onBack: () => void;
}

export function ExchangeBalanceView({
  returnItemLabel, returnTotal, newItemLabel, newTotal, balance,
  hasCustomer, paymentMethods, isLoading, onConfirm, onBack,
}: ExchangeBalanceViewProps) {
  const [method, setMethod] = useState(paymentMethods[0]?.name || 'CASH');
  const [amountTendered, setAmountTendered] = useState('');
  const [reference, setReference] = useState('');

  const isEven = Math.abs(balance) < 0.005;
  const isUpsell = balance > 0.005;
  const isDownsell = balance < -0.005;
  const selectedMethod = paymentMethods.find(m => m.name === method);
  const referenceRequired = !!selectedMethod?.isReferenceRequired;

  const tenderedNum = parseFloat(amountTendered) || 0;
  const canConfirm = isEven
    || (isUpsell && tenderedNum >= balance && (!referenceRequired || reference.trim()))
    || (isDownsell && hasCustomer);

  const handleConfirm = () => {
    if (isEven) {
      onConfirm(undefined);
      return;
    }
    if (isUpsell) {
      onConfirm({ method, amountTendered: tenderedNum, reference: reference.trim() || undefined });
      return;
    }
    onConfirm(undefined); // downsell: server credits customer, no payment object needed
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b pb-3">
        <h2 className="text-base font-semibold">Settle Exchange Balance</h2>
      </div>

      <div className="mt-4 space-y-2 text-sm">
        <div className="flex justify-between"><span>Returning: {returnItemLabel}</span><span className="font-mono">{peso(returnTotal)}</span></div>
        <div className="flex justify-between"><span>New item: {newItemLabel}</span><span className="font-mono">{peso(newTotal)}</span></div>
        <div className="border-t pt-2 flex justify-between font-bold">
          <span>{isUpsell ? 'Amount Due' : isDownsell ? 'Credit to Customer' : 'Even Exchange'}</span>
          <span className="font-mono">{peso(Math.abs(balance))}</span>
        </div>
      </div>

      {isUpsell && (
        <div className="mt-5 space-y-3">
          <div className="space-y-1.5">
            <Label>Payment Method</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {paymentMethods.map(m => <SelectItem key={m.id} value={m.name}>{m.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Amount Tendered</Label>
            <Input
              type="text"
              inputMode="decimal"
              value={amountTendered}
              onChange={(e) => { if (/^\d*\.?\d*$/.test(e.target.value)) setAmountTendered(e.target.value); }}
              placeholder={balance.toFixed(2)}
            />
          </div>
          {referenceRequired && (
            <div className="space-y-1.5">
              <Label>Reference Number</Label>
              <Input value={reference} onChange={(e) => setReference(e.target.value)} />
            </div>
          )}
          {tenderedNum > balance && (
            <p className="text-sm text-muted-foreground">Change: {peso(tenderedNum - balance)}</p>
          )}
        </div>
      )}

      {isDownsell && !hasCustomer && (
        <p className="mt-5 text-sm text-destructive">
          This sale has no customer attached, so the difference cannot be credited.
          Cancel and use plain "Issue Credit" instead, or attach a customer to the original sale first.
        </p>
      )}

      <SheetFooter className="mt-auto pt-4">
        <Button variant="outline" onClick={onBack} disabled={isLoading}>Back</Button>
        <Button
          className="bg-amber-600 hover:bg-amber-700 text-white"
          disabled={!canConfirm || isLoading}
          onClick={handleConfirm}
        >
          {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowLeftRight className="mr-2 h-4 w-4" />}
          Confirm Exchange
        </Button>
      </SheetFooter>
    </div>
  );
}
```

- [ ] **Step 3: Create `ExchangeSuccessView.tsx`**

```tsx
'use client';

import { Button } from '@/components/ui/button';
import { SheetFooter } from '@/components/ui/sheet';
import { Printer, CheckCircle2 } from 'lucide-react';
import { peso } from './return-sales-utils';

interface ExchangeSuccessViewProps {
  mcNumber: string;
  siNumber: string | null;
  balance: number;
  onClose: () => void;
  onPrint: () => void;
}

export function ExchangeSuccessView({ mcNumber, siNumber, balance, onClose, onPrint }: ExchangeSuccessViewProps) {
  const isEven = Math.abs(balance) < 0.005;
  const isUpsell = balance > 0.005;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-950">
          <CheckCircle2 className="h-9 w-9 text-green-600" />
        </div>
        <h2 className="mt-4 text-xl font-bold">Exchange Complete</h2>
        <div className="mt-4 space-y-1 text-sm text-muted-foreground">
          <p>MC No.: <span className="font-mono font-medium text-foreground">{mcNumber}</span></p>
          {siNumber && <p>SI No.: <span className="font-mono font-medium text-foreground">{siNumber}</span></p>}
        </div>
        {!isEven && (
          <p className="mt-3 text-sm">
            {isUpsell ? 'Payment Collected: ' : 'Credited to Customer: '}
            <span className="font-mono font-bold">{peso(Math.abs(balance))}</span>
          </p>
        )}
      </div>
      <SheetFooter className="shrink-0 flex-col gap-2 sm:flex-row">
        <Button className="w-full sm:w-auto" variant="outline" onClick={onPrint}>
          <Printer className="mr-2 h-4 w-4" />
          Print Exchange Slip
        </Button>
        <Button className="w-full sm:w-auto" onClick={onClose}>Close</Button>
      </SheetFooter>
    </div>
  );
}
```

- [ ] **Step 4: Wire the new steps into `ReturnSalesDialog.tsx`**

Add imports:
```typescript
import { ExchangeBalanceView } from './ExchangeBalanceView';
import { ExchangeSuccessView } from './ExchangeSuccessView';
import { ProductSearchDialog } from '../product-search/ProductSearchDialog';
```

Destructure the new hook fields/handlers (add to the existing `useReturnSales(...)` destructuring):
```typescript
    exchangeReturnItem,
    replacementItem,
    exchangeBalance,
    exchangeResult,
    handleStartExchange,
    handleBackFromReplacement,
    handlePickReplacement,
    handleSettleBalance,
```

Add new props to `ReturnSalesDialogProps` (in `return-sales-types.ts`): `paymentMethods: { id: string; name: string; isReferenceRequired?: boolean }[]`, `warehouseId?: string`, `activeLevelId?: string`. Thread these into `ReturnSalesDialog`'s function signature.

Expand the `Sheet`'s `open` condition to include the new steps:
```typescript
      <Sheet open={isOpen && (step === 'input_so' || step === 'select_items' || step === 'settle_balance' || step === 'exchange_success' || step === 'success')} onOpenChange={onOpenChange}>
```

Add the new step branches inside the `SheetContent`, before the existing `step === 'select_items'` branch:
```tsx
          {step === 'exchange_success' && exchangeResult ? (
            <ExchangeSuccessView
              mcNumber={exchangeResult.mcNumber}
              siNumber={exchangeResult.siNumber}
              balance={exchangeResult.balance}
              onClose={handleCloseSuccess}
              onPrint={() => { /* Task 7 wires real printing */ }}
            />
          ) : step === 'settle_balance' && exchangeReturnItem && replacementItem ? (
            <ExchangeBalanceView
              returnItemLabel={exchangeReturnItem.product.name}
              returnTotal={exchangeReturnItem.price * exchangeReturnItem.quantity}
              newItemLabel={replacementItem.product.name}
              newTotal={replacementItem.product.price * replacementItem.quantity}
              balance={exchangeBalance ?? 0}
              hasCustomer={!!(selectedSale?.customer?.id && selectedSale.customer.id !== 'walk-in')}
              paymentMethods={paymentMethods}
              isLoading={isLoading}
              onConfirm={handleSettleBalance}
              onBack={() => setStep('pick_replacement' as any)}
            />
          ) : step === 'select_items' && selectedSale ? (
```

(The existing `step === 'select_items'` branch's `SelectItemsView` needs the new `onExchangeItem={handleStartExchange}` prop added to it.)

After picking a replacement (`step === 'pick_replacement'`), the dialog should open `ProductSearchDialog` and, once a product is chosen, immediately call `handlePickReplacement` and transition to `settle_balance`. Add this near the bottom of the component alongside the existing hidden `CreditSlipView`:

```tsx
      <ProductSearchDialog
        isOpen={isOpen && step === 'pick_replacement'}
        onOpenChange={(open) => { if (!open) handleBackFromReplacement(); }}
        onSelectProduct={(product) => {
          handlePickReplacement(product, 1);
          setStep('settle_balance' as any);
        }}
        warehouseId={warehouseId}
        activeLevelId={activeLevelId}
      />
```

- [ ] **Step 5: Pass the new props from `PosDialogs.tsx`**

In `app/(app)/pos/pos-content/PosDialogs.tsx`, update the `<ReturnSalesDialog>` usage:

```tsx
      <ReturnSalesDialog
        isOpen={pos.isReturnSalesOpen}
        onOpenChange={pos.setIsReturnSalesOpen}
        currentUser={pos.currentUser}
        terminalId={pos.selectedTerminalId}
        printMode={pos.businessSettings?.printMode || 'browser'}
        paymentMethods={pos.paymentMethods}
        warehouseId={pos.inventoryLocation}
        activeLevelId={pos.activeLevelId}
      />
```

- [ ] **Step 6: Manual smoke test**

Run: `npm run electron-dev` (or `npm run dev` if a browser session is sufficient for this check)
Steps: Open POS → Merchandise Credit → pick a past sale → select exactly one item → click "Exchange for Another Item" → pick a different product in the search dialog → observe the balance screen shows correct totals → for an even exchange, confirm and see the success screen with both MC and SI numbers.
Expected: No console errors; the flow reaches `exchange_success` and both numbers render.

- [ ] **Step 7: Commit**

```bash
git add app/(app)/pos/return-sales/SelectItemsView.tsx app/(app)/pos/return-sales/ReturnSalesDialog.tsx app/(app)/pos/return-sales/ExchangeBalanceView.tsx app/(app)/pos/return-sales/ExchangeSuccessView.tsx app/(app)/pos/return-sales/return-sales-types.ts app/(app)/pos/pos-content/PosDialogs.tsx
git commit -m "feat: wire exchange UI flow into Merchandise Credit dialog

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 7: Exchange Slip printing

**Files:**
- Create: `lib/exchange-slip-generator.ts`
- Modify: `app/(app)/pos/return-sales/use-return-sales.ts` (add `handlePrintExchangeSlip`)
- Modify: `app/(app)/pos/return-sales/ReturnSalesDialog.tsx` (wire the print button, add a hidden browser-print view)
- Modify: `tests/unit/run.ts` (register the new test file)
- Test: `tests/unit/exchange-slip-generator.test.ts`

**Interfaces:**
- Consumes: `formatSINumber` from `lib/si-number.ts`, same `SystemSettings` type `CreditSlipGenerator` uses.
- Produces: `ExchangeSlipGenerator.generate(data: ExchangeSlipData): Uint8Array`, consumed by `use-return-sales.ts`'s new `handlePrintExchangeSlip`.

- [ ] **Step 1: Write the failing unit test**

Create `tests/unit/exchange-slip-generator.test.ts`, following the decode-and-assert-on-printed-text convention from `tests/unit/receipt-si-number.test.ts` — plain `node:assert/strict`, no test framework, decode the ESC/POS bytes with `latin1` and assert on the substrings that must appear:

```typescript
import assert from 'node:assert/strict';
import { ExchangeSlipGenerator } from '../../lib/exchange-slip-generator';

const decode = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1');

const gen = new ExchangeSlipGenerator();

// ─── both SI and MC numbers print, plus a payment-collected balance line ──
const upsell = decode(gen.generate({
  mcNumber: 'MC-000123',
  siNumber: '000456',
  date: new Date('2026-09-24T10:00:00Z').toISOString(),
  cashierName: 'Juan Dela Cruz',
  customerName: 'Walk-in Customer',
  returnedItem: { name: 'Old Widget', quantity: 1, price: 50, total: 50 },
  newItem: { name: 'New Widget', quantity: 1, price: 65, total: 65 },
  balance: 15,
  businessSettings: { businessName: 'Verdix Store', address: '123 Main St' } as any,
}));

assert.ok(upsell.includes('MC NO.: MC-000123'), 'prints the MC number');
assert.ok(upsell.includes('SI NO.:'), 'prints an SI NO. line when siNumber is present');
assert.ok(upsell.includes('Old Widget'), 'prints the returned item name');
assert.ok(upsell.includes('New Widget'), 'prints the new item name');
assert.ok(upsell.includes('PAYMENT COLLECTED'), 'labels a positive balance as collected, not credited');
assert.ok(upsell.includes('15.00'), 'prints the balance amount');

// ─── even exchange omits the balance line and its label entirely ─────────
const even = decode(gen.generate({
  mcNumber: 'MC-000124',
  siNumber: '000457',
  date: new Date().toISOString(),
  cashierName: 'Juan',
  customerName: 'Walk-in Customer',
  returnedItem: { name: 'Old Widget', quantity: 1, price: 50, total: 50 },
  newItem: { name: 'New Widget', quantity: 1, price: 50, total: 50 },
  balance: 0,
  businessSettings: null,
}));

assert.ok(!even.includes('PAYMENT COLLECTED'), 'even exchange has no payment-collected line');
assert.ok(!even.includes('CREDIT TO ACCOUNT'), 'even exchange has no credit-to-account line');

// ─── downsell labels the balance as a credit, not a collection ───────────
const downsell = decode(gen.generate({
  mcNumber: 'MC-000125',
  siNumber: '000458',
  date: new Date().toISOString(),
  cashierName: 'Juan',
  customerName: 'Maria Santos',
  returnedItem: { name: 'Expensive Widget', quantity: 1, price: 80, total: 80 },
  newItem: { name: 'Cheap Widget', quantity: 1, price: 60, total: 60 },
  balance: -20,
  businessSettings: null,
}));

assert.ok(downsell.includes('CREDIT TO ACCOUNT'), 'labels a negative balance as credited, not collected');
assert.ok(!downsell.includes('PAYMENT COLLECTED'));

console.log('✓ exchange-slip-generator');
```

- [ ] **Step 2: Register the test and run it to verify it fails**

Add `import './exchange-slip-generator.test';` to `tests/unit/run.ts`.

Run: `npm run test:unit`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/exchange-slip-generator.ts`**

Base this directly on `lib/credit-slip-generator.ts`'s structure (same encoder setup, same header/footer conventions, same `getLayout`/`fmt`/`wrap`/`row` helpers — copy those private helpers verbatim since they're layout utilities, not return-specific logic), replacing the single-item-list body with two labeled sections and a conditional balance line:

```typescript
import ReceiptPrinterEncoder from '@point-of-sale/receipt-printer-encoder';
import { format } from 'date-fns';
import { SystemSettings } from './types';
import { formatSINumber } from './si-number';

export interface ExchangeSlipData {
  mcNumber: string;
  siNumber: string | null;
  date: string;
  cashierName: string;
  customerName: string;
  returnedItem: { name: string; quantity: number; price: number; total: number };
  newItem: { name: string; quantity: number; price: number; total: number };
  balance: number; // newItem.total - returnedItem.total
  businessSettings?: SystemSettings | null;
}

export class ExchangeSlipGenerator {
  private encoder: any;

  private getLayout(settings?: SystemSettings | null) {
    const paperSize = settings?.paperSize || '58mm';
    return paperSize === '80mm' ? { COLS: 48 } : { COLS: 32 };
  }

  public generate(data: ExchangeSlipData): Uint8Array {
    const settings = data.businessSettings;
    const { COLS } = this.getLayout(settings);

    this.encoder = new ReceiptPrinterEncoder({ language: 'esc-pos', codepageMapping: 'epson', width: COLS });
    const enc = this.encoder.initialize().codepage('cp437');

    const bizName = settings?.businessName?.trim() || 'verdix';
    const address = settings?.address?.trim() || 'General Merchandise';

    enc.raw([0x1b, 0x61, 0x31]);
    enc.line(bizName);
    enc.line(address);
    if (settings?.contactNumber) enc.line(settings.contactNumber);
    if (settings?.tin) enc.line(`VAT REG TIN: ${settings.tin}`);
    enc.line(format(new Date(data.date), 'PP p'));
    enc.raw([0x1b, 0x61, 0x30]);
    enc.newline();

    enc.raw([0x1b, 0x61, 0x31]).line('EXCHANGE SLIP').raw([0x1b, 0x61, 0x30]);
    if (data.siNumber) enc.line(`SI NO.: ${formatSINumber(data.siNumber)}`);
    enc.line(`MC NO.: ${data.mcNumber}`);
    enc.line(`Cust: ${data.customerName}`);
    enc.line(`Cashier: ${data.cashierName}`);
    enc.line('-'.repeat(COLS));

    enc.bold(true).line('RETURNED').bold(false);
    enc.line(`${data.returnedItem.quantity} x ${data.returnedItem.name}`);
    enc.line(`@ ${data.returnedItem.price.toFixed(2)}  = ${data.returnedItem.total.toFixed(2)}`);
    enc.newline();

    enc.bold(true).line('NEW ITEM').bold(false);
    enc.line(`${data.newItem.quantity} x ${data.newItem.name}`);
    enc.line(`@ ${data.newItem.price.toFixed(2)}  = ${data.newItem.total.toFixed(2)}`);
    enc.line('-'.repeat(COLS));

    if (Math.abs(data.balance) >= 0.005) {
      const label = data.balance > 0 ? 'PAYMENT COLLECTED:' : 'CREDIT TO ACCOUNT:';
      enc.bold(true).line(`${label} ${Math.abs(data.balance).toFixed(2)}`).bold(false);
      enc.line('-'.repeat(COLS));
    }

    enc.newline();
    enc.align('center');
    enc.line('Exchange Transaction Record');
    enc.line('Printed: ' + format(new Date(), 'MM/dd/yy h:mm a'));
    enc.newline().newline().newline();
    enc.cut();

    return enc.encode();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit`
Expected: PASS — output includes `✓ exchange-slip-generator`.

- [ ] **Step 5: Wire printing into `use-return-sales.ts` and `ReturnSalesDialog.tsx`**

In `use-return-sales.ts`, add a `handlePrintExchangeSlip` callback modeled directly on the existing `handlePrintCredit` (same `printMode === 'browser'` branch using `useReactToPrint`, same ESC/POS `usePrinter`/`print()` branch otherwise), but constructing `ExchangeSlipData` from `exchangeReturnItem`, `replacementItem`, and `exchangeResult` instead of `CreditSlipData`. Export it from the hook's return object.

In `ReturnSalesDialog.tsx`, wire the `onPrint` prop of `ExchangeSuccessView` (currently a no-op placeholder from Task 6 Step 4) to call `handlePrintExchangeSlip`, and add a hidden `ExchangeSlipView`-equivalent print target the same way the existing hidden `CreditSlipView` is rendered at the bottom of the component (for the browser print path). If a dedicated print-preview component is needed for `useReactToPrint`'s `contentRef`, create `app/(app)/pos/return-sales/ExchangeSlipView.tsx` mirroring `app/(app)/pos/credit-slip/CreditSlipView.tsx`'s structure (read that file first to match its exact forwardRef/props pattern) rendering the same fields `ExchangeSlipData` carries.

- [ ] **Step 6: Manual smoke test**

Run: `npm run electron-dev`
Steps: Repeat Task 6 Step 6's flow through to `exchange_success`, click "Print Exchange Slip" with `printMode: 'browser'`.
Expected: Browser print dialog opens showing both SI and MC numbers, both items, and the balance line (or no balance line for an even exchange).

- [ ] **Step 7: Commit**

```bash
git add lib/exchange-slip-generator.ts app/(app)/pos/return-sales/use-return-sales.ts app/(app)/pos/return-sales/ReturnSalesDialog.tsx app/(app)/pos/return-sales/ExchangeSlipView.tsx tests/unit/exchange-slip-generator.test.ts tests/unit/run.ts
git commit -m "feat: add Exchange Slip printing

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 8: End-to-end Playwright coverage for the full UI flow

**Files:**
- Create: `tests/e2e/pos-exchange.spec.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–7. This is the final integration checkpoint — no new production code, only tests.

- [ ] **Step 1: Write the E2E test covering the Review Focus scenarios**

Read `tests/e2e/setup/global-setup.ts` and an existing full-flow POS spec (e.g. one that drives a checkout through the UI, not just the API) to match this codebase's conventions for logging into POS, starting a shift, and navigating the return-sales dialog through the UI (not direct API calls, since Task 4 already covered the API layer directly).

```typescript
import { test, expect } from '@playwright/test';
import { testQuery, resetPosState } from './helpers/db';
import { seedSession, DEFAULT_ADMIN } from './helpers/auth';

test.describe('POS Exchange Item — full UI flow', () => {
  test.beforeEach(async () => {
    await resetPosState();
    // Seed products, a completed sale, an active shift — same seed shape as
    // tests/e2e/pos-exchange-api.spec.ts's beforeEach, reused here so both
    // suites exercise the identical starting state.
  });

  test('even exchange completes through the UI and shows both numbers on the success screen', async ({ page }) => {
    await seedSession(page, DEFAULT_ADMIN);
    await page.goto('/pos');

    // Open Merchandise Credit, search the seeded sale, select it.
    await page.getByRole('button', { name: /merchandise credit/i }).click();
    await page.getByPlaceholder(/search/i).fill('SEEDED-SALE-1');
    await page.getByText('SEEDED-SALE-1').click();

    // Select exactly one item, click Exchange.
    await page.getByRole('checkbox').first().check();
    await page.getByRole('button', { name: /exchange for another item/i }).click();

    // Pick the replacement product in the search dialog.
    await page.getByPlaceholder(/search/i).last().fill('Product B');
    await page.getByText('Product B').click();

    // Even exchange: confirm directly.
    await page.getByRole('button', { name: /confirm exchange/i }).click();

    await expect(page.getByText(/exchange complete/i)).toBeVisible();
    await expect(page.getByText(/MC No\./i)).toBeVisible();
    await expect(page.getByText(/SI No\./i)).toBeVisible();
  });

  test('downsell exchange on a walk-in sale is blocked in the UI', async ({ page }) => {
    // Seed a sale with customer_id = NULL (walk-in).
    await seedSession(page, DEFAULT_ADMIN);
    await page.goto('/pos');

    await page.getByRole('button', { name: /merchandise credit/i }).click();
    await page.getByPlaceholder(/search/i).fill('SEEDED-SALE-WALKIN');
    await page.getByText('SEEDED-SALE-WALKIN').click();
    await page.getByRole('checkbox').first().check();
    await page.getByRole('button', { name: /exchange for another item/i }).click();

    // Pick a CHEAPER replacement.
    await page.getByPlaceholder(/search/i).last().fill('Cheap Product');
    await page.getByText('Cheap Product').click();

    await expect(page.getByText(/no customer attached/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /confirm exchange/i })).toBeDisabled();
  });

  test('a fully-returned line cannot be selected for exchange again', async ({ page }) => {
    // Seed a sale where one line has already been fully returned via the
    // plain return flow (sale_items has a matching negative row already).
    // This reuses SelectItemsView's existing fullyReturned/remaining
    // bookkeeping unchanged — the exchange feature adds no new logic here,
    // it only must not have broken the existing guard.
    await seedSession(page, DEFAULT_ADMIN);
    await page.goto('/pos');

    await page.getByRole('button', { name: /merchandise credit/i }).click();
    await page.getByPlaceholder(/search/i).fill('SEEDED-SALE-FULLY-RETURNED');
    await page.getByText('SEEDED-SALE-FULLY-RETURNED').click();

    await expect(page.getByText(/fully returned/i)).toBeVisible();
    await expect(page.getByRole('checkbox').first()).toBeDisabled();
    // With nothing selectable, Exchange must stay disabled too — it is
    // gated on selectedItems.size === 1, same as Issue Credit.
    await expect(page.getByRole('button', { name: /exchange for another item/i })).toBeDisabled();
  });

  test('X-reading total includes both legs of a committed exchange', async ({ page, request }) => {
    // Run the even-exchange flow via the API (Task 4's route) to seed a
    // committed exchange, then hit the X-reading endpoint and assert its
    // totals reflect both the return and the sale — confirming no report
    // code needed to change for this feature.
    await seedSession(page, DEFAULT_ADMIN);

    // (call POST /api/sales/exchanges via `request.post`, matching Task 4's test)

    const xReadingRes = await request.get('/api/sales/x-reading?terminalId=TERMINAL-1');
    const xReadingBody = await xReadingRes.json();
    expect(xReadingBody.success).toBe(true);
    // Assert the return and sale totals both appear in the expected fields —
    // read app/api/sales/x-reading/route.ts's response shape first to know
    // the exact field names to assert against.
  });
});
```

- [ ] **Step 2: Fill in seed data and exact selectors by running the test interactively**

Run: `npm run test:e2e:ui -- pos-exchange`
Use Playwright's UI mode to iterate on the exact `getByRole`/`getByPlaceholder`/`getByText` selectors against the real rendered DOM (the ones sketched above are best-guess based on sibling components read earlier in this plan — e.g. `TransactionSearchBar`'s actual placeholder text, `SelectItemsView`'s actual checkbox structure — and must be corrected against the live page).

- [ ] **Step 3: Run the full suite to verify it passes and nothing else broke**

Run: `npm run test:e2e`
Expected: All tests PASS, including the pre-existing suite (workers: 1, so this also re-confirms no cross-test DB pollution was introduced by the new seeds).

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/pos-exchange.spec.ts
git commit -m "test: add full-flow E2E coverage for POS Exchange Item

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Post-plan verification

After Task 8, run the project's standard verification gate before considering this feature complete:

- `npm run typecheck`
- `npm run lint`
- `npm run test:unit`
- `npm run test:e2e`

Per the project's `verification-baseline-is-red` memory, some lint/typecheck failures may be pre-existing — compare against a clean run on `main` before attributing any failure to this feature's changes.
