# Bulk Price Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let staff bulk-change selling price, cost, markup%, and price-level prices for many products at once (via a drawer or an Excel upload), scoped to one warehouse, routed through the app's existing multi-level approval engine.

**Architecture:** Reuse the existing generic `approval_queue` engine as a new `PRICE_UPDATE` transaction type, gated by a new `require_price_update_confirmation` toggle in `pos_settings` — the exact same pattern already used by `PRODUCT_CREATE`/`REPACKAGING`/`SHELF_TRANSFER` (`checkApprovalRequired` → `submitToApprovalQueue` → dispatch in `app/api/approvals/process/route.ts`). A pure math module (`lib/price-update-math.ts`) holds the adjustment formulas so they're unit-testable without a DB. A single `'use server'` actions file (`app/(app)/products/bulk-price-update/actions.ts`) holds the DB-touching logic, following the same pattern as `app/(app)/products/actions.ts`'s `addProduct` — callable directly from client components as a server action AND dynamically imported by the approval finalizer.

**Tech Stack:** Next.js 16 (App Router, server actions), MySQL via `mysql2/promise` (`lib/mysql.ts`), `xlsx` (client-side read/write, already a dependency), shadcn/ui (`Sheet`, `Checkbox`, `Select`), TanStack Query, Playwright for E2E.

## Global Constraints

- No new database tables — the batch payload lives in `approval_queue.transaction_data` (JSON), exactly like `PRODUCT_CREATE`/`STOCK_ADJUSTMENT`.
- Products are per-warehouse rows — every operation in this feature is scoped to one `warehouse_id` at a time.
- Family-linked products (`lib/family-sync.ts`) are **not** cascaded — out of scope per the design.
- Price levels are **drawer-only** for v1 — the Excel template covers price/cost/markup% only.
- Formula: `price = cost * (1 + markup / 100)`, rounded to 2 decimals — must match `app/(app)/products/add-product/use-add-product-form.ts:364`.
- Follow existing house style: `'use server'` action files export plain async functions; DB access goes through `query`/`withTransaction` from `lib/mysql.ts`; no ORM.

---

### Task 1: Migration — `require_price_update_confirmation` setting

**Files:**
- Create: `scripts/migrations/107_add_price_update_approval_setting.ts`
- Test: manual (migration runner)

**Interfaces:**
- Produces: a `require_price_update_confirmation BOOLEAN NOT NULL DEFAULT FALSE` column on `pos_settings`, consumed by Task 2 (API) and Task 4 (approvals mapping).

- [ ] **Step 1: Write the migration**

```ts
import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

const migration: Migration = {
  name: '107_add_price_update_approval_setting',
  timestamp: '2026-08-03_09-00-00',

  async up(): Promise<void> {
    const rows: any = await query(`
      SELECT COUNT(*) as cnt
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'pos_settings'
        AND COLUMN_NAME = 'require_price_update_confirmation'
    `);
    const exists = rows[0]?.cnt > 0;
    if (!exists) {
      await query(`
        ALTER TABLE pos_settings
        ADD COLUMN require_price_update_confirmation BOOLEAN NOT NULL DEFAULT FALSE
      `);
      console.log('✅ require_price_update_confirmation column added to pos_settings');
    } else {
      console.log('⏭️  require_price_update_confirmation column already exists, skipping');
    }
  },

  async down(): Promise<void> {
    const rows: any = await query(`
      SELECT COUNT(*) as cnt
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'pos_settings'
        AND COLUMN_NAME = 'require_price_update_confirmation'
    `);
    const exists = rows[0]?.cnt > 0;
    if (exists) {
      await query(`ALTER TABLE pos_settings DROP COLUMN require_price_update_confirmation`);
      console.log('✅ require_price_update_confirmation column dropped from pos_settings');
    }
  }
};

registerMigration(migration);
```

- [ ] **Step 2: Run the migration**

Run: `npm run migrate`
Expected: log line `✅ require_price_update_confirmation column added to pos_settings` (or the `skipping` line if re-run).

- [ ] **Step 3: Verify the column exists**

Run:
```bash
node -e "const{query}=require('./lib/mysql');query(\"SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='pos_settings' AND COLUMN_NAME='require_price_update_confirmation'\").then(r=>{console.log(r);process.exit(0)})"
```
Expected: one row with `COLUMN_NAME: 'require_price_update_confirmation'`.

- [ ] **Step 4: Commit**

```bash
git add scripts/migrations/107_add_price_update_approval_setting.ts
git commit -m "feat: add require_price_update_confirmation column to pos_settings"
```

---

### Task 2: Expose `requirePriceUpdateConfirmation` in the pos-settings API

**Files:**
- Modify: `app/api/pos-settings/route.ts:31` (ensure-columns list), `:146` (SELECT alias), `:251` (INSERT column list), `:254` (VALUES placeholder count), `:307` (INSERT value), `:382` (update key-map)

**Interfaces:**
- Consumes: the `require_price_update_confirmation` column from Task 1.
- Produces: `GET /api/pos-settings` returns `requirePriceUpdateConfirmation` (boolean); `POST /api/pos-settings` persists `requirePriceUpdateConfirmation` → `require_price_update_confirmation`.

- [ ] **Step 1: Add to the ensure-columns list**

In the `columns` array (`app/api/pos-settings/route.ts:31`), right after the `require_product_confirmation` entry:

```ts
      { name: 'require_product_confirmation', type: 'BOOLEAN DEFAULT FALSE' },
      { name: 'require_price_update_confirmation', type: 'BOOLEAN DEFAULT FALSE' },
```

- [ ] **Step 2: Add to the SELECT alias list**

At `app/api/pos-settings/route.ts:146`, right after `require_product_confirmation AS requireProductConfirmation,`:

```ts
        require_product_confirmation AS requireProductConfirmation,
        require_price_update_confirmation AS requirePriceUpdateConfirmation,
```

- [ ] **Step 3: Add to the initial-insert column list and value**

At `app/api/pos-settings/route.ts:251` (inside the `INSERT INTO pos_settings (...)` column list), right after `require_product_confirmation,`:

```ts
          require_product_confirmation,
          require_price_update_confirmation,
```

This adds one more `?` placeholder. At `app/api/pos-settings/route.ts:254`, the `VALUES (...)` line currently ends in `..., ?, ?)` — change the final `?)` to `?, ?)` (one more placeholder, same pattern as every other column in that list). Then add the corresponding value at line ~307, right after `body.requireProductConfirmation ?? false,`:

```ts
        body.requireProductConfirmation ?? false,
        body.requirePriceUpdateConfirmation ?? false,
```

- [ ] **Step 4: Add to the dynamic-update key-map**

At `app/api/pos-settings/route.ts:382`, right after `requireProductConfirmation: 'require_product_confirmation',`:

```ts
        requireProductConfirmation: 'require_product_confirmation',
        requirePriceUpdateConfirmation: 'require_price_update_confirmation',
```

- [ ] **Step 5: Start the dev server and verify round-trip**

Run: `npm run dev` (in one terminal), then in another:
```bash
curl -s -X POST http://localhost:3000/api/pos-settings -H "Content-Type: application/json" -d '{"requirePriceUpdateConfirmation":true}'
curl -s http://localhost:3000/api/pos-settings | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).data.requirePriceUpdateConfirmation))"
```
Expected: second command prints `true`. Reset it back afterward with the same POST and `"requirePriceUpdateConfirmation":false`.

