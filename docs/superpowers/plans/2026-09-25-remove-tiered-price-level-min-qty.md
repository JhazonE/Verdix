# Remove Tiered Price-Level Min Qty Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the tiered/quantity-break pricing feature (`minQuantity` / `min_quantity`) from the codebase — the core resolver logic, the DB columns, all write paths, all types/schemas, the UI, and tests — leaving price-level overrides as a flat "one price per level" model with no quantity trigger.

**Architecture:** This is a subtractive change with one core-logic edit (`lib/pricing.ts`), one migration (drop two DB columns), and a wide but mechanical set of call-site edits that stop reading/writing a field that no longer means anything. Order matters: core logic and types first (so nothing downstream can silently keep depending on stale semantics), then write paths, then UI, then the migration, then tests, so that at every commit point the app still runs against the *old* schema until the very last step introduces the new one.

**Tech Stack:** Next.js (App Router), TypeScript, raw `mysql2/promise`, Zod, React Hook Form, Node's built-in `assert` for unit tests (no test runner framework — files are run directly with `node` or `tsx` and exit non-zero on a failed `assert`).

**Spec:** `docs/superpowers/specs/2026-09-25-remove-tiered-price-level-min-qty-design.md`

## Global Constraints

- No NOT NULL/FK constraints exist on either `min_quantity` column being dropped — every write path already tolerates 0/NULL, so the DB migration needs no data-migration step.
- Migrations in this codebase are idempotent: check `INFORMATION_SCHEMA.COLUMNS`/`TABLES` before altering, so re-running `up()` is always safe (see migration 127 for the pattern).
- `schema.sql` / `verdix_install.sql` are pre-existing stale dumps (predate migration 121) — out of scope, do not touch them as part of this plan.
- `ManagePriceLevelsDialog` and `BulkPriceUpdateDrawer` never exposed `minQuantity` in their UI — no changes needed there beyond what Task 3 already covers in `actions.ts`.
- Do not touch `setup_integration_test.ts`'s reference to the already-dropped `product_price_levels` table — it's pre-existing breakage unrelated to this change (that table was dropped by migration 121, long before this plan).

## Review Focus

- **Type checker as the safety net for missed references** — this change touches ~15 files with a field name (`minQuantity`/`min_quantity`) that appears in loosely-typed places (`any` casts in `actions.ts`, raw SQL result rows). `npm run typecheck` after each task is the main way to catch a stale reference before it reaches runtime.
- **`updateProductPrice`'s branch simplification must not change which row gets updated** — the existing `min_quantity IS NULL OR min_quantity = 0` check exists to distinguish "the one default-tier row" from other rows on the same selling unit/level pair; once the column is gone there is at most one row per (selling_unit_id, price_level_id) anyway (that pair is the primary key), so the check becomes unconditional — verify this doesn't change behavior when a row already exists vs. when it doesn't.
- **`addPriceLevel`/`updatePriceLevel` signature change is a breaking change to a positional-args function** — both call sites in `use-manage-price-levels.ts` must be updated in the same commit as the function signature, or TypeScript will silently shift every argument after the removed one.
- **The migration's `down()` must not attempt to restore data** — per the spec, rollback re-adds the columns as empty/default, it does not attempt to repopulate historical values. Confirm the migration doesn't claim otherwise in its comments.
- **`PriceLevelOverrides`' value shape is shared by 4+ call sites** (both conversion-tab files' base-unit and extra-unit bindings) — changing its prop type must be done consistently across both files in one task, not split, or one file's compiler error will mask the other's.

---

## Task 1: Remove tier logic and types from `lib/pricing.ts`

**Files:**
- Modify: `lib/pricing.ts`
- Test: `tests/unit/pricing.test.ts`

**Interfaces:**
- Produces: `calculateEffectivePrice(product, quantity, activeLevelId?, defaultLevelId?)` — signature unchanged, but a price-level row now applies only when `pl.levelId === activeLevelId` or `pl.levelId === defaultLevelId`, never based on quantity.
- Produces: `calculateEffectivePriceForUnit(unit, quantity, activeLevelId?, defaultLevelId?)` — same simplification.
- Produces: `SellingUnitPriceLevel = { levelId: string; price: number }` (drops `minQuantity`).

- [ ] **Step 1: Update the failing/changing test first**

Edit `tests/unit/pricing.test.ts`: remove the "tiered minimum-quantity overrides still work, per unit" block (lines 43-59) entirely, since that behavior is being removed. Also drop `minQuantity: 0` from the two existing `priceLevels` literals earlier in the file (lines 16 and — none other reference it), since the field no longer exists on the type. The file becomes:

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
    priceLevels: [{ levelId: wholesaleLevel, price: 1400 }],
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

