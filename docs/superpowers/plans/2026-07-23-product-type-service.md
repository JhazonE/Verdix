# Product Type: Standard vs Service — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users create products of type Service that sell without stock tracking, FIFO batches, or stock movements.

**Architecture:** A new `products.type` ENUM column drives a single predicate helper (`lib/product-type.ts`). Every stock-touching path consults that helper and short-circuits for services. The Add Product form gets a type toggle that swaps the Zod schema branch and hides stock fields.

**Tech Stack:** Next.js 16 (App Router), TypeScript, raw `mysql2/promise`, Zod + react-hook-form, Playwright.

## Global Constraints

- **Naming:** The new concept is `itemType` in React/form code and `type` in the database. **Do NOT reuse `productType`** — `use-add-product-form.ts:52` already defines `productType: 'parent' | 'child'` for the family/repackaging feature. Colliding on that name will silently break repackaging.
- **DB column:** `products.type ENUM('standard','service') NOT NULL DEFAULT 'standard'`
- **Migration guard:** Follow the existing `information_schema` existence-check pattern (see `scripts/migrations/100_add_expiration_tracking.ts`) so re-running is safe.
- **No ORM:** Raw SQL only, via `lib/mysql.ts`.
- **DO NOT run `npm run lint`.** It is broken repo-wide — `next lint` misparses its argument and dies with `Invalid project directory provided, no such directory: ...\lint`. This is unrelated to any change here. Never use it as a gate.
- **Typecheck gate:** `npm run typecheck 2>&1 | grep -v "^\.next" | grep -E "error TS"` must print nothing. Source files are currently clean; `.next/` build artifacts always emit parse noise and must be filtered. Do not "fix" `.next/` errors.
- **Unit tests:** custom runner, `npm run test:unit` → `tsx tests/unit/run.ts`. Tests use `node:assert/strict`, self-execute on import, and must be registered in `run.ts`. Model on `tests/unit/product-tree.test.ts`.
- **Never import `lib/mysql.ts` (directly or transitively) from a unit test** — it opens a connection pool and starts a background worker on import, so the runner never exits. To exercise a function that pulls in `lib/mysql.ts`, copy it into a scratch file instead.
- **mysql2 renders bare DATE columns as local-time JS Dates.** A stored `2027-06-30` prints as `2027-06-29T16:00:00.000Z` at UTC+8. When asserting dates use `DATE_FORMAT(col,'%Y-%m-%d')` in SQL — never compare `.toISOString()`.
- **E2E:** Playwright on port 3100 against `verdix_test`, `workers: 1`. Never parallelize.
- **`verdix_test` is a schema CLONE of the dev `verdix` DB**, not a migration replay. Migration 101 must be applied to the dev DB *before* `npm run test:e2e:db`, or the test DB will lack `products.type`.
- **BIR:** Do not touch SI numbering. Services get invoices like any other line item.
- **Cost for services is required** (zero allowed). A blank cost would write `NULL` to `cost_at_sale` and break profit reports.

---

## File Structure

**Create:**
- `scripts/migrations/101_add_product_type.ts` — the column
- `lib/product-type.ts` — `isService()` predicate + shared `ProductType` type
- `tests/unit/product-type.test.ts` — unit tests for the helper (registered in `tests/unit/run.ts`)
- `tests/e2e/product-type-service.spec.ts` — end-to-end coverage

**Modify:**
- `app/(app)/products/add-product/product-schema.ts` — discriminated union on `itemType`
- `app/(app)/products/add-product/use-add-product-form.ts` — `itemType` state, pass through on submit
- `app/(app)/products/add-product/add-product-dialog.tsx` — type toggle, conditional Conversion tab
- `app/(app)/products/add-product/tabs/inventory-tab.tsx` — hide stock fields for services
- `app/(app)/products/actions.ts:406` — persist `type`, skip initial batch
- `app/api/pos/checkout/route.ts` — reorder SELECT, guard deduction
- `app/api/sales/transactions/route.ts` — add SELECT, guard deduction
- `app/api/reports/stats/route.ts` — exclude services from low-stock
- `app/api/reports/inventory/route.ts` — exclude services from low-stock/valuation

---

## Task 1: Database Column

**Files:**
- Create: `scripts/migrations/101_add_product_type.ts`

**Interfaces:**
- Produces: `products.type` column, values `'standard'` | `'service'`

- [ ] **Step 1: Write the migration**

Create `scripts/migrations/101_add_product_type.ts`:

```typescript
import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

/**
 * Product type: standard (stocked) vs service (not stocked).
 *
 * Services skip FIFO batches, stock movements, and family sync entirely.
 * Every existing row becomes 'standard' via the column default — products
 * currently faking service behaviour (unit_of_measure = 'Service', or a
 * "Services" category) are deliberately NOT auto-converted, because that
 * heuristic also matches genuinely stocked goods like "Service Kit" and
 * would silently destroy their stock tracking. Conversion is manual.
 *
 * ENUM rather than a boolean so future types (bundle, non_inventory) don't
 * need another migration.
 */
const migration: Migration = {
  name: '101_add_product_type',
  timestamp: '2026-07-23_10-00-00',

  async up(): Promise<void> {
    const [typeCol]: any = await query(`
      SELECT COUNT(*) AS cnt
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'products'
        AND COLUMN_NAME = 'type'
    `);
    if (typeCol?.cnt > 0) {
      console.log('• products.type already exists — skipping');
      return;
    }

    await query(`
      ALTER TABLE products
      ADD COLUMN type ENUM('standard','service') NOT NULL DEFAULT 'standard'
    `);
    console.log('✅ Added products.type');

    // Indexed because every stock screen and low-stock report filters on it.
    await query(`CREATE INDEX idx_products_type ON products (type)`);
    console.log('✅ Added idx_products_type');
  },

  async down(): Promise<void> {
    await query(`DROP INDEX idx_products_type ON products`);
    await query(`ALTER TABLE products DROP COLUMN type`);
    console.log('✅ Dropped products.type');
  }
};

registerMigration(migration);
```

- [ ] **Step 2: Register the migration**

Open `scripts/migrations/index.ts` and add the import alongside the existing ones, in numeric order:

```typescript
import './101_add_product_type';
```

- [ ] **Step 3: Run the migration**

Run: `npm run migrate`
Expected output contains: `✅ Added products.type` and `✅ Added idx_products_type`