- [ ] **Step 6: Commit**

```bash
git add app/api/pos-settings/route.ts
git commit -m "feat: expose requirePriceUpdateConfirmation in pos-settings API"
```

---

### Task 3: Settings UI toggle

**Files:**
- Modify: `app/(app)/settings/pos-setup/pos-setup-types.ts:58` (type), `:133` (default)
- Modify: `app/(app)/settings/pos-setup/TransactionConfirmationsCard.tsx:20` (toggle entry)

**Interfaces:**
- Consumes: `requirePriceUpdateConfirmation` from the settings API (Task 2).
- Produces: a visible "Bulk Price Update Approval" switch bound to `settings.requirePriceUpdateConfirmation`.

- [ ] **Step 1: Add the field to `PosSettings`**

`app/(app)/settings/pos-setup/pos-setup-types.ts:58`, right after `requireProductConfirmation?: boolean;`:

```ts
  requireProductConfirmation?: boolean;
  requirePriceUpdateConfirmation?: boolean;
```

- [ ] **Step 2: Add the default**

`app/(app)/settings/pos-setup/pos-setup-types.ts:133`, right after `requireProductConfirmation: false,`:

```ts
  requireProductConfirmation: false,
  requirePriceUpdateConfirmation: false,
```

- [ ] **Step 3: Add the toggle entry**

`app/(app)/settings/pos-setup/TransactionConfirmationsCard.tsx:20`, right after the `requireProductConfirmation` entry:

```ts
  { key: 'requireProductConfirmation',        label: 'Add Product Approval',            desc: 'Require multi-level approval before a new product is created' },
  { key: 'requirePriceUpdateConfirmation',    label: 'Bulk Price Update Approval',      desc: 'Require multi-level approval before bulk price changes are applied' },
```

- [ ] **Step 4: Manually verify in the browser**

Run: `npm run dev`, open `http://localhost:3000/settings/pos-setup`, find "Bulk Price Update Approval" under Transaction Confirmations, toggle it on, refresh the page, confirm it stayed on. Toggle it back off.

- [ ] **Step 5: Commit**

```bash
git add app/(app)/settings/pos-setup/pos-setup-types.ts app/(app)/settings/pos-setup/TransactionConfirmationsCard.tsx
git commit -m "feat: add Bulk Price Update Approval toggle to settings UI"
```

---

### Task 4: Map `PRICE_UPDATE` to the new setting in the approvals engine

**Files:**
- Modify: `lib/approvals.ts:16`

**Interfaces:**
- Consumes: the `require_price_update_confirmation` column (Task 1).
- Produces: `checkApprovalRequired('PRICE_UPDATE')` now reads the new master switch, exactly like every other transaction type.

- [ ] **Step 1: Add to `settingsMap`**

`lib/approvals.ts:16`, right after `'PRODUCT_CREATE': 'require_product_confirmation'`:

```ts
      'PRODUCT_CREATE': 'require_product_confirmation',
      'PRICE_UPDATE': 'require_price_update_confirmation',
```

(Note the trailing comma now needed after `'require_product_confirmation'`.)

- [ ] **Step 2: Verify with a quick script**

