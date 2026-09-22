# Retire products.sku — Schema + Core Forms (Sub-project A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the manual SKU field from Add/Edit Product, make the base selling unit's barcode the required, auto-generated identifier in its place, and keep `products.sku` mirrored from that barcode (not dropped yet) so every other file that still reads `products.sku` today keeps working unmodified until its own sub-project.

**Architecture:** `products.sku` stays in the database and keeps being written on every create/update — its value is now sourced from the base selling unit's barcode instead of a user-typed field, so it and the barcode are always identical from this point forward. The Add/Edit Product forms drop the SKU input; the existing `barcode` field (already bound to the base selling unit — see the spec's "two barcode columns" section) becomes required and pre-fills itself with a generated EAN-8 code the moment the dialog opens for a new product, using the same generator (`generateBarcode`) already used for extra selling units and re-generation.

**Tech Stack:** Next.js 16 App Router, react-hook-form + zod, raw `mysql2/promise` via `lib/mysql.ts`, no ORM.

**Spec:** `docs/superpowers/specs/2026-09-22-retire-product-sku-design.md`

## Global Constraints

- Do not drop the `products.sku` column or its unique index in this plan — that is a final-cleanup step after Sub-project D, once no file reads it. `products.sku` must keep being written on every insert/update so files in sub-projects B–D keep working.
- Do not touch `products.barcode` (the legacy per-product column, migration 001) — it is a different column from `product_selling_units.barcode` and is out of scope entirely (see the spec's "Two barcode columns" section).
- Do not touch `supplier_product_mapping.supplier_sku` — unrelated, stays exactly as-is.
- Do not touch `lib/product-search.ts`, any report, bulk price-list import/export, sales/purchase product selectors, or e2e test files in this plan — those belong to Sub-projects B, C, and D respectively.
- The base selling unit's barcode UNIQUE constraint (migration 118, `uniq_selling_unit_barcode`) already exists and already enforces cross-product/cross-selling-unit uniqueness — no new constraint is added by this plan.
- `POST /api/products` (`CreateProductUseCase` / `MySqlProductRepository.create`) is a live, e2e-tested path independent of `actions.ts`. Its `sku` becomes optional, not removed — `tests/e2e/purchase-order.spec.ts` explicitly passes a `sku` value today and must keep passing unmodified in this plan (that test's own migration to barcode-based fixtures is Sub-project D's job).

---

### Task 1: Backfill migration — every product's base unit gets a barcode

**Files:**
- Create: `scripts/migrations/<next-number>_backfill_base_unit_barcode_from_sku.ts` (run `ls scripts/migrations | sort | tail -5` to find the current highest number and pick the next one)
- Test: manual (query verification, no test harness covers migrations directly)

**Interfaces:**
- Consumes: nothing new — reads `products.sku` and `product_selling_units` directly.
- Produces: after this migration, every product's base selling unit (`is_base = 1`) has a non-empty `barcode`, OR the migration's own log output lists which product ids were skipped because their `sku` collided with an already-used barcode (see Step 2's dedupe check) — those are surfaced for a human decision, not silently resolved.

- [ ] **Step 1: Check the current highest migration number**

```bash
ls scripts/migrations | sort | tail -5
```

Use that number + 1 for this migration's filename and internal `name` field (this codebase's migrations are numbered sequentially, e.g. `088_...`, `118_...` — follow the same `NNN_description.ts` pattern).

- [ ] **Step 2: Write the migration**

Read `scripts/migrations/118_create_product_selling_units.ts` first to confirm the exact table/column names this migration depends on (`product_selling_units.barcode`, `product_selling_units.is_base`, `product_selling_units.product_id`) — do not proceed until you've confirmed those names against that file, since a typo here silently no-ops instead of erroring.

```typescript
import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

const migration: Migration = {
  name: '<NNN>_backfill_base_unit_barcode_from_sku',
  timestamp: new Date().toISOString().replace(/T/, '_').replace(/\..+/, '').replace(/:/g, '-'),

  async up(): Promise<void> {
    // Every product's base selling unit (is_base = 1) should have a barcode
    // once this plan's forms require one going forward. Pre-existing
    // products created before this change may not — backfill from their
    // own `sku` (already unique per (sku, warehouse_id)) rather than
    // generating a fresh random code, so existing printed labels /
    // external references that happen to already use the sku as a scan
    // code keep working.
    const baseUnitsMissingBarcode: any = await query(`
      SELECT psu.id AS selling_unit_id, psu.product_id, p.sku
      FROM product_selling_units psu
      JOIN products p ON p.id = psu.product_id
      WHERE psu.is_base = 1
        AND (psu.barcode IS NULL OR psu.barcode = '')
    `);

    let backfilled = 0;
    let skipped = 0;
    const skippedProductIds: string[] = [];

    for (const row of baseUnitsMissingBarcode) {
      const candidateBarcode = row.sku;
      if (!candidateBarcode) {
        skipped++;
        skippedProductIds.push(row.product_id);
        continue;
      }

      // A candidate barcode must not already be in use by ANY selling unit
      // (the unique index spans all selling units, not just base ones) —
      // check before writing rather than letting the INSERT/UPDATE's own
      // unique-constraint violation abort the whole migration partway
      // through.
      const [clash]: any = await query(
        'SELECT id FROM product_selling_units WHERE barcode = ? AND id != ? LIMIT 1',
        [candidateBarcode, row.selling_unit_id],
      );

      if (clash) {
        skipped++;
        skippedProductIds.push(row.product_id);
        console.warn(`⚠️  Skipped product ${row.product_id}: sku "${candidateBarcode}" already used as a barcode by selling unit ${clash.id}`);
        continue;
      }

      await query('UPDATE product_selling_units SET barcode = ? WHERE id = ?', [candidateBarcode, row.selling_unit_id]);
      backfilled++;
    }

    console.log(`✅ Backfilled ${backfilled} base selling unit barcode(s) from products.sku`);
    if (skipped > 0) {
      console.warn(`⚠️  ${skipped} product(s) skipped (sku collided with an existing barcode) — these still have no base unit barcode and must be resolved by hand before Add/Edit Product's barcode requirement can be relied on for them:`);
      console.warn(skippedProductIds.join(', '));
    }
  },

  async down(): Promise<void> {
    // Deliberately a no-op: reversing this would mean guessing which
    // barcodes were backfilled by this migration versus set by a user
    // afterward (e.g. by editing the product post-migration). Leaving
    // backfilled barcodes in place on rollback is the safe default — they
    // are valid, unique barcodes either way.
    console.log('ℹ️  No rollback: backfilled barcodes are left in place (see migration source for rationale).');
  }
};

