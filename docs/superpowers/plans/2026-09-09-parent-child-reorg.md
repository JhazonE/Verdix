# Parent/Child Product Reorganization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each child product its own markup percentage, move the child list out of the products table into a dedicated dialog, and badge any product shown outside its family with its parent.

**Architecture:** A new nullable `products.markup_percentage` column becomes the highest-priority source in the existing markup resolution chain, which lives in one pure function (`lib/purchase-utils.ts`). The products list drops its inline expandable tree — including a recursive CTE that exists only to feed it — and renders a flat top-level list with two badges. A new dialog fetches a parent's direct children on demand and edits their markups in one batch save.

**Tech Stack:** Next.js 16 (App Router, server actions), MySQL 8 via raw `mysql2/promise`, React with `@tanstack/react-query`, shadcn/ui dialogs and tables, `node:assert/strict` unit tests, Playwright E2E.

**Spec:** `docs/superpowers/specs/2026-09-09-parent-child-reorg-design.md`

## Global Constraints

- **Markup is a suggestion only.** No task in this plan writes to `products.price`. Setting a markup never changes what a product sells for.
- **`NULL` means inherit; `0` is a real value.** An empty markup field falls through to the subcategory → category → brand → supplier → global chain. A typed `0` means "sell at cost" and does not inherit. Never coerce one into the other (no `|| 0`, no `Number(undefined)`).
- **A per-product markup applies even when `enableAutomaticMarkup` is off.** That toggle governs only the *inherited* sources.
- **MySQL only, raw SQL.** No ORM. All DB access goes through `query()` from `lib/mysql`.
- **Unit tests use `node:assert/strict`** and self-execute on import. Every new test file must be registered in `tests/unit/run.ts` or it never runs.
- **Migrations** register via `registerMigration()` and must be imported in `scripts/migrations/index.ts`.
- **Verification baseline is red.** `npm run lint` is broken, `npm run typecheck` reports pre-existing errors, and the E2E suite has known failures (`bulk-price-update.spec.ts:87` fails ~40% of runs on unchanged code). Before attributing any failure to your change, capture the same command's output on `git stash`ed state and compare. Never call a pre-existing failure a regression.

---

### Task 1: Add the `markup_percentage` column

**Files:**
- Create: `scripts/migrations/117_add_product_markup_percentage.ts`
- Modify: `scripts/migrations/index.ts` (append one import after `'./116_normalize_product_unit_labels'`)

**Interfaces:**
- Consumes: nothing (first task)
- Produces: `products.markup_percentage DECIMAL(6,2) NULL DEFAULT NULL` — every later task depends on this column existing.

- [ ] **Step 1: Write the migration**

Create `scripts/migrations/117_add_product_markup_percentage.ts`:

```typescript
import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

/**
 * Per-product markup override.
 *
 * Markup was previously resolved only from subcategory/category/brand/supplier
 * (see calculateMarkupPercentage in lib/purchase-utils.ts), so every unit in a
 * product family inherited the same percentage. A 25kg sack and a 500g repack
 * do not carry the same margin in practice.
 *
 * NULL means "inherit" — fall through to the existing chain. 0 is a real value
 * meaning "sell at cost" and does NOT inherit. Keep that distinction: it is
 * what lets the UI show an empty field as inherited.
 */
const migration: Migration = {
  name: '117_add_product_markup_percentage',
  timestamp: '2026-09-09_12-00-00',

  async up(): Promise<void> {
    const existing: any = await query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'products'
         AND COLUMN_NAME = 'markup_percentage'`
    );
    if (existing[0]) {
      console.log('⏭️  products.markup_percentage already exists, skipping');
      return;
    }

    await query(
      `ALTER TABLE products
         ADD COLUMN markup_percentage DECIMAL(6,2) NULL DEFAULT NULL`
    );
    console.log('✅ added products.markup_percentage');
  },

  async down(): Promise<void> {
    await query('ALTER TABLE products DROP COLUMN markup_percentage');
    console.log('✅ dropped products.markup_percentage');
  }
};

registerMigration(migration);
```

- [ ] **Step 2: Register the migration**

In `scripts/migrations/index.ts`, add directly after the `'./116_normalize_product_unit_labels'` import line:

```typescript
import './117_add_product_markup_percentage';
```

- [ ] **Step 3: Run the migration**

Run: `npm run migrate`
Expected: output contains `✅ added products.markup_percentage`

- [ ] **Step 4: Verify the column exists and defaults to NULL**

Run:
```bash
node -e "require('tsx/cjs'); const {query}=require('./lib/mysql'); query(\"SHOW COLUMNS FROM products LIKE 'markup_percentage'\").then(r=>{console.log(r); process.exit(0)})"
```
Expected: one row, `Null: YES`, `Default: NULL`, `Type: decimal(6,2)`.

If that one-liner is awkward in your shell, an equivalent check is fine — the requirement is that you confirm the column is nullable with a NULL default before moving on.

- [ ] **Step 5: Verify the rollback works, then re-apply**

Run: `npm run migrate:down`
Expected: `✅ dropped products.markup_percentage`

Run: `npm run migrate`
Expected: `✅ added products.markup_percentage`

This proves `down()` is real before anything depends on the column.

- [ ] **Step 6: Commit**

```bash
git add scripts/migrations/117_add_product_markup_percentage.ts scripts/migrations/index.ts
git commit -m "feat: add products.markup_percentage column"
```

---

### Task 2: Per-product override in the markup resolver

**Files:**
- Modify: `lib/purchase-utils.ts:124-206` (`calculateMarkupPercentage`)
- Create: `tests/unit/product-markup-resolution.test.ts`
- Modify: `tests/unit/run.ts` (register the new test)

**Interfaces:**
- Consumes: `products.markup_percentage` from Task 1.
- Produces: `calculateMarkupPercentage(product, settings, categories, subcategories, brands, suppliers)` where `product` now accepts `markupPercentage?: number | null`. Returns `{ markup: number; source: string }` with `source === 'Product'` for an override. Tasks 5, 6, and 7 call this with the new field.

**Context you need:** the current function returns `{ markup: 0, source: '' }` immediately when `settings.enableAutomaticMarkup` is falsy (line 132). The override check must go **above** that early return — see Global Constraints.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/product-markup-resolution.test.ts`:

```typescript
import assert from 'node:assert/strict';
import { calculateMarkupPercentage } from '../../lib/purchase-utils';

// Fixtures: a category that would supply 12% if nothing overrides it.
const settings = {
  enableAutomaticMarkup: true,
  markupPriority: ['subcategory', 'category', 'brand', 'supplier'],
};
const categories = [{ id: 'cat1', name: 'Grocery', markupPercentage: 12 }];
const subcategories: any[] = [];
const brands = [{ id: 'br1', name: 'Acme', markupPercentage: 30 }];
const suppliers = [{ id: 'sup1', name: 'Supplier A', markupPercentage: 40 }];

const resolve = (product: any, s: any = settings) =>
  calculateMarkupPercentage(product, s, categories, subcategories, brands, suppliers);

// --- inheritance still works when there is no override ---
{
  const { markup, source } = resolve({ category: 'Grocery' });
  assert.equal(markup, 12, 'null markup inherits the category markup');
  assert.equal(source, 'Category', 'source names the inherited origin');
}

// --- a per-product markup overrides every inherited source ---
{
  const { markup, source } = resolve({
    markupPercentage: 25,
    category: 'Grocery',
    brand: 'Acme',
    supplierId: 'sup1',
  });
  assert.equal(markup, 25, 'per-product markup wins over category/brand/supplier');
  assert.equal(source, 'Product', 'source is Product for an override');
}

// --- 0 is a real value and does NOT inherit ---
{
  const { markup, source } = resolve({ markupPercentage: 0, category: 'Grocery' });
  assert.equal(markup, 0, '0 means sell at cost, it does not fall through');
  assert.equal(source, 'Product', '0 is still a deliberate product-level entry');
}

// --- null and undefined both mean inherit ---
{
  assert.equal(resolve({ markupPercentage: null, category: 'Grocery' }).markup, 12,
    'null markup inherits');
  assert.equal(resolve({ markupPercentage: undefined, category: 'Grocery' }).markup, 12,
    'undefined markup inherits');
}

// --- the automatic-markup toggle suppresses inheritance but NOT an override ---
{
  const off = { ...settings, enableAutomaticMarkup: false };

  const inherited = resolve({ category: 'Grocery' }, off);
  assert.equal(inherited.markup, 0, 'inherited markup is suppressed when the toggle is off');
  assert.equal(inherited.source, '', 'no source when suppressed');

  const overridden = resolve({ markupPercentage: 25, category: 'Grocery' }, off);
  assert.equal(overridden.markup, 25,
    'a deliberate per-product markup survives the automatic-markup toggle being off');
  assert.equal(overridden.source, 'Product', 'source is still Product');
}

// --- a non-numeric override is ignored rather than producing NaN ---
{
  const { markup } = resolve({ markupPercentage: NaN as any, category: 'Grocery' });
  assert.equal(markup, 12, 'NaN is not a usable override, fall through to inheritance');
}

console.log('✅ product-markup-resolution tests passed');
```

- [ ] **Step 2: Register the test**

In `tests/unit/run.ts`, add at the end of the import list:

```typescript
import './product-markup-resolution.test';
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test:unit`
Expected: FAIL — the override assertion throws (`markup` is 12, not 25) because the field is not read yet.

Note: `lib/mysql` starts cron workers on import, so this command may not exit on its own. The pass/fail line is the signal — read the output, then interrupt if it hangs.

- [ ] **Step 4: Implement the override**

In `lib/purchase-utils.ts`, extend the signature at line 124-131:

```typescript
export function calculateMarkupPercentage(
  product: {
    markupPercentage?: number | null;
    category?: string;
    subcategory?: string;
    brand?: string;
    supplierId?: string;
  },
  settings: any,
  categories: any[] = [],
  subcategories: any[] = [],
  brands: any[] = [],
  suppliers: any[] = []
): { markup: number; source: string } {
```

Then insert this block as the **first statement in the body**, above the existing `if (!settings?.enableAutomaticMarkup)` early return:

```typescript
  // A markup typed against one specific product is a deliberate entry, not a
  // guess the system made from its category or brand — so it takes precedence
  // over every inherited source AND survives enableAutomaticMarkup being off.
  // That toggle governs only the inherited chain below.
  //
  // 0 is a real value here (sell at cost) and must not fall through, which is
  // why this tests for a finite number rather than truthiness.
  const ownMarkup = product.markupPercentage;
  if (ownMarkup !== null && ownMarkup !== undefined && Number.isFinite(Number(ownMarkup))) {
    return { markup: Number(ownMarkup), source: 'Product' };
  }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test:unit`
Expected: `✅ product-markup-resolution tests passed`, and every previously passing test file still passes.

- [ ] **Step 6: Commit**

```bash
git add lib/purchase-utils.ts tests/unit/product-markup-resolution.test.ts tests/unit/run.ts
git commit -m "feat: per-product markup overrides the inherited markup chain"
```

---

### Task 3: Markup validation helper

**Files:**
- Create: `lib/markup-validation.ts`
- Create: `tests/unit/markup-validation.test.ts`
- Modify: `tests/unit/run.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `isValidMarkupValue(value: number | null): boolean` and `MARKUP_MAX = 1000`. Task 4's `updateChildMarkups` and Task 8's dialog both import these, so the server and the UI reject exactly the same values.

**Why a separate module:** the dialog needs to disable Save on an invalid entry *before* calling the server, and the server must not trust the client. One shared function keeps the two rules from drifting — the same reason `lib/price-update-math.ts` exposes `isValidPriceValue`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/markup-validation.test.ts`:

```typescript
import assert from 'node:assert/strict';
import { isValidMarkupValue, MARKUP_MAX } from '../../lib/markup-validation';

// null is valid: it means "inherit from category/brand/supplier"
assert.equal(isValidMarkupValue(null), true, 'null is valid and means inherit');

// 0 is valid and distinct from null: sell at cost
assert.equal(isValidMarkupValue(0), true, '0 is a valid markup (sell at cost)');

// ordinary values
assert.equal(isValidMarkupValue(25), true, '25% is valid');
assert.equal(isValidMarkupValue(12.5), true, 'fractional markup is valid');
assert.equal(isValidMarkupValue(MARKUP_MAX), true, 'the maximum itself is valid');

// negatives are rejected — selling below cost is expressed as a manual price,
// not as a negative markup
assert.equal(isValidMarkupValue(-1), false, 'a negative markup is invalid');

// above the ceiling
assert.equal(isValidMarkupValue(MARKUP_MAX + 0.01), false, 'above the max is invalid');

// non-finite values (an empty or garbled numeric input)
assert.equal(isValidMarkupValue(NaN), false, 'NaN is invalid');
assert.equal(isValidMarkupValue(Infinity), false, 'Infinity is invalid');

assert.equal(MARKUP_MAX, 1000, 'the documented ceiling is 1000%');

console.log('✅ markup-validation tests passed');
```

- [ ] **Step 2: Register the test**

In `tests/unit/run.ts`, add:

```typescript
import './markup-validation.test';
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test:unit`
Expected: FAIL — `Cannot find module '../../lib/markup-validation'`.

- [ ] **Step 4: Write the implementation**

Create `lib/markup-validation.ts`:

```typescript
/**
 * Shared markup validation, used by both the child-units dialog (to disable
 * Save before a round trip) and updateChildMarkups (which must not trust the
 * client). Keeping one function stops the two rules from drifting apart.
 */

/** Highest accepted markup percentage. 1000% is far past any real retail margin. */
export const MARKUP_MAX = 1000;

/**
 * `null` is valid and means "inherit from the category/brand/supplier chain".
 * `0` is also valid and means "sell at cost" — it is NOT the same as null.
 * Negatives are rejected: selling below cost is done by typing a manual price.
 */
export function isValidMarkupValue(value: number | null): boolean {
  if (value === null) return true;
  return Number.isFinite(value) && value >= 0 && value <= MARKUP_MAX;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test:unit`
Expected: `✅ markup-validation tests passed`

- [ ] **Step 6: Commit**

```bash
git add lib/markup-validation.ts tests/unit/markup-validation.test.ts tests/unit/run.ts
git commit -m "feat: add shared markup validation helper"
```

---

### Task 4: Server data layer — read markup, count children, name parents, save markups

**Files:**
- Modify: `app/(app)/products/actions.ts` — `getProducts` (SQL ~line 65-160, row mapping ~line 258-297), `getChildProducts` (line 2257), plus a new exported action
- Modify: `lib/types.ts` — the `Product` interface

**Interfaces:**
- Consumes: `products.markup_percentage` (Task 1), `isValidMarkupValue` / `MARKUP_MAX` (Task 3).
- Produces:
  - `Product.markupPercentage?: number | null`, `Product.childCount?: number`, `Product.parentName?: string | null`
  - `getChildProducts(parentId: string)` — rows now carry `markupPercentage`, `childCount`, and `conversionFactor`
  - `updateChildMarkups(rows: { id: string; markupPercentage: number | null }[]): Promise<{ success: boolean; message: string }>`

Tasks 6 and 8 consume all of these.

- [ ] **Step 1: Add the fields to the `Product` type**

In `lib/types.ts`, inside the `Product` interface, add:

```typescript
  /** Per-product markup override. null = inherit from category/brand/supplier. */
  markupPercentage?: number | null;
  /** Number of direct children. Populated by getProducts for the list badge. */
  childCount?: number;
  /** Name of this product's parent, when it has one. Drives the "↳ parent" badge. */
  parentName?: string | null;
```

- [ ] **Step 2: Add the badge columns to the `getProducts` query**

In `app/(app)/products/actions.ts`, in the `getProducts` SELECT list (starts line ~68), add these two lines alongside the existing computed columns:

```sql
             (SELECT COUNT(*) FROM products c WHERE c.parent_id = p.id) AS child_count,
             parent_p.name AS parent_name,
```

and add this JOIN next to the existing `LEFT JOIN` clauses:

```sql
      LEFT JOIN products parent_p ON p.parent_id = parent_p.id
```

Use the alias `parent_p`, not `parent` — `parent` is already used as a table alias inside `getChildProducts` and reusing the name across this file invites confusion.

- [ ] **Step 3: Map the new columns onto the returned object**

In the `getProducts` return mapping (~line 258-297), alongside `parentId: product.parent_id,` add:

```typescript
        markupPercentage: product.markup_percentage === null || product.markup_percentage === undefined
          ? null
          : Number(product.markup_percentage),
        childCount: Number(product.child_count ?? 0),
        parentName: product.parent_name ?? null,
```

`DECIMAL` comes back from mysql2 as a string, so the `Number()` conversion is required — but only when the value is not null, or `Number(null)` would silently turn "inherit" into `0`.

- [ ] **Step 4: Extend `getChildProducts`**

Replace the query in `getChildProducts` (line ~2258) with:

```typescript
export async function getChildProducts(parentId: string) {
  try {
    const products = await query(`
      SELECT p.*, p.parent_id as parentId, p.conversion_factor as conversionFactor,
             COALESCE(w.name, pw.name) as warehouseName,
             (SELECT GROUP_CONCAT(sl.name) FROM product_shelves ps JOIN shelf_locations sl ON ps.shelf_id = sl.id WHERE ps.product_id = p.id) as shelfLocationNames,
             (SELECT COUNT(*) FROM products c WHERE c.parent_id = p.id) as childCount
      FROM products p
      LEFT JOIN warehouses w ON p.warehouse_id = w.id
      LEFT JOIN products parent ON p.parent_id = parent.id
      LEFT JOIN warehouses pw ON parent.warehouse_id = pw.id
      WHERE p.parent_id = ?
      ORDER BY p.name
    `, [parentId]);

    return (products as any[]).map((p) => ({
      ...p,
      markupPercentage: p.markup_percentage === null || p.markup_percentage === undefined
        ? null
        : Number(p.markup_percentage),
      childCount: Number(p.childCount ?? 0),
      cost: p.cost === null || p.cost === undefined ? undefined : parseFloat(p.cost),
      price: p.price === null || p.price === undefined ? undefined : parseFloat(p.price),
      unitOfMeasure: p.unit_of_measure,
    }));
  } catch (error) {
    console.error('Error fetching child products:', error);
    return [];
  }
}
```