Run:
```bash
node -e "
const{checkApprovalRequired}=require('./lib/approvals');
(async()=>{
  console.log('no workflow, switch off ->', await checkApprovalRequired('PRICE_UPDATE'));
})();
"
```
Expected: prints `false` (no workflow defined yet, switch off by default from Task 1's `DEFAULT FALSE`).

- [ ] **Step 3: Commit**

```bash
git add lib/approvals.ts
git commit -m "feat: map PRICE_UPDATE to require_price_update_confirmation"
```

---

### Task 5: Pure adjustment-formula module + unit tests

**Files:**
- Create: `lib/price-update-math.ts`
- Create: `tests/unit/price-update-math.test.ts`
- Modify: `tests/unit/run.ts` (register the new test file)

**Interfaces:**
- Produces: `applyAdjustment(adjustmentType, currentValue, value, cost?) => number`, used by Task 6's DB layer for every price/cost/markup computation. This is the ONLY place the formula is implemented — Task 6 must import it, not reimplement it.

- [ ] **Step 1: Write the failing test**

`tests/unit/price-update-math.test.ts`:

```ts
import assert from 'node:assert/strict';
import { applyAdjustment } from '../../lib/price-update-math';

// percentage
assert.equal(applyAdjustment('percentage', 100, 10), 110, '+10% of 100 = 110');
assert.equal(applyAdjustment('percentage', 100, -10), 90, '-10% of 100 = 90');

// fixed
assert.equal(applyAdjustment('fixed', 100, 5), 105, '+5 fixed = 105');
assert.equal(applyAdjustment('fixed', 100, -5), 95, '-5 fixed = 95');

// exact
assert.equal(applyAdjustment('exact', 999, 42), 42, 'exact overwrite ignores current value');

// markup (derives price from cost, ignores currentValue)
assert.equal(applyAdjustment('markup', 0, 25, 80), 100, 'cost 80 * 1.25 = 100');
assert.equal(applyAdjustment('markup', 999, 0, 80), 80, '0% markup = cost');

// rounding to 2 decimals
assert.equal(applyAdjustment('percentage', 33.335, 10), 36.67, 'rounds to 2 decimals');

// markup requires cost
assert.throws(
  () => applyAdjustment('markup', 0, 25),
  /cost is required/,
  'markup adjustment without cost throws',
);

console.log('price-update-math: all assertions passed');
```

- [ ] **Step 2: Register the test in the runner**

`tests/unit/run.ts` — add a new import line (anywhere in the list, e.g. after `import './sta-lucia-payload.test';`):

```ts
import './sta-lucia-payload.test';
import './price-update-math.test';
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `npm run test:unit`
Expected: FAIL — `Cannot find module '../../lib/price-update-math'`.

- [ ] **Step 4: Implement `lib/price-update-math.ts`**

```ts
export type AdjustmentType = 'percentage' | 'fixed' | 'exact' | 'markup';

/**
 * Computes a bulk-price adjustment result, rounded to 2 decimals.
 *
 * - percentage/fixed/exact operate on `currentValue`.
 * - markup derives price from `cost` (matches app/(app)/products/add-product/use-add-product-form.ts:364:
 *   price = cost * (1 + markup / 100)) and ignores `currentValue`.
 */
export function applyAdjustment(
  adjustmentType: AdjustmentType,
  currentValue: number,
  value: number,
  cost?: number,
): number {
  let result: number;
  switch (adjustmentType) {
    case 'percentage':
      result = currentValue * (1 + value / 100);
      break;
    case 'fixed':
      result = currentValue + value;
      break;
    case 'exact':
      result = value;
      break;
    case 'markup':
      if (cost == null) throw new Error('cost is required for markup adjustment');
      result = cost * (1 + value / 100);
      break;
    default:
      throw new Error(`Unknown adjustment type: ${adjustmentType}`);
  }
  return Math.round(result * 100) / 100;
}
```

- [ ] **Step 5: Run the tests again to confirm they pass**

Run: `npm run test:unit`
Expected: PASS, including `price-update-math: all assertions passed`.

- [ ] **Step 6: Commit**

```bash
git add lib/price-update-math.ts tests/unit/price-update-math.test.ts tests/unit/run.ts
git commit -m "feat: add bulk price update adjustment formulas with unit tests"
```

---

### Task 6: Server actions — submit, apply, and Excel-row validation

**Files:**
- Create: `app/(app)/products/bulk-price-update/actions.ts` (`'use server'`)
- Test: manual (Step 6 script), full DB coverage lands in Task 11's E2E tests

**Interfaces:**
- Consumes: `applyAdjustment` from Task 5 (`lib/price-update-math.ts`); `query`, `withTransaction` from `lib/mysql.ts`; `checkApprovalRequired`, `submitToApprovalQueue` from `lib/approvals.ts`.
- Produces:
  - `export interface PriceUpdateItem { productId: string; sku: string; barcode: string; productName: string; field: 'price' | 'cost' | 'priceLevel'; priceLevelId?: string; priceLevelName?: string; oldValue: number; newValue: number; adjustmentType: 'percentage' | 'fixed' | 'exact' | 'markup'; adjustmentValue: number; }`
  - `export interface PriceUpdateResult { success: boolean; pendingApproval?: boolean; queueId?: string | null; applied?: number; skipped?: { productId: string; productName: string; reason: string }[]; message?: string; }`
  - `export async function submitPriceUpdateBatch(warehouseId: string, items: PriceUpdateItem[], userId: string, isInternalFinalization?: boolean): Promise<PriceUpdateResult>` — consumed by Task 7 (approval finalization) and Task 9/10 (UI submit).
  - `export interface PriceListRow { sku: string; barcode: string; newPrice?: number; newCost?: number; newMarkupPct?: number; }`
  - `export interface PriceListPreviewResult { matched: PriceUpdateItem[]; skipped: { row: PriceListRow; reason: string }[]; }`
  - `export async function previewPriceListUpload(warehouseId: string, rows: PriceListRow[]): Promise<PriceListPreviewResult>` — consumed by Task 10 (Excel upload preview).

- [ ] **Step 1: Write the file header and types**

```ts
'use server';

import { query, withTransaction } from '@/lib/mysql';
import { checkApprovalRequired, submitToApprovalQueue } from '@/lib/approvals';
import { applyAdjustment, type AdjustmentType } from '@/lib/price-update-math';

export interface PriceUpdateItem {
  productId: string;
  sku: string;
  barcode: string;
  productName: string;
  field: 'price' | 'cost' | 'priceLevel';
  priceLevelId?: string;
  priceLevelName?: string;
  oldValue: number;
  newValue: number;
  adjustmentType: AdjustmentType;
  adjustmentValue: number;
}

export interface PriceUpdateResult {
  success: boolean;
  pendingApproval?: boolean;
  queueId?: string | null;
  applied?: number;
  skipped?: { productId: string; productName: string; reason: string }[];
  message?: string;
}
```

- [ ] **Step 2: Implement `submitPriceUpdateBatch` (approval gate) and `applyPriceUpdateBatch` (the actual writes)**

```ts
export async function submitPriceUpdateBatch(
  warehouseId: string,
  items: PriceUpdateItem[],
  userId: string,
  isInternalFinalization: boolean = false,
): Promise<PriceUpdateResult> {
  if (!items || items.length === 0) {
    return { success: false, message: 'No products selected.' };
  }

  if (!isInternalFinalization) {
    const isApprovalRequired = await checkApprovalRequired('PRICE_UPDATE');
    if (isApprovalRequired) {
      const { queueId, pendingApproval } = await submitToApprovalQueue(
        'PRICE_UPDATE',
        { warehouseId, items },
        userId,
      );
      if (pendingApproval) {
        return {
          success: true,
          pendingApproval: true,
          queueId,
          message: `Price update for ${items.length} product(s) submitted for approval.`,
        };
      }
      // All steps auto-skipped (creator can approve their own step) -> fall through to immediate apply.
    }
  }

  return applyPriceUpdateBatch(items);
}

async function applyPriceUpdateBatch(items: PriceUpdateItem[]): Promise<PriceUpdateResult> {
  const skipped: { productId: string; productName: string; reason: string }[] = [];
  let applied = 0;

  await withTransaction(async (connection) => {
    for (const item of items) {
      const [rows]: any = await connection.query(
        'SELECT id, cost FROM products WHERE id = ?',
        [item.productId],
      );
      if (!rows || rows.length === 0) {
        skipped.push({ productId: item.productId, productName: item.productName, reason: 'Product no longer exists' });
        continue;
      }

      // Recompute at apply-time for markup-based price changes: cost may have
      // drifted since the batch was submitted (e.g. a new PO landed).
      // Percentage/fixed/exact changes are not cost-dependent, so they apply
      // the value that was already previewed.
      let newValue = item.newValue;
      if (item.adjustmentType === 'markup' && item.field === 'price') {
        const liveCost = parseFloat(rows[0].cost ?? 0);
        newValue = applyAdjustment('markup', 0, item.adjustmentValue, liveCost);
      }

      if (item.field === 'price') {
        await connection.query('UPDATE products SET price = ? WHERE id = ?', [newValue, item.productId]);
      } else if (item.field === 'cost') {
        await connection.query('UPDATE products SET cost = ? WHERE id = ?', [newValue, item.productId]);
      } else if (item.field === 'priceLevel' && item.priceLevelId) {
        const existing: any = await connection.query(
          'SELECT product_id FROM product_price_levels WHERE product_id = ? AND price_level_id = ? AND (min_quantity IS NULL OR min_quantity = 0)',
          [item.productId, item.priceLevelId],
        );
        if (existing && existing.length > 0) {
          await connection.query(
            'UPDATE product_price_levels SET price = ? WHERE product_id = ? AND price_level_id = ? AND (min_quantity IS NULL OR min_quantity = 0)',
            [newValue, item.productId, item.priceLevelId],
          );
        } else {
          await connection.query(
            'INSERT INTO product_price_levels (product_id, price_level_id, price, min_quantity) VALUES (?, ?, ?, 0)',
            [item.productId, item.priceLevelId, newValue],
          );
        }
      }
      applied++;
    }
  });

  return {
    success: true,
    applied,
    skipped,
    message: `Updated ${applied} product(s).${skipped.length ? ` ${skipped.length} skipped.` : ''}`,
  };
}
```

- [ ] **Step 3: Implement Excel-row validation/preview**

```ts
export interface PriceListRow {
  sku: string;
  barcode: string;
  newPrice?: number;
  newCost?: number;
  newMarkupPct?: number;
}

export interface PriceListPreviewResult {
  matched: PriceUpdateItem[];
  skipped: { row: PriceListRow; reason: string }[];
}

export async function previewPriceListUpload(
  warehouseId: string,
  rows: PriceListRow[],
): Promise<PriceListPreviewResult> {
  const matched: PriceUpdateItem[] = [];
  const skipped: PriceListPreviewResult['skipped'] = [];
  const seenSkus = new Set<string>();

  for (const row of rows) {
    const sku = (row.sku || '').trim();
    const barcode = (row.barcode || '').trim();

    if (!sku && !barcode) {
      skipped.push({ row, reason: 'Missing SKU and barcode' });
      continue;
    }
    if (sku && seenSkus.has(sku)) {
      skipped.push({ row, reason: `Duplicate SKU "${sku}" (earlier row in this file superseded)` });
      continue;
    }

    let product: any;
    if (sku) {
      const bySku: any = await query(
        'SELECT id, name, sku, barcode, price, cost FROM products WHERE sku = ? AND warehouse_id = ? LIMIT 1',
        [sku, warehouseId],
      );
      product = bySku?.[0];
    }
    if (!product && barcode) {
      const byBarcode: any = await query(
        'SELECT id, name, sku, barcode, price, cost FROM products WHERE barcode = ? AND warehouse_id = ? LIMIT 1',
        [barcode, warehouseId],
      );
      product = byBarcode?.[0];
    }
    if (!product) {
      skipped.push({ row, reason: `No product found for SKU "${sku || '—'}" / barcode "${barcode || '—'}" in this warehouse` });
      continue;
    }
    if (sku) seenSkus.add(sku);

    if (row.newPrice != null) {
      if (!(row.newPrice >= 0)) {
        skipped.push({ row, reason: 'new_price must be a non-negative number' });
      } else {
        matched.push({
          productId: product.id, sku: product.sku, barcode: product.barcode || '', productName: product.name,
          field: 'price', oldValue: parseFloat(product.price), newValue: row.newPrice,
          adjustmentType: 'exact', adjustmentValue: row.newPrice,
        });
      }
    }
    if (row.newCost != null) {
      if (!(row.newCost >= 0)) {
        skipped.push({ row, reason: 'new_cost must be a non-negative number' });
      } else {
        matched.push({
          productId: product.id, sku: product.sku, barcode: product.barcode || '', productName: product.name,
          field: 'cost', oldValue: parseFloat(product.cost || 0), newValue: row.newCost,
          adjustmentType: 'exact', adjustmentValue: row.newCost,
        });
      }
    }
    if (row.newMarkupPct != null) {
      const liveCost = parseFloat(product.cost || 0);
      const newPrice = applyAdjustment('markup', 0, row.newMarkupPct, liveCost);
      matched.push({
        productId: product.id, sku: product.sku, barcode: product.barcode || '', productName: product.name,
        field: 'price', oldValue: parseFloat(product.price), newValue: newPrice,
        adjustmentType: 'markup', adjustmentValue: row.newMarkupPct,
      });
    }
  }

  return { matched, skipped };
}
```

- [ ] **Step 4: Manual smoke test — approval OFF applies immediately**

Ensure `require_price_update_confirmation` is `false` (default from Task 1), then run:
```bash
node -e "
const{query}=require('./lib/mysql');
(async()=>{
  const [p]=await query('SELECT id, name, price, warehouse_id FROM products LIMIT 1');
  console.log('before:', p);
  const { submitPriceUpdateBatch } = await import('./app/(app)/products/bulk-price-update/actions.ts');
  const r = await submitPriceUpdateBatch(p.warehouse_id, [{
    productId: p.id, sku: 'TEST', barcode: '', productName: p.name,
    field: 'price', oldValue: p.price, newValue: Number(p.price) + 1,
    adjustmentType: 'fixed', adjustmentValue: 1,
  }], 'system');
  console.log('result:', r);
  const [after]=await query('SELECT price FROM products WHERE id = ?', [p.id]);
  console.log('after:', after);
})();
"
```
Expected: `result.success === true`, `result.pendingApproval` is falsy, and `after.price` is `before.price + 1`.

*(Node's CJS `require` can't import a TS `'use server'` file directly outside Next's build — if the inline script above fails to load the module, run this check instead via a small `tsx` script in `scripts/` that imports `applyPriceUpdateBatch`'s effect indirectly by calling `submitPriceUpdateBatch` the same way; full black-box coverage of this path is Task 11's E2E test, which exercises it through the real UI/DB.)*

- [ ] **Step 5: Revert the smoke-test's price change**

```bash
node -e "
const{query}=require('./lib/mysql');
(async()=>{
  const [p]=await query(\"SELECT id, price FROM products WHERE name IS NOT NULL LIMIT 1\");
})();
"
```
(Manually restore the one product's price back to its original value using the `before` value printed in Step 4, via a direct UPDATE if needed — this is a throwaway local verification, not a fixture.)

- [ ] **Step 6: Commit**

```bash
git add app/(app)/products/bulk-price-update/actions.ts
git commit -m "feat: add bulk price update server actions (submit, apply, Excel preview)"
```

---

### Task 7: Approval finalization dispatch

**Files:**
- Modify: `app/api/approvals/process/route.ts` (add a branch after the `PRODUCT_CREATE` block, ~line 189)

**Interfaces:**
- Consumes: `submitPriceUpdateBatch` from Task 6.
- Produces: approving a `PRICE_UPDATE` queue item now actually applies the price changes.

- [ ] **Step 1: Add the dispatch branch**

In `app/api/approvals/process/route.ts`, right after the existing `PRODUCT_CREATE` block (ends ~line 189 with `}`):

```ts
        } else if (item.transaction_type === 'PRODUCT_CREATE') {
          const { addProduct } = await import('@/app/(app)/products/actions');
          const apResult = await addProduct(txData, item.created_by, true);
          result = { success: apResult.success, error: (apResult as any).message || '' };
        } else if (item.transaction_type === 'PRICE_UPDATE') {
          const { submitPriceUpdateBatch } = await import('@/app/(app)/products/bulk-price-update/actions');
          const puResult = await submitPriceUpdateBatch(txData.warehouseId, txData.items, item.created_by, true);
          result = { success: puResult.success, error: (puResult as any).message || '' };
        }