- [ ] **Step 4: Verify the column shape**

Run:
```bash
npx tsx scripts/dbq.ts "SHOW COLUMNS FROM products LIKE 'type'"
```
Expected: `Type` is `enum('standard','service')`, `Null` is `NO`, `Default` is `standard`

- [ ] **Step 5: Verify existing rows defaulted correctly**

Run:
```bash
npx tsx scripts/dbq.ts "SELECT type, COUNT(*) c FROM products GROUP BY type"
```
Expected: a single row with `type: 'standard'` covering every product. No `service` rows yet.

- [ ] **Step 6: Commit**

```bash
git add scripts/migrations/101_add_product_type.ts scripts/migrations/index.ts
git commit -m "feat(db): add products.type column for standard vs service"
```

---

## Task 2: Shared Predicate Helper

**Files:**
- Create: `lib/product-type.ts`
- Test: `tests/unit/product-type.test.ts`
- Modify: `tests/unit/run.ts`

**Interfaces:**
- Produces:
  - `type ProductType = 'standard' | 'service'`
  - `isService(product: { type?: string | null }): boolean`
  - `PRODUCT_TYPES: readonly ProductType[]`

This helper exists so `type === 'service'` never gets scattered across call sites. Every later task imports from here.

**Test runner:** this repo has a custom unit runner — `npm run test:unit` → `tsx tests/unit/run.ts`. Tests use `node:assert/strict` and self-execute on import; `run.ts` imports each test file. Model the new test on `tests/unit/product-tree.test.ts`.

**Critical constraint:** the test must import ONLY `lib/product-type.ts`. Importing anything that reaches `lib/mysql.ts` hangs the runner forever — that module opens a connection pool and starts a background sync worker on import. `lib/product-type.ts` has no imports, so it is safe.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/product-type.test.ts`:

```typescript
import assert from 'node:assert/strict';
import { isService, PRODUCT_TYPES } from '../../lib/product-type';

assert.equal(isService({ type: 'service' }), true, 'service product');
assert.equal(isService({ type: 'standard' }), false, 'standard product');

// A missing or unknown type must read as standard. This direction matters:
// a SELECT that forgets the column must never silently disable stock
// deduction on a real product.
assert.equal(isService({}), false, 'undefined type falls back to standard');
assert.equal(isService({ type: null }), false, 'null type falls back to standard');
assert.equal(isService({ type: 'bundle' }), false, 'unknown type falls back to standard');

assert.deepEqual([...PRODUCT_TYPES], ['standard', 'service'], 'both types exposed');

console.log('product-type: all assertions passed');
```

- [ ] **Step 2: Register the test in the runner**

Add to the end of the import list in `tests/unit/run.ts`:

```typescript
import './product-type.test';
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm run test:unit`
Expected: FAIL — cannot resolve `../../lib/product-type`

- [ ] **Step 4: Write the implementation**

Create `lib/product-type.ts`:

```typescript
/**
 * Product type predicate.
 *
 * Services are products that sell without stock: no FIFO batches, no stock
 * movements, no family sync, never out of stock.
 *
 * Everything that branches on product type goes through this module so the
 * check lives in exactly one place.
 */

export type ProductType = 'standard' | 'service';

export const PRODUCT_TYPES: readonly ProductType[] = ['standard', 'service'] as const;

/**
 * True only for an explicit 'service' type.
 *
 * Defaults to false for null/undefined/unknown values. This direction matters:
 * a missing type must behave as a stocked product, so a bad read can never
 * cause stock to silently stop being deducted.
 */