The `ORDER BY p.name` is new — the dialog lists units and an unordered list reshuffles between opens.

- [ ] **Step 5: Write the `updateChildMarkups` action**

Add to `app/(app)/products/actions.ts` (near the other product mutations). This file wraps transactions with `withTransaction` from `@/lib/mysql` — already imported at line 3, and used at lines 474, 623, 770, and 850. It commits, rolls back, and releases the connection for you, so do not call `beginTransaction`/`commit`/`rollback`/`release` yourself:

```typescript
/**
 * Batch-saves per-product markup overrides from the child-units dialog.
 *
 * markupPercentage null clears the override so the product inherits again;
 * 0 is a real value meaning "sell at cost". This never touches products.price
 * — markup only ever suggests a price, the user still sets the real one.
 */
export async function updateChildMarkups(
  rows: { id: string; markupPercentage: number | null }[]
): Promise<{ success: boolean; message: string }> {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { success: false, message: 'No markups to save.' };
  }

  // Validate everything BEFORE opening a transaction: one bad row rejects the
  // whole batch, so there is nothing to roll back.
  for (const row of rows) {
    if (!row?.id) {
      return { success: false, message: 'A markup row is missing its product id.' };
    }
    if (!isValidMarkupValue(row.markupPercentage)) {
      return {
        success: false,
        message: `Invalid markup for product ${row.id}. Enter a value between 0 and ${MARKUP_MAX}, or leave it blank to inherit.`,
      };
    }
  }

  try {
    await withTransaction(async (connection) => {
      for (const row of rows) {
        await connection.query(
          'UPDATE products SET markup_percentage = ? WHERE id = ?',
          [row.markupPercentage, row.id]
        );
      }
    });
    return { success: true, message: `Saved markup for ${rows.length} product(s).` };
  } catch (error) {
    console.error('Error updating child markups:', error);
    return { success: false, message: 'Error saving markups.' };
  }
}
```

Add the import at the top of the file:

```typescript
import { isValidMarkupValue, MARKUP_MAX } from '@/lib/markup-validation';
```

- [ ] **Step 6: Verify the query changes against the real database**

Start the dev server (`npm run dev`), open `/products`, and confirm in the browser devtools Network/React Query state — or with a `console.log` in the action — that products come back with `childCount` as a number and `parentName` populated for children. A parent with known children must report a non-zero `childCount`.

This is a manual check because `getProducts` is a server action against live MySQL with no existing unit-test harness. Do not skip it: Steps 2-4 are raw SQL edits and a typo here surfaces as a silently empty badge.

- [ ] **Step 7: Commit**

```bash
git add app/\(app\)/products/actions.ts lib/types.ts
git commit -m "feat: expose child counts, parent names, and markup saving"
```

---

### Task 5: Pass markup through the product forms

**Files:**
- Modify: `app/(app)/products/add-product/use-add-product-form.ts:277`
- Modify: `app/(app)/products/edit-product/use-edit-product-form.ts:251`
- Modify: `app/(app)/purchases/add-purchase-order/add-purchase-order-dialog.tsx:342`

**Interfaces:**
- Consumes: `calculateMarkupPercentage` with `markupPercentage` (Task 2), `Product.markupPercentage` (Task 4).
- Produces: nothing new — this task only makes the three existing call sites honour an override.

**Why this matters:** without it, a markup saved in the dialog would be invisible in the Edit Product form, which would still show the inherited percentage and suggest a price from it. The two screens would disagree.

- [ ] **Step 1: Update the add-product call site**

In `use-add-product-form.ts`, the `calculateMarkupPercentage` call at line ~277 passes an object literal. Add the markup field as its first property:

```typescript
    const { markup, source } = calculateMarkupPercentage(
        {
            markupPercentage: form.getValues('markupPercentage') ?? null,
            category: watchedCategoryName,
            subcategory: watchedSubcategoryName,
            brand: watchedBrandName,
            supplierId: watchedSupplierId
        },
        ...
```

If the add-product form has no `markupPercentage` field in its schema, pass `null` instead of the `form.getValues(...)` call — a brand-new product has no override yet, and adding a markup input to this form is out of scope.

- [ ] **Step 2: Update the edit-product call site**

In `use-edit-product-form.ts` at line ~251, pass the product's saved override into the same position:

```typescript
    const { markup, source } = calculateMarkupPercentage(
        {
            markupPercentage: product?.markupPercentage ?? null,
            category: watchedCategoryName,
            subcategory: watchedSubcategoryName,
            brand: watchedBrandName,
            supplierId: watchedSupplierId
        },
        ...
```

Use whatever identifier this hook already uses for the product being edited — read the surrounding lines rather than assuming the name `product`.

- [ ] **Step 3: Update the purchase-order call site**

In `add-purchase-order-dialog.tsx` at line ~342, the call resolves a markup for a product being added to an order. Pass that product's override the same way:

```typescript
                            const { markup, source } = calculateMarkupPercentage(
                                {
                                    markupPercentage: selectedProduct?.markupPercentage ?? null,
                                    ...
```

Again, use the identifier already in scope at that line.

- [ ] **Step 4: Verify the source label appears**

Run `npm run dev`, open a product that has a markup override (set one directly in MySQL for this check:
`UPDATE products SET markup_percentage = 25 WHERE id = '<some product id>'`),
and open its Edit Product dialog.

Expected: the markup hint under the price reads `Calculated from Product Markup (25%)` rather than naming a category or brand.

Then clear it (`UPDATE products SET markup_percentage = NULL WHERE id = '<same id>'`) and confirm the hint reverts to the inherited source.

- [ ] **Step 5: Commit**

```bash
git add app/\(app\)/products/add-product/use-add-product-form.ts app/\(app\)/products/edit-product/use-edit-product-form.ts app/\(app\)/purchases/add-purchase-order/add-purchase-order-dialog.tsx
git commit -m "feat: honour per-product markup in product and purchase forms"
```