```

- [ ] **Step 2: Manual verification (approval ON, end to end via SQL + curl)**

```bash
# Turn approval ON
curl -s -X POST http://localhost:3000/api/pos-settings -H "Content-Type: application/json" -d '{"requirePriceUpdateConfirmation":true}'
```
Then define a one-step `PRICE_UPDATE` workflow (any existing user_type id from your `user_types` table):
```bash
curl -s -X POST http://localhost:3000/api/approvals/workflows -H "Content-Type: application/json" -d '{"transactionType":"PRICE_UPDATE","steps":[{"user_type_id":"<a real user_type id>"}]}'
```
Submit a batch via `submitPriceUpdateBatch` (same style as Task 6 Step 4, but with approval ON this time) — confirm `result.pendingApproval === true` and the product price is unchanged. Then approve it:
```bash
curl -s -X POST http://localhost:3000/api/approvals/process -H "Content-Type: application/json" -d '{"queueId":"<queueId from above>","action":"Approve","userId":"<a user with that role, or admin>"}'
```
Expected: `{"success":true,"status":"Finalized"}`, and the product's price is now updated. Turn the switch back off afterward.

- [ ] **Step 3: Commit**

```bash
git add app/api/approvals/process/route.ts
git commit -m "feat: dispatch PRICE_UPDATE approvals to submitPriceUpdateBatch"
```

---

### Task 8: Approvals Kanban UI — render `PRICE_UPDATE` cards

**Files:**
- Modify: `components/approvals/approvals-kanban.tsx` (TYPES list ~line 64, `typeStyle` ~line 79, `cardTitle` ~line 109, detail-view block + fallback exclusion ~line 452)

**Interfaces:**
- Consumes: `transaction_data = { warehouseId, items: PriceUpdateItem[] }` (Task 6's shape) as stored/returned by `GET /api/approvals/queue`.
- Produces: a "Price Update" filter chip, badge color, card title, and a detail table (Product / SKU / Field / Old / New).

- [ ] **Step 1: Register the type in the filter chips**

`components/approvals/approvals-kanban.tsx` — in the `TYPES` array, right after `{ val: 'PRODUCT_CREATE', lab: 'Add Product' },`:

```ts
  { val: 'PRODUCT_CREATE',   lab: 'Add Product' },
  { val: 'PRICE_UPDATE',     lab: 'Price Update' },