console.log('✅ pricing tests passed');
```

- [ ] **Step 2: Run the test to confirm it still passes against the OLD implementation**

Run: `npx tsx tests/unit/pricing.test.ts`
Expected: PASS (the old implementation still satisfies these assertions since they don't exercise tiering)

- [ ] **Step 3: Rewrite `lib/pricing.ts` to remove tier logic**

Replace the full file contents with:

```typescript

import { Product, PriceLevel } from './types';

/**
 * Calculates the effective price for a product based on the active price
 * level.
 *
 * Logic Priority:
 * 1. Override for the ACTIVE Level (Customer or Selected)
 * 2. Override for the DEFAULT Level
 * 3. Base Product Price
 *
 * @param product The product object including its price levels
 * @param quantity Unused — kept for call-site compatibility (see note below)
 * @param activeLevelId The currently active price level ID (from customer or manual selection)
 * @param defaultLevelId The system's default price level ID (usually 'retail-level')
 * @returns The calculated effective price
 */
export function calculateEffectivePrice(
    product: Product,
    quantity: number,
    activeLevelId?: string,
    defaultLevelId: string = 'retail-level'
): number {
    // Start with a list of valid price candidates
    const priceCandidates: number[] = [];

    // 1. Add the product's base price
    priceCandidates.push(Number(product.price));

    if (product.priceLevels && product.priceLevels.length > 0) {
        // 2. Add the price from whichever level row matches the active level
        // or the default level.
        product.priceLevels.forEach(pl => {
            const price = Number(pl.price);
            const isDefaultTarget = pl.levelId === defaultLevelId;
            const isActiveTarget = activeLevelId && pl.levelId === activeLevelId;

            if (isDefaultTarget || isActiveTarget) {
                priceCandidates.push(price);
            }
        });
    }

    // Return the lowest price among all valid candidates.
    return priceCandidates.length > 0 ? Math.min(...priceCandidates) : Number(product.price);
}

export type SellingUnitPriceLevel = { levelId: string; price: number };
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
  const priceCandidates: number[] = [Number(unit.price)];

  if (unit.priceLevels && unit.priceLevels.length > 0) {
    unit.priceLevels.forEach(pl => {
      const price = Number(pl.price);
      const isDefaultTarget = pl.levelId === defaultLevelId;
      const isActiveTarget = activeLevelId && pl.levelId === activeLevelId;

      if (isDefaultTarget || isActiveTarget) {
        priceCandidates.push(price);
      }
    });
  }

  return priceCandidates.length > 0 ? Math.min(...priceCandidates) : Number(unit.price);
}
```

Note: `quantity` stays as a parameter on both functions (unused) rather than being removed from the signature, because every call site across the app (`use-pos.ts`, `PriceInquiryDialog.tsx`, `use-edit-item.ts`, `MySqlProductRepository.ts`) passes it positionally — removing it would require touching every call site for no behavioral benefit. This is a deliberate, minimal-surface-area choice, not an oversight.

- [ ] **Step 4: Run the test to confirm it passes against the NEW implementation**

Run: `npx tsx tests/unit/pricing.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/pricing.ts tests/unit/pricing.test.ts
git commit -m "$(cat <<'EOF'
refactor: remove tiered quantity-break pricing from price-level resolver

A price level now applies only when it matches the active or default
level, never based on sale quantity. Prepares for dropping the
min_quantity column.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Remove `minQuantity` from shared types and Zod schemas

**Files:**
- Modify: `lib/types.ts`
- Modify: `src/core/products/domain/Product.ts`
- Modify: `src/core/products/application/CreateProductUseCase.ts`
- Modify: `app/(app)/products/edit-product/product-schema.ts`
- Modify: `app/(app)/products/add-product/product-schema.ts`
- Modify: `lib/price-level-seed.ts`
- Test: `tests/unit/seed-default-price-level.test.ts`

**Interfaces:**
- Consumes: nothing new from Task 1.
- Produces: `Product.priceLevels: { levelId: string; price: number }[]`, `Product.sellingUnits[].priceLevels: { levelId: string; price: number }[]`, `PriceLevel` (drops `minQuantity`). `seedDefaultPriceLevel(existing: {levelId, price}[], defs, currentPrice): {levelId, price}[]`.

- [ ] **Step 1: Update `lib/types.ts`**

In the `Product` type, change:
```typescript
priceLevels?: { levelId: string; price: number; minQuantity?: number }[];
```
(both the top-level `priceLevels` field and the `sellingUnits[].priceLevels` field — two occurrences) to:
```typescript
priceLevels?: { levelId: string; price: number }[];
```

In the `PriceLevel` type, delete the line:
```typescript
minQuantity?: number;
```