registerMigration(migration);
```

- [ ] **Step 3: Run the migration against your local dev database**

```bash
npm run migrate
```

Expected output includes `✅ Backfilled N base selling unit barcode(s) from products.sku` (N may be 0 on a fresh/seeded dev database — that's fine, it means every product already had one).

- [ ] **Step 4: Verify with a direct query**

```bash
npm run migrate -- --help 2>/dev/null; echo "run the query below via your MySQL client instead"
```

Using whatever MySQL client you have configured (`mysql -u ... -p ... verdix`), run:

```sql
SELECT COUNT(*) AS products_missing_base_barcode
FROM products p
JOIN product_selling_units psu ON psu.product_id = p.id AND psu.is_base = 1
WHERE psu.barcode IS NULL OR psu.barcode = '';
```

Expected: this count matches the "skipped" count logged in Step 3 (0 in the common case) — every other product now has a base-unit barcode.

- [ ] **Step 5: Commit**

```bash
git add scripts/migrations/
git commit -m "feat: backfill base selling unit barcode from products.sku for pre-existing products"
```

---

### Task 2: `generateBarcode` becomes the default on Add Product's dialog open

**Files:**
- Modify: `app/(app)/products/add-product/use-add-product-form.ts`
- Test: manual

**Interfaces:**
- Consumes: existing `generateBarcode(fieldPath)` (already defined in this file, confirmed at the file's `generateBarcode = (fieldPath: 'barcode' | ...) => {...}` — EAN-8: 7 random digits + 1 check digit).
- Produces: nothing new exposed — this task only adds a call site, not a new export.

- [ ] **Step 1: Locate the dialog-open reset effect**

```bash
grep -n "if (isOpen) {" "app/(app)/products/add-product/use-add-product-form.ts"
```

Read the effect this locates (it resets `lastAutoRetailPrice`/`retailPriceEditedByUser`/`lastAutoSuggestedCost`/`costEditedByUser` on open — confirm this is the same effect that calls `form.reset()`).

- [ ] **Step 2: Auto-generate a barcode inside that same effect**

Add a call to `generateBarcode()` (default `fieldPath` is `'barcode'`) right after `form.reset()` inside that effect, so a brand-new Add Product session opens with a barcode already filled in — the user can still change it, this just means they're never blocked on typing one from scratch. Confirm the exact surrounding lines with:

```bash
grep -n "form.reset();" "app/(app)/products/add-product/use-add-product-form.ts"
```

Add the call immediately after that line, inside the same `if (isOpen) { ... }` block:

```typescript
      form.reset();
      generateBarcode();