---

### Task 6: Flatten the products list and add the badges

**Files:**
- Modify: `app/(app)/products/page.tsx` — `ProductRow` (line 57), the child render (line 277), `ProductWithChildren` (line 330), `buildTree` (line 457)
- Modify: `app/(app)/products/actions.ts:158-215` — delete the recursive CTE block

**Interfaces:**
- Consumes: `Product.childCount`, `Product.parentName` (Task 4).
- Produces: an `onManageChildren(product: Product)` callback wired to both the badge and the dropdown item. Task 8 attaches the dialog to it.

**Read before editing:** `getProducts` already restricts to `p.parent_id IS NULL` when unfiltered (line 141) and `getProductsCount` already counts the same way (line 369). **Pagination is already correct — change neither.** The recursive CTE exists only to hydrate descendants for the inline tree.

- [ ] **Step 1: Delete the recursive CTE**

In `app/(app)/products/actions.ts`, delete the entire block from line 158 (`if (!hasActiveFilters && limit !== undefined && offset !== undefined && pagedProducts.length > 0) {`) through its closing brace at line ~215, including the `try`/`catch` fallback and the `recursiveSql` string.

Keep the line above it:

```typescript
    let products = pagedProducts;
```

That single assignment is now the whole behaviour: the page shows exactly the rows the paged query returned.

- [ ] **Step 2: Remove the tree building from the page**

In `app/(app)/products/page.tsx`:

- Delete the `buildTree` function and the tree branch inside the `productTree` memo (line ~457). Replace the whole memo body with:

```typescript
  const productTree = useMemo(() => {
    // Children live in the child-units dialog now, so the table is always a
    // flat list. In the unfiltered view getProducts returns top-level products
    // only; under a filter it returns matches at any depth, which is where the
    // "↳ parent" badge earns its place.
    return products ?? [];
  }, [products]);
```

- Delete the `ProductWithChildren` interface (line ~330) and replace its uses with `Product`.
- In `ProductRow`, delete the `depth` prop, `indentStyle`, `hasChildren`, the `isOpen` state, the chevron `Button` (line ~136), the `depth > 0` spacer branch, and the recursive child render block at line ~277.
- Remove `depth={depth + 1}` and the `cn(depth > 0 && "bg-muted/20")` row class.
- In the list render (line ~895), the map callback is now `(product: Product)`.

- [ ] **Step 3: Add the child-count badge**

In `ProductRow`, beside the product name, add:

```tsx
{(product.childCount ?? 0) > 0 && (
  <Badge
    variant="secondary"
    className="ml-2 cursor-pointer hover:bg-secondary/80"
    onClick={(e) => { e.stopPropagation(); onManageChildren?.(product); }}
  >
    {product.childCount} {product.childCount === 1 ? 'child' : 'children'}
  </Badge>
)}
```

`stopPropagation` matters — the row itself may already respond to clicks.

- [ ] **Step 4: Add the parent badge**

Directly below the product name in the same cell:

```tsx
{product.parentName && (
  <div className="text-xs text-muted-foreground mt-0.5">
    ↳ {product.parentName}
  </div>
)}
```

Read-only by design: it tells the user which family the row belongs to. In the unfiltered view no row has a `parentName`, so this only appears under a filter or search — exactly where a child would otherwise show up with no context.

- [ ] **Step 5: Replace the dropdown item**

In `ProductRow`'s dropdown menu, remove the `Add Child Product` item and the `QuickAddChildDialog` instance it opened (along with the now-unused `addChildDialogOpen` state). Add in its place:

```tsx
<DropdownMenuItem onSelect={() => setTimeout(() => onManageChildren?.(product), 0)}>
  Manage Child Units
</DropdownMenuItem>
```

This shows for **every** product, including childless ones — the badge only appears when children exist, so without this menu item a product with no children would have no way to gain its first one.

Add `onManageChildren?: (product: Product) => void;` to `ProductRow`'s props and thread it from the page component. For now the page can define it as a `useState` setter holding the product whose dialog is open; Task 8 renders the dialog from that state.

- [ ] **Step 6: Verify the list renders flat**

Run `npm run dev` and open `/products`.

Expected:
- No chevrons, no indented rows.
- A parent product shows an `N children` badge.
- Search for a known child by name: its row appears with a `↳ <parent>` badge under the name.
- Clear the search: that child is no longer in the table.
- Page size is consistent — every full page shows the same number of rows.

- [ ] **Step 7: Confirm you have not broken the baseline**

Run: `npm run typecheck`

The baseline is already red, so compare: run it once on your branch, then `git stash && npm run typecheck && git stash pop` and diff the two outputs. Expected: **no new errors** naming `page.tsx` or `actions.ts`. Fix any that are yours; leave pre-existing ones alone.

- [ ] **Step 8: Commit**

```bash
git add app/\(app\)/products/page.tsx app/\(app\)/products/actions.ts
git commit -m "feat: flatten products list with child-count and parent badges"
```

---

### Task 7: Child-units dialog — read-only table

**Files:**
- Create: `app/(app)/products/child-units/use-child-units.ts`
- Create: `app/(app)/products/child-units/ChildUnitsDialog.tsx`
- Modify: `app/(app)/products/page.tsx` (render the dialog)

**Interfaces:**
- Consumes: `getChildProducts` (Task 4), `calculateMarkupPercentage` + `calculateSuggestedPrice` (Task 2 / existing), `onManageChildren` state (Task 6).
- Produces: `<ChildUnitsDialog product={...} open={...} onOpenChange={...} onSaved={...} />` and the `useChildUnits` hook. Task 8 adds editing and saving on top of this.

This task delivers a working read-only dialog. Editing is Task 8 so that a reviewer can reject the editing model without rejecting the fetch-and-render work.

- [ ] **Step 1: Write the hook**

Create `app/(app)/products/child-units/use-child-units.ts`:

```typescript
'use client';

import { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getChildProducts } from '../actions';
import { calculateMarkupPercentage, calculateSuggestedPrice } from '@/lib/purchase-utils';
import { getApiUrl } from '@/lib/api-config';
import type { Product, SystemSettings } from '@/lib/types';

export type ChildUnitRow = {
  id: string;
  name: string;
  unitOfMeasure?: string;
  conversionFactor?: number;
  stock?: number;
  cost?: number;
  price?: number;
  childCount: number;
  /** Saved override. null = inherits. */
  markupPercentage: number | null;
};

export function useChildUnits({
  product,
  open,
  productOptions,
}: {
  product?: Product | null;
  open: boolean;
  productOptions?: any;
}) {
  // The products page has neither systemSettings nor priceLevels in scope, so
  // this hook sources them the same way use-edit-product-form.ts does: price
  // levels ride along on productOptions, settings are fetched here.
  const priceLevels: any[] = productOptions?.priceLevels ?? [];

  // Same fetch as use-edit-product-form.ts:103 — one settings endpoint, one shape.
  const [systemSettings, setSystemSettings] = useState<SystemSettings | null>(null);
  useEffect(() => {
    fetch(getApiUrl('/pos-settings'))
      .then(res => res.json())
      .then(data => {
        if (data.success) setSystemSettings(data.data);
      })
      .catch(err => console.error('Failed to fetch settings', err));
  }, []);

  // The dialog can re-target itself at a child that has its own children, so
  // the parent being viewed is state, not just the prop. `trail` is the way
  // back up.
  const [viewedParent, setViewedParent] = useState<Product | null>(product ?? null);
  const [trail, setTrail] = useState<Product[]>([]);

  useEffect(() => {
    if (open) {
      setViewedParent(product ?? null);
      setTrail([]);
    }
  }, [open, product]);

  const { data: children = [], isLoading, refetch } = useQuery({
    queryKey: ['child-units', viewedParent?.id],
    queryFn: () => getChildProducts(viewedParent!.id),
    enabled: open && !!viewedParent?.id,
  });

  const rows: ChildUnitRow[] = (children as any[]).map((c) => ({
    id: c.id,
    name: c.name,
    unitOfMeasure: c.unitOfMeasure ?? c.unit_of_measure,
    conversionFactor: c.conversionFactor ?? undefined,
    stock: c.stock === null || c.stock === undefined ? undefined : Number(c.stock),
    cost: c.cost,
    price: c.price,
    childCount: c.childCount ?? 0,
    markupPercentage: c.markupPercentage ?? null,
  }));

  /**
   * What this row would inherit if its override were cleared — shown as a hint
   * under an empty markup field so the user knows what "blank" actually means.
   */
  const inheritedFor = useCallback(
    (row: ChildUnitRow, raw: any) => {
      const { markup, source } = calculateMarkupPercentage(
        {
          markupPercentage: null, // deliberately ignore the override
          category: raw?.category,
          subcategory: raw?.subcategory,
          brand: raw?.brand,
          supplierId: raw?.supplier_id,
        },
        systemSettings,
        productOptions?.categories ?? [],
        productOptions?.subcategories ?? [],
        productOptions?.brands ?? [],
        productOptions?.suppliers ?? []
      );
      return { markup, source };
    },
    [systemSettings, productOptions]
  );

  /** Suggested price for a given markup. Never written to products.price. */
  const suggestedPrice = useCallback(
    (cost: number | undefined, markup: number) => {
      if (cost === undefined || cost === null) return undefined;
      const defaultLevel = (priceLevels ?? []).find((l: any) => l.isDefault) ?? (priceLevels ?? [])[0];
      return calculateSuggestedPrice(cost, markup, 0, defaultLevel);
    },
    [priceLevels]
  );

  const drillInto = useCallback((child: Product) => {
    setTrail((t) => [...t, viewedParent!].filter(Boolean) as Product[]);
    setViewedParent(child);
  }, [viewedParent]);

  const goBack = useCallback(() => {
    setTrail((t) => {
      const next = [...t];
      const previous = next.pop();
      if (previous) setViewedParent(previous);
      return next;
    });
  }, []);

  return {
    viewedParent,
    rows,
    rawChildren: children as any[],
    isLoading,
    refetch,
    inheritedFor,
    suggestedPrice,
    drillInto,
    goBack,
    canGoBack: trail.length > 0,
  };
}
```

- [ ] **Step 2: Write the dialog**

Create `app/(app)/products/child-units/ChildUnitsDialog.tsx`. Render:

- A `<Dialog>` with `open` / `onOpenChange` from props, wide content (`sm:max-w-4xl`).
- A header showing the viewed parent's name, unit, and cost — the cost is there because every suggested price derives from it. When `canGoBack`, a back button calling `goBack()`.
- A `<Table>` with columns: Name, Unit, Conversion, Stock, Cost, Markup %, Suggested, Current Price. In this task the Markup % cell renders the saved value (or `—` when null) as plain text; Task 8 turns it into an input.
- On a row with `childCount > 0`, a small badge beside its name that calls `drillInto(row)`.
- An empty state when `rows.length === 0`: "No child units yet."
- A footer with a `Close` button only. The Add and Save buttons arrive in Task 8.

Follow the dialog structure already used by `app/(app)/products/price-levels/ManagePriceLevelsDialog.tsx` — read it first and match its imports, spacing, and table markup rather than inventing a new layout.

- [ ] **Step 3: Render the dialog from the page**

In `app/(app)/products/page.tsx`, hold the target product in state and render one dialog instance at the page level (not per row — one shared instance avoids mounting a dialog for every row in the table):

```tsx
const [childUnitsTarget, setChildUnitsTarget] = useState<Product | null>(null);

// ...passed into each ProductRow as onManageChildren={setChildUnitsTarget}

<ChildUnitsDialog
  product={childUnitsTarget}
  open={!!childUnitsTarget}
  onOpenChange={(open) => { if (!open) setChildUnitsTarget(null); }}
  productOptions={productOptions}
  onSaved={() => refetch()}
/>
```

`productOptions` (line 406) and `refetch` (line 392) already exist in this component.

**`systemSettings` and `priceLevels` do not exist in this component** — do not add fetches for them here. `useChildUnits` already derives both from `productOptions` and its own settings fetch (Step 1), matching how `use-edit-product-form.ts` sources the same two things.

- [ ] **Step 4: Verify it opens and lists children**