- [ ] **Step 2: Update `src/core/products/domain/Product.ts`**

Change the `sellingUnits[].priceLevels` field:
```typescript
priceLevels?: { levelId: string; price: number; minQuantity?: number }[];
```
to:
```typescript
priceLevels?: { levelId: string; price: number }[];
```

Change the `ProductPriceLevel`-shaped type (the standalone `{ levelId, price, minQuantity }` interface around line 38-42) by deleting its `minQuantity: number;` line entirely.

- [ ] **Step 3: Update `src/core/products/application/CreateProductUseCase.ts`**

Change:
```typescript
priceLevels?: { levelId: string; price: number; minQuantity: number }[];
```
to:
```typescript
priceLevels?: { levelId: string; price: number }[];
```

- [ ] **Step 4: Update `app/(app)/products/edit-product/product-schema.ts`**

Remove both occurrences of the line:
```typescript
minQuantity: z.number().min(0).optional(),
```
— one inside `sellingUnits[].priceLevels`'s object shape, one inside the top-level `priceLevels`'s object shape.

- [ ] **Step 5: Update `app/(app)/products/add-product/product-schema.ts`**

Remove both occurrences of the same line:
```typescript
minQuantity: z.number().min(0).optional(),
```
— one inside `baseProductSchema`'s top-level `priceLevels`, one inside `standardProductSchema`'s `sellingUnits[].priceLevels`.

- [ ] **Step 6: Update `lib/price-level-seed.ts`**

Change the function signature and body:
```typescript
export function seedDefaultPriceLevel(
  existingPriceLevels: { levelId: string; price: number }[],
  priceLevelDefs: any[],
  currentPrice: number | string | null | undefined,
): { levelId: string; price: number }[] {
  if (existingPriceLevels.length > 0) return existingPriceLevels;
  const defaultLevel = priceLevelDefs.find((l: any) => l.isDefault);
  const price = currentPrice == null ? NaN : Number(currentPrice);
  if (!defaultLevel || !Number.isFinite(price)) return existingPriceLevels;
  return [{ levelId: defaultLevel.id, price: parseFloat(price.toFixed(2)) }];
}
```

- [ ] **Step 7: Update `tests/unit/seed-default-price-level.test.ts`**

Remove `minQuantity: 0` from the two expected-output literals (lines 12 and 19), and remove `minQuantity: 5` from the `existing` input literal (line 24) since that shape no longer includes the field:

```typescript
import assert from 'node:assert/strict';
import { seedDefaultPriceLevel } from '../../lib/price-level-seed';

const levelDefs = [
  { id: 'retail-level', name: 'Retail', isDefault: true, percentageAdjustment: 0 },
  { id: 'wholesale-level', name: 'Wholesale', isDefault: false, percentageAdjustment: -10 },
];

// no existing rows -> seeds a default-level row from the live price
assert.deepEqual(
  seedDefaultPriceLevel([], levelDefs, 100),
  [{ levelId: 'retail-level', price: 100 }],
  'seeds a default row when there are no existing price levels',
);

// price given as a string (e.g. a MySQL decimal column) is coerced correctly
assert.deepEqual(
  seedDefaultPriceLevel([], levelDefs, '133.5'),
  [{ levelId: 'retail-level', price: 133.5 }],
  'coerces a string price and rounds to 2 decimals',
);

// existing rows are never touched, even if only a non-default level is present
const existing = [{ levelId: 'wholesale-level', price: 90 }];
assert.deepEqual(
  seedDefaultPriceLevel(existing, levelDefs, 100),
  existing,
  'never modifies or adds to existing price-level rows',
);

// no default level defined -> leaves an empty array empty, does not guess
assert.deepEqual(
  seedDefaultPriceLevel([], [{ id: 'wholesale-level', isDefault: false, percentageAdjustment: -10 }], 100),
  [],
  'does not seed when no level is marked as default',
);

// missing / non-numeric price -> does not seed
assert.deepEqual(seedDefaultPriceLevel([], levelDefs, null), [], 'does not seed when price is null');
assert.deepEqual(seedDefaultPriceLevel([], levelDefs, undefined), [], 'does not seed when price is undefined');
assert.deepEqual(seedDefaultPriceLevel([], levelDefs, 'not-a-number'), [], 'does not seed when price is non-numeric');

console.log('seed-default-price-level: all assertions passed');
```

- [ ] **Step 8: Run the test**