export function isService(product: { type?: string | null }): boolean {
  return product?.type === 'service';
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test:unit`
Expected: the full suite passes, ending with `product-type: all assertions passed`

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck 2>&1 | grep -v "^\.next" | grep -E "error TS"`
Expected: no output

- [ ] **Step 7: Commit**

```bash
git add lib/product-type.ts tests/unit/product-type.test.ts tests/unit/run.ts
git commit -m "feat(products): add isService predicate helper"
```

---

## Task 3: Form Schema

**Files:**
- Modify: `app/(app)/products/add-product/product-schema.ts`

**Interfaces:**
- Consumes: `ProductType` from `lib/product-type.ts` (Task 2)
- Produces: `productSchema` as a discriminated union; `ProductFormValues` gains `itemType: 'standard' | 'service'`

Recall the Global Constraint: this field is `itemType`, NOT `productType`.

- [ ] **Step 1: Rewrite the schema as a discriminated union**

Replace the entire contents of `app/(app)/products/add-product/product-schema.ts`:

```typescript
import { z } from 'zod';

/**
 * Fields shared by every product type.
 *
 * Note the field is `itemType`, not `productType` — `productType` is already
 * taken by the parent/child family selector in use-add-product-form.ts.
 */
const baseProductSchema = z.object({
  name: z.string().min(1, 'Product name is required'),
  brand: z.string().min(1, 'Brand is required'),
  sku: z.string().min(1, 'SKU is required'),
  barcode: z.string().optional(),
  department: z.string().optional(),
  description: z.string().min(1, 'Description is required'),
  additionalDescription: z.string().optional(),
  category: z.string().min(1, 'Category is required'),
  subcategory: z.string().optional(),
  unitOfMeasure: z.string().min(1, 'Unit of measure is required'),
  price: z.coerce.number().positive('Price must be a positive number'),
  incomeAccount: z.string().optional(),
  expenseAccount: z.string().optional(),
  priceLevels: z.array(z.object({
    levelId: z.string().min(1, 'Price level is required'),
    price: z.number().min(0, 'Price cannot be negative'),
    minQuantity: z.number().min(0).optional(),
  })).optional(),
  vatStatus: z.string().default('YES (Subject to 12% VAT)'),
  availability: z.string().default('Available'),
  earnsPoints: z.boolean().default(true),
});

/** Stocked goods — the existing behaviour, unchanged. */
const standardProductSchema = baseProductSchema.extend({
  itemType: z.literal('standard'),
  supplier: z.string().optional(),
  warehouse: z.string().optional(),
  shelfLocationIds: z.array(z.string()).optional(),
  stock: z.coerce.number().int().nonnegative('Initial stock must be a non-negative integer'),
  reorderPoint: z.coerce.number().int().nonnegative().optional().default(0),
  cost: z.coerce.number().nonnegative('Cost must be non-negative').optional(),
  parentId: z.string().optional(),
  conversionFactor: z.coerce.number().positive('Conversion factor must be positive').optional(),
  conversionFactors: z.array(z.object({
    unit: z.string().min(1, 'Unit is required'),
    factor: z.coerce.number().positive('Factor must be positive'),
  })).optional(),
  isPerishable: z.boolean().optional(),
});

/**
 * Services — no stock, no batches, no family.
 *
 * `cost` is REQUIRED here even though it is optional for standard products:
 * standard products fall back to FIFO batch cost, services have no such
 * fallback, and a blank cost would write NULL to sale_items.cost_at_sale and
 * break profit reporting. Zero is allowed — a pure-margin service is valid,
 * the user just has to say so explicitly.
 *
 * Stock and family fields are pinned to constants rather than omitted so a
 * service with stock is unrepresentable even if the UI is bypassed.
 */
const serviceProductSchema = baseProductSchema.extend({
  itemType: z.literal('service'),
  cost: z.coerce.number().nonnegative('Cost is required for services (enter 0 if there is no input cost)'),
  stock: z.literal(0).default(0),
  reorderPoint: z.literal(0).default(0),
  supplier: z.undefined(),
  warehouse: z.undefined(),
  shelfLocationIds: z.undefined(),
  parentId: z.undefined(),
  conversionFactor: z.undefined(),
  conversionFactors: z.undefined(),
  isPerishable: z.undefined(),
});

export const productSchema = z.discriminatedUnion('itemType', [
  standardProductSchema,
  serviceProductSchema,
]);

export type ProductFormValues = z.infer<typeof productSchema>;
export type StandardProductValues = z.infer<typeof standardProductSchema>;
export type ServiceProductValues = z.infer<typeof serviceProductSchema>;
```

- [ ] **Step 2: Typecheck to find every consumer that breaks**

Run: `npm run typecheck 2>&1 | grep -v "^.next" | grep -E "error TS"`
Expected: errors in `use-add-product-form.ts` and the tab components, because `ProductFormValues` is now a union and the stock fields are no longer unconditionally present. This is the intended signal — Tasks 4-6 fix each one. Record the error list; it is the checklist for those tasks.

- [ ] **Step 3: Commit**

```bash
git add app/\(app\)/products/add-product/product-schema.ts
git commit -m "feat(products): make product schema a discriminated union on itemType"
```

---

## Task 4: Form Controller

**Files:**
- Modify: `app/(app)/products/add-product/use-add-product-form.ts`

**Interfaces:**
- Consumes: `ProductFormValues` (Task 3), `ProductType` (Task 2)
- Produces: controller gains `itemType: ProductType` and `setItemType(t: ProductType): void`

- [ ] **Step 1: Add the itemType state**

In `app/(app)/products/add-product/use-add-product-form.ts`, find line 52:

```typescript
  const [productType, setProductType] = useState<'parent' | 'child'>('parent');
```

Add directly below it (do NOT modify or rename the existing line — it drives the family selector):

```typescript
  // Standard vs Service. Distinct from `productType` above, which is the
  // parent/child family selector.
  const [itemType, setItemType] = useState<ProductType>('standard');
```

Add the import at the top of the file, after the existing `@/lib/types` import:

```typescript
import type { ProductType } from '@/lib/product-type';
```

- [ ] **Step 2: Add itemType to form defaults**

Find the `defaultValues` object beginning at line 103 and add `itemType` as its first property:

```typescript
    defaultValues: {
      itemType: 'standard',
      name: '',
```

- [ ] **Step 3: Reset stock fields when switching to Service**

Add this effect immediately after the existing `productType === 'parent'` effect (which ends at line 200):

```typescript
  // Switching to Service clears every stock-side field. Without this, values
  // typed while Standard was selected stay in form state and fail the service
  // branch's z.undefined() checks on submit, with no visible field to fix.
  useEffect(() => {
    if (itemType === 'service') {
      form.setValue('stock', 0);
      form.setValue('reorderPoint', 0);
      form.setValue('cost', 0);
      form.setValue('supplier', undefined);
      form.setValue('warehouse', undefined);
      form.setValue('shelfLocationIds', undefined);
      form.setValue('parentId', undefined);
      form.setValue('conversionFactor', undefined);
      form.setValue('conversionFactors', undefined);
      form.setValue('isPerishable', undefined);
    }
  }, [itemType, form]);
```

- [ ] **Step 4: Block auto-child creation for services**

Find the `willAutoChild` expression at line 365 and add the service guard as its first condition:

```typescript
      const willAutoChild =
        itemType === 'standard' &&
        productType === 'parent' &&
        autoCreateChild &&
        values.conversionFactors &&
        values.conversionFactors.length > 0;
```

- [ ] **Step 5: Pass itemType through on submit**

Find the `addProduct` call at line 395 and add `itemType` to the payload:

```typescript
      const result = await addProduct(
        {
          ...values,
          itemType,
          image: `https://picsum.photos/seed/${values.sku}/400/300`,
          ...(childProduct ? { __childProduct: childProduct } : {}),
        } as any,
        uid,
      );
```

- [ ] **Step 6: Export itemType from the controller**

Find the return object at line 482 and add the pair next to the existing `productType` line:

```typescript
    productType, setProductType,
    itemType, setItemType,
```

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck 2>&1 | grep -v "^.next" | grep -E "error TS"`
Expected: errors remain in the tab components (fixed in Tasks 5-6), but none in `use-add-product-form.ts`

- [ ] **Step 8: Commit**

```bash
git add app/\(app\)/products/add-product/use-add-product-form.ts
git commit -m "feat(products): wire itemType through the add-product controller"
```

---

## Task 5: Type Toggle in the Dialog

**Files:**
- Modify: `app/(app)/products/add-product/add-product-dialog.tsx`

**Interfaces:**
- Consumes: `itemType`, `setItemType` from the controller (Task 4)

- [ ] **Step 1: Destructure itemType from the controller**

In `app/(app)/products/add-product/add-product-dialog.tsx`, find the destructuring block at line 28 and add the two fields:

```typescript
  const {
    isOpen, setIsOpen,
    isSubmitting,
    form,
    tabErrors,
    markupSource,
    onSubmit,
    itemType, setItemType,
  } = controller;
```