Run `npm run dev`, open `/products`, click an `N children` badge.

Expected: the dialog opens listing that parent's direct children with unit, conversion, stock, cost, and current price populated. Open a childless product via `Manage Child Units` — the empty state shows. If a child has its own children, clicking its badge re-targets the dialog and the back button returns.

- [ ] **Step 5: Commit**

```bash
git add app/\(app\)/products/child-units app/\(app\)/products/page.tsx
git commit -m "feat: add read-only child units dialog"
```

---

### Task 8: Inline markup editing, batch save, and Add Child Unit

**Files:**
- Modify: `app/(app)/products/child-units/use-child-units.ts`
- Modify: `app/(app)/products/child-units/ChildUnitsDialog.tsx`

**Interfaces:**
- Consumes: `updateChildMarkups` (Task 4), `isValidMarkupValue` / `MARKUP_MAX` (Task 3), `QuickAddChildDialog` (existing).
- Produces: the finished dialog.

**About `QuickAddChildDialog`:** it already accepts controlled `open` / `onOpenChange` and hides its parent selector when `parentProduct` is supplied (`quick-add-child-dialog.tsx:97`). **Do not modify that component.**

- [ ] **Step 1: Add draft state to the hook**

In `use-child-units.ts`, add edit tracking. Drafts are stored as **strings** so that an empty field stays distinguishable from a typed `0`:

```typescript
  /** productId -> raw input text. Absent = untouched. '' = cleared to inherit. */
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) setDrafts({});
  }, [open, viewedParent?.id]);

  const setDraft = useCallback((id: string, text: string) => {
    setDrafts((d) => ({ ...d, [id]: text }));
  }, []);

  /** The value a row would save: null when blank, else the parsed number. */
  const draftValue = useCallback((row: ChildUnitRow): number | null => {
    const text = drafts[row.id];
    if (text === undefined) return row.markupPercentage;
    if (text.trim() === '') return null;
    return Number(text);
  }, [drafts]);

  const isRowValid = useCallback(
    (row: ChildUnitRow) => isValidMarkupValue(draftValue(row)),
    [draftValue]
  );

  const changedRows = rows.filter((r) => {
    const text = drafts[r.id];
    if (text === undefined) return false;
    return draftValue(r) !== r.markupPercentage;
  });

  const hasChanges = changedRows.length > 0;
  const allValid = rows.every(isRowValid);
```

Import `isValidMarkupValue` from `@/lib/markup-validation`.

- [ ] **Step 2: Add the save function to the hook**

```typescript
  const [isSaving, setIsSaving] = useState(false);

  const save = useCallback(async () => {
    if (!hasChanges || !allValid) return { success: false, message: '' };
    setIsSaving(true);
    try {
      const result = await updateChildMarkups(
        changedRows.map((r) => ({ id: r.id, markupPercentage: draftValue(r) }))
      );
      if (result.success) {
        setDrafts({});
        await refetch();
      }
      return result;
    } finally {
      setIsSaving(false);
    }
  }, [hasChanges, allValid, changedRows, draftValue, refetch]);
```

Import `updateChildMarkups` from `../actions`. Return `isSaving`, `save`, `hasChanges`, `allValid`, `setDraft`, `drafts`, `draftValue`, and `isRowValid` from the hook.

- [ ] **Step 3: Make the Markup % cell editable**

In `ChildUnitsDialog.tsx`, replace the plain-text markup cell with an input:

```tsx
<TableCell>
  <Input
    type="number"
    step="0.01"
    min={0}
    max={MARKUP_MAX}
    className={cn('w-24', !isRowValid(row) && 'border-destructive')}
    placeholder="inherit"
    value={drafts[row.id] ?? (row.markupPercentage === null ? '' : String(row.markupPercentage))}
    onChange={(e) => setDraft(row.id, e.target.value)}
  />
  {draftValue(row) === null && (
    <div className="text-xs text-muted-foreground mt-1">
      inherits {inheritedFor(row, rawById[row.id]).markup}%
      {inheritedFor(row, rawById[row.id]).source
        ? ` (${inheritedFor(row, rawById[row.id]).source})`
        : ''}
    </div>
  )}
  {!isRowValid(row) && (
    <div className="text-xs text-destructive mt-1">
      Enter 0–{MARKUP_MAX}, or leave blank to inherit.
    </div>
  )}
</TableCell>
```

Build `rawById` in the dialog as a lookup from `rawChildren` keyed by id, so `inheritedFor` can read the row's category/brand/supplier.

- [ ] **Step 4: Make Suggested react to the draft**

```tsx
<TableCell>
  {(() => {
    const value = draftValue(row);
    const effective = value === null ? inheritedFor(row, rawById[row.id]).markup : value;
    const suggested = suggestedPrice(row.cost, effective);
    return suggested === undefined ? '—' : suggested.toFixed(2);
  })()}
</TableCell>
```

The Current Price cell stays as it is. **Do not add an "apply suggested price" action** — markup is a suggestion, and the price is changed in the product form.

- [ ] **Step 5: Highlight changed rows**

On the `<TableRow>`:

```tsx
className={cn(drafts[row.id] !== undefined && draftValue(row) !== row.markupPercentage && 'bg-muted/40')}
```

- [ ] **Step 6: Wire the footer**

Left side — the Add button, mounting the existing dialog with the parent preset:

```tsx
<Button variant="outline" onClick={() => setAddChildOpen(true)}>
  <PlusCircle className="mr-2 h-4 w-4" /> Add Child Unit
</Button>

<QuickAddChildDialog
  parentProduct={viewedParent ?? undefined}
  products={[]}
  open={addChildOpen}
  onOpenChange={setAddChildOpen}
  onChildAdded={() => { refetch(); onSaved?.(); }}
/>
```

`products={[]}` is safe because the parent selector it feeds is hidden whenever `parentProduct` is set.

Right side — Cancel and Save:

```tsx
<Button variant="ghost" onClick={handleClose}>Cancel</Button>
<Button onClick={handleSave} disabled={!hasChanges || !allValid || isSaving}>
  {isSaving ? 'Saving…' : 'Save Markups'}
</Button>
```