Run: `npx tsx tests/unit/seed-default-price-level.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add lib/types.ts src/core/products/domain/Product.ts src/core/products/application/CreateProductUseCase.ts app/\(app\)/products/edit-product/product-schema.ts app/\(app\)/products/add-product/product-schema.ts lib/price-level-seed.ts tests/unit/seed-default-price-level.test.ts
git commit -m "$(cat <<'EOF'
refactor: drop minQuantity from price-level types and schemas

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Remove `minQuantity`/`min_quantity` from all write paths

**Files:**
- Modify: `app/(app)/products/actions.ts`
- Modify: `src/infrastructure/repositories/MySqlProductRepository.ts`
- Modify: `lib/price-list-import.ts`
- Modify: `src/infrastructure/services/TransferStockService.ts`
- Modify: `lib/purchase-actions.ts`
- Modify: `app/(app)/products/price-levels/use-manage-price-levels.ts`

**Interfaces:**
- Consumes: `SellingUnitPriceLevel = { levelId: string; price: number }` from Task 1, the trimmed `Product`/`priceLevels` shapes from Task 2.
- Produces: no interface changes — these are internal implementation edits; every function here keeps its existing exported name and call signature except `addPriceLevel`/`updatePriceLevel`, whose `minQuantity` parameter is removed (see Step 6).

- [ ] **Step 1: Update `app/(app)/products/actions.ts` type aliases**

Change both occurrences of:
```typescript
priceLevels?: { levelId: string; price: number; minQuantity?: number }[];
```
(one in the product-input type around line 42, one in `SellingUnitInput` around line 72) to:
```typescript
priceLevels?: { levelId: string; price: number }[];
```

- [ ] **Step 2: Update `replaceSellingUnitPriceLevels`**

Change the parameter type and INSERT:
```typescript
async function replaceSellingUnitPriceLevels(
  connection: any,
  sellingUnitId: string,
  priceLevels: { levelId: string; price: number }[] | undefined,
) {
  await connection.query(
    'DELETE FROM product_selling_unit_price_levels WHERE selling_unit_id = ?',
    [sellingUnitId],
  );
  if (priceLevels && priceLevels.length > 0) {
    for (const pl of priceLevels) {
      await connection.query(
        'INSERT INTO product_selling_unit_price_levels (selling_unit_id, price_level_id, price) VALUES (?, ?, ?)',
        [sellingUnitId, pl.levelId, pl.price],
      );
    }
  }
}
```

- [ ] **Step 3: Update `writeSellingUnits`**

Change the `basePriceLevels` parameter type from `{ levelId: string; price: number; minQuantity?: number }[]` to `{ levelId: string; price: number }[]`, and update all three INSERT sites inside it (base unit's price levels, and the per-extra-unit loop) to drop `min_quantity`:

```typescript
    if (basePriceLevels && basePriceLevels.length > 0) {
      for (const pl of basePriceLevels) {
        await connection.query(
          'INSERT INTO product_selling_unit_price_levels (selling_unit_id, price_level_id, price) VALUES (?, ?, ?)',
          [baseUnitId, pl.levelId, pl.price],
        );
      }
    }
```
and
```typescript
      if (unit.priceLevels && unit.priceLevels.length > 0) {
        for (const pl of unit.priceLevels) {
          await connection.query(
            'INSERT INTO product_selling_unit_price_levels (selling_unit_id, price_level_id, price) VALUES (?, ?, ?)',
            [sellingUnitId, pl.levelId, pl.price],
          );
        }
      }
```

- [ ] **Step 4: Update `getProducts`' read of `product_selling_unit_price_levels`**

Change:
```typescript
    const sulpByUnit = new Map<string, any[]>();
    for (const row of allSulp) {
      if (!sulpByUnit.has(row.selling_unit_id)) sulpByUnit.set(row.selling_unit_id, []);
      sulpByUnit.get(row.selling_unit_id)!.push({
        levelId: row.price_level_id,
        price: Number(row.price),
      });
    }
```
(drop the `minQuantity: row.min_quantity ?? 0,` line).

Then update the sort right below it — since there is at most one row per (selling_unit_id, price_level_id) already (that pair is the table's primary key), the `.filter(...).sort(...)` that picked "the lowest-tier row for the default level" collapses to just the filter (there will only ever be zero or one match):
```typescript
      const basePriceLevels = (baseUnit ? sulpByUnit.get(baseUnit.id) : undefined) || [];
      const retailPriceOverrides = basePriceLevels
        .filter((pl: any) => pl.levelId === defaultLevelId);

      const effectivePrice = retailPriceOverrides.length > 0
        ? retailPriceOverrides[0].price
        : (parseFloat(product.price) || 0);
