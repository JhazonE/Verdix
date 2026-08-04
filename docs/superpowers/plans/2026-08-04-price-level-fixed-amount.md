# Price Level Fixed Amount Adjustment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a price level (Manage Price Levels) be defined as either a `Percentage` adjustment (existing) or a `Fixed Amount` adjustment (new) — a positive peso value added on top of the chosen base (Retail or Cost) — used everywhere a level's suggested price is auto-calculated.

**Architecture:** One new `price_levels.adjustment_type ENUM('percentage','fixed') DEFAULT 'percentage'` column; the existing `percentage_adjustment` column is reused to hold the value for either type. A new pure, shared `lib/price-level-calc.ts` module replaces two duplicated `calculatePriceLevelPrice` copies (add-product and edit-product hooks) and is also called from `lib/purchase-utils.ts`'s `calculateSuggestedPrice`. The Manage Price Levels UI (form, row, dialog, hook) threads the new field end-to-end.

**Tech Stack:** Next.js 16 (App Router, server actions), MySQL via `mysql2/promise` (`lib/mysql.ts`), shadcn/ui (`Select`, `Input`), react-hook-form (unaffected by this — Manage Price Levels uses plain `useState`, not RHF).

## Global Constraints

- No new database tables — one new column on the existing `price_levels` table.
- Both adjustment types are **positive-only** — same validation rule as today's Percentage, just reworded per type. Neither type accepts negative values.
- Formula: `percentage` → `basePrice * (1 + value / 100)` (unchanged); `fixed` → `basePrice + value` (new). `Base On` (Retail or Cost) applies to both types identically.
- Bulk Price Update (`app/(app)/products/bulk-price-update/`) is explicitly **out of scope** — it never reads a price level's `adjustment_type`/`percentage_adjustment`, only writes arbitrary values via its own drawer-chosen adjustment type. Do not touch any file under that directory.
- `lib/price-level-seed.ts` (the Edit Product dialog's auto-seed-default-row fix) is explicitly **out of scope** — it seeds from a product's live `price` directly, unrelated to level adjustment formulas. Do not touch it.
- The legacy `app/api/price-levels/route.ts` REST endpoint is dead code (confirmed unused by any current UI — the real UI goes through the `addPriceLevel`/`updatePriceLevel` server actions). Do not touch it.
- Follow existing house style: no ORM, DB access via `query`/`withTransaction` from `lib/mysql.ts`; pure calculation logic lives in `lib/*.ts` with no DB/React imports, matching `lib/price-update-math.ts` and `lib/price-level-seed.ts`.

---

### Task 1: Migration — `price_levels.adjustment_type` column

**Files:**
- Create: `scripts/migrations/108_add_price_level_adjustment_type.ts`
- Modify: `scripts/migrations/index.ts` (register the import)
- Test: manual (migration runner)

**Interfaces:**
- Produces: an `adjustment_type ENUM('percentage','fixed') NOT NULL DEFAULT 'percentage'` column on `price_levels`, consumed by Task 3 (actions.ts read/write) and Task 4 (UI).

- [ ] **Step 1: Write the migration**

```ts
import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

const migration: Migration = {
  name: '108_add_price_level_adjustment_type',
  timestamp: '2026-08-04_09-00-00',

  async up(): Promise<void> {
    const rows: any = await query(`
      SELECT COUNT(*) as cnt
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'price_levels'
        AND COLUMN_NAME = 'adjustment_type'
    `);
    const exists = rows[0]?.cnt > 0;
    if (!exists) {
      await query(`
        ALTER TABLE price_levels
        ADD COLUMN adjustment_type ENUM('percentage', 'fixed') NOT NULL DEFAULT 'percentage'
      `);
      console.log('✅ adjustment_type column added to price_levels');
    } else {
      console.log('⏭️  adjustment_type column already exists, skipping');
    }
  },

  async down(): Promise<void> {
    const rows: any = await query(`
      SELECT COUNT(*) as cnt
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'price_levels'
        AND COLUMN_NAME = 'adjustment_type'
    `);
    const exists = rows[0]?.cnt > 0;
    if (exists) {
      await query(`ALTER TABLE price_levels DROP COLUMN adjustment_type`);
      console.log('✅ adjustment_type column dropped from price_levels');
    }
  }
};

registerMigration(migration);
```

- [ ] **Step 2: Register the migration**

In `scripts/migrations/index.ts`, add right after the `107_add_price_update_approval_setting` import:

```ts
import './107_add_price_update_approval_setting';
import './108_add_price_level_adjustment_type';
```

- [ ] **Step 3: Run the migration**

Run: `npm run migrate`
Expected: log line `✅ adjustment_type column added to price_levels` (or the `skipping` line if re-run).

- [ ] **Step 4: Verify the column exists and defaults correctly**

Run:
```bash
node -e "const{query}=require('./lib/mysql');query(\"SELECT COLUMN_NAME, COLUMN_TYPE, COLUMN_DEFAULT FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='price_levels' AND COLUMN_NAME='adjustment_type'\").then(r=>{console.log(r);process.exit(0)})"
```
Expected: one row, `COLUMN_TYPE` containing `enum('percentage','fixed')`, `COLUMN_DEFAULT` = `percentage`.

- [ ] **Step 5: Commit**

```bash
git add scripts/migrations/108_add_price_level_adjustment_type.ts scripts/migrations/index.ts
git commit -m "feat: add adjustment_type column to price_levels"
```

---

### Task 2: Shared price-level calculation module + unit tests

**Files:**
- Create: `lib/price-level-calc.ts`
- Create: `tests/unit/price-level-calc.test.ts`
- Modify: `tests/unit/run.ts` (register the new test file)
- Modify: `lib/types.ts` (add `adjustmentType` to `PriceLevel`)

**Interfaces:**
- Produces: `applyPriceLevelAdjustment(adjustmentType: 'percentage' | 'fixed' | undefined, value: number | undefined, basePrice: number): number`, consumed by Task 3 (add-product hook, edit-product hook, `lib/purchase-utils.ts`).

- [ ] **Step 1: Add `adjustmentType` to the `PriceLevel` type**

In `lib/types.ts`, right after the `percentageAdjustment` field (currently line 75):

```ts
export interface PriceLevel {
  id: string;
  name: string;
  description?: string;
  isDefault: boolean;
  calculationBase?: 'retail' | 'cost';
  adjustmentType?: 'percentage' | 'fixed'; // 'percentage' (default) or 'fixed' peso amount
  percentageAdjustment?: number; // a percent when adjustmentType is 'percentage', a peso amount when 'fixed'
  minQuantity?: number;
  createdAt?: string;
  updatedAt?: string;
}
```

- [ ] **Step 2: Write the failing test**

`tests/unit/price-level-calc.test.ts`:

```ts
import assert from 'node:assert/strict';
import { applyPriceLevelAdjustment } from '../../lib/price-level-calc';

// percentage (default type when adjustmentType is undefined, matching pre-existing rows)
assert.equal(applyPriceLevelAdjustment('percentage', 20, 100), 120, '20% on 100 = 120');
assert.equal(applyPriceLevelAdjustment(undefined, 20, 100), 120, 'undefined adjustmentType behaves as percentage');
assert.equal(applyPriceLevelAdjustment('percentage', 0, 100), 100, '0% on 100 = 100 (no change)');

// fixed
assert.equal(applyPriceLevelAdjustment('fixed', 20, 100), 120, 'fixed +20 on base 100 = 120');
assert.equal(applyPriceLevelAdjustment('fixed', 0, 100), 100, 'fixed +0 on base 100 = 100 (no change)');

// missing/non-numeric value defaults to 0 (no adjustment)
assert.equal(applyPriceLevelAdjustment('percentage', undefined, 100), 100, 'undefined value = no adjustment (percentage)');
assert.equal(applyPriceLevelAdjustment('fixed', undefined, 100), 100, 'undefined value = no adjustment (fixed)');
assert.equal(applyPriceLevelAdjustment('fixed', NaN, 100), 100, 'NaN value = no adjustment (fixed)');

console.log('price-level-calc: all assertions passed');
```

- [ ] **Step 3: Register the test in the runner**

`tests/unit/run.ts` — add after the existing `price-list-template.test` import:

```ts
import './price-list-template.test';
import './price-level-calc.test';
```

- [ ] **Step 4: Run it to confirm it fails**

Run: `npm run test:unit`
Expected: FAIL — `Cannot find module '../../lib/price-level-calc'`.

- [ ] **Step 5: Implement `lib/price-level-calc.ts`**

```ts
/**
 * Applies a price level's adjustment to a resolved base price.
 *
 * - 'percentage' (or an unset/legacy adjustmentType, for rows written before
 *   this field existed): basePrice * (1 + value / 100).
 * - 'fixed': basePrice + value (value is a positive peso amount).
 *
 * Both adjustment types are positive-only by house rule — this function
 * does not enforce that itself (callers validate on save); it just applies
 * whatever value it's given.
 */
export function applyPriceLevelAdjustment(
  adjustmentType: 'percentage' | 'fixed' | undefined,
  value: number | undefined,
  basePrice: number,
): number {
  const v = Number(value) || 0;
  if (adjustmentType === 'fixed') {
    return basePrice + v;
  }
  return basePrice * (1 + v / 100);
}
```

- [ ] **Step 6: Run the tests again to confirm they pass**

Run: `npm run test:unit`
Expected: PASS, including `price-level-calc: all assertions passed`.

- [ ] **Step 7: Commit**

```bash
git add lib/price-level-calc.ts tests/unit/price-level-calc.test.ts tests/unit/run.ts lib/types.ts
git commit -m "feat: add shared price-level adjustment calculation with unit tests"
```

---

### Task 3: Wire the shared calc into read/write paths

**Files:**
- Modify: `app/(app)/products/actions.ts` (`getPriceLevels`, `addPriceLevel`, `updatePriceLevel`)
- Modify: `app/(app)/products/add-product/use-add-product-form.ts` (`calculatePriceLevelPrice`)
- Modify: `app/(app)/products/edit-product/use-edit-product-form.ts` (`calculatePriceLevelPrice`)
- Modify: `lib/purchase-utils.ts` (`calculateSuggestedPrice`)
- Test: manual (Step 6 script)

**Interfaces:**
- Consumes: `applyPriceLevelAdjustment` from Task 2 (`lib/price-level-calc.ts`).
- Produces: `getPriceLevels()` now returns `adjustmentType` on each `PriceLevel`; `addPriceLevel`/`updatePriceLevel` now accept and persist an `adjustmentType` parameter (consumed by Task 4's UI layer); `calculatePriceLevelPrice` (both hook files, same exported name/signature as before — callers in `price-levels-tab.tsx` for both add and edit products need no changes) and `calculateSuggestedPrice` now branch on `adjustmentType`.

- [ ] **Step 1: Update `getPriceLevels`, `addPriceLevel`, `updatePriceLevel`**

In `app/(app)/products/actions.ts`, replace the three functions (currently ~lines 2079-2124):

```ts
export async function getPriceLevels(): Promise<PriceLevel[]> {
  try {
    const levels = await query('SELECT * FROM price_levels ORDER BY name');
    return levels.map((level: any) => ({
      id: level.id,
      name: level.name,
      description: level.description,
      isDefault: level.is_default === 1,
      calculationBase: level.calculation_base,
      adjustmentType: level.adjustment_type === 'fixed' ? 'fixed' : 'percentage',
      percentageAdjustment: parseFloat(level.percentage_adjustment),
      minQuantity: level.min_quantity,
      createdAt: level.created_at,
      updatedAt: level.updated_at
    }));
  } catch (error) {
    console.error('Error fetching price levels:', error);
    return [];
  }
}

export async function addPriceLevel(name: string, description: string, isDefault: boolean, percentageAdjustment: number, minQuantity: number = 0, calculationBase: 'retail' | 'cost' = 'retail', adjustmentType: 'percentage' | 'fixed' = 'percentage') {
  try {
    const id = `pl_${Date.now()}`;
    if (isDefault) {
      await query('UPDATE price_levels SET is_default = 0', []);
    }
    await query('INSERT INTO price_levels (id, name, description, is_default, percentage_adjustment, min_quantity, calculation_base, adjustment_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [id, name, description || null, isDefault ? 1 : 0, percentageAdjustment, minQuantity, calculationBase, adjustmentType]);
    return { success: true, message: 'Price level added successfully.' };
  } catch (error) {
    console.error('Error adding price level:', error);
    return { success: false, message: 'Error adding price level.' };
  }
}

export async function updatePriceLevel(id: string, name: string, description: string, isDefault: boolean, percentageAdjustment: number, minQuantity: number = 0, calculationBase: 'retail' | 'cost' = 'retail', adjustmentType: 'percentage' | 'fixed' = 'percentage') {
  try {
    if (isDefault) {
      await query('UPDATE price_levels SET is_default = 0', []);
    }
    await query('UPDATE price_levels SET name = ?, description = ?, is_default = ?, percentage_adjustment = ?, min_quantity = ?, calculation_base = ?, adjustment_type = ? WHERE id = ?', [name, description || null, isDefault ? 1 : 0, percentageAdjustment, minQuantity, calculationBase, adjustmentType, id]);
    return { success: true, message: 'Price level updated successfully.' };
  } catch (error) {
    console.error('Error updating price level:', error);
    return { success: false, message: 'Error updating price level.' };
  }
}
```

(`deletePriceLevel`, immediately after, is unchanged — do not touch it.)

- [ ] **Step 2: Wire the shared calc into `add-product/use-add-product-form.ts`**

In `app/(app)/products/add-product/use-add-product-form.ts`, add the import near the top (alongside other `@/lib/*` imports):

```ts
import { applyPriceLevelAdjustment } from '@/lib/price-level-calc';
```

Replace the local `calculatePriceLevelPrice` function (currently lines 44-59):

```ts
export function calculatePriceLevelPrice(
  levelId: string,
  calculationBase: 'retail' | 'cost',
  priceLevels: any[],
  formPrice: number,
  formCost: number
): number {
  if (!levelId) return 0;

  const level = priceLevels.find(l => l.id === levelId);
  if (!level) return 0;

  const basePrice = calculationBase === 'retail' ? formPrice : formCost;
  if (basePrice === undefined || basePrice === null) return 0;

  return applyPriceLevelAdjustment(level.adjustmentType, level.percentageAdjustment, basePrice);
}
```

- [ ] **Step 3: Wire the shared calc into `edit-product/use-edit-product-form.ts`**

Same change, in `app/(app)/products/edit-product/use-edit-product-form.ts`. Add the import near the top (alongside the existing `import { seedDefaultPriceLevel } from '@/lib/price-level-seed';`):

```ts
import { applyPriceLevelAdjustment } from '@/lib/price-level-calc';
```

Replace the local `calculatePriceLevelPrice` function (currently lines 31-47, right before the `export interface UseEditProductFormProps` block):

```ts
export function calculatePriceLevelPrice(
  levelId: string,
  calculationBase: 'retail' | 'cost',
  priceLevels: any[],
  formPrice: number,
  formCost: number
): number {
  if (!levelId) return 0;

  const level = priceLevels.find(l => l.id === levelId);
  if (!level) return 0;

  const basePrice = calculationBase === 'retail' ? formPrice : formCost;
  if (basePrice === undefined || basePrice === null) return 0;

  return applyPriceLevelAdjustment(level.adjustmentType, level.percentageAdjustment, basePrice);
}
```

- [ ] **Step 4: Wire the shared calc into `lib/purchase-utils.ts`**

Add the import near the top of `lib/purchase-utils.ts` (alongside `import { toSafeNumber } from './utils';`):

```ts
import { toSafeNumber } from './utils';
import { applyPriceLevelAdjustment } from './price-level-calc';
```

Replace `calculateSuggestedPrice`'s body (currently lines 209-236) — this preserves the *existing* percentage-type behavior exactly (a level with `percentageAdjustment === 0` falls through to plain `baseRetailPrice`, ignoring `calculationBase` — do not "fix" this quirk, it's pre-existing and out of scope) while adding a clean `fixed` branch:

```ts
export function calculateSuggestedPrice(
  unitCost: number,
  markupPercentage: number,
  shippingPerUnit: number = 0,
  priceLevel?: any // Default level from system
): number {
  // Formula: (Cost * (1 + Markup%)) + Shipping
  // This ensures markup is ONLY applied to the base cost, not the shipping.
  const baseRetailPrice = (toSafeNumber(unitCost) * (1 + (toSafeNumber(markupPercentage)) / 100)) + toSafeNumber(shippingPerUnit);
  const landedCost = toSafeNumber(unitCost) + toSafeNumber(shippingPerUnit);

  if (priceLevel) {
    const adjustmentType = priceLevel.adjustmentType === 'fixed' ? 'fixed' : 'percentage';
    const value = toSafeNumber(priceLevel.percentageAdjustment);
    const base = priceLevel.calculationBase || 'retail';
    const resolvedBase = base === 'cost' ? landedCost : baseRetailPrice;

    if (adjustmentType === 'fixed') {
      return applyPriceLevelAdjustment('fixed', value, resolvedBase);
    }
    if (value !== 0) {
      return applyPriceLevelAdjustment('percentage', value, resolvedBase);
    }
  }

  return baseRetailPrice;
}
```

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: no new errors in `app/(app)/products/actions.ts`, `app/(app)/products/add-product/use-add-product-form.ts`, `app/(app)/products/edit-product/use-edit-product-form.ts`, or `lib/purchase-utils.ts` (pre-existing baseline errors in unrelated files are expected and not yours — see the project's documented baseline).

- [ ] **Step 6: Manual smoke test — verify the read/write/calc chain end-to-end via direct DB manipulation**

There is no UI yet to create a `fixed`-type level (that's Task 4) — verify the plumbing directly:

```bash
node -e "
const mysql = require('mysql2/promise');
(async()=>{
  const conn = await mysql.createConnection({host:'127.0.0.1',port:3306,user:'root',password:'rootpassword',database:'verdix'});
  const [defLevel] = await conn.query('SELECT id FROM price_levels WHERE is_default = 1 LIMIT 1');
  const testId = 'test-fixed-level-' + Date.now();
  await conn.query('INSERT INTO price_levels (id, name, is_default, percentage_adjustment, calculation_base, adjustment_type) VALUES (?, ?, 0, 20, ?, ?)', [testId, 'Test Fixed Level', 'cost', 'fixed']);
  const [rows] = await conn.query('SELECT * FROM price_levels WHERE id = ?', [testId]);
  console.log('inserted row:', rows[0]);
  await conn.query('DELETE FROM price_levels WHERE id = ?', [testId]);
  await conn.end();
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
"
```
Expected: the inserted row shows `adjustment_type: 'fixed'`, `percentage_adjustment: '20.00'` (or similar), `calculation_base: 'cost'`. Then confirm `getPriceLevels()` surfaces it correctly and `applyPriceLevelAdjustment` computes as expected:
```bash
node -e "
const{query}=require('./lib/mysql');
const{applyPriceLevelAdjustment}=require('./lib/price-level-calc');
(async()=>{
  await query('INSERT INTO price_levels (id, name, is_default, percentage_adjustment, calculation_base, adjustment_type) VALUES (?, ?, 0, 20, ?, ?)', ['test-fixed-smoke', 'Test Fixed Level', 'cost', 'fixed']);
  const levels = await query('SELECT * FROM price_levels WHERE id = ?', ['test-fixed-smoke']);
  const level = levels[0];
  console.log('raw row:', level);
  const computed = applyPriceLevelAdjustment(level.adjustment_type, parseFloat(level.percentage_adjustment), 100);
  console.log('applyPriceLevelAdjustment(fixed, 20, base=100) =', computed, '(expected 120)');
  await query('DELETE FROM price_levels WHERE id = ?', ['test-fixed-smoke']);
  process.exit(0);
})();
"
```
Expected: `computed` prints `120`.

*(Node's CJS `require` may not resolve TS path aliases the same way Next's build does — if `require('./lib/price-level-calc')` fails to load, adapt the script to inline the same formula from Task 2 Step 5 for this one verification, or run it via `npx tsx` instead of `node -e`.)*

- [ ] **Step 7: Commit**

```bash
git add app/(app)/products/actions.ts app/(app)/products/add-product/use-add-product-form.ts app/(app)/products/edit-product/use-edit-product-form.ts lib/purchase-utils.ts
git commit -m "feat: read/write price_levels.adjustment_type and branch calculations on it"
```

---

### Task 4: Manage Price Levels UI

**Files:**
- Modify: `app/(app)/products/price-levels/use-price-level-form.ts`
- Modify: `app/(app)/products/price-levels/price-level-form.tsx`
- Modify: `app/(app)/products/price-levels/price-level-row.tsx`
- Modify: `app/(app)/products/price-levels/use-manage-price-levels.ts`
- Modify: `app/(app)/products/price-levels/ManagePriceLevelsDialog.tsx`

**Interfaces:**
- Consumes: `addPriceLevel`/`updatePriceLevel`/`getPriceLevels` from Task 3 (now accepting/returning `adjustmentType`).
- Produces: a working "Adjustment Type" selector in the Add/Edit Price Level form, correct display in the list, and the new field threaded end-to-end from form save through to the DB.

- [ ] **Step 1: Add `adjustmentType` state and validation to `use-price-level-form.ts`**

Replace the full file content:

```ts
'use client';

import { useState } from 'react';

import { useToast } from '@/hooks/use-toast';
import type { PriceLevel } from '@/lib/types';

export type PriceLevelSaveHandler = (
  name: string,
  description: string,
  isDefault: boolean,
  percentageAdjustment: number,
  calculationBase: 'retail' | 'cost',
  adjustmentType: 'percentage' | 'fixed'
) => Promise<boolean>;

export interface UsePriceLevelFormProps {
  initialData?: PriceLevel;
  onSave: PriceLevelSaveHandler;
}

/**
 * Controller for the price level add/edit form: field state and the validated
 * save flow (clears the form after a successful add).
 */
export function usePriceLevelForm({ initialData, onSave }: UsePriceLevelFormProps) {
  const [name, setName] = useState(initialData?.name || '');
  const [description, setDescription] = useState(initialData?.description || '');
  const [isDefault, setIsDefault] = useState(initialData?.isDefault || false);
  const [calculationBase, setCalculationBase] = useState<'retail' | 'cost'>(initialData?.calculationBase || 'retail');
  const [adjustmentType, setAdjustmentType] = useState<'percentage' | 'fixed'>(initialData?.adjustmentType || 'percentage');
  const [percentageAdjustment, setPercentageAdjustment] = useState(initialData?.percentageAdjustment?.toString() || '0');
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  const handleSave = async () => {
    if (!name.trim()) {
      toast({
        variant: 'destructive',
        title: 'Validation Error',
        description: 'Price level name cannot be empty.',
      });
      return;
    }
    const adjustment = parseFloat(percentageAdjustment);

    if (isNaN(adjustment) || adjustment < 0) {
      toast({
        variant: 'destructive',
        title: 'Validation Error',
        description: adjustmentType === 'fixed'
          ? 'Fixed amount must be a valid positive number.'
          : 'Markup percentage must be a valid positive number.',
      });
      return;
    }

    setIsSaving(true);
    try {
      const success = await onSave(name, description, isDefault, adjustment, calculationBase, adjustmentType);
      if (success) {
        toast({
          title: initialData ? 'Price Level Updated' : 'Price Level Added',
          description: `Price level "${name}" has been successfully saved.`,
        });
        if (!initialData) {
          setName('');
          setDescription('');
          setIsDefault(false);
          setCalculationBase('retail');
          setAdjustmentType('percentage');
          setPercentageAdjustment('0');
        }
      }
    } catch (error) {
      console.error('Failed to save price level', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to save price level. Please try again.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  return {
    name,
    setName,
    description,
    setDescription,
    isDefault,
    setIsDefault,
    calculationBase,
    setCalculationBase,
    adjustmentType,
    setAdjustmentType,
    percentageAdjustment,
    setPercentageAdjustment,
    isSaving,
    handleSave,
  };
}
```

- [ ] **Step 2: Add the Adjustment Type selector and adapt labels in `price-level-form.tsx`**

Add `Select` is already imported. Replace the "Markup %" field block (currently lines 64-76) with an Adjustment Type selector followed by the (now type-aware) value field:

```tsx
      <div className="grid grid-cols-4 items-center gap-4">
        <Label htmlFor="adjustmentType" className="text-right">
          Adjustment Type
        </Label>
        <div className="col-span-3">
          <Select value={adjustmentType} onValueChange={(val: 'percentage' | 'fixed') => setAdjustmentType(val)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="percentage">Percentage</SelectItem>
              <SelectItem value="fixed">Fixed Amount</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-4 items-center gap-4">
        <Label htmlFor="adjustment" className="text-right">
          {adjustmentType === 'fixed' ? 'Fixed Amount (₱)' : 'Markup %'}
        </Label>
        <Input
          id="adjustment"
          type="number"
          value={percentageAdjustment}
          onChange={(e) => setPercentageAdjustment(e.target.value)}
          className="col-span-3"
          placeholder={adjustmentType === 'fixed' ? 'e.g., 20 for ₱20 added' : 'e.g., 20 for 20% markup'}
        />
      </div>
```

Then update the destructured hook values at the top of the component to include `adjustmentType, setAdjustmentType`:

```ts
  const {
    name,
    setName,
    description,
    setDescription,
    isDefault,
    setIsDefault,
    calculationBase,
    setCalculationBase,
    adjustmentType,
    setAdjustmentType,
    percentageAdjustment,
    setPercentageAdjustment,
    isSaving,
    handleSave,
  } = usePriceLevelForm({ initialData, onSave });
```

Finally, reword the "Base On" helper text (currently lines 91-95) so it doesn't say "markup/discount" for a type that's markup-only:

```tsx
          <p className="text-xs text-muted-foreground mt-1 text-right">
            {calculationBase === 'retail'
              ? (adjustmentType === 'fixed' ? 'Adds a fixed amount on top of the calculated Retail price.' : 'Applies markup/discount on top of the calculated Retail price.')
              : (adjustmentType === 'fixed' ? 'Adds a fixed amount on top of the base Cost.' : 'Applies markup/discount on top of the base Cost.')}
          </p>
```

- [ ] **Step 3: Adapt the list display in `price-level-row.tsx`**

Replace the Markup cell (currently line 35):

```tsx
      <TableCell className="text-center">
        {level.adjustmentType === 'fixed' ? `₱${level.percentageAdjustment}` : `${level.percentageAdjustment}%`}
        <br /> <span className="text-xs text-muted-foreground">on {level.calculationBase === 'cost' ? 'Cost' : 'Retail'}</span>
      </TableCell>
```

- [ ] **Step 4: Thread `adjustmentType` through `use-manage-price-levels.ts`**

Replace `addLevel` and `updateLevel` (currently lines 39-72):

```ts
  const addLevel = async (
    name: string,
    description: string,
    isDefault: boolean,
    percentageAdjustment: number,
    calculationBase: 'retail' | 'cost',
    adjustmentType: 'percentage' | 'fixed'
  ): Promise<boolean> => {
    const result = await addPriceLevel(name, description, isDefault, percentageAdjustment, 0, calculationBase, adjustmentType);
    if (result.success) {
      await refreshLevels();
      onLevelAdded?.();
      return true;
    }
    toast({ variant: 'destructive', title: 'Error', description: result.message });
    return false;
  };

  const updateLevel = async (
    id: string,
    name: string,
    description: string,
    isDefault: boolean,
    percentageAdjustment: number,
    calculationBase: 'retail' | 'cost',
    adjustmentType: 'percentage' | 'fixed'
  ): Promise<boolean> => {
    const result = await updatePriceLevel(id, name, description, isDefault, percentageAdjustment, 0, calculationBase, adjustmentType);
    if (result.success) {
      await refreshLevels();
      onLevelAdded?.();
      return true;
    }
    toast({ variant: 'destructive', title: 'Error', description: result.message });
    return false;
  };
```

- [ ] **Step 5: Thread `adjustmentType` through `ManagePriceLevelsDialog.tsx`**

Replace `handleAddLevel` and `handleUpdateLevel` (currently lines 38-54):

```ts
  const handleAddLevel = async (name: string, description: string, isDefault: boolean, percentageAdjustment: number, calculationBase: 'retail' | 'cost', adjustmentType: 'percentage' | 'fixed') => {
    const success = await addLevel(name, description, isDefault, percentageAdjustment, calculationBase, adjustmentType);
    if (success) {
      setView('list');
    }
    return success;
  };

  const handleUpdateLevel = async (name: string, description: string, isDefault: boolean, percentageAdjustment: number, calculationBase: 'retail' | 'cost', adjustmentType: 'percentage' | 'fixed') => {
    if (!editingLevel) return false;
    const success = await updateLevel(editingLevel.id, name, description, isDefault, percentageAdjustment, calculationBase, adjustmentType);
    if (success) {
      setView('list');
      setEditingLevel(undefined);
    }
    return success;
  };
```

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: no new errors in any of the 5 files touched in this task.

- [ ] **Step 7: Manual verification in the browser**

Run `npm run dev`, open `/products`, open "Manage Price Levels" (via the Manage dropdown), click "Add Price Level":
1. Set Adjustment Type = "Fixed Amount", enter `20`, Base On = "Cost", save. Confirm the list row shows `₱20` (not `20%`).
2. Edit that same level, confirm it re-opens with Adjustment Type = "Fixed Amount" and value `20` correctly pre-filled (not reset to Percentage/0).
3. Open "Add Product", set a Cost value, confirm the auto-suggested price for this level equals `cost + 20`.
4. Open Edit Product on an existing product, change its Cost, confirm the same level's suggested price updates to `newCost + 20`.
5. Create a second level with Adjustment Type = "Percentage" (existing path) and confirm it still works exactly as before (no regression).

- [ ] **Step 8: Commit**

```bash
git add app/(app)/products/price-levels/use-price-level-form.ts app/(app)/products/price-levels/price-level-form.tsx app/(app)/products/price-levels/price-level-row.tsx app/(app)/products/price-levels/use-manage-price-levels.ts app/(app)/products/price-levels/ManagePriceLevelsDialog.tsx
git commit -m "feat: add Fixed Amount adjustment type to the Manage Price Levels UI"
```

---

## Self-Review Notes

- **Spec coverage:** schema + formula (design's Architecture) — Task 1 + Task 2; consolidation of the 3 duplicated/similar calc sites (design's Architecture "Consolidation" + Components) — Task 2 (shared module) + Task 3 (adoption at all 3 sites); UI (design's Components + Data Flow) — Task 4, covering all 5 files in the real call chain (form → dialog → hook → server action), including `ManagePriceLevelsDialog.tsx` and `use-manage-price-levels.ts` which the design doc's Components list summarized under "UI" without naming individually. Non-Goals (Bulk Price Update, `price-level-seed.ts`, the legacy REST route) are explicitly called out as constraints so no task drifts into them.
- **Type consistency:** `applyPriceLevelAdjustment(adjustmentType, value, basePrice)` is defined once in Task 2 and imported (never redefined) in Task 3's three call sites. `PriceLevelSaveHandler`'s signature gains `adjustmentType` in Task 4 Step 1 and every caller in Tasks 4 Steps 2/4/5 is updated to match — traced the full chain (form → `ManagePriceLevelsDialog` → `use-manage-price-levels` → `actions.ts`) to confirm no link was missed. `PriceLevel.adjustmentType` is added once in Task 2 Step 1 and consumed identically in Tasks 3 and 4.
- **Preserved pre-existing behavior:** `calculateSuggestedPrice`'s existing quirk (a 0%-adjustment percentage level falls through to plain `baseRetailPrice`, ignoring `calculationBase`) is deliberately preserved as-is in Task 3 Step 4 rather than "fixed" — it's pre-existing behavior, out of scope for this feature, and changing it could alter suggested prices for any currently-configured 0%-adjustment level.