`handleSave` calls `save()`, toasts `result.message` (destructive variant when `!result.success`), and calls `onSaved?.()` on success so the products list refetches and badge counts update.

- [ ] **Step 7: Confirm before discarding unsaved changes**

```tsx
const handleClose = () => {
  if (hasChanges && !window.confirm('Discard unsaved markup changes?')) return;
  onOpenChange(false);
};
```

Route the dialog's own `onOpenChange` through this too, so the X and the overlay click are guarded the same way as Cancel.

- [ ] **Step 8: Verify the full flow**

Run `npm run dev`:

1. Open a family via its badge. Every markup field is blank with an `inherits N% (Source)` hint.
2. Type `25` in one row — Suggested updates immediately, Current Price does **not** change, the row highlights, Save enables.
3. Type `-5` in another row — an inline error appears and Save disables.
4. Fix it, Save. A success toast appears, the dialog reloads, and the values persist.
5. Reopen the dialog — the saved markups are still there and their `inherits` hints are gone.
6. Clear one field back to blank and Save — the hint returns, meaning the override was cleared to NULL rather than saved as 0.
7. Type `0` in a field and Save, then reopen — it shows `0`, **not** blank. This is the NULL-vs-0 distinction; if `0` comes back blank, the coercion bug is in `draftValue` or the action.
8. Click `+ Add Child Unit`, add a unit. It appears in the table, and the parent's badge count on the list behind the dialog increments.
9. Open the edited child's Edit Product dialog — the markup hint reads `Calculated from Product Markup (25%)`.

- [ ] **Step 9: Run the unit tests**

Run: `npm run test:unit`
Expected: both new test files pass and no previously passing file regresses. (The command may not exit on its own — `lib/mysql` starts cron workers on import. The pass lines are the signal.)

- [ ] **Step 10: Commit**

```bash
git add app/\(app\)/products/child-units
git commit -m "feat: inline markup editing and add-child in the child units dialog"
```

---

### Task 9: E2E coverage

**Files:**
- Create: `tests/e2e/child-units.spec.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

**Before writing:** read `tests/e2e/bulk-price-update.spec.ts` for the login helper, the seeded product fixtures in `tests/e2e/fixtures/test-data.ts`, and the selector conventions this suite uses. Tests run sequentially (`workers: 1`) against `verdix_test` on port 3100 — never add parallelism.

- [ ] **Step 1: Write the spec**

Create `tests/e2e/child-units.spec.ts` covering four flows. Use the fixtures' existing parent/child pair rather than creating products inline where one exists:

1. **The badge opens the dialog.** Navigate to `/products`, click a parent's `N children` badge, assert the dialog is visible and lists the expected child name.
2. **Markups persist.** Fill two markup inputs, click `Save Markups`, wait for the success toast, close, reopen, assert both inputs hold the saved values.
3. **The parent badge appears under search.** Type a child's name into the products search, assert its row is visible and contains `↳ <parent name>`. Clear the search and assert that row is gone.
4. **Add Child Unit works from the dialog.** Open the dialog, click `+ Add Child Unit`, fill the required fields, submit, and assert the new unit appears in the dialog's table.

- [ ] **Step 2: Reset the test database**

Run: `npm run test:e2e:db`
Expected: completes without error.

- [ ] **Step 3: Capture the baseline before judging your results**

Run: `git stash && npx playwright test --reporter=line > /tmp/baseline.txt 2>&1; git stash pop`

This records which tests already fail without your changes. `bulk-price-update.spec.ts:87` is known to fail intermittently — roughly 40% of runs on untouched code.

- [ ] **Step 4: Run your new spec**

Run: `npx playwright test tests/e2e/child-units.spec.ts --reporter=line`
Expected: all four tests pass.

- [ ] **Step 5: Run the full suite and compare**

Run: `npx playwright test --reporter=line`

Compare against the baseline from Step 3. Expected: **no test that passed in the baseline now fails.** Any failure present in both runs is pre-existing — leave it. If a previously passing test now fails, it is yours; fix it before committing.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/child-units.spec.ts
git commit -m "test: e2e coverage for child units dialog and badges"
```

---

### Task 10: Update project documentation

**Files:**
- Modify: `CLAUDE.md` (the "Key Domain Patterns" section)

- [ ] **Step 1: Document the markup precedence**

In `CLAUDE.md`, under **Key Domain Patterns**, add to the Stock / Inventory group:

```markdown
**Product markup** — `lib/purchase-utils.ts` resolves a suggested price's markup in
strict precedence: `products.markup_percentage` (a per-product override) first, then
subcategory → category → brand → supplier ordered by `settings.markupPriority`, then
`defaultMarkupPercentage`. The per-product override deliberately bypasses the
`enableAutomaticMarkup` toggle — that toggle suppresses only *inherited* markup, since
a value typed against one product is not a guess the system made. `NULL` means inherit
and `0` means sell at cost; never coerce between them. Markup only ever *suggests* a
price — nothing in this chain writes `products.price`.
```

- [ ] **Step 2: Document the flat product list**

Add nearby:

```markdown
**Product families in the UI** — the products list is a flat list of top-level
products (`parent_id IS NULL`) when unfiltered; children are reached through the
child-units dialog (`app/(app)/products/child-units/`) or by searching, and a
filtered row carries a `↳ parent` badge. There is no inline tree — a recursive CTE
in `getProducts` used to hydrate one and was removed. Adding a child unit lives
inside that dialog, not in the product row menu.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: describe markup precedence and the flat product list"
```

---

## Done When

- `products.markup_percentage` exists, nullable, with a working `down()`.
- A per-product markup outranks every inherited source and survives `enableAutomaticMarkup` being off.
- `NULL` inherits, `0` means sell at cost, and neither is coerced into the other anywhere in the stack.
- The products list is flat; the recursive CTE is gone; pagination is unchanged.
- Parents show a child-count badge; filtered children show a parent badge.
- The child-units dialog lists children, edits markups inline with a live suggested price, saves in one batch, and hosts Add Child Unit.
- No product's `price` was written by any of this.
- `npm run test:unit` passes both new files; the E2E suite shows no test that passed in the baseline now failing.