```

- [ ] **Step 5: Update `updateProductPrice`**

Simplify the branch that used `min_quantity IS NULL OR min_quantity = 0` to distinguish the default-tier row — since the column is going away and `(selling_unit_id, price_level_id)` is the primary key, there is exactly zero or one row to find or update:

```typescript
      if (baseUnitId) {
        const checkSql = `SELECT * FROM product_selling_unit_price_levels WHERE selling_unit_id = ? AND price_level_id = ?`;
        const existing = await connection.query(checkSql, [baseUnitId, defaultLevelId]);

        if (existing.length > 0) {
          await connection.query(
            'UPDATE product_selling_unit_price_levels SET price = ? WHERE selling_unit_id = ? AND price_level_id = ?',
            [newPrice, baseUnitId, defaultLevelId]
          );
        } else {
          await connection.query(
            'INSERT INTO product_selling_unit_price_levels (selling_unit_id, price_level_id, price) VALUES (?, ?, ?)',
            [baseUnitId, defaultLevelId, newPrice]
          );
        }
      }
```

Also delete the now-stale comment above it referencing "Preserve a manually-edited default-tier row" and the `2026-08-04-price-level-row-no-auto-recalc.md` doc pointer, replacing it with a short note:
```typescript
        // Upsert on the real PK (selling_unit_id, price_level_id).
```

- [ ] **Step 6: Update `getPriceLevels`/`addPriceLevel`/`updatePriceLevel`**

In `getPriceLevels`, delete the line:
```typescript
      minQuantity: level.min_quantity,