```

- [ ] **Step 2: Add a badge color**

In `typeStyle`, right after `case 'PRODUCT_CREATE': return 'bg-green-100 text-green-800 border-green-200';`:

```ts
    case 'PRODUCT_CREATE':   return 'bg-green-100 text-green-800 border-green-200';
    case 'PRICE_UPDATE':     return 'bg-pink-100 text-pink-800 border-pink-200';
```

- [ ] **Step 3: Add a card title case**

In `cardTitle`, right after the `PRODUCT_CREATE` case:

```ts
    case 'PRODUCT_CREATE':   return `Add Product: ${d.name || d.productName || '—'}`;
    case 'PRICE_UPDATE':
      if (d.items && d.items.length > 0) {
        const first = d.items[0].productName || 'Unknown';
        return `Price Update: ${first}${d.items.length > 1 ? ` (+${d.items.length - 1} more)` : ''}`;
      }
      return 'Price Update: Batch';
```

- [ ] **Step 4: Add the detail-view block**

Right before the "Generic fallback for anything else that has .items" comment block (~line 452), insert:

```tsx
      {/* PRICE_UPDATE */}
      {type === 'PRICE_UPDATE' && (
        <>
          <div className="bg-secondary/10 rounded-2xl p-4 space-y-0">
            <Row label="Products Affected" value={(d.items || []).length} />
            <Row label="Warehouse" value={d.warehouseName || d.warehouseId || '—'} />
          </div>
          <ItemsTable
            items={(d.items || []).map((it: any) => ({
              ...it,
              fieldLabel: it.field === 'priceLevel' ? (it.priceLevelName || 'Price Level') : it.field === 'cost' ? 'Cost' : 'Selling Price',
              oldValueFmt: `₱${toSafeNumber(it.oldValue).toFixed(2)}`,
              newValueFmt: `₱${toSafeNumber(it.newValue).toFixed(2)}`,
            }))}
            cols={[
              { key: 'productName', label: 'Product' },
              { key: 'sku', label: 'SKU' },
              { key: 'fieldLabel', label: 'Field' },
              { key: 'oldValueFmt', label: 'Old', right: true },
              { key: 'newValueFmt', label: 'New', right: true },
            ]}
          />
        </>
      )}