- [ ] **Step 2: Render the toggle above the tabs**

Find the `<div className="h-full">` at line 56 and insert the toggle immediately inside it, before `<Tabs>`:

```tsx
                <div className="h-full">
                  {/* Above the tabs on purpose: this changes the whole form,
                      not one section. */}
                  <div className="flex items-center gap-3 px-6 pb-4">
                    <span className="text-sm font-medium">Product Type:</span>
                    <div className="inline-flex rounded-lg border p-0.5">
                      <button
                        type="button"
                        onClick={() => setItemType('standard')}
                        className={`rounded-md px-4 py-1.5 text-sm transition-colors ${
                          itemType === 'standard'
                            ? 'bg-primary text-primary-foreground'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        Standard
                      </button>
                      <button
                        type="button"
                        onClick={() => setItemType('service')}
                        className={`rounded-md px-4 py-1.5 text-sm transition-colors ${
                          itemType === 'service'
                            ? 'bg-primary text-primary-foreground'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        Service
                      </button>
                    </div>
                    {itemType === 'service' && (
                      <span className="text-xs text-muted-foreground">
                        No stock tracking — always available for sale.
                      </span>
                    )}
                  </div>
                  <Tabs defaultValue="basic" className="w-full h-full">
```

- [ ] **Step 3: Hide the Conversion tab trigger for services**

Find the Conversion `TabsTrigger` at lines 80-86 and wrap it:

```tsx
                      {itemType === 'standard' && (
                        <TabsTrigger
                          value="conversion"
                          className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-3"
                        >
                          Conversion
                          {tabErrors.conversion && <span className="ml-1.5 inline-flex h-2 w-2 rounded-full bg-destructive" />}
                        </TabsTrigger>
                      )}
```

- [ ] **Step 4: Hide the Conversion tab content for services**

Find the Conversion `TabsContent` at lines 100-102 and wrap it the same way:

```tsx
                    {itemType === 'standard' && (
                      <TabsContent value="conversion" className="space-y-4 p-6">
                        <ConversionTab />
                      </TabsContent>
                    )}
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck 2>&1 | grep -v "^.next" | grep -E "error TS"`
Expected: no errors in `add-product-dialog.tsx`

- [ ] **Step 6: Manually verify the toggle**

Run: `npm run dev`

Open http://localhost:3000/products, click **Add Product**, and confirm:
- The toggle shows Standard selected by default
- Clicking Service hides the Conversion tab and shows the "No stock tracking" hint
- Clicking Standard brings the Conversion tab back

- [ ] **Step 7: Commit**

```bash
git add app/\(app\)/products/add-product/add-product-dialog.tsx
git commit -m "feat(products): add Standard/Service toggle to add-product dialog"
```

---

## Task 6: Inventory Tab Field Hiding

**Files:**
- Modify: `app/(app)/products/add-product/tabs/inventory-tab.tsx`

**Interfaces:**
- Consumes: `itemType` from the form context (Task 4)

- [ ] **Step 1: Read the file first**

Run: `cat "app/(app)/products/add-product/tabs/inventory-tab.tsx"`

This file was not read in full while planning. Before editing, identify the exact JSX block for each field below — the line numbers here are from a partial read and may have shifted.

- [ ] **Step 2: Destructure itemType**

Find the destructuring block at line 21 and add `itemType` alongside the existing `productType`:

```typescript
  const {
    form,
    productType,
    itemType,
    departments, isLoadingDepartments,
```

- [ ] **Step 3: Hide the stock-only fields**

Wrap each of these `FormField` blocks in `{itemType === 'standard' && ( ... )}`:

- Initial Stock (`name="stock"`)
- Reorder Point (`name="reorderPoint"`)
- Supplier (`name="supplier"`)
- Warehouse (`name="warehouse"`)
- Shelf Location (`name="shelfLocationIds"`)
- Perishable / expiry (`name="isPerishable"` and any expiry date field gated by it)

Leave untouched: Unit of Measure, Cost, Price, VAT status, Availability, Income/Expense account, Department, Category.

The existing conversion-factor block at line 288 is already gated on `productType === 'child'`. Change its condition to require standard as well:

```tsx
      {itemType === 'standard' && productType === 'child' && (
```

- [ ] **Step 4: Make the Cost label reflect that it is required for services**

Find the Cost `FormField` and make its label conditional:

```tsx
              <FormLabel>{itemType === 'service' ? 'Cost (required)' : 'Cost'}</FormLabel>
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck 2>&1 | grep -v "^.next" | grep -E "error TS"`
Expected: no errors anywhere. If errors remain elsewhere, they are leftovers from the Task 3 list — fix them now.

- [ ] **Step 6: Manually verify field hiding**

Run: `npm run dev`

Open the Add Product dialog, switch to Service, open the Inventory tab, and confirm Initial Stock, Reorder Point, Supplier, Warehouse, Shelf Location, and Perishable are all gone, while Cost, Price, UoM, VAT, and Availability remain.

- [ ] **Step 7: Commit**

```bash
git add app/\(app\)/products/add-product/tabs/inventory-tab.tsx
git commit -m "feat(products): hide stock fields for service products"
```

---

## Task 7: Persist the Type

**Files:**
- Modify: `app/(app)/products/actions.ts` (the `addProduct` function beginning at line 406)

**Interfaces:**
- Consumes: `itemType` on the form payload (Task 4)
- Produces: `products.type` populated on insert; no `inventory_batches` row for services

Note: `app/api/products/route.ts` delegates to `CreateProductUseCase`, but the Add Product form does **not** go through it — it calls the `addProduct` server action directly. This task changes only `actions.ts`.

- [ ] **Step 1: Add type to the productData object**

In `addProduct`, find the `productData` object and add the field after `is_perishable`:

```typescript
        is_perishable: formData.isPerishable ? 1 : 0,
        type: formData.itemType === 'service' ? 'service' : 'standard',
```

The explicit ternary (rather than passing `formData.itemType` through) guarantees a valid ENUM value even if a caller omits the field — an unknown value would otherwise be rejected by MySQL in strict mode.

- [ ] **Step 2: Add the column to the INSERT statement**

Find the `INSERT INTO products` SQL and add `type` to the column list and one more `?` to the values list:

```typescript
      const sql = `
        INSERT INTO products (
          id, name, description, additional_description, category, brand, department,
          subcategory, supplier_id, warehouse_id, stock, reorder_point, avg_daily_sales, price, cost,
          sku, barcode, image_url, image_hint,
          unit_of_measure, parent_id, conversion_factor, income_account, expense_account,
          vat_status, availability, earns_points, shelf_location_id, is_perishable, type
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
```

Count check: 30 columns, 30 placeholders.

- [ ] **Step 3: Add the value to the values array**

Find `values_array` and append `productData.type` as the final element:

```typescript
        legacyShelfId, productData.is_perishable, productData.type
      ];
```

- [ ] **Step 4: Skip initial batch creation for services**

Find the `--- BATCH COSTING: Auto-create batch for initial stock ---` block and change its condition:

```typescript
      // --- BATCH COSTING: Auto-create batch for initial stock ---
      // Services never get a batch: they have no stock, and an empty batch
      // would make them appear in FIFO deduction and valuation reports.
      if (productData.type === 'standard' && formData.stock && formData.stock > 0) {
```

- [ ] **Step 5: Verify a service inserts correctly**

Run: `npm run dev`

Create a service via the UI named `Test Service A`, cost 200, price 500. Then run:

```bash
npx tsx scripts/dbq.ts "SELECT id,name,type,stock,cost FROM products WHERE name='Test Service A'"
```
Expected: one row, `type: 'service'`, `stock: 0`, `cost: 200`

- [ ] **Step 6: Verify no batch was created**

Run:
```bash
npx tsx scripts/dbq.ts "SELECT COUNT(*) c FROM inventory_batches b JOIN products p ON p.id=b.product_id WHERE p.name='Test Service A'"
```
Expected: `c: 0`

- [ ] **Step 7: Commit**

```bash
git add app/\(app\)/products/actions.ts
git commit -m "feat(products): persist product type and skip batch creation for services"
```

---

## Task 8: POS Checkout Guard

**Files:**
- Modify: `app/api/pos/checkout/route.ts:150-260`

**Interfaces:**
- Consumes: `isService` from `lib/product-type.ts` (Task 2)

This is the highest-risk task in the plan. The product `SELECT` currently runs *after* batch deduction, so it must move before it.

- [ ] **Step 1: Add the import**

At the top of `app/api/pos/checkout/route.ts`, after the existing `lib/mysql` import:

```typescript
import { isService } from '@/lib/product-type';
```

- [ ] **Step 2: Move the product SELECT above the batch-costing block**

Currently the per-item loop runs: batch costing (line ~154) → `INSERT INTO sale_items` (line ~177) → product SELECT (line ~193).

Cut the SELECT at lines 193-200 and paste it as the **first** statement inside the loop, immediately after `const itemId = ...`. Add `p.type` to the column list:

```typescript
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const itemId = `${saleId}-ITEM-${i + 1}`;

        // Loaded before batch costing because `type` decides whether we deduct
        // at all. Same single query that already served loyalty + family sync.
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
```

- [ ] **Step 3: Guard the batch deduction**

Replace the batch-costing block (the `try`/`catch` around `deductFromBatches`) with:

```typescript
        // --- BATCH COSTING: FIFO deduction & cost recording ---
        let costAtSale: number | null = null;
        let batchSource: string | null = null;

        if (itemIsService) {
          // Services have no batches. Cost is the fixed value on the product,
          // so sale_items.cost_at_sale stays populated and profit reports work
          // identically for services and standard goods.
          costAtSale = soldProd?.cost != null ? parseFloat(soldProd.cost) : 0;
          batchSource = null;
        } else {
          try {
            const bcs = await getBCS();
            const deduction = await deductFromBatches(
              item.id,
              item.quantity,
              bcs.oversellBlock,
              connection as any
            );
            costAtSale = deduction.weightedAvgCost;
            batchSource = JSON.stringify(deduction.splits);
          } catch (batchErr: any) {
            // If oversell_block is ON, rethrow to abort the transaction
            if (batchErr.message && batchErr.message.startsWith('Batch stock exhausted')) {
              throw batchErr;
            }
            // Otherwise non-fatal (e.g. migration not yet run) — log and continue
            console.warn('[BatchCosting] Could not deduct batch (migration pending?):', batchErr.message);
          }
        }
        // --- END BATCH COSTING ---
```

- [ ] **Step 4: Guard the stock deduction and family sync**

The block that begins `if (soldProdResult && soldProdResult.length > 0) {` now needs to skip stock work for services while still doing loyalty. Change its opening condition and wrap the family-sync half:

```typescript
        if (soldProd) {
          // Loyalty Points Calculation — applies to services too.
          const hasFivePercentMarkup = Math.abs((soldProd.markup_percentage || 0) - 5) < 0.01;
          const earnsPointsEnabled = soldProd.earns_points !== 0 && soldProd.earns_points !== false;
          const isExcluded = hasFivePercentMarkup || !earnsPointsEnabled;
          if (!isExcluded) {
             eligiblePointsAmount += item.price * item.quantity;
          } else {
             console.log(`Item ${item.name} excluded from points. Markup: ${soldProd.markup_percentage}, Earns: ${soldProd.earns_points}`);
          }

          // Services carry no stock and belong to no family — nothing to sync.
          if (!itemIsService) {
```

Then close that new `if` block after the existing `deductFamilyStock` call completes, before the closing brace of the `if (soldProd)` block. Keep every line of the existing family-sync logic (`findUltimateRoot`, `rootQty`, `deductFamilyStock`) exactly as it is — only its nesting changes.

- [ ] **Step 5: Verify the remaining references compile**

Any later use of `soldProdResult[0]` inside the loop must now read `soldProd`.

Run: `npm run typecheck 2>&1 | grep -v "^.next" | grep -E "error TS"`
Expected: no errors

- [ ] **Step 6: Verify a service sale at POS**

Run: `npm run dev`

At http://localhost:3000/pos, sell 3 units of `Test Service A` (created in Task 7). Then run:

```bash
npx tsx scripts/dbq.ts "SELECT p.stock, s.quantity, s.cost_at_sale, s.batch_source FROM products p LEFT JOIN sale_items s ON s.product_name=p.name WHERE p.name='Test Service A' ORDER BY s.id DESC LIMIT 1"
```
Expected: `stock: 0` (unchanged), `quantity: 3`, `cost_at_sale: 200`, `batch_source: null`

- [ ] **Step 7: Verify a standard sale still deducts**

Sell 1 unit of any existing standard product at POS, then confirm its `stock` dropped by 1 and its `sale_items.batch_source` is non-null JSON. This is the regression check that the reorder did not break the normal path.

- [ ] **Step 8: Commit**

```bash
git add app/api/pos/checkout/route.ts
git commit -m "feat(pos): skip stock deduction for service products at checkout"
```

---

## Task 9: Back-Office Sales Guard

**Files:**
- Modify: `app/api/sales/transactions/route.ts:330-360`

**Interfaces:**
- Consumes: `isService` from `lib/product-type.ts` (Task 2)

This is the second sales path. Guarding only the POS leaves a hole here.

- [ ] **Step 1: Read the surrounding block first**

Run: `sed -n '320,400p' app/api/sales/transactions/route.ts`

This route was only partially read while planning. Confirm the exact shape of the item loop and whether it does its own stock UPDATE or family sync before editing.

- [ ] **Step 2: Add the import**

After the existing `lib/batch-deduction` import at line 4:

```typescript
import { isService } from '@/lib/product-type';
```

- [ ] **Step 3: Load the product before deducting**

Unlike checkout, this loop has no product SELECT. Add one as the first statement inside the item loop, immediately after `const itemId = ...`:

```typescript
        const [prodRows]: any = await connection.query(
          'SELECT id, type, cost FROM products WHERE id = ?',
          [item.id]
        );
        const prod = prodRows?.[0];
        const itemIsService = prod ? isService(prod) : false;
```

- [ ] **Step 4: Guard the deduction**

Replace the `deductFromBatches` call at line 342:

```typescript
        // --- BATCH COSTING: FIFO Deduction ---
        // Services have no batches; cost comes from the product's fixed cost.
        let deduction: { weightedAvgCost: number; splits: any[] };
        if (itemIsService) {
          deduction = {
            weightedAvgCost: prod?.cost != null ? parseFloat(prod.cost) : 0,
            splits: [],
          };
        } else {
          deduction = await deductFromBatches(item.id, item.quantity, oversellBlock, connection);
        }
```

Downstream code that reads `deduction.weightedAvgCost` and `deduction.splits` keeps working unchanged.

- [ ] **Step 5: Guard any stock UPDATE in this route**

If Step 1 revealed a stock UPDATE or family-sync call in this loop, wrap it in `if (!itemIsService) { ... }`. If there is none, note that in the commit body and move on.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck 2>&1 | grep -v "^.next" | grep -E "error TS"`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add app/api/sales/transactions/route.ts
git commit -m "feat(sales): skip stock deduction for service products in back-office sales"
```

---

## Task 10: Exclude Services from Stock Reports

**Files:**
- Modify: `app/api/reports/stats/route.ts`
- Modify: `app/api/reports/inventory/route.ts`

- [ ] **Step 1: Find the low-stock queries**

Run:
```bash
grep -n "reorder_point\|stock <=\|stock <" app/api/reports/stats/route.ts app/api/reports/inventory/route.ts
```

Record every matching query — each one needs the filter.

- [ ] **Step 2: Add the filter to each query**

For every low-stock, out-of-stock, or stock-valuation query found in Step 1, add to its `WHERE` clause:

```sql
AND type = 'standard'
```

If the query aliases the products table (e.g. `FROM products p`), qualify it as `p.type = 'standard'` to match the surrounding style.

Rationale to include as a comment above the first one in each file:

```typescript
// Services are excluded: they have no stock, so they would otherwise appear
// permanently out-of-stock and drag inventory valuation totals to zero.
```

- [ ] **Step 3: Verify the service is absent from low-stock**

Run: `npm run dev`

Open http://localhost:3000/reports and confirm `Test Service A` (stock 0) does not appear in low-stock or out-of-stock lists.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck 2>&1 | grep -v "^.next" | grep -E "error TS"`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add app/api/reports/stats/route.ts app/api/reports/inventory/route.ts
git commit -m "feat(reports): exclude services from stock alerts and valuation"
```

---

## Task 11: Exclude Services from Stock-Operation Pickers

**Files:** Determined by Step 1 — not known in advance.

The spec flags this task as carrying the plan's main uncertainty: the picker list came from architecture docs, not from reading each file. Step 1 establishes the real list.

- [ ] **Step 1: Find every product picker used by stock operations**

Run:
```bash
grep -rln "FROM products" app/api/purchases app/api/inventory app/api/approvals 2>/dev/null
```

And for the UI side:
```bash
grep -rln "getProducts\|/api/products" app/\(app\)/purchases app/\(app\)/inventory 2>/dev/null
```

From the results, keep only the ones that let a user pick a product for: purchase orders, stock adjustment, stock count, stock transfer, bad orders, or repackaging. Write the list into the commit body so the next reviewer can check it.

- [ ] **Step 2: Add the filter to each picker query**

For each query identified, add `AND type = 'standard'` to its `WHERE` clause (qualified with the table alias where one is used).

- [ ] **Step 3: Verify each picker excludes the service**

Run: `npm run dev`

For each screen in the Step 1 list, open its product picker and confirm `Test Service A` does not appear. Check at minimum: Purchase Order create, Stock Adjustment, Stock Count, Stock Transfer.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck 2>&1 | grep -v "^.next" | grep -E "error TS"`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(inventory): exclude services from stock-operation product pickers"
```

---

## Task 12: Service Badge and Filter in the Inventory List

**Files:**
- Modify: `app/(app)/inventory/product-list-types.ts`
- Modify: `app/(app)/inventory/ProductCard.tsx` or `ProductTableRowGroup.tsx` (whichever renders the row badges — confirm in Step 1)
- Modify: `app/(app)/inventory/use-inventory-page.ts`

- [ ] **Step 1: Locate the row-badge render and the filter state**

Run:
```bash
grep -n "type\|Badge" app/\(app\)/inventory/product-list-types.ts | head -20
grep -rn "Badge" app/\(app\)/inventory/ProductCard.tsx app/\(app\)/inventory/ProductTableRowGroup.tsx | head -10
grep -n "filter\|useState" app/\(app\)/inventory/use-inventory-page.ts | head -20
```

- [ ] **Step 2: Add type to the product row type**

In `app/(app)/inventory/product-list-types.ts`, add to the product interface:

```typescript
  type?: 'standard' | 'service';
```

- [ ] **Step 3: Render the badge**

In the row component identified in Step 1, next to the existing badges:

```tsx
{product.type === 'service' && (
  <Badge variant="secondary" className="ml-2">Service</Badge>
)}
```

- [ ] **Step 4: Add the filter state**

In `use-inventory-page.ts`, alongside the existing filter state:

```typescript
  const [typeFilter, setTypeFilter] = useState<'all' | 'standard' | 'service'>('all');
```

Apply it wherever the product list is filtered:

```typescript
    .filter(p => typeFilter === 'all' || (p.type ?? 'standard') === typeFilter)
```

The `?? 'standard'` fallback matters: rows fetched by a SELECT that omits the column must not vanish from the Standard filter.

Export `typeFilter` and `setTypeFilter` from the hook, and wire a select control in the inventory page toolbar with options All / Standard / Service.

- [ ] **Step 5: Verify the badge and filter**

Run: `npm run dev`

At http://localhost:3000/inventory, confirm `Test Service A` shows a Service badge, that the Service filter shows only it, and that the Standard filter hides it.

- [ ] **Step 6: Typecheck and lint**

Run: `npm run typecheck 2>&1 | grep -v "^.next" | grep -E "error TS"`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add app/\(app\)/inventory
git commit -m "feat(inventory): add Service badge and type filter to product list"
```

---

## Task 13: Lock the Type in Edit Product

**Files:** Determined by Step 1.

- [ ] **Step 1: Find the edit-product form**

Run:
```bash
grep -rln "edit-product\|EditProduct" app/\(app\)/products app/\(app\)/inventory | head
```

- [ ] **Step 2: Display the type read-only**

In the edit form, render the product's type as a disabled control or plain text label — visible so the user can see what the product is, but not editable:

```tsx
<div className="flex items-center gap-2">
  <span className="text-sm font-medium">Product Type:</span>
  <Badge variant="secondary">
    {product.type === 'service' ? 'Service' : 'Standard'}
  </Badge>
  <span className="text-xs text-muted-foreground">
    Cannot be changed after creation.
  </span>
</div>
```

- [ ] **Step 3: Ensure the update path never writes type**

Find the `UPDATE products SET ...` statement used by the edit action and confirm `type` is not among its columns. If it is, remove it.

Run:
```bash
grep -rn "UPDATE products SET" app/\(app\)/products/actions.ts | head
```

- [ ] **Step 4: Verify**

Run: `npm run dev`

Open `Test Service A` for editing and confirm the type shows as Service and cannot be changed.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(products): show product type read-only in edit form"
```

---

## Task 14: End-to-End Coverage

**Files:**
- Create: `tests/e2e/product-type-service.spec.ts`

**Interfaces:**
- Consumes: everything from Tasks 1-13

Model the structure on `tests/e2e/add-product-approval.spec.ts`, which already demonstrates this suite's `testQuery` helper and cleanup conventions.

- [ ] **Step 1: Read the reference spec**

Run: `cat tests/e2e/add-product-approval.spec.ts`

Copy its import block, `testQuery` usage, login helper, and `beforeEach` cleanup style exactly — do not invent a new pattern.

The helpers live at `tests/e2e/helpers/auth.ts` (`seedSession`, `DEFAULT_ADMIN`) and `tests/e2e/helpers/db.ts` (`testQuery`, `resetPosState`). Confirm the exact exported names before relying on them.

That spec also contains a Radix Select helper for picking options inside the Add Product dialog. Reuse it rather than writing new selector logic — the dialog's selects are not native `<select>` elements.

- [ ] **Step 2: Write the spec**

Create `tests/e2e/product-type-service.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';
import { seedSession, DEFAULT_ADMIN } from './helpers/auth';
import { testQuery } from './helpers/db';

/**
 * Service products: sell without stock, batches, or movements.
 *
 * The critical assertion is #2 — a service sale must leave stock untouched
 * while still writing cost_at_sale, because profit reporting reads that column
 * and cannot tell services from standard goods.
 */
test.describe('Service product type', () => {
  const SERVICE_SKU = 'E2E-SVC-001';
  const SERVICE_NAME = 'E2E Test Service';

  test.beforeEach(async ({ page }) => {
    await testQuery('DELETE FROM sale_items WHERE product_name = ?', [SERVICE_NAME]);
    await testQuery('DELETE FROM products WHERE sku = ?', [SERVICE_SKU]);
    // Every page in this suite is behind auth — seed the session first.
    await seedSession(page, DEFAULT_ADMIN);
  });

  test('creating a service hides all stock fields', async ({ page }) => {
    await page.goto('/products');
    await page.getByRole('button', { name: 'Add Product' }).click();
    await page.getByRole('button', { name: 'Service', exact: true }).click();

    await expect(page.getByRole('tab', { name: /Conversion/ })).toBeHidden();

    await page.getByRole('tab', { name: /Inventory/ }).click();
    await expect(page.getByLabel(/Initial Stock/i)).toBeHidden();
    await expect(page.getByLabel(/Reorder Point/i)).toBeHidden();
    await expect(page.getByLabel(/Supplier/i)).toBeHidden();
    await expect(page.getByLabel(/Warehouse/i)).toBeHidden();
    await expect(page.getByLabel(/Cost/i)).toBeVisible();
    await expect(page.getByLabel(/Price/i)).toBeVisible();
  });

  test('selling a service leaves stock untouched but records cost', async ({ page }) => {
    await testQuery(
      `INSERT INTO products (id, name, description, category, brand, sku, stock, price, cost, unit_of_measure, type)
       VALUES (?, ?, 'E2E service', 'IT Services', 'Generic', ?, 0, 500, 200, 'Service', 'service')`,
      [SERVICE_SKU, SERVICE_NAME, SERVICE_SKU]
    );

    await page.goto('/pos');
    await page.getByPlaceholder(/Search/i).fill(SERVICE_NAME);
    await page.getByText(SERVICE_NAME).first().click();
    await page.getByRole('button', { name: /Checkout|Pay/i }).click();
    await page.getByRole('button', { name: /Cash/i }).click();
    await page.getByRole('button', { name: /Confirm|Complete/i }).click();
    await expect(page.getByText(/Receipt|Change|Success/i).first()).toBeVisible({ timeout: 15000 });

    const stock: any = await testQuery('SELECT stock FROM products WHERE sku = ?', [SERVICE_SKU]);
    expect(Number(stock[0].stock)).toBe(0);

    const movements: any = await testQuery(
      'SELECT COUNT(*) c FROM stock_movements WHERE product_id = ?',
      [SERVICE_SKU]
    );
    expect(Number(movements[0].c)).toBe(0);

    const items: any = await testQuery(
      'SELECT cost_at_sale, batch_source FROM sale_items WHERE product_name = ? ORDER BY id DESC LIMIT 1',
      [SERVICE_NAME]
    );
    expect(Number(items[0].cost_at_sale)).toBe(200);
    expect(items[0].batch_source).toBeNull();
  });

  test('a service with no batches never blocks on oversell', async ({ page }) => {
    await testQuery("UPDATE pos_settings SET value = '1' WHERE key_name = 'oversell_block'").catch(() => {});
    await testQuery(
      `INSERT INTO products (id, name, description, category, brand, sku, stock, price, cost, unit_of_measure, type)
       VALUES (?, ?, 'E2E service', 'IT Services', 'Generic', ?, 0, 500, 200, 'Service', 'service')`,
      [SERVICE_SKU, SERVICE_NAME, SERVICE_SKU]
    );

    await page.goto('/pos');
    await page.getByPlaceholder(/Search/i).fill(SERVICE_NAME);
    await page.getByText(SERVICE_NAME).first().click();
    await page.getByRole('button', { name: /Checkout|Pay/i }).click();
    await page.getByRole('button', { name: /Cash/i }).click();
    await page.getByRole('button', { name: /Confirm|Complete/i }).click();

    await expect(page.getByText(/Batch stock exhausted/i)).toBeHidden();
    await expect(page.getByText(/Receipt|Change|Success/i).first()).toBeVisible({ timeout: 15000 });
  });

  test('services are absent from low-stock alerts', async ({ page }) => {
    await testQuery(
      `INSERT INTO products (id, name, description, category, brand, sku, stock, reorder_point, price, cost, unit_of_measure, type)
       VALUES (?, ?, 'E2E service', 'IT Services', 'Generic', ?, 0, 10, 500, 200, 'Service', 'service')`,
      [SERVICE_SKU, SERVICE_NAME, SERVICE_SKU]
    );

    await page.goto('/reports');
    await expect(page.getByText(SERVICE_NAME)).toBeHidden();
  });
});
```

- [ ] **Step 3: Reset the test database**

Run: `npm run test:e2e:db`
Expected: completes without error

- [ ] **Step 4: Run the new spec**

Run: `npx playwright test tests/e2e/product-type-service.spec.ts`
Expected: 4 passed

If a selector fails, fix the selector to match the actual DOM — do not weaken an assertion to make it pass.

- [ ] **Step 5: Run the full suite as a regression check**

Run: `npm run test:e2e`
Expected: all pre-existing tests still pass. Batch-deduction and family-sync coverage passing unchanged is the proof that the standard path is untouched.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/product-type-service.spec.ts
git commit -m "test(products): E2E coverage for service product type"
```

---

## Task 15: Import Path

**Files:**
- Modify: `app/api/data-management/import/products/route.ts`

This route *inserts* `inventory_batches` rows (around line 74); it does not deduct. It is not a third sales path.

- [ ] **Step 1: Read the insert block**

Run: `sed -n '50,110p' app/api/data-management/import/products/route.ts`

- [ ] **Step 2: Accept the type column**

Add `type` to the products INSERT, defaulting to `'standard'` when the imported row does not specify it:

```typescript
const rowType = String(row.type || '').toLowerCase() === 'service' ? 'service' : 'standard';
```

Add `type` to the column list and `rowType` to the values array, matching the pattern used in Task 7.

- [ ] **Step 3: Skip batch creation for imported services**

Wrap the `INSERT INTO inventory_batches` block:

```typescript
if (rowType === 'standard') {
  // ... existing batch insert ...
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck 2>&1 | grep -v "^.next" | grep -E "error TS"`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add app/api/data-management/import/products/route.ts
git commit -m "feat(import): support product type on product import"
```

---

## Task 16: Final Verification

- [ ] **Step 1: Clean up manual test data**

```bash
npx tsx scripts/dbq.ts "DELETE FROM products WHERE name='Test Service A'"
```

- [ ] **Step 2: Full quality gate**

Run: `npm run typecheck 2>&1 | grep -v "^.next" | grep -E "error TS"`
Expected: no output

- [ ] **Step 3: Full test suite**

Run: `npm run test:e2e`
Expected: all pass, including the 4 new service tests

- [ ] **Step 4: Verify the migration rolls back cleanly**

```bash
npm run migrate:down
npm run migrate
```
Expected: down drops `products.type` and its index without error; up re-adds them. This confirms the rollback path works before the change reaches production.

- [ ] **Step 5: Report results**

State plainly which commands were run and their actual output. If anything failed, say so with the output rather than describing the feature as complete.

---

## Self-Review Notes

**Spec coverage:** §1 → Task 1; §2 → Task 13; §3 → Tasks 3-6; §4 → Tasks 3, 7, 8, 9; §5 → Tasks 8, 9; §6 → Task 2; §7 → Tasks 10, 11, 12; §8 → Task 15; §9 → Task 14.

**Deviation from the spec:** §9 calls for unit tests of `lib/product-type.ts`. There is no unit test runner in this repo — no `test` script, no jest or vitest dependency — so Task 2 verifies the predicate with a direct `tsx` invocation instead, and Task 14 covers it end-to-end. Adding a test runner for a four-line predicate was judged not worth the dependency. Revisit if unit-testable logic accumulates.

**Known soft spots, stated rather than hidden:**
- **Task 6** edits a file that was not read in full during planning. Step 1 mandates reading it first; the listed line numbers may have shifted.
- **Task 9** Step 1 mandates reading the back-office sales loop before editing, for the same reason. Step 5 may turn out to be a no-op.
- **Tasks 11, 12, 13** discover their own file lists in Step 1. This is the spec's flagged uncertainty (§10) and cannot be resolved without reading those files.
- **Task 14** selectors (POS search box, checkout buttons) are guesses based on conventional labels. Expect to adjust them against the real DOM.