```

Change `addPriceLevel`'s signature and body:
```typescript
export async function addPriceLevel(name: string, description: string, isDefault: boolean, percentageAdjustment: number, calculationBase: 'retail' | 'cost' = 'retail', adjustmentType: 'percentage' | 'fixed' = 'percentage') {
  try {
    const id = `pl_${Date.now()}`;
    if (isDefault) {
      await query('UPDATE price_levels SET is_default = 0', []);
    }
    await query('INSERT INTO price_levels (id, name, description, is_default, percentage_adjustment, calculation_base, adjustment_type) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, name, description || null, isDefault ? 1 : 0, percentageAdjustment, calculationBase, adjustmentType]);
    return { success: true, message: 'Price level added successfully.' };
  } catch (error) {
    console.error('Error adding price level:', error);
    return { success: false, message: 'Error adding price level.' };
  }
}
```

Change `updatePriceLevel`'s signature and body:
```typescript
export async function updatePriceLevel(id: string, name: string, description: string, isDefault: boolean, percentageAdjustment: number, calculationBase: 'retail' | 'cost' = 'retail', adjustmentType: 'percentage' | 'fixed' = 'percentage') {
  try {
    if (isDefault) {
      await query('UPDATE price_levels SET is_default = 0', []);
    }
    await query('UPDATE price_levels SET name = ?, description = ?, is_default = ?, percentage_adjustment = ?, calculation_base = ?, adjustment_type = ? WHERE id = ?', [name, description || null, isDefault ? 1 : 0, percentageAdjustment, calculationBase, adjustmentType, id]);
    return { success: true, message: 'Price level updated successfully.' };
  } catch (error) {
    console.error('Error updating price level:', error);
    return { success: false, message: 'Error updating price level.' };
  }
}
```

- [ ] **Step 7: Update `app/(app)/products/price-levels/use-manage-price-levels.ts` call sites**

Change:
```typescript
const result = await addPriceLevel(name, description, isDefault, percentageAdjustment, 0, calculationBase, adjustmentType);
```
to:
```typescript
const result = await addPriceLevel(name, description, isDefault, percentageAdjustment, calculationBase, adjustmentType);
```

Change:
```typescript
const result = await updatePriceLevel(id, name, description, isDefault, percentageAdjustment, 0, calculationBase, adjustmentType);
```
to:
```typescript
const result = await updatePriceLevel(id, name, description, isDefault, percentageAdjustment, calculationBase, adjustmentType);
```

- [ ] **Step 8: Update `src/infrastructure/repositories/MySqlProductRepository.ts`**

Change the type:
```typescript
priceLevels?: { levelId: string; price: number }[];
```

Drop `minQuantity: row.min_quantity ?? 0,` from the row-mapping block, and simplify the sort the same way as Step 4 (filter only, no sort needed since there's at most one match):
```typescript
            const baseOverrides = (baseUnit?.priceLevels ?? [])
                .filter((pl: any) => pl.levelId === defaultLevelId);
```

- [ ] **Step 9: Update `lib/price-list-import.ts`**

Change the type:
```typescript
priceLevels?: { levelId: string; price: number }[];
```

Change the INSERT:
```typescript
      for (const pl of product.priceLevels) {
        await query(
          'INSERT INTO product_selling_unit_price_levels (selling_unit_id, price_level_id, price) VALUES (?, ?, ?)',
          [baseUnitId, pl.levelId, pl.price],
        );
      }
```

- [ ] **Step 10: Update `src/infrastructure/services/TransferStockService.ts`**

Change the SELECT and INSERT that copy price-level rows between selling units:
```typescript
        if (sourceBaseUnits && sourceBaseUnits.length > 0) {
            const sourceBaseUnitId = sourceBaseUnits[0].id;
            const [priceLevels]: any = await connection.query(
                'SELECT price_level_id, price FROM product_selling_unit_price_levels WHERE selling_unit_id = ?',
                [sourceBaseUnitId]
            );

            for (const pl of priceLevels) {
                await connection.query(
                    'INSERT INTO product_selling_unit_price_levels (selling_unit_id, price_level_id, price) VALUES (?, ?, ?)',
                    [targetBaseUnitId, pl.price_level_id, pl.price]
                );
            }
        }
```

- [ ] **Step 11: Update `lib/purchase-actions.ts`**

Change the two INSERTs that write a hardcoded `min_quantity` of 0:
```typescript
              await connection.query(
                `INSERT INTO product_selling_unit_price_levels (selling_unit_id, price_level_id, price)
                 VALUES (?, ?, ?)
                 ON DUPLICATE KEY UPDATE price = VALUES(price)`,
                [baseUnitRows[0].id, item.priceLevelId, newValue],
```
and (the other similar block further down):
```typescript
          await connection.query(`
            INSERT INTO product_selling_unit_price_levels (selling_unit_id, price_level_id, price)
            VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE price = VALUES(price)
          `, [baseUnitRows[0].id, defaultLevelId, finalPrice]);
```

Also update the comment above the first one that currently explains the `min_quantity` pitfall — replace it with a note that reflects the current, simpler state:
```typescript
            // Upsert on the real PK (selling_unit_id, price_level_id). Price
            // levels are per selling unit now (product_selling_unit_price_levels);
            // write onto the product's base selling unit, matching every other
            // write path in this codebase.
```

- [ ] **Step 12: Typecheck**

Run: `npm run typecheck`
Expected: no errors referencing `minQuantity`, `min_quantity`, or a wrong argument count for `addPriceLevel`/`updatePriceLevel`. Fix any stragglers this surfaces before moving on.

- [ ] **Step 13: Commit**

```bash
git add app/\(app\)/products/actions.ts src/infrastructure/repositories/MySqlProductRepository.ts lib/price-list-import.ts src/infrastructure/services/TransferStockService.ts lib/purchase-actions.ts app/\(app\)/products/price-levels/use-manage-price-levels.ts
git commit -m "$(cat <<'EOF'
refactor: stop writing min_quantity across all product/price write paths

Covers actions.ts (selling units + legacy price_levels CRUD),
MySqlProductRepository, price-list-import, TransferStockService, and
purchase-actions. addPriceLevel/updatePriceLevel drop their unused
minQuantity parameter; both call sites updated to match.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Remove the "Min Qty" UI from both product forms and the products list

**Files:**
- Modify: `app/(app)/products/edit-product/tabs/conversion-tab.tsx`
- Modify: `app/(app)/products/add-product/tabs/conversion-tab.tsx`
- Modify: `app/(app)/products/edit-product/use-edit-product-form.ts`
- Modify: `app/(app)/products/page.tsx`

**Interfaces:**
- Consumes: the trimmed `{ levelId: string; price?: number }[]` shape from Task 2/3.
- Produces: `PriceLevelOverrides` in both conversion-tab files now takes `values: { levelId: string; price?: number }[]` and `onChange: (next: { levelId: string; price?: number }[]) => void`.

- [ ] **Step 1: Edit `app/(app)/products/edit-product/tabs/conversion-tab.tsx`**

Change the `PriceLevelOverrides` prop types (drop `minQuantity?: number` from both the `values` and `onChange` shapes):
```typescript
function PriceLevelOverrides({
  values,
  onChange,
  requireDefaultLevel = false,
}: {
  values: { levelId: string; price?: number }[];
  onChange: (next: { levelId: string; price?: number }[]) => void;
  requireDefaultLevel?: boolean;
}) {
```

Delete the `setMinQuantity` function entirely (the block from `const setMinQuantity = ...` through its closing `};`).

Replace the row markup — remove the "Min Qty" `<div className="w-[100px]">...</div>` block, and drop the now-unnecessary flex row wrapper since there's only one field left:
```typescript
      {priceLevels.map((level: any) => {
        const entry = values.find(v => v.levelId === level.id);
        const isRequired = level.id === defaultLevelId;
        return (
          <div key={level.id}>
            <Label className="text-xs text-muted-foreground">
              {level.name}
              {isRequired && <span className="text-destructive"> *</span>}
            </Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              placeholder={isRequired ? 'Required' : 'No override'}
              value={entry?.price ?? ''}
              onChange={(e) => setPrice(level.id, e.target.value)}
            />
          </div>
        );
      })}
```

Update the two type annotations further down in `SellingUnitsTab` that reference the old shape:
```typescript
  const allPriceLevelValues = form.watch('priceLevels') || [];
  const basePriceLevelValues: { levelId: string; price?: number }[] =
    allPriceLevelValues.filter((v) => !!v?.levelId) as { levelId: string; price?: number }[];

  const setBasePriceLevels = (next: { levelId: string; price?: number }[]) => {
    replacePriceLevels(next.map(entry => ({ levelId: entry.levelId, price: entry.price ?? 0 })));
  };
```

- [ ] **Step 2: Edit `app/(app)/products/add-product/tabs/conversion-tab.tsx`**

Apply the identical set of edits as Step 1 (this file is a near-duplicate): trim `PriceLevelOverrides`' prop types, delete `setMinQuantity`, remove the Min Qty input block and its flex wrapper, and update `basePriceLevelValues`/`setBasePriceLevels` the same way.

- [ ] **Step 3: Check `use-edit-product-form.ts`'s submit-side type guard**

Change:
```typescript
      const unitPriceLevels = (unit.priceLevels || []).filter(
        (pl): pl is { levelId: string; price: number; minQuantity?: number } => pl.price !== undefined,
      );
```
to:
```typescript
      const unitPriceLevels = (unit.priceLevels || []).filter(
        (pl): pl is { levelId: string; price: number } => pl.price !== undefined,
      );
```

- [ ] **Step 4: Edit `app/(app)/products/page.tsx`**

Remove both `(min N)` badge blocks:
```typescript
                  <span key={pl.levelId} className="text-xs whitespace-nowrap">
                    <span className="text-muted-foreground">{levelName}:</span> ₱{pl.price.toFixed(2)}
                  </span>
```
and
```typescript
                      <span key={pl.levelId} className="text-muted-foreground">
                        {levelName}: <span className="text-foreground">₱{pl.price.toFixed(2)}</span>
                      </span>
```
(i.e. delete the `{typeof pl.minQuantity === 'number' && pl.minQuantity > 0 && (...)}` conditional block from each, keeping the rest of the line intact).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Manual UI check**

Run: `npm run dev`
Navigate to Products → Add Product → Selling Units tab, expand a unit's price levels: confirm each price-level row shows only the Price input (no Min Qty column, no leftover empty space). Repeat on Edit Product for an existing product. Then check the Products list page: confirm price-level badges no longer show `(min N)`.

- [ ] **Step 7: Commit**

```bash
git add app/\(app\)/products/edit-product/tabs/conversion-tab.tsx app/\(app\)/products/add-product/tabs/conversion-tab.tsx app/\(app\)/products/edit-product/use-edit-product-form.ts app/\(app\)/products/page.tsx
git commit -m "$(cat <<'EOF'
feat: remove Min Qty field from Selling Units price-level UI

Removes the per-price-level quantity-tier input from both add/edit
product forms and the (min N) badge from the products list, matching
the removed tiered-pricing resolver logic.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Drop the `min_quantity` columns via migration

**Files:**
- Create: `scripts/migrations/128_drop_price_level_min_quantity.ts`

**Interfaces:**
- Consumes: the `Migration`/`registerMigration` contract from `scripts/migrations/runner.ts` (same pattern as migration 127).
- Produces: `product_selling_unit_price_levels` and `price_levels` no longer have a `min_quantity` column.

- [ ] **Step 1: Write the migration**

```typescript
import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

/**
 * Drops the tiered/quantity-break pricing columns. The feature they backed
 * (a price level auto-applying once sale quantity crosses a threshold) was
 * removed from lib/pricing.ts; these columns had no remaining reader.
 *
 * price_levels.min_quantity was already dead before this migration — no UI
 * ever exposed it and no pricing logic read it, only actions.ts's
 * addPriceLevel/updatePriceLevel round-tripped it.
 */
const migration: Migration = {
  name: '128_drop_price_level_min_quantity',
  timestamp: new Date().toISOString().replace(/T/, '_').replace(/\..+/, '').replace(/:/g, '-'),

  async up(): Promise<void> {
    const sulpColumn: any = await query(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'product_selling_unit_price_levels' AND TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'min_quantity'"
    );
    if (sulpColumn && sulpColumn.length > 0) {
      await query('ALTER TABLE product_selling_unit_price_levels DROP COLUMN min_quantity');
      console.log('✅ dropped min_quantity from product_selling_unit_price_levels');
    } else {
      console.log('⏭️  product_selling_unit_price_levels.min_quantity already gone, skipping');
    }

    const plColumn: any = await query(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'price_levels' AND TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'min_quantity'"
    );
    if (plColumn && plColumn.length > 0) {
      await query('ALTER TABLE price_levels DROP COLUMN min_quantity');
      console.log('✅ dropped min_quantity from price_levels');
    } else {
      console.log('⏭️  price_levels.min_quantity already gone, skipping');
    }
  },

  async down(): Promise<void> {
    // Re-adds both columns empty/defaulted — this does not restore any
    // historical values that existed before up() ran.
    const sulpColumn: any = await query(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'product_selling_unit_price_levels' AND TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'min_quantity'"
    );
    if (!sulpColumn || sulpColumn.length === 0) {
      await query('ALTER TABLE product_selling_unit_price_levels ADD COLUMN min_quantity INT DEFAULT 0');
      console.log('✅ re-added product_selling_unit_price_levels.min_quantity (empty)');
    }

    const plColumn: any = await query(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'price_levels' AND TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'min_quantity'"
    );
    if (!plColumn || plColumn.length === 0) {
      await query('ALTER TABLE price_levels ADD COLUMN min_quantity INT DEFAULT 0');
      console.log('✅ re-added price_levels.min_quantity (empty)');
    }
  }
};

registerMigration(migration);
```

- [ ] **Step 2: Confirm the migration is registered**

Check `scripts/migrations/index.ts` for how prior migrations are wired in (e.g. migration 127) — if it's an explicit import list, add `import './128_drop_price_level_min_quantity';` in the same place/order; if it auto-discovers files by directory scan, no edit is needed there.

- [ ] **Step 3: Run the migration against your local dev DB**

Run: `npm run migrate`
Expected: log lines `✅ dropped min_quantity from product_selling_unit_price_levels` and `✅ dropped min_quantity from price_levels`.

- [ ] **Step 4: Verify the columns are gone**

Run (adjust credentials/db name to your local `.env`): `mysql -u <user> -p<password> <db_name> -e "DESCRIBE product_selling_unit_price_levels; DESCRIBE price_levels;"`
Expected: neither `DESCRIBE` output lists a `min_quantity` row.

- [ ] **Step 5: Run the migration down, then back up, to confirm idempotency and rollback**

Run: `npm run migrate:down`
Expected: log lines `✅ re-added product_selling_unit_price_levels.min_quantity (empty)` and `✅ re-added price_levels.min_quantity (empty)`.

Run: `npm run migrate`
Expected: drops them again cleanly, no errors.

- [ ] **Step 6: Smoke-test the app against the migrated schema**

Run: `npm run dev`, then in the browser: open Add Product, add a selling unit with a price-level override, save. Open Edit Product on an existing product, confirm price levels still load and display correctly. Run a POS sale for that product and confirm checkout still prices it correctly (using the active price level, no quantity-based change).

- [ ] **Step 7: Commit**

```bash
git add scripts/migrations/128_drop_price_level_min_quantity.ts
git commit -m "$(cat <<'EOF'
migrate: drop min_quantity from product_selling_unit_price_levels and price_levels

Both columns backed the tiered/quantity-break pricing feature removed
in prior commits. Neither has a NOT NULL/FK constraint, so this is a
clean drop with no data migration needed.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Full-repo verification sweep

**Files:** none created or modified — this task only runs checks.

**Interfaces:** none.

- [ ] **Step 1: Grep for any remaining reference**

Run: `grep -rn "minQuantity\|min_quantity" --include="*.ts" --include="*.tsx" app lib src scripts tests` (exclude `docs/` — historical plan/spec docs are expected to still mention it) and confirm the only remaining hits are: (a) this plan and its spec under `docs/`, (b) `setup_integration_test.ts` (explicitly out of scope per Global Constraints — it already references a dropped legacy table), and (c) `schema.sql`/`verdix_install.sql` (explicitly out of scope per Global Constraints).

- [ ] **Step 2: Full typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Run all unit tests touched by this plan**

Run: `npx tsx tests/unit/pricing.test.ts && npx tsx tests/unit/seed-default-price-level.test.ts`
Expected: both print their success line and exit 0.

- [ ] **Step 4: Run the product/POS E2E specs**

Run: `npm run test:e2e -- --grep "product|pos|price"` (adjust the grep filter to match whatever spec file naming the repo actually uses — check `tests/e2e/` for exact spec names if this filter matches nothing)
Expected: all matched specs pass. Per project memory, note that some pre-existing E2E flakiness exists in this repo independent of this change (e.g. `bulk-price-update.spec.ts`) — if an unrelated spec fails, re-run once before treating it as a regression.

- [ ] **Step 5: Report status**

No commit for this task — if all checks pass, the branch is ready for the requesting-code-review skill. If any check surfaces a real gap, fix it as a new task appended to this plan (do not silently patch and skip re-verification).