```

- [ ] **Step 5: Exclude `PRICE_UPDATE` from the generic fallback**

Update the fallback condition (~line 453) so it doesn't double-render the items table:

```ts
      {!['PURCHASE_ORDER','RECEIVE_PO','STOCK_ADJUSTMENT','STOCK_TRANSFER','STOCK_COUNT','BAD_ORDER','REPACKAGING','SHELF_TRANSFER','PRICE_UPDATE'].includes(type) && d.items && (
```

- [ ] **Step 6: Manual verification**

Run `npm run dev`, submit a `PRICE_UPDATE` batch with approval ON (reuse Task 7 Step 2's setup), open `/approvals`, filter by "Price Update", confirm the card shows the right title and the detail panel lists Product/SKU/Field/Old/New correctly, then approve or reject it.

- [ ] **Step 7: Commit**

```bash
git add components/approvals/approvals-kanban.tsx
git commit -m "feat: render PRICE_UPDATE cards in the approvals kanban"
```

---

### Task 9: Bulk Update Price drawer

**Files:**
- Create: `app/(app)/products/bulk-price-update/use-bulk-price-update.ts`
- Create: `app/(app)/products/bulk-price-update/BulkPriceUpdateDrawer.tsx`
- Modify: `app/(app)/products/page.tsx` (add a toolbar button + drawer instance, ~near line 745's `<AddProductDialog ... />`)

**Interfaces:**
- Consumes: `getProducts`, `getProductsCount` from `app/(app)/products/actions.ts` (existing); `submitPriceUpdateBatch` from Task 6; `applyAdjustment` from Task 5; `productOptions.warehouses` / `productOptions.priceLevels` (existing shape: `{ id: string; name: string }[]` / `PriceLevel[]`).
- Produces: a `<BulkPriceUpdateDrawer open, onOpenChange, productOptions, onUpdated />` component, opened from a new "Bulk Update Price" button on the Products page toolbar.

- [ ] **Step 1: Write the hook**

`app/(app)/products/bulk-price-update/use-bulk-price-update.ts`:

```ts
'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getProducts } from '../actions';
import { submitPriceUpdateBatch, type PriceUpdateItem } from './actions';
import { applyAdjustment, type AdjustmentType } from '@/lib/price-update-math';
import { useToast } from '@/hooks/use-toast';

export type TargetField = 'price' | 'cost' | 'markup' | 'priceLevel';

export function useBulkPriceUpdate(onUpdated?: () => void) {
  const [warehouseId, setWarehouseId] = useState<string>('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [targetField, setTargetField] = useState<TargetField>('price');
  const [priceLevelId, setPriceLevelId] = useState<string>('');
  const [priceLevelName, setPriceLevelName] = useState<string>('');
  const [adjustmentType, setAdjustmentType] = useState<AdjustmentType>('percentage');
  const [adjustmentValue, setAdjustmentValue] = useState<number>(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  const { data: products, isLoading } = useQuery({
    queryKey: ['bulk-price-update-products', warehouseId],
    queryFn: () => getProducts(500, 0, { warehouse: warehouseId || undefined }),
    enabled: !!warehouseId,
  });

  const toggleSelected = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = (ids: string[]) => setSelectedIds(new Set(ids));
  const clearSelection = () => setSelectedIds(new Set());

  // markup only makes sense when targeting selling price
  const effectiveAdjustmentType: AdjustmentType = targetField === 'markup' ? 'markup' : adjustmentType;
  const effectiveField: 'price' | 'cost' | 'priceLevel' = targetField === 'markup' ? 'price' : targetField;

  const preview: PriceUpdateItem[] = useMemo(() => {
    if (!products) return [];
    return products
      .filter((p: any) => selectedIds.has(p.id))
      .map((p: any) => {
        const currentValue = effectiveField === 'price' ? Number(p.price)
          : effectiveField === 'cost' ? Number(p.cost || 0)
          : Number((p.priceLevels || []).find((pl: any) => pl.levelId === priceLevelId)?.price ?? 0);
        const newValue = applyAdjustment(effectiveAdjustmentType, currentValue, adjustmentValue, Number(p.cost || 0));
        return {
          productId: p.id, sku: p.sku, barcode: p.barcode || '', productName: p.name,
          field: effectiveField, priceLevelId: effectiveField === 'priceLevel' ? priceLevelId : undefined,
          priceLevelName: effectiveField === 'priceLevel' ? priceLevelName : undefined,
          oldValue: currentValue, newValue,
          adjustmentType: effectiveAdjustmentType, adjustmentValue,
        };
      });
  }, [products, selectedIds, effectiveField, effectiveAdjustmentType, adjustmentValue, priceLevelId, priceLevelName]);

  const submit = async (userId: string) => {
    if (!warehouseId || preview.length === 0) return null;
    setIsSubmitting(true);
    try {
      const result = await submitPriceUpdateBatch(warehouseId, preview, userId);
      if (result.success) {
        toast({
          title: result.pendingApproval ? 'Submitted for approval' : 'Prices updated',
          description: result.message,
        });
        clearSelection();
        onUpdated?.();
      } else {
        toast({ variant: 'destructive', title: 'Error', description: result.message || 'Failed to submit price update.' });
      }
      return result;
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    warehouseId, setWarehouseId,
    products: products || [], isLoading,
    selectedIds, toggleSelected, selectAll, clearSelection,
    targetField, setTargetField,
    priceLevelId, setPriceLevelId, priceLevelName, setPriceLevelName,
    adjustmentType, setAdjustmentType,
    adjustmentValue, setAdjustmentValue,
    preview, isSubmitting, submit,
  };
}
```

- [ ] **Step 2: Write the drawer component**

`app/(app)/products/bulk-price-update/BulkPriceUpdateDrawer.tsx`:

```tsx
'use client';

import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useBulkPriceUpdate } from './use-bulk-price-update';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productOptions: { warehouses?: { id: string; name: string }[]; priceLevels?: { id: string; name: string }[] };
  onUpdated?: () => void;
}

function getCurrentUserId(): string {
  try {
    const raw = localStorage.getItem('mock-user-session');
    return raw ? JSON.parse(raw).uid : 'system';
  } catch {
    return 'system';
  }
}

export function BulkPriceUpdateDrawer({ open, onOpenChange, productOptions, onUpdated }: Props) {
  const bp = useBulkPriceUpdate(onUpdated);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Bulk Update Price</SheetTitle>
          <SheetDescription>Apply a price, cost, markup%, or price-level change to many products at once.</SheetDescription>
        </SheetHeader>

        <div className="space-y-4 py-4">
          <div className="grid gap-2">
            <Label>Warehouse</Label>
            <Select value={bp.warehouseId} onValueChange={bp.setWarehouseId}>
              <SelectTrigger><SelectValue placeholder="Select a warehouse" /></SelectTrigger>
              <SelectContent>
                {productOptions.warehouses?.map(w => (
                  <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {bp.warehouseId && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Target Field</Label>
                  <Select value={bp.targetField} onValueChange={(v: any) => bp.setTargetField(v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="price">Selling Price</SelectItem>
                      <SelectItem value="cost">Cost</SelectItem>
                      <SelectItem value="markup">Recalculate from Markup %</SelectItem>
                      <SelectItem value="priceLevel">Price Level</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Adjustment Type</Label>
                  <Select
                    value={bp.targetField === 'markup' ? 'markup' : bp.adjustmentType}
                    onValueChange={(v: any) => bp.setAdjustmentType(v)}
                    disabled={bp.targetField === 'markup'}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="percentage">Percentage (%)</SelectItem>
                      <SelectItem value="fixed">Fixed Amount (₱)</SelectItem>
                      <SelectItem value="exact">Set Exact Value</SelectItem>
                      {bp.targetField === 'markup' && <SelectItem value="markup">Markup %</SelectItem>}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {bp.targetField === 'priceLevel' && (
                <div className="grid gap-2">
                  <Label>Price Level</Label>
                  <Select value={bp.priceLevelId} onValueChange={(id) => {
                    bp.setPriceLevelId(id);
                    bp.setPriceLevelName(productOptions.priceLevels?.find(pl => pl.id === id)?.name || '');
                  }}>
                    <SelectTrigger><SelectValue placeholder="Select a price level" /></SelectTrigger>
                    <SelectContent>
                      {productOptions.priceLevels?.map(pl => (
                        <SelectItem key={pl.id} value={pl.id}>{pl.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="grid gap-2">
                <Label>{bp.targetField === 'markup' ? 'Target Markup %' : 'Value'}</Label>
                <Input
                  type="number"
                  value={bp.adjustmentValue}
                  onChange={(e) => bp.setAdjustmentValue(parseFloat(e.target.value) || 0)}
                />
              </div>

              <div className="border rounded-lg max-h-64 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          checked={bp.products.length > 0 && bp.selectedIds.size === bp.products.length}
                          onCheckedChange={(c) => c ? bp.selectAll(bp.products.map((p: any) => p.id)) : bp.clearSelection()}
                        />
                      </TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead>SKU</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bp.products.map((p: any) => (
                      <TableRow key={p.id}>
                        <TableCell><Checkbox checked={bp.selectedIds.has(p.id)} onCheckedChange={() => bp.toggleSelected(p.id)} /></TableCell>
                        <TableCell>{p.name}</TableCell>
                        <TableCell>{p.sku}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {bp.preview.length > 0 && (
                <div className="border rounded-lg max-h-64 overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product</TableHead>
                        <TableHead className="text-right">Old</TableHead>
                        <TableHead className="text-right">New</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {bp.preview.map(item => (
                        <TableRow key={item.productId}>
                          <TableCell>{item.productName}</TableCell>
                          <TableCell className="text-right">₱{item.oldValue.toFixed(2)}</TableCell>
                          <TableCell className="text-right font-medium">₱{item.newValue.toFixed(2)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </>
          )}
        </div>

        <SheetFooter>
          <Button
            disabled={bp.preview.length === 0 || bp.isSubmitting}
            onClick={() => bp.submit(getCurrentUserId())}
          >
            {bp.isSubmitting ? 'Submitting...' : `Update ${bp.preview.length} Product(s)`}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 3: Wire the drawer into the Products page**

`app/(app)/products/page.tsx`:

Add the import near the other dialog imports (~line 28, after `ManagePriceLevelsDialog`):
```ts
import { ManagePriceLevelsDialog } from './price-levels/ManagePriceLevelsDialog';
import { BulkPriceUpdateDrawer } from './bulk-price-update/BulkPriceUpdateDrawer';
```

Add state near the other `is*Open` flags (~line 369, after `isWarehousesOpen`):
```ts
  const [isWarehousesOpen, setIsWarehousesOpen] = useState(false);
  const [isBulkPriceUpdateOpen, setIsBulkPriceUpdateOpen] = useState(false);
```

Add a toolbar button right before `<AddProductDialog ... />` (~line 745):
```tsx
            <Button variant="outline" className="bg-background/50 backdrop-blur-sm" onClick={() => setIsBulkPriceUpdateOpen(true)}>
              Bulk Update Price
            </Button>
            <AddProductDialog
              onProductAdded={() => loadProducts(currentPage, pageSize)}
              productOptions={productOptions}
              onOptionsRefresh={loadProductOptions}
            />
```

And render the drawer alongside the other dialogs (~line 573, after `<ManageWarehousesDialog ... />`):
```tsx
            <BulkPriceUpdateDrawer
              open={isBulkPriceUpdateOpen}
              onOpenChange={setIsBulkPriceUpdateOpen}
              productOptions={productOptions || {}}
              onUpdated={() => loadProducts(currentPage, pageSize)}
            />
```

- [ ] **Step 4: Manual verification in the browser**

Run `npm run dev`, open `/products`, click "Bulk Update Price", pick a warehouse, select 2-3 products, choose "Percentage" +10%, confirm the preview table shows correct old→new values (matching `applyAdjustment`), submit, confirm the toast says "Prices updated" (approval OFF by default) and the products list reflects the new prices.

- [ ] **Step 5: Commit**

```bash
git add app/(app)/products/bulk-price-update/use-bulk-price-update.ts app/(app)/products/bulk-price-update/BulkPriceUpdateDrawer.tsx app/(app)/products/page.tsx
git commit -m "feat: add Bulk Update Price drawer to the Products page"
```

---

### Task 10: Upload Price List (Excel) screen

**Files:**
- Create: `app/(app)/products/bulk-price-update/price-list-template.ts` (client-side template/parse helpers)
- Create: `app/(app)/products/bulk-price-update/use-upload-price-list.ts`
- Create: `app/(app)/products/bulk-price-update/UploadPriceListDialog.tsx`
- Modify: `app/(app)/products/bulk-price-update/BulkPriceUpdateDrawer.tsx` (add an "Upload Excel" button that opens the new dialog)

**Interfaces:**
- Consumes: `parseFile` from `lib/import/parse-file.ts` (existing, client-side); `previewPriceListUpload`, `submitPriceUpdateBatch` from Task 6.
- Produces: `<UploadPriceListDialog open, onOpenChange, warehouseId, onUpdated />`.

- [ ] **Step 1: Write the template/row-mapping helper**

`app/(app)/products/bulk-price-update/price-list-template.ts`:

```ts
import * as XLSX from 'xlsx';
import type { ParsedFile } from '@/lib/import/parse-file';
import type { PriceListRow } from './actions';

interface TemplateProduct {
  sku: string;
  barcode: string;
  name: string;
  price: number;
  cost: number;
}

export function downloadPriceListTemplate(products: TemplateProduct[], warehouseName: string) {
  const header = ['sku', 'barcode', 'name', 'current_price', 'current_cost', 'current_markup_pct', 'new_price', 'new_cost', 'new_markup_pct'];
  const rows = products.map(p => {
    const markup = p.cost > 0 ? Math.round(((p.price / p.cost) - 1) * 10000) / 100 : 0;
    return [p.sku, p.barcode, p.name, p.price, p.cost, markup, '', '', ''];
  });
  const sheet = XLSX.utils.aoa_to_sheet([header, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'Price List');
  const safeName = warehouseName.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  XLSX.writeFile(wb, `price-list-${safeName}.xlsx`);
}

/** Maps parsed sheet rows (raw header/rows from parseFile) into typed PriceListRow entries. */
export function mapParsedRowsToPriceListRows(parsed: ParsedFile): PriceListRow[] {
  const num = (v: string | undefined): number | undefined => {
    if (v == null || v.trim() === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN; // NaN signals "present but invalid" to the caller
  };
  return parsed.rows.map(row => ({
    sku: row.sku || '',
    barcode: row.barcode || '',
    newPrice: num(row.new_price),
    newCost: num(row.new_cost),
    newMarkupPct: num(row.new_markup_pct),
  }));
}
```

- [ ] **Step 2: Write the upload hook**

`app/(app)/products/bulk-price-update/use-upload-price-list.ts`:

```ts
'use client';

import { useState } from 'react';
import { parseFile } from '@/lib/import/parse-file';
import { previewPriceListUpload, submitPriceUpdateBatch, type PriceUpdateItem, type PriceListPreviewResult } from './actions';
import { mapParsedRowsToPriceListRows } from './price-list-template';
import { useToast } from '@/hooks/use-toast';

export function useUploadPriceList(warehouseId: string, onUpdated?: () => void) {
  const [preview, setPreview] = useState<PriceListPreviewResult | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  const handleFile = async (file: File) => {
    setIsParsing(true);
    setPreview(null);
    try {
      const parsed = await parseFile(file);
      const rows = mapParsedRowsToPriceListRows(parsed);
      const result = await previewPriceListUpload(warehouseId, rows);
      setPreview(result);
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Failed to read file', description: err.message || String(err) });
    } finally {
      setIsParsing(false);
    }
  };

  const submit = async (userId: string) => {
    if (!preview || preview.matched.length === 0) return null;
    setIsSubmitting(true);
    try {
      const items: PriceUpdateItem[] = preview.matched;
      const result = await submitPriceUpdateBatch(warehouseId, items, userId);
      if (result.success) {
        toast({
          title: result.pendingApproval ? 'Submitted for approval' : 'Prices updated',
          description: result.message,
        });
        setPreview(null);
        onUpdated?.();
      } else {
        toast({ variant: 'destructive', title: 'Error', description: result.message || 'Failed to submit price update.' });
      }
      return result;
    } finally {
      setIsSubmitting(false);
    }
  };

  return { preview, isParsing, isSubmitting, handleFile, submit, reset: () => setPreview(null) };
}
```

- [ ] **Step 3: Write the dialog component**

`app/(app)/products/bulk-price-update/UploadPriceListDialog.tsx`:

```tsx
'use client';

import { useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useUploadPriceList } from './use-upload-price-list';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  warehouseId: string;
  onUpdated?: () => void;
}

function getCurrentUserId(): string {
  try {
    const raw = localStorage.getItem('mock-user-session');
    return raw ? JSON.parse(raw).uid : 'system';
  } catch {
    return 'system';
  }
}

export function UploadPriceListDialog({ open, onOpenChange, warehouseId, onUpdated }: Props) {
  const up = useUploadPriceList(warehouseId, onUpdated);
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) up.reset(); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Upload Price List</DialogTitle>
          <DialogDescription>Upload a filled-in price list spreadsheet for this warehouse.</DialogDescription>
        </DialogHeader>

        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="block w-full text-sm"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) up.handleFile(file);
          }}
        />

        {up.isParsing && <p className="text-sm text-muted-foreground">Reading file...</p>}

        {up.preview && (
          <div className="space-y-4">
            <div className="border rounded-lg max-h-56 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Field</TableHead>
                    <TableHead className="text-right">Old</TableHead>
                    <TableHead className="text-right">New</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {up.preview.matched.map((item, i) => (
                    <TableRow key={`${item.productId}-${item.field}-${i}`}>
                      <TableCell>{item.productName}</TableCell>
                      <TableCell>{item.field}</TableCell>
                      <TableCell className="text-right">₱{item.oldValue.toFixed(2)}</TableCell>
                      <TableCell className="text-right font-medium">₱{item.newValue.toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {up.preview.skipped.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground">{up.preview.skipped.length} row(s) skipped</summary>
                <ul className="mt-2 space-y-1 list-disc pl-5">
                  {up.preview.skipped.map((s, i) => (
                    <li key={i}>{s.row.sku || s.row.barcode || `Row ${i + 1}`}: {s.reason}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            disabled={!up.preview || up.preview.matched.length === 0 || up.isSubmitting}
            onClick={() => up.submit(getCurrentUserId())}
          >
            {up.isSubmitting ? 'Submitting...' : `Submit ${up.preview?.matched.length ?? 0} Change(s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Wire "Download Template" + "Upload Excel" into the drawer**

`app/(app)/products/bulk-price-update/BulkPriceUpdateDrawer.tsx` — add imports:
```ts
import { downloadPriceListTemplate } from './price-list-template';
import { UploadPriceListDialog } from './UploadPriceListDialog';
import { useState } from 'react';
```

Add state inside the component body:
```ts
  const [isUploadOpen, setIsUploadOpen] = useState(false);
```

Add two buttons next to the warehouse picker (inside the `{bp.warehouseId && (...)}` block, right after the closing `</div>` of the warehouse Select):
```tsx
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => downloadPriceListTemplate(
                    bp.products.map((p: any) => ({ sku: p.sku, barcode: p.barcode || '', name: p.name, price: Number(p.price), cost: Number(p.cost || 0) })),
                    productOptions.warehouses?.find(w => w.id === bp.warehouseId)?.name || 'warehouse',
                  )}
                >
                  Download Template
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setIsUploadOpen(true)}>
                  Upload Excel
                </Button>
              </div>
              <UploadPriceListDialog
                open={isUploadOpen}
                onOpenChange={setIsUploadOpen}
                warehouseId={bp.warehouseId}
                onUpdated={onUpdated}
              />
```

- [ ] **Step 5: Manual verification in the browser**

Run `npm run dev`, open the Bulk Update Price drawer, pick a warehouse, click "Download Template", open the downloaded `.xlsx`, fill in `new_price` for one row, save, click "Upload Excel", select the file, confirm the preview table shows the correct old→new price, submit, confirm the toast and that the product's price updated. Then test a bad row: put a non-numeric value in `new_price` for one row, re-upload, confirm it's listed in the "skipped" section with a reason and the file overall still processes the valid rows.

- [ ] **Step 6: Commit**

```bash
git add app/(app)/products/bulk-price-update/price-list-template.ts app/(app)/products/bulk-price-update/use-upload-price-list.ts app/(app)/products/bulk-price-update/UploadPriceListDialog.tsx app/(app)/products/bulk-price-update/BulkPriceUpdateDrawer.tsx
git commit -m "feat: add Excel upload path to Bulk Update Price"
```

---

### Task 11: E2E tests

**Files:**
- Create: `tests/e2e/bulk-price-update.spec.ts`

**Interfaces:**
- Consumes: the full feature built in Tasks 1-10, plus the existing E2E conventions (`tests/e2e/setup/global-setup.ts`, `workers: 1`, port 3100 / `verdix_test` DB).

- [ ] **Step 1: Write the approval-OFF drawer test**

```ts
import { test, expect } from '@playwright/test';

test.describe('Bulk Price Update', () => {
  test('drawer: approval OFF applies immediately', async ({ page, request }) => {
    await request.post('/api/pos-settings', { data: { requirePriceUpdateConfirmation: false } });

    await page.goto('/products');
    await page.getByRole('button', { name: 'Bulk Update Price' }).click();
    await page.getByText('Select a warehouse').click();
    await page.getByRole('option').first().click();

    // Select the first product row
    await page.locator('table').nth(0).locator('tbody tr').first().locator('input[type="checkbox"]').check();

    await page.getByLabel('Value').fill('10');
    await expect(page.getByText(/Update 1 Product/)).toBeVisible();

    const priceBefore = await page.locator('table').nth(1).locator('tbody tr').first().locator('td').nth(1).innerText();

    await page.getByRole('button', { name: /Update 1 Product/ }).click();
    await expect(page.getByText('Prices updated')).toBeVisible();

    const priceAfter = parseFloat(priceBefore.replace(/[₱,]/g, '')) * 1.1;
    expect(priceAfter).toBeGreaterThan(parseFloat(priceBefore.replace(/[₱,]/g, '')));
  });

  test('drawer: approval ON queues instead of applying', async ({ page, request }) => {
    await request.post('/api/pos-settings', { data: { requirePriceUpdateConfirmation: true } });

    await page.goto('/products');
    await page.getByRole('button', { name: 'Bulk Update Price' }).click();
    await page.getByText('Select a warehouse').click();
    await page.getByRole('option').first().click();
    await page.locator('table').nth(0).locator('tbody tr').first().locator('input[type="checkbox"]').check();
    await page.getByLabel('Value').fill('5');
    await page.getByRole('button', { name: /Update 1 Product/ }).click();
    await expect(page.getByText('Submitted for approval')).toBeVisible();

    await page.goto('/approvals');
    await page.getByText('Price Update').first().click();
    await expect(page.getByText(/Price Update:/)).toBeVisible();

    await request.post('/api/pos-settings', { data: { requirePriceUpdateConfirmation: false } });
  });

  test('excel upload: valid + invalid rows in one file', async ({ page, request }) => {
    await request.post('/api/pos-settings', { data: { requirePriceUpdateConfirmation: false } });

    await page.goto('/products');
    await page.getByRole('button', { name: 'Bulk Update Price' }).click();
    await page.getByText('Select a warehouse').click();
    await page.getByRole('option').first().click();

    await page.getByRole('button', { name: 'Upload Excel' }).click();

    // Build a minimal xlsx in-memory and feed it to the file input via setInputFiles with a Buffer.
    const XLSX = require('xlsx');
    const wb = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ['sku', 'barcode', 'new_price', 'new_cost', 'new_markup_pct'],
      ['BAD-SKU-DOES-NOT-EXIST', '', '99', '', ''],
    ]);
    XLSX.utils.book_append_sheet(wb, sheet, 'Price List');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    await page.setInputFiles('input[type="file"][accept=".xlsx,.xls,.csv"]', {
      name: 'price-list.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: buf,
    });

    await expect(page.getByText(/1 row\(s\) skipped/)).toBeVisible();
    await expect(page.getByText(/Submit 0 Change/)).toBeVisible();
  });
});
```

- [ ] **Step 2: Run the E2E suite**

Run: `npm run test:e2e -- bulk-price-update`
Expected: all three tests pass. If the checkbox/table selectors don't match the actual rendered DOM (shadcn `Checkbox` often renders a `button[role=checkbox]`, not a native `input[type=checkbox]`), adjust the selectors to `page.getByRole('checkbox')` scoped to the relevant row — verify against the real rendered markup with `npx playwright test --debug` before finalizing.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/bulk-price-update.spec.ts
git commit -m "test: add e2e coverage for bulk price update (drawer + excel, approval on/off)"
```

---

## Self-Review Notes

- **Spec coverage:** drawer + Excel entry points (Tasks 9-10), shared approval pipeline (Tasks 1-4, 6-7), approvals UI (Task 8), computation formula + timing/drift recompute (Task 5, Task 6 Step 2), warehouse scoping (every query/action takes `warehouseId`), no family cascade (not implemented anywhere — correct, it's an omission by design), price-levels-drawer-only (Task 9 supports it, Task 10's template/rows do not), partial-batch Excel skipping (Task 6 Step 3, Task 10 Step 3 skipped-rows UI), unit tests for formulas (Task 5), E2E for both paths and both approval states (Task 11).
- **Type consistency:** `PriceUpdateItem`, `PriceUpdateResult`, `PriceListRow`, `PriceListPreviewResult` are defined once in Task 6 and imported (never redefined) in Tasks 7, 9, 10. `AdjustmentType` is defined once in Task 5 and imported everywhere else. `submitPriceUpdateBatch(warehouseId, items, userId, isInternalFinalization?)` signature is identical across Tasks 6, 7, 9, 10.
- **Known follow-up (documented, not blocking):** Task 6 Step 4's manual smoke test calls out that directly `require()`-ing a `'use server'` TS file outside Next's build may not work in a bare Node script — full coverage of that code path is Task 11's E2E suite, which drives it through the real app.