```

Note: `generateBarcode` is defined later in the file (function declarations via `const` are not hoisted) — since this is inside a `useEffect` callback that only *runs* on open (after the whole component body, including `generateBarcode`'s own `const` assignment, has executed), this is safe; it is not called during the render itself.

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit -p .
```

Expected: no new errors (compare the total count against the baseline — run `npx tsc --noEmit -p . 2>&1 | wc -l` before and after this step if unsure what today's baseline count is).

- [ ] **Step 4: Manual verification**

Run `npm run dev`, open Add Product → Standard. Switch to the Selling Units tab and confirm the base unit's Barcode field already has an 8-digit value filled in (not blank), without having clicked the Wand2 "Generate" button.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/products/add-product/use-add-product-form.ts"
git commit -m "feat: auto-generate a barcode for a new product's base selling unit"
```

---

### Task 3: Make the base unit's Barcode field required in both schemas

**Files:**
- Modify: `app/(app)/products/add-product/product-schema.ts`
- Modify: `app/(app)/products/edit-product/product-schema.ts`
- Test: manual

**Interfaces:**
- Consumes: nothing new.
- Produces: `ProductFormValues.barcode` (both Add and Edit) is now `string` (min length 1), not `string | undefined`. Every later task in this plan that reads `formData.barcode`/`values.barcode` can assume it is present and non-empty for a standard product's submission.

- [ ] **Step 1: Read the current field in Add Product's schema**

```bash
grep -n "barcode: z.string" "app/(app)/products/add-product/product-schema.ts"
```

- [ ] **Step 2: Make it required in `baseProductSchema`**

In `app/(app)/products/add-product/product-schema.ts`, change:

```typescript
  barcode: z.string().optional(),
```

to:

```typescript
  barcode: z.string().min(1, 'Barcode is required'),
```

This is the ONE line inside `baseProductSchema` (shared by both Standard and Service) — do not touch the `serviceProductSchema`'s own barcode handling, since a Service has no selling units at all and this field, for a Service, behaves exactly as it does today (nothing in this plan changes Service behavior; the spec's "two barcode columns" section and every task in this plan concerns the Standard product's base selling unit only). Confirm with:

```bash
grep -n "barcode" "app/(app)/products/add-product/product-schema.ts"
```

Expected: exactly one `barcode:` line inside `baseProductSchema`, now required; `serviceProductSchema` has no barcode override of its own (it inherits the base schema's field, same as before this change — a Service product still has a barcode field on its Basic Info-equivalent tab, unaffected).

- [ ] **Step 3: Same change in Edit Product's schema**

```bash
grep -n "barcode: z.string" "app/(app)/products/edit-product/product-schema.ts"
```

Change the same `barcode: z.string().optional(),` line to `barcode: z.string().min(1, 'Barcode is required'),`.

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit -p .
```

Expected: no new errors. (`field.value ?? ''` patterns already used in both Barcode `FormField`s' `Input` components remain valid regardless of the zod type — they degrade gracefully to an empty string, not a crash, while the field is mid-edit.)

- [ ] **Step 5: Manual verification**

Add Product → Standard → Selling Units tab: clear the Barcode field entirely and try to save. Confirm a validation error appears ("Barcode is required") and the save is blocked, the same way a missing required field already behaves elsewhere in this form.

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/products/add-product/product-schema.ts" "app/(app)/products/edit-product/product-schema.ts"
git commit -m "feat: require a barcode on the base selling unit for standard products"
```

---

### Task 4: Remove the SKU field from Add Product's Basic Info tab

**Files:**
- Modify: `app/(app)/products/add-product/product-schema.ts`
- Modify: `app/(app)/products/add-product/use-add-product-form.ts`
- Modify: `app/(app)/products/add-product/tabs/basic-info-tab.tsx`
- Test: manual

**Interfaces:**
- Consumes: nothing new.
- Produces: `ProductFormValues` (Add) no longer has a `sku` field for either item type. `generateSku` is removed from `useAddProductForm`'s returned controller — Task 6 confirms no remaining reader before this lands, but do this step regardless since it's this task's own dead code to clean up.

- [ ] **Step 1: Remove `sku` from `baseProductSchema`**

In `app/(app)/products/add-product/product-schema.ts`, delete this line from `baseProductSchema`:

```typescript
  sku: z.string().min(1, 'SKU is required'),
```

Confirm no other `sku:` line remains in this file:

```bash
grep -n "sku" "app/(app)/products/add-product/product-schema.ts"
```

Expected: no matches (the `supplierMappings[].supplierSku` field, if grep matches "sku" as a substring, is a DIFFERENT field on a different object — `supplier_product_mapping`'s own per-supplier code, explicitly out of scope per this plan's Global Constraints. If your grep shows a `supplierSku` line, that is expected and must NOT be touched).

- [ ] **Step 2: Remove `sku` from the form's default values**

In `app/(app)/products/add-product/use-add-product-form.ts`, find and delete the `sku: '',` line in the `useForm({ defaultValues: {...} })` block:

```bash
grep -n "sku: ''" "app/(app)/products/add-product/use-add-product-form.ts"
```

- [ ] **Step 3: Remove the `generateSku` function and its export**

```bash
grep -n "generateSku" "app/(app)/products/add-product/use-add-product-form.ts"
```

Delete the whole function:

```typescript
  const generateSku = () => {
    const randomPart = Math.random().toString(36).substring(2, 8).toUpperCase();
    const brandPart = form.getValues('brand')?.substring(0, 3).toUpperCase() || 'BRD';
    const namePart = form.getValues('name')?.substring(0, 3).toUpperCase() || 'PRO';
    form.setValue('sku', `${brandPart}-${namePart}-${randomPart}`);
  };
```

And remove `generateSku,` from the hook's returned object (the `return { ... }` block near the bottom of the file).

- [ ] **Step 4: Remove the SKU `FormField` block from Basic Info tab**

In `app/(app)/products/add-product/tabs/basic-info-tab.tsx`, delete this entire block (the "Row 2: SKU" field, including its comment):

```tsx
      {/* Row 2: SKU — no partner left once Category moved into the card
          below, so it spans the full width instead of leaving an empty
          half-row beside it. */}
      <FormField
        control={form.control}
        name="sku"
        render={({ field }) => (
          <FormItem>
            <FormLabel>SKU</FormLabel>
            <div className="relative">
              <FormControl>
                <Input placeholder="e.g., COKE-PC" {...field} className="pr-10" />
              </FormControl>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 text-muted-foreground"
                onClick={generateSku}
              >
                <Wand2 className="h-4 w-4" />
                <span className="sr-only">Generate SKU</span>
              </Button>
            </div>
            <FormMessage />
          </FormItem>
        )}
      />
```

Also remove `generateSku` from this file's `useAddProductFormContext()` destructure. Check whether `Wand2` and `Button` become unused in this file after the removal:

```bash
grep -n "Wand2\|<Button" "app/(app)/products/add-product/tabs/basic-info-tab.tsx"
```

If either has zero remaining usages, remove its now-unused import too (unused imports are a lint warning in this codebase, not a build error — but clean up what this task itself made dead).

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit -p .
```

Expected: no new errors. If any file outside the three modified here now shows a `Property 'generateSku' does not exist` or `Property 'sku' does not exist on type ...` error, note it — that means a fourth file reads `generateSku`/the Add form's `sku` and needs the same treatment; this plan's own research found none, so treat any such error as new information to resolve within this task, not defer.

- [ ] **Step 6: Manual verification**

Add Product → Standard: confirm the Basic Info tab no longer shows a "SKU" field. Fill in the rest of the form (Selling Units tab's Barcode is pre-filled per Task 2) and save — confirm the product is created successfully.

- [ ] **Step 7: Commit**

```bash
git add "app/(app)/products/add-product/product-schema.ts" \
        "app/(app)/products/add-product/use-add-product-form.ts" \
        "app/(app)/products/add-product/tabs/basic-info-tab.tsx"
git commit -m "feat: remove the manual SKU field from Add Product"
```

---

### Task 5: Remove the (read-only) SKU field from Edit Product's Basic Info tab

**Files:**
- Modify: `app/(app)/products/edit-product/product-schema.ts`
- Modify: `app/(app)/products/edit-product/use-edit-product-form.ts`
- Modify: `app/(app)/products/edit-product/tabs/basic-info-tab.tsx`
- Test: manual

**Interfaces:**
- Consumes: nothing new.
- Produces: `ProductFormValues` (Edit) no longer has a `sku` field.

- [ ] **Step 1: Remove `sku` from Edit's schema**

In `app/(app)/products/edit-product/product-schema.ts`, delete:

```typescript
    sku: z.string().min(1, 'SKU is required'),
```

- [ ] **Step 2: Remove `sku` from the form's default values and reset logic**

```bash
grep -n "sku:" "app/(app)/products/edit-product/use-edit-product-form.ts"
```

This form spreads `...product` into its `defaultValues` and into the `sanitizedProduct` object inside the dialog-open reset effect, rather than listing every field explicitly — confirm there is no explicit `sku:` override line to remove (the grep above should show zero results in this file, since `sku` was never explicitly listed, only inherited via the `...product` spread). If the grep shows a result, read the surrounding 5 lines and remove that line the same way Task 4 Step 2 did for Add Product.

- [ ] **Step 3: Remove the SKU `FormField` block from Edit Product's Basic Info tab**

In `app/(app)/products/edit-product/tabs/basic-info-tab.tsx`, delete this block:

```tsx
      {/* SKU — no partner left once Category moved into the card below, so
          it spans the full width instead of leaving an empty half-row
          beside it. */}
      <FormField
        control={form.control}
        name="sku"
        render={({ field }) => (
          <FormItem>
            <FormLabel>SKU</FormLabel>
            <FormControl>
              <Input {...field} value={field.value ?? ''} readOnly className="bg-muted" />
            </FormControl>
            <FormDescription>SKU cannot be changed after creation.</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
```

Confirm removal and check for now-unused imports in this file the same way Task 4 Step 4 did (`FormDescription` in particular — check whether it's used elsewhere in this same file before removing its import):

```bash
grep -n "FormDescription" "app/(app)/products/edit-product/tabs/basic-info-tab.tsx"
```

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit -p .
```

Expected: no new errors.

- [ ] **Step 5: Manual verification**

Edit Product on any existing standard product: confirm the Basic Info tab no longer shows the read-only "SKU" field, the rest of the form still loads correctly, and saving still succeeds.

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/products/edit-product/product-schema.ts" \
        "app/(app)/products/edit-product/use-edit-product-form.ts" \
        "app/(app)/products/edit-product/tabs/basic-info-tab.tsx"
git commit -m "feat: remove the read-only SKU field from Edit Product"
```

---

### Task 6: Mirror `products.sku` from the base unit's barcode in `addProduct`

**Files:**
- Modify: `app/(app)/products/actions.ts`
- Test: manual

**Interfaces:**
- Consumes: `formData.barcode` — required and non-empty for a standard product's submission (Task 3's zod schema enforces this before `addProduct` is ever called), but a Service product has no selling units and its own top-level `barcode` field stays optional (unaffected by Task 3, which only touched `baseProductSchema`'s shared field — re-read Task 3 Step 2's note: a Service still inherits that same required field from `baseProductSchema`, so a Service's `barcode` is ALSO required by this plan's schema change; there is no remaining case where `formData.barcode` reaches `addProduct` as `undefined` for either item type. This step's fallback below exists purely as defense against a caller bypassing the form, not a real product-type distinction).
- Produces: `addProduct`'s `productId` generation and the inserted `products.sku` column value both derive from `formData.barcode` instead of `formData.sku` (which no longer exists on the submitted payload after Tasks 4–5, but `formData` here is still typed as `ProductFormData` — Step 1 tightens that type to match).

- [ ] **Step 1: Tighten `ProductFormData`'s `sku` and `barcode` fields**

```bash
grep -n "sku: string;\|barcode?: string;" "app/(app)/products/actions.ts" | head -5
```

Find the `ProductFormData` type definition (near the top of the file) and change:

```typescript
  sku: string;
  barcode?: string;
```

to:

```typescript
  sku?: string;
  barcode: string;
```

`sku` is no longer guaranteed to be sent by the form — this plan keeps the field in the type rather than removing it outright, since other current callers (e.g. the approval-queue snapshot at the `submitToApprovalQueue` call further down this same function, which reads `formData.sku` for a pending-approval item summary — out of this plan's scope to touch) still reference it. `barcode` becomes required at the type level to match what Task 3's zod schema now guarantees by the time a validated submission reaches this function, and is what Step 2 and Step 3 below rely on without an `undefined` fallback.

- [ ] **Step 2: Change `productId` generation in `addProduct`**

Find:

```typescript
    const productId = `${formData.sku}-${Date.now()}`;
```

Replace with:

```typescript
    // formData.sku no longer exists on a submitted product's payload (see
    // product-schema.ts) — formData.barcode (the base selling unit's
    // barcode) is required by Task 3's schema change for both item types,
    // so it's always a real value here, not `undefined`.
    const productId = `${formData.barcode}-${Date.now()}`;
```

- [ ] **Step 3: Mirror `products.sku` from `formData.barcode` in the INSERT**

Find, inside the `productData` object literal in `addProduct`:

```typescript
        sku: formData.sku,
```

Replace with:

```typescript
        // products.sku is retired as a user-facing field (see the
        // retire-product-sku spec) but the column itself stays populated —
        // kept in sync with the base unit's barcode — because every other
        // file still reading products.sku (search, reports, bulk import,
        // etc.) is migrated to barcode in later, separate sub-projects and
        // must keep seeing a matching value until then.
        sku: formData.barcode,
```

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit -p .
```

Expected: no new errors related to `actions.ts`. (If Step 1's `sku?: string` change surfaces a new error somewhere reading `formData.sku` without a null-check, note the file/line — this plan's own research found none, but confirm here rather than assume.)

- [ ] **Step 5: Manual verification**

Add Product → Standard → fill in the form (barcode auto-filled per Task 2) → Save. Query the created row:

```sql
SELECT id, sku FROM products WHERE name = '<the name you used>' ORDER BY created_at DESC LIMIT 1;
```

Confirm `sku` equals the barcode value shown in the Selling Units tab, and `id` starts with that same barcode followed by `-<timestamp>`.

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/products/actions.ts"
git commit -m "feat: mirror products.sku from the base selling unit's barcode in addProduct"
```

---

### Task 7: Mirror `products.sku` from the base unit's barcode in `updateProduct`

**Files:**
- Modify: `app/(app)/products/actions.ts`
- Test: manual

**Interfaces:**
- Consumes: `formData.barcode` (Task 3 makes it required in the Edit form's schema — always present on a submitted standard product's edit).
- Produces: `updateProduct`'s `productData.sku` derives from `formData.barcode ?? existing.barcode ?? existing.sku` instead of `formData.sku ?? existing.sku`, keeping the mirrored invariant on every edit too, not just create.

- [ ] **Step 1: Locate the current line**

```bash
grep -n "sku: formData.sku" "app/(app)/products/actions.ts"
```

This is inside `updateProduct`'s `productData` object:

```typescript
        sku: formData.sku ?? existing.sku,
```

- [ ] **Step 2: Replace it to mirror from barcode**

```typescript
        // Same mirroring rationale as addProduct (see that function's own
        // comment on this) — products.sku tracks the base selling unit's
        // barcode now. formData.barcode is required by the Edit schema for
        // a standard product's submission (Task 3), but this function is
        // also reachable for a partial update that doesn't touch the
        // barcode field at all — falling back to the already-stored
        // existing.barcode (the products.barcode column, which this
        // function ALSO mirrors from formData.barcode a few lines below)
        // keeps sku in sync with whatever barcode value survives this call,
        // rather than reverting to a stale existing.sku.
        sku: (formData.barcode !== undefined ? formData.barcode : existing.barcode) || existing.sku,
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit -p .
```

Expected: no new errors.

- [ ] **Step 4: Manual verification**

Edit an existing standard product's Barcode field (Selling Units tab) to a new unique value and save. Query:

```sql
SELECT sku, barcode FROM products WHERE id = '<product id>';
SELECT barcode FROM product_selling_units WHERE product_id = '<product id>' AND is_base = 1;
```

Confirm `products.sku` now equals the new barcode value, and matches the base selling unit's own `barcode` column.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/products/actions.ts"
git commit -m "feat: mirror products.sku from the base selling unit's barcode in updateProduct"
```

---

### Task 8: Make `sku` optional on the `CreateProductUseCase` / `MySqlProductRepository` path

**Files:**
- Modify: `src/core/products/application/CreateProductUseCase.ts`
- Modify: `src/infrastructure/repositories/MySqlProductRepository.ts`
- Test: `tests/e2e/purchase-order.spec.ts` (existing, unmodified)

**Interfaces:**
- Consumes: nothing new.
- Produces: `CreateProductRequest.sku` becomes `sku?: string`. `MySqlProductRepository.create` no longer assumes `product.sku` is present — falls back to `product.barcode` when `sku` is omitted, so a caller of this path that (after this plan) never sends `sku` still gets a populated `products.sku` column, same mirroring invariant as Tasks 6–7.

- [ ] **Step 1: Update the request type**

In `src/core/products/application/CreateProductUseCase.ts`, change:

```typescript
  sku: string;
```

to:

```typescript
  sku?: string;
```

- [ ] **Step 2: Update `MySqlProductRepository.create` to mirror when `sku` is absent**

In `src/infrastructure/repositories/MySqlProductRepository.ts`, find:

```typescript
    await query(sql, [
      id, product.name, product.description, product.category, product.brand, product.department,
      product.stock || 0, product.price, product.cost, product.sku, product.barcode, 0, 0
    ]);
```

Replace the `product.sku` argument:

```typescript
    // This path is reachable independently of app/(app)/products/actions.ts
    // (see the class-level comment further down in this file) and its own
    // CreateProductRequest no longer requires sku — mirror it from barcode
    // the same way addProduct/updateProduct do, so products.sku stays
    // populated for every creation path, not just the primary one.
    await query(sql, [
      id, product.name, product.description, product.category, product.brand, product.department,
      product.stock || 0, product.price, product.cost, product.sku ?? product.barcode ?? null, product.barcode, 0, 0
    ]);
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit -p .
```

Expected: no new errors.

- [ ] **Step 4: Run the existing purchase-order e2e spec to confirm it still passes unmodified**

```bash
npm run test:e2e -- purchase-order.spec.ts
```

Expected: 3/3 pass, same as this codebase's known-green baseline for this spec (this test explicitly sends its own `sku` value in its `POST /api/products` call, at `tests/e2e/purchase-order.spec.ts:78` — confirming that path still works with `sku` present is exactly what this step checks; the new `sku` optionality is exercised by nothing in this repo yet, since no current caller omits it, but the type-level change is what unblocks it for future callers and for Sub-project D's eventual test rewrite).

- [ ] **Step 5: Commit**

```bash
git add "src/core/products/application/CreateProductUseCase.ts" \
        "src/infrastructure/repositories/MySqlProductRepository.ts"
git commit -m "feat: make sku optional (mirrored from barcode) on the CreateProductUseCase path"
```

---

### Task 9: Full regression pass

**Files:** none (verification only)

**Interfaces:** none.

- [ ] **Step 1: Full typecheck**

```bash
npx tsc --noEmit -p . 2>&1 | wc -l
```

Compare against the baseline captured before Task 1 (run the same command on a clean `git status` before starting this plan if you haven't already recorded it). The count after all 8 tasks should be equal to or lower than that baseline — never higher.

- [ ] **Step 2: Run the purchase-order e2e spec once more against the fully-merged branch**

```bash
npm run test:e2e -- purchase-order.spec.ts
```

Expected: 3/3 pass (per this codebase's own documented flakiness pattern, do not conclude a single run proves anything if it fails — check twice, per the "Flaky approval E2E test" precedent already known in this codebase, before treating a failure as caused by this plan).

- [ ] **Step 3: Manual end-to-end walkthrough**

1. Add Product → Standard → fill Basic Info (no SKU field present) → Selling Units tab: confirm the base unit's Barcode is pre-filled with a generated 8-digit code → change it to a custom value → Save.
2. Open the new product in Edit Product: confirm Basic Info has no SKU field, confirm the Selling Units tab shows the same barcode you set in step 1.
3. Query `SELECT sku, barcode FROM products WHERE id = '<the product's id>'` and `SELECT barcode FROM product_selling_units WHERE product_id = '<id>' AND is_base = 1` — confirm all three values match.
4. Add Product → Service: confirm the Service form's own barcode field (top-level, unaffected by this plan) still works exactly as before — Services have no Selling Units tab and this plan does not change their barcode handling.
5. Open Edit Product on a product that existed before this plan's migration ran (any product seeded before Task 1): confirm its Selling Units tab shows a barcode (backfilled by the Task 1 migration), not a blank required field blocking the save.

- [ ] **Step 4: No commit for this task** (verification only — if any step fails, return to the relevant task above and fix before proceeding)
