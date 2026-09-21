# Consolidate Supplier Mapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the legacy single-supplier field from Add/Edit Product and make `supplier_product_mapping`'s primary row the one source for markup precedence, reorder point, and a new selling-unit cost suggestion.

**Architecture:** No new tables. `supplier_product_mapping` (already live, already has full CRUD in `actions.ts` and UI in `ProductSuppliers`/`AddSupplierMappingDialog`/the Add Product `SuppliersTab` field-array version) becomes the only place supplier data is entered for a product. Three read sites that currently read `products.supplier_id` or a form-only `supplier` field switch to reading the primary mapping instead, each keeping its existing fallback for products that predate this change.

**Tech Stack:** Next.js 16 App Router, react-hook-form + zod, raw `mysql2/promise` via `lib/mysql.ts`, no ORM.

**Spec:** `docs/superpowers/specs/2026-09-21-consolidate-supplier-mapping-design.md`

## Global Constraints

- Do not backfill or migrate `products.supplier_id` data into `supplier_product_mapping`. It stays as a read-only fallback for products created before this change.
- Do not touch `TransferStockService.ts`, PO receiving, or `lib/batch-deduction.ts` (FIFO costing). Supplier cost only ever suggests a form field value; it never writes `inventory_batches` or `sale_items.cost_at_sale`.
- Never auto-multiply a supplier's cost by a selling unit's `factor` into other selling units. The suggestion targets the base unit's cost field only; extra units are left untouched.
- Every new "suggest into a field, but let the user's own edit win" effect must follow the existing guarded-write pattern in this codebase: a ref remembers the last value the effect itself wrote, and any later mismatch means the user edited it, so the effect stops writing for the rest of that session (see `lastAutoRetailPrice`/`retailPriceEditedByUser` in both `use-add-product-form.ts` and `use-edit-product-form.ts` for the exact shape to copy).
- Do not change what the 70+ files reading `products.reorder_point`/`Product.reorderPoint` do with it — only what's allowed to write it changes.

---

### Task 1: Force the first supplier mapping to be primary (server-side)

**Files:**
- Modify: `app/(app)/products/actions.ts` (`addSupplierMapping`, lines 2441-2453)
- Test: manual (no test harness exercises `actions.ts` directly today — see Task 8 for the one existing e2e touchpoint)

**Interfaces:**
- Consumes: nothing new.
- Produces: `addSupplierMapping(productId, supplierId, leadTime, rop, cost?, supplierSku?, isPrimary?)` now ignores its `isPrimary` argument when the product currently has zero mapping rows, and always inserts `is_primary = 1` in that case. When it does so, it also writes the new row's `rop` into `products.reorder_point` — later tasks (3, 5) depend on `products.reorder_point` always reflecting the current primary mapping's `rop`, and this is the one insert path that previously never synced it at all (unlike `setPrimarySupplier`, which already does).

- [ ] **Step 1: Read the current function**

Confirm current body (already shown below) before editing:

```typescript
export async function addSupplierMapping(productId: string, supplierId: string, leadTime: number, rop: number, cost?: number, supplierSku?: string, isPrimary: boolean = false) {
  try {
    const id = `spm_${Date.now()}`;
    if (isPrimary) {
      await query('UPDATE supplier_product_mapping SET is_primary = 0 WHERE product_id = ?', [productId]);
    }
    await query('INSERT INTO supplier_product_mapping (id, product_id, supplier_id, supplier_lead_time, supplier_specific_rop, supplier_cost, supplier_sku, is_primary) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [id, productId, supplierId, leadTime, rop, cost || null, supplierSku || null, isPrimary ? 1 : 0]);
    return { success: true, message: 'Supplier mapping added successfully.' };
  } catch (error) {
    console.error('Error adding supplier mapping:', error);
    return { success: false, message: 'Error adding supplier mapping.' };
  }
}
```

- [ ] **Step 2: Rewrite it to force primary on the first mapping and sync ROP**

```typescript
export async function addSupplierMapping(productId: string, supplierId: string, leadTime: number, rop: number, cost?: number, supplierSku?: string, isPrimary: boolean = false) {
  try {
    const id = `spm_${Date.now()}`;

    const existingCount: any = await query(
      'SELECT COUNT(*) as count FROM supplier_product_mapping WHERE product_id = ?',
      [productId]
    );
    // A product's very first mapping is always primary — markup, reorder
    // point, and the selling-unit cost suggestion all read "the primary
    // mapping", and none of them should have to handle "one mapping exists
    // but none is primary" as a normal state.
    // Matches this file's own established unwrap convention for a
    // `COUNT(*) as count` query — see getProductsCount's `result[0].count`.
    const isFirstMapping = existingCount[0].count === 0;
    const resolvedIsPrimary = isFirstMapping ? true : isPrimary;

    if (resolvedIsPrimary) {
      await query('UPDATE supplier_product_mapping SET is_primary = 0 WHERE product_id = ?', [productId]);
    }
    await query('INSERT INTO supplier_product_mapping (id, product_id, supplier_id, supplier_lead_time, supplier_specific_rop, supplier_cost, supplier_sku, is_primary) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [id, productId, supplierId, leadTime, rop, cost || null, supplierSku || null, resolvedIsPrimary ? 1 : 0]);

    if (resolvedIsPrimary) {
      await query('UPDATE products SET reorder_point = ? WHERE id = ?', [rop, productId]);
    }

    return { success: true, message: 'Supplier mapping added successfully.' };
  } catch (error) {
    console.error('Error adding supplier mapping:', error);
    return { success: false, message: 'Error adding supplier mapping.' };
  }
}
```

- [ ] **Step 3: Manual verification**

Run the dev server (`npm run dev`), open Edit Product on any existing standard product with zero supplier mappings, go to the Suppliers tab, add one mapping. Confirm:
- The star icon shows immediately on that single row (it is primary) without needing to click "Set Primary".
- `products.reorder_point` for that product now equals the ROP you typed, via `SELECT reorder_point FROM products WHERE id = '<id>'`.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/products/actions.ts"
git commit -m "fix: first supplier mapping on a product is always primary"
```

---

### Task 2: Force the first supplier mapping to be primary (Add Product's local field array)

**Files:**
- Modify: `app/(app)/products/add-product/tabs/suppliers-tab.tsx` (`handleDialogSuccess`)
- Test: manual

**Interfaces:**
- Consumes: `supplierMappingFields` (existing `useFieldArray` fields array from `use-add-product-form.ts`), `appendSupplierMapping`.
- Produces: the same "first row is always primary" guarantee as Task 1, but client-side, since Add Product's mappings live in form state until submit and never touch `addSupplierMapping` at all (see `use-supplier-mapping-form.ts`'s `productId === 'new'` branch).

- [ ] **Step 1: Read the current `handleDialogSuccess`**

```typescript
const handleDialogSuccess = (data?: {
  supplierId: string;
  leadTime: number;
  rop: number;
  cost?: number;
  supplierSku?: string;
  isPrimary: boolean;
}) => {
  if (!data) return;

  // Only one mapping can be primary — clear any existing flag first, same
  // as setPrimarySupplier enforces server-side for an existing product.
  if (data.isPrimary) {
    supplierMappingFields.forEach((row, i) => {
      if (i !== editingIndex && row.isPrimary) {
        updateSupplierMappingField(i, { ...row, isPrimary: false });
      }
    });
  }

  if (editingIndex !== null) {
    updateSupplierMappingField(editingIndex, { ...supplierMappingFields[editingIndex], ...data });
  } else {
    appendSupplierMapping(data);
  }
  setEditingIndex(null);
};
```

- [ ] **Step 2: Force `isPrimary: true` when this is the first row being added**

```typescript
const handleDialogSuccess = (data?: {
  supplierId: string;
  leadTime: number;
  rop: number;
  cost?: number;
  supplierSku?: string;
  isPrimary: boolean;
}) => {
  if (!data) return;

  // A product's first supplier mapping is always primary — same rule
  // addSupplierMapping enforces server-side for Edit Product (see
  // actions.ts). Only applies when adding a brand-new row (editingIndex is
  // null) into a currently-empty array; editing an existing row leaves
  // whatever primary flag the user picked in the dialog.
  const isAddingFirstRow = editingIndex === null && supplierMappingFields.length === 0;
  const resolvedData = isAddingFirstRow ? { ...data, isPrimary: true } : data;

  // Only one mapping can be primary — clear any existing flag first, same
  // as setPrimarySupplier enforces server-side for an existing product.
  if (resolvedData.isPrimary) {
    supplierMappingFields.forEach((row, i) => {
      if (i !== editingIndex && row.isPrimary) {
        updateSupplierMappingField(i, { ...row, isPrimary: false });
      }
    });
  }

  if (editingIndex !== null) {
    updateSupplierMappingField(editingIndex, { ...supplierMappingFields[editingIndex], ...resolvedData });
  } else {
    appendSupplierMapping(resolvedData);
  }
  setEditingIndex(null);
};
```

- [ ] **Step 3: Manual verification**

Open Add Product → Standard → Suppliers tab → Add Supplier, fill in a supplier without checking any primary option (there is none in the dialog UI). Confirm the row renders with the star/"Primary" badge immediately after adding it.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/products/add-product/tabs/suppliers-tab.tsx"
git commit -m "fix: first supplier mapping added in Add Product is always primary"
```

---

### Task 3: Close the ROP desync gap in `updateSupplierMapping`

**Files:**
- Modify: `app/(app)/products/actions.ts` (`updateSupplierMapping`, lines 2455-2467)
- Test: manual

**Interfaces:**
- Consumes: nothing new.
- Produces: `updateSupplierMapping(id, leadTime, rop, cost?, supplierSku?, isPrimary?)` now also writes `products.reorder_point` whenever the row it just updated ends up primary (whether it already was, or `isPrimary: true` was just set) — closing the gap identified in the spec §3 where editing an already-primary row's ROP silently desynced `products.reorder_point` until someone re-triggered "Set Primary".

- [ ] **Step 1: Read the current function**

```typescript
export async function updateSupplierMapping(id: string, leadTime: number, rop: number, cost?: number, supplierSku?: string, isPrimary: boolean = false) {
  try {
    const [mapping]: any = await query('SELECT product_id FROM supplier_product_mapping WHERE id = ?', [id]);
    if (isPrimary && mapping) {
      await query('UPDATE supplier_product_mapping SET is_primary = 0 WHERE product_id = ?', [mapping.product_id]);
    }
    await query('UPDATE supplier_product_mapping SET supplier_lead_time = ?, supplier_specific_rop = ?, supplier_cost = ?, supplier_sku = ?, is_primary = ? WHERE id = ?', [leadTime, rop, cost || null, supplierSku || null, isPrimary ? 1 : 0, id]);
    return { success: true, message: 'Supplier mapping updated successfully.' };
  } catch (error) {
    console.error('Error updating supplier mapping:', error);
    return { success: false, message: 'Error updating supplier mapping.' };
  }
}
```

- [ ] **Step 2: Add the ROP sync after the update, for whichever row ends up primary**

```typescript
export async function updateSupplierMapping(id: string, leadTime: number, rop: number, cost?: number, supplierSku?: string, isPrimary: boolean = false) {
  try {
    const [existing]: any = await query('SELECT product_id, is_primary FROM supplier_product_mapping WHERE id = ?', [id]);
    if (!existing) {
      return { success: false, message: 'Supplier mapping not found.' };
    }

    if (isPrimary) {
      await query('UPDATE supplier_product_mapping SET is_primary = 0 WHERE product_id = ?', [existing.product_id]);
    }
    await query('UPDATE supplier_product_mapping SET supplier_lead_time = ?, supplier_specific_rop = ?, supplier_cost = ?, supplier_sku = ?, is_primary = ? WHERE id = ?', [leadTime, rop, cost || null, supplierSku || null, isPrimary ? 1 : 0, id]);

    // The row being edited was already primary (is_primary=1 before this
    // update, and isPrimary wasn't explicitly turned off — this function has
    // no "demote" path, only "promote via isPrimary:true"), or was just
    // promoted by this call. Either way, if it is primary AFTER this update,
    // its rop must be what products.reorder_point reflects — otherwise
    // editing an already-primary row's ROP here would silently desync it
    // until someone re-triggered setPrimarySupplier.
    const isNowPrimary = isPrimary || !!existing.is_primary;
    if (isNowPrimary) {
      await query('UPDATE products SET reorder_point = ? WHERE id = ?', [rop, existing.product_id]);
    }

    return { success: true, message: 'Supplier mapping updated successfully.' };
  } catch (error) {
    console.error('Error updating supplier mapping:', error);
    return { success: false, message: 'Error updating supplier mapping.' };
  }
}
```

- [ ] **Step 3: Manual verification**

In Edit Product's Suppliers tab, edit the primary mapping's ROP to a new value and save. Confirm `products.reorder_point` matches immediately (`SELECT reorder_point FROM products WHERE id = '<id>'`), without needing to touch "Set Primary".

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/products/actions.ts"
git commit -m "fix: editing the primary supplier mapping's ROP now syncs products.reorder_point"
```

---

### Task 4: Lift supplier-mapping state into `useEditProductForm`

**Files:**
- Modify: `app/(app)/products/edit-product/use-edit-product-form.ts`
- Modify: `app/(app)/products/product-suppliers/product-suppliers.tsx`
- Modify: `app/(app)/products/product-suppliers/use-product-suppliers.ts`
- Modify: `app/(app)/products/edit-product/edit-product-dialog.tsx`
- Test: manual

**Interfaces:**
- Consumes: `getSupplierMappings(productId)` (existing, returns `SupplierProductMapping[]`, already fixed to camelCase in a prior task on this branch).
- Produces: `useEditProductForm`'s returned controller gains `supplierMappings: SupplierProductMapping[]`, `isLoadingSupplierMappings: boolean`, `refreshSupplierMappings: () => Promise<void>`, and a derived `primarySupplierMapping: SupplierProductMapping | undefined`. Tasks 5 and 6 read `primarySupplierMapping` directly instead of re-fetching. `ProductSuppliers` stops owning its own `getSupplierMappings` fetch and instead takes `mappings`/`isLoading`/`onMappingsChanged` as props — this is the one fetch both the Suppliers tab and the markup/cost effects share, per spec §2.

- [ ] **Step 1: Read `use-product-suppliers.ts`'s current data-loading block**

```typescript
const loadData = async () => {
  setIsLoading(true);
  try {
    const [mappingsData, suppliersData] = await Promise.all([
      getSupplierMappings(productId),
      getSuppliers(),
    ]);
    setMappings(mappingsData);
    setSuppliers(suppliersData);
  } catch (error) {
    console.error('Failed to load supplier data', error);
    toast({
      variant: 'destructive',
      title: 'Error',
      description: 'Failed to load supplier data.',
    });
  } finally {
    setIsLoading(false);
  }
};

useEffect(() => {
  loadData();
}, [productId]);
```

- [ ] **Step 2: Split `use-product-suppliers.ts` so mappings/suppliers are optionally supplied externally**

Rewrite the hook's props and data section so it accepts the mappings from outside (falls back to fetching them itself only if not supplied — this keeps `ProductSuppliers` usable standalone elsewhere if it ever is, while letting Edit Product share one fetch):

```typescript
export interface UseProductSuppliersProps {
  productId: string;
  onUpdate?: () => void;
  /**
   * When supplied (Edit Product does, via useEditProductForm — see Task 4),
   * this hook uses these instead of fetching its own copy, so the markup and
   * selling-unit-cost suggestion effects in useEditProductForm and this
   * tab's CRUD UI always agree on the same primary mapping. When omitted,
   * this hook fetches and owns the data itself (kept for any other caller).
   */
  mappings?: SupplierProductMapping[];
  isLoadingMappings?: boolean;
  onMappingsChanged?: () => void | Promise<void>;
}

export function useProductSuppliers({
  productId,
  onUpdate,
  mappings: externalMappings,
  isLoadingMappings: externalIsLoading,
  onMappingsChanged,
}: UseProductSuppliersProps) {
  const [internalMappings, setInternalMappings] = useState<SupplierProductMapping[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [internalIsLoading, setInternalIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingMapping, setEditingMapping] = useState<SupplierProductMapping | null>(null);
  const [confirmPrimaryOpen, setConfirmPrimaryOpen] = useState(false);
  const [pendingPrimaryId, setPendingPrimaryId] = useState<string | null>(null);
  const { toast } = useToast();

  const usesExternalMappings = externalMappings !== undefined;
  const mappings = usesExternalMappings ? externalMappings : internalMappings;
  const isLoading = usesExternalMappings ? !!externalIsLoading : internalIsLoading;

  const loadData = async () => {
    if (usesExternalMappings) {
      // Suppliers still needs its own fetch either way — only the mappings
      // list is shared with the parent.
      try {
        setSuppliers(await getSuppliers());
      } catch (error) {
        console.error('Failed to load suppliers', error);
      }
      await onMappingsChanged?.();
      return;
    }
    setInternalIsLoading(true);
    try {
      const [mappingsData, suppliersData] = await Promise.all([
        getSupplierMappings(productId),
        getSuppliers(),
      ]);
      setInternalMappings(mappingsData);
      setSuppliers(suppliersData);
    } catch (error) {
      console.error('Failed to load supplier data', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to load supplier data.',
      });
    } finally {
      setInternalIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);
```

Leave the rest of the hook (`handleOpenDialog`, `handleDelete`, `initiateSetPrimary`, `confirmSetPrimary`) as-is, except: everywhere those functions currently call `loadData()` after a mutation, they should still call it — `loadData()` now internally does the right thing for both modes (refetches itself, or tells the parent to refetch via `onMappingsChanged`).

- [ ] **Step 3: Add supplier-mapping state to `useEditProductForm`**

In `app/(app)/products/edit-product/use-edit-product-form.ts`, add near the other option-data `useState` calls (after `const [suppliers, setSuppliers] = useState<Supplier[]>([]);`):

```typescript
const [supplierMappings, setSupplierMappings] = useState<SupplierProductMapping[]>([]);
const [isLoadingSupplierMappings, setIsLoadingSupplierMappings] = useState(false);
```

Add the import at the top of the file:

```typescript
import { Category, Product, Brand, UnitOfMeasure, Supplier, TaxRate, SystemSettings, SupplierProductMapping } from '@/lib/types';
```

and add `getSupplierMappings` to the existing `actions` import block:

```typescript
import {
  updateProduct,
  getBrands,
  getCategories,
  getSubcategories,
  getUnitsOfMeasure,
  getSuppliers,
  getSupplierMappings,
  getWarehouses,
  getShelfLocations,
  getDepartments,
} from '../actions';
```

Add the fetch effect, near the other `useEffect(() => { ... }, [isOpen])`-style effects (after the `product.reset` effect is fine — order doesn't matter here since this doesn't touch form state):

```typescript
const refreshSupplierMappings = async () => {
  setIsLoadingSupplierMappings(true);
  try {
    setSupplierMappings(await getSupplierMappings(product.id));
  } finally {
    setIsLoadingSupplierMappings(false);
  }
};

useEffect(() => {
  if (isOpen) {
    refreshSupplierMappings();
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [isOpen, product.id]);

const primarySupplierMapping = supplierMappings.find(m => m.isPrimary);
```

Add all four to the hook's returned object, in the "option data + loading flags" section:

```typescript
    suppliers,
    supplierMappings, isLoadingSupplierMappings, refreshSupplierMappings, primarySupplierMapping,
    warehouses,
```

- [ ] **Step 4: Wire `EditProductDialog` to pass the lifted state into `ProductSuppliers`**

In `app/(app)/products/edit-product/edit-product-dialog.tsx`, the controller destructure needs the new fields:

```typescript
const {
  isOpen, setIsOpen,
  isSubmitting,
  form,
  tabErrors,
  markupSource,
  saveChanges,
  supplierMappings,
  isLoadingSupplierMappings,
  refreshSupplierMappings,
} = controller;
```

And the `ProductSuppliers` render call becomes:

```tsx
<ProductSuppliers
  productId={product.id}
  mappings={supplierMappings}
  isLoadingMappings={isLoadingSupplierMappings}
  onMappingsChanged={refreshSupplierMappings}
  onUpdate={onProductUpdated}
/>
```

- [ ] **Step 5: Update `ProductSuppliers` to accept and forward the new props**

In `app/(app)/products/product-suppliers/product-suppliers.tsx`, update the component's prop type and its call into `useProductSuppliers`:

```typescript
export function ProductSuppliers({
  productId,
  onUpdate,
  mappings,
  isLoadingMappings,
  onMappingsChanged,
}: {
  productId: string;
  onUpdate?: () => void;
  mappings?: SupplierProductMapping[];
  isLoadingMappings?: boolean;
  onMappingsChanged?: () => void | Promise<void>;
}) {
  const {
    mappings: resolvedMappings,
    suppliers,
    isLoading,
    isDialogOpen,
    setIsDialogOpen,
    editingMapping,
    confirmPrimaryOpen,
    setConfirmPrimaryOpen,
    loadData,
    handleOpenDialog,
    handleDelete,
    initiateSetPrimary,
    confirmSetPrimary,
  } = useProductSuppliers({ productId, onUpdate, mappings, isLoadingMappings, onMappingsChanged });
```

Add the `SupplierProductMapping` type import if not already present, and replace every use of the old destructured `mappings` variable in this file's JSX with `resolvedMappings` (the table body's `.length === 0` check and `.map(...)` call).

- [ ] **Step 6: Typecheck**

```bash
npx tsc --noEmit -p .
```

Expected: no new errors in `use-edit-product-form.ts`, `edit-product-dialog.tsx`, `product-suppliers.tsx`, or `use-product-suppliers.ts`. (Pre-existing errors in unrelated files, e.g. `inventory-tab.tsx`'s `string | undefined` issues, are expected to remain — confirm they're the same ones from before this task by checking they're not in any file this task touched.)

- [ ] **Step 7: Manual verification**

Open Edit Product on a product with 2+ supplier mappings. Confirm the Suppliers tab still lists them, add/edit/delete/set-primary all still work exactly as before this task (this task only changes where the data source lives, not the UI behavior).

- [ ] **Step 8: Commit**

```bash
git add "app/(app)/products/edit-product/use-edit-product-form.ts" \
        "app/(app)/products/edit-product/edit-product-dialog.tsx" \
        "app/(app)/products/product-suppliers/product-suppliers.tsx" \
        "app/(app)/products/product-suppliers/use-product-suppliers.ts"
git commit -m "refactor: lift supplier-mapping fetch into useEditProductForm"
```

---

### Task 5: Markup reads the primary supplier mapping (Edit Product)

**Files:**
- Modify: `app/(app)/products/edit-product/use-edit-product-form.ts`
- Test: manual

**Interfaces:**
- Consumes: `primarySupplierMapping` (from Task 4).
- Produces: the markup-calculation effect now passes `primarySupplierMapping?.supplierId ?? product.supplier` as `supplierId` to `calculateMarkupPercentage`, instead of the removed `supplier` form field.

- [ ] **Step 1: Locate the current markup effect's `supplierId` input**

```typescript
const { markup, source } = calculateMarkupPercentage(
    {
        markupPercentage: product?.markupPercentage ?? null,
        category: watchedCategoryName,
        subcategory: watchedSubcategoryName,
        brand: watchedBrandName,
        supplierId: selectedSupplierId
    },
    systemSettings,
    categories,
    subcategories,
    brands,
    suppliers
);
```

- [ ] **Step 2: Replace `selectedSupplierId` with the primary-mapping-first value**

Remove the line `const selectedSupplierId = form.watch('supplier');` (Task 6 also removes the `supplier` form field entirely, so this watch would break anyway). In its place, add:

```typescript
// The Supplier field is gone from the form — markup's supplier link now
// comes from the primary supplier mapping (see refreshSupplierMappings /
// primarySupplierMapping above), falling back to the read-only legacy
// `product.supplier` (itself already primary_supplier_id || supplier_id,
// resolved by getProducts) for a product with no mapping row yet.
const markupSupplierId = primarySupplierMapping?.supplierId ?? product.supplier;
```

Update the `calculateMarkupPercentage` call site:

```typescript
const { markup, source } = calculateMarkupPercentage(
    {
        markupPercentage: product?.markupPercentage ?? null,
        category: watchedCategoryName,
        subcategory: watchedSubcategoryName,
        brand: watchedBrandName,
        supplierId: markupSupplierId
    },
    systemSettings,
    categories,
    subcategories,
    brands,
    suppliers
);
```

Update the effect's dependency array (the closing `}, [...])` line) — replace `selectedSupplierId` with `markupSupplierId`:

```typescript
}, [watchedCost, watchedCategoryName, watchedSubcategoryName, watchedBrandName, markupSupplierId, categories, subcategories, brands, suppliers, form, priceLevels, systemSettings, isInitialized, priceLevelFields]);
```

- [ ] **Step 3: Remove `selectedSupplierId` from the hook's returned object**

Find and remove the `selectedSupplierId,` line from the `return { ... }` block (it's no longer produced; `inventory-tab.tsx` will stop reading it in Task 7).

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit -p .
```

Expected: a new error will appear in `edit-product/tabs/inventory-tab.tsx` if it still reads `selectedSupplierId` from the context — that's expected and fixed in Task 7, not this one. Confirm no *other* new errors appear.

- [ ] **Step 5: Manual verification**

On a product with a primary supplier mapping whose supplier has a `markupPercentage` set (Suppliers management page → edit a supplier → set Markup %), and with `enableAutomaticMarkup` on and no category/subcategory/brand markup set, open Edit Product and confirm the markup hint (near the Save button) reads `Calculated from Supplier Markup (...)`.

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/products/edit-product/use-edit-product-form.ts"
git commit -m "feat: markup calculation reads the primary supplier mapping in Edit Product"
```

---

### Task 6: Remove the single Supplier field from Edit Product

**Files:**
- Modify: `app/(app)/products/edit-product/product-schema.ts`
- Modify: `app/(app)/products/edit-product/use-edit-product-form.ts`
- Modify: `app/(app)/products/edit-product/tabs/inventory-tab.tsx`
- Test: manual

**Interfaces:**
- Consumes: nothing new.
- Produces: `ProductFormValues` (Edit) no longer has a `supplier` field. `updateProduct` in `actions.ts` needs no code change — its existing line `supplier_id: (formData.supplier !== undefined ? formData.supplier : existing.supplier_id) || null` already preserves `existing.supplier_id` untouched whenever `formData.supplier` is `undefined`, which is what it will always be once the schema stops declaring it.

- [ ] **Step 1: Remove `supplier` from the Edit schema**

In `app/(app)/products/edit-product/product-schema.ts`, delete this line from `buildProductSchema`'s returned object:

```typescript
    supplier: z.string().optional(),
```

- [ ] **Step 2: Remove `supplier` from the form's default values and reset logic**

In `use-edit-product-form.ts`, remove these two lines (one in the initial `useForm({ defaultValues: {...} })` block, one in the `form.reset(sanitizedProduct)` effect's `sanitizedProduct` object):

```typescript
      supplier: product.supplier ?? '', // Handle null
```

(It appears twice — once in each object. Remove both occurrences.)

- [ ] **Step 3: Remove the Supplier field block from Inventory tab**

In `app/(app)/products/edit-product/tabs/inventory-tab.tsx`, delete this entire `FormField` block (the one wrapped in `{!isServiceProduct && (...)}` for `name="supplier"`):

```tsx
        {!isServiceProduct && (
        <FormField
          control={form.control}
          name="supplier"
          render={({ field }) => (
            <FormItem className="col-span-1">
              <FormLabel>Supplier (Optional)</FormLabel>
              <InlineEditableSelect
                items={suppliers}
                isLoading={false}
                value={field.value}
                onChange={field.onChange}
                open={selects.suppliers}
                onOpenChange={(o) => setSelects((p) => ({ ...p, suppliers: o }))}
                placeholder="Select a supplier"
                addLabel="Add Supplier"
                emptyLabel="No suppliers found"
                getId={(s: Supplier) => s.id}
                getValue={(s: Supplier) => s.id}
                getOptionLabel={(s: Supplier) => s.name}
                getName={(s: Supplier) => s.name}
                onAdd={async (name) => {
                  const r = await addSupplier({ name });
                  if (r.success) {
                    await refreshSuppliers();
                    const fresh = await getSuppliers();
                    const created = fresh.find((s) => s.name === name);
                    return created?.id;
                  }
                  return { error: r.message };
                }}
                onRename={async (id, name) => {
                  const existing = suppliers.find((s: Supplier) => s.id === id);
                  if (!existing) return undefined;
                  const r = await updateSupplier(id, { ...existing, name });
                  if (r.success) { await refreshSuppliers(); return id; }
                  return { error: r.message };
                }}
              />
              <FormMessage />
            </FormItem>
          )}
        />
        )}
```

Do not remove `suppliers`, `refreshSuppliers`, `addSupplier`, `updateSupplier`, or `getSuppliers` from this file's imports/context destructure — they may still be unused here after this deletion (check with the typecheck step below; if `suppliers`/`refreshSuppliers` become unused in this file specifically, it's fine to leave the destructured names in place since `useEditProductFormContext()` returns an object and unused destructured properties are not a TypeScript error — only remove the actual `addSupplier`/`updateSupplier`/`getSuppliers` *imports* if they're now unused, since unused imports would be a lint warning, not a build break).

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit -p .
```

Expected: no new errors. If `Supplier` (the type import) becomes unused in `inventory-tab.tsx`, that's a lint-only concern (this repo's lint is already broken per its own baseline — do not attempt to fix lint as part of this task).

- [ ] **Step 5: Manual verification**

Open Edit Product on any standard product. Confirm the Inventory tab no longer shows a "Supplier (Optional)" field, the form still submits successfully, and (query the DB) `products.supplier_id` for that product is unchanged after saving — proving the removal doesn't null out existing legacy data.

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/products/edit-product/product-schema.ts" \
        "app/(app)/products/edit-product/use-edit-product-form.ts" \
        "app/(app)/products/edit-product/tabs/inventory-tab.tsx"
git commit -m "feat: remove single Supplier field from Edit Product Inventory tab"
```

---

### Task 7: Conditional Reorder Point field in Edit Product's Inventory tab

**Files:**
- Modify: `app/(app)/products/edit-product/edit-product-form-context.tsx`
- Modify: `app/(app)/products/edit-product/tabs/inventory-tab.tsx`
- Test: manual

**Interfaces:**
- Consumes: `primarySupplierMapping` (Task 4), already on `useEditProductForm`'s returned controller and therefore already flowing through `EditProductFormProvider`/`useEditProductFormContext()` with no extra wiring — confirm this in Step 1.

- [ ] **Step 1: Confirm the context already exposes `primarySupplierMapping`**

`edit-product-form-context.tsx` is a plain pass-through (`createContext<EditProductFormController | null>`), so anything added to the hook's return value in Task 4 is already available via `useEditProductFormContext()`. Read the file to confirm there is no manual prop-list to update:

```bash
cat "app/(app)/products/edit-product/edit-product-form-context.tsx"
```

If it is indeed a plain pass-through (matches the same shape as `add-product-form-context.tsx` shown earlier in this plan's research), no change is needed here — skip to Step 2.

- [ ] **Step 2: Replace the ROP field block in Inventory tab with a conditional version**

In `app/(app)/products/edit-product/tabs/inventory-tab.tsx`, add `primarySupplierMapping` to the context destructure at the top of the component:

```typescript
export function InventoryTab() {
  const {
    form,
    product,
    departments, isLoadingDepartments,
    taxRates,
    suppliers,
    warehouses,
    shelfLocations,
    units,
    selects, setSelects,
    refreshDepartments,
    refreshSuppliers,
    refreshWarehouses,
    refreshShelfLocations,
    refreshUnits,
    primarySupplierMapping,
  } = useEditProductFormContext();
```

Replace the current ROP `FormField` block:

```tsx
        <FormField
          control={form.control}
          name="reorderPoint"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Reorder Point</FormLabel>
              <FormControl>
                <Input type="number" placeholder="0" value={field.value != null ? formatQuantity(field.value) : ''} onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
```

with:

```tsx
        {primarySupplierMapping ? (
          <div className="space-y-2">
            <Label>Reorder Point</Label>
            <div>
              <Input
                type="text"
                value={formatQuantity(primarySupplierMapping.supplierSpecificRop)}
                disabled
              />
            </div>
            <p className="text-sm text-muted-foreground">
              Managed by {primarySupplierMapping.supplierName || 'the primary supplier'} — edit it on the Suppliers tab.
            </p>
          </div>
        ) : (
          <FormField
            control={form.control}
            name="reorderPoint"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Reorder Point</FormLabel>
                <FormControl>
                  <Input type="number" placeholder="0" value={field.value != null ? formatQuantity(field.value) : ''} onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit -p .
```

Expected: no new errors.

- [ ] **Step 4: Manual verification**

Open Edit Product on a product with a primary supplier mapping: confirm the Inventory tab shows the read-only "Managed by {supplier}" line with the mapping's ROP value, not an editable input. Open Edit Product on a product with no supplier mappings: confirm the ROP field is editable exactly as before this task.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/products/edit-product/tabs/inventory-tab.tsx"
git commit -m "feat: Edit Product's Reorder Point field defers to the primary supplier mapping"
```

---

### Task 8: Selling-unit cost suggestion from supplier (Edit Product)

**Files:**
- Modify: `app/(app)/products/edit-product/use-edit-product-form.ts`
- Test: manual

**Interfaces:**
- Consumes: `primarySupplierMapping` (Task 4).
- Produces: a new effect that writes `form.setValue('cost', ...)` whenever the primary mapping has a `supplierCost` and the user hasn't already edited the Cost field this session. Exposes a new `costSuggestionSource: string | null` on the controller (mirrors `markupSource`'s contract) for the UI hint added in Task 9.

- [ ] **Step 1: Add the guard refs, alongside the existing `lastAutoRetailPrice`/`retailPriceEditedByUser` refs**

```typescript
// Mirrors lastAutoRetailPrice/retailPriceEditedByUser above, but for the
// base unit's Cost field being suggested from the primary supplier
// mapping's own cost. Reset on the same product-open effect as those two,
// so a manual edit on a previously-open product doesn't carry into the next.
const lastAutoSuggestedCost = useRef<number | null>(null);
const costEditedByUser = useRef(false);
```

Add their reset alongside the existing resets inside the `useEffect(() => { if (product && isOpen) { lastAutoRetailPrice.current = null; ... } }, [product, isOpen, form])` effect:

```typescript
      lastAutoRetailPrice.current = null;
      retailPriceEditedByUser.current = false;
      lastAutoSuggestedCost.current = null;
      costEditedByUser.current = false;
```

- [ ] **Step 2: Add the suggestion effect and `costSuggestionSource` state**

Add near `const [markupSource, setMarkupSource] = useState<string | null>(null);`:

```typescript
const [costSuggestionSource, setCostSuggestionSource] = useState<string | null>(null);
```

Add the effect (placed after the markup effect, since it doesn't depend on it):

```typescript
useEffect(() => {
  if (!isInitialized || !primarySupplierMapping || primarySupplierMapping.supplierCost == null) {
    setCostSuggestionSource(null);
    return;
  }
  if (costEditedByUser.current) {
    // User already overrode a previous suggestion this session — respect
    // that for the rest of it, same contract as retailPriceEditedByUser.
    return;
  }

  const suggested = primarySupplierMapping.supplierCost;
  const currentValue = form.getValues('cost');
  // A mismatch against what this effect itself wrote last means the user
  // changed it in between — respect that and stop suggesting.
  if (lastAutoSuggestedCost.current !== null && currentValue !== lastAutoSuggestedCost.current) {
    costEditedByUser.current = true;
    return;
  }

  form.setValue('cost', suggested);
  lastAutoSuggestedCost.current = suggested;
  setCostSuggestionSource(`Suggested from ${primarySupplierMapping.supplierName || 'the primary supplier'}'s cost`);
}, [isInitialized, primarySupplierMapping, form]);
```

- [ ] **Step 3: Expose `costSuggestionSource` on the hook's returned object**

Add it next to `markupSource,` in the `return { ... }` block:

```typescript
    markupSource,
    costSuggestionSource,
```

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit -p .
```

Expected: no new errors.

- [ ] **Step 5: Manual verification**

Set a `supplier_cost` on a supplier mapping that's primary for some product (via the Suppliers tab's Add/Edit Supplier Mapping dialog's Cost field). Reopen Edit Product for that product and confirm the Selling Units tab's base-unit Cost field auto-fills to that value (only if the Cost field was previously blank/0 — if the product already had a different cost typed and saved, this effect still overwrites it once on open, since `costEditedByUser` resets per-open; this matches the existing markup→price suggestion's own behavior of re-suggesting fresh on every open unless touched again). Then manually change the Cost field and confirm the suggestion does not re-apply itself afterward (e.g. after switching tabs and back) for the rest of that session.

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/products/edit-product/use-edit-product-form.ts"
git commit -m "feat: suggest base selling unit cost from the primary supplier's cost"
```

---

### Task 9: Cost suggestion hint in Edit Product's Selling Units tab

**Files:**
- Modify: `app/(app)/products/edit-product/tabs/conversion-tab.tsx`
- Test: manual

**Interfaces:**
- Consumes: `costSuggestionSource` (Task 8).

- [ ] **Step 1: Add `costSuggestionSource` to the context destructure**

Find the `useEditProductFormContext()` destructure near the top of `SellingUnitsTab` (mirrors the same pattern as `use-add-product-form.ts`'s `conversion-tab.tsx`) and add `costSuggestionSource`.

- [ ] **Step 2: Render the hint next to the base unit's Cost field**

Locate the base-unit Cost `FormField` (identified earlier — `name="cost"` inside the "Base Unit" `Collapsible` card, around the `FormLabel className="text-xs">Cost</FormLabel>` block). Add the hint immediately below its `<FormMessage />`:

```tsx
                <FormField
                  control={form.control}
                  name="cost"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Cost</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          min="0.01"
                          placeholder="Required"
                          value={field.value ?? ''}
                          onChange={(e) => {
                            const parsed = parseFloat(e.target.value);
                            field.onChange(Number.isNaN(parsed) ? undefined : parsed);
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                      {costSuggestionSource && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Wand2 className="h-3 w-3" />
                          {costSuggestionSource}
                        </p>
                      )}
                    </FormItem>
                  )}
                />
```

`Wand2` is already imported in this file (used elsewhere for barcode generation) — confirm with:

```bash
grep -n "Wand2" "app/(app)/products/edit-product/tabs/conversion-tab.tsx"
```

If it isn't imported, add it to the existing `lucide-react` import line.

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit -p .
```

Expected: no new errors.

- [ ] **Step 4: Manual verification**

Reopen the same product from Task 8's verification. Confirm the hint text appears under the base unit's Cost field once the suggestion has applied, and disappears once you type a different value into that field.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/products/edit-product/tabs/conversion-tab.tsx"
git commit -m "feat: show cost-suggestion hint on Edit Product's base selling unit"
```

---

### Task 10: Markup reads the primary supplier mapping (Add Product)

**Files:**
- Modify: `app/(app)/products/add-product/use-add-product-form.ts`
- Test: manual

**Interfaces:**
- Consumes: `form.watch('supplierMappings')` (existing field array from the prior Suppliers-tab task on this branch).
- Produces: the markup effect passes the form's own primary mapping's `supplierId`, derived from `supplierMappings`, instead of the (to-be-removed in Task 11) `supplier` field.

- [ ] **Step 1: Locate the current effect's `watchedSupplierId`**

```typescript
const watchedSupplierId = form.watch('supplier');
```

and its use inside `calculateMarkupPercentage(...)`:

```typescript
const { markup, source } = calculateMarkupPercentage(
    {
        markupPercentage: null,
        category: watchedCategoryName,
        subcategory: watchedSubcategoryName,
        brand: watchedBrandName,
        supplierId: watchedSupplierId
    },
    systemSettings,
    categories,
    subcategories,
    brands,
    suppliers
);
```

- [ ] **Step 2: Replace with a derived value from `supplierMappings`**

Remove `const watchedSupplierId = form.watch('supplier');` and replace with:

```typescript
const watchedSupplierMappings = form.watch('supplierMappings');
const markupSupplierId = (watchedSupplierMappings || []).find(m => m.isPrimary)?.supplierId;
```

Update the `calculateMarkupPercentage` call's `supplierId` to `markupSupplierId`, and update the effect's dependency array — replace `watchedSupplierId` with `markupSupplierId`:

```typescript
  }, [watchedCost, watchedCategoryName, watchedSubcategoryName, watchedBrandName, markupSupplierId, categories, subcategories, brands, suppliers, form, priceLevels, systemSettings, priceLevelFields]);
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit -p .
```

Expected: no new errors (Task 11 removes the `supplier` schema field next; doing markup first avoids a transient broken state where `form.watch('supplier')` still compiles against a schema that no longer has it, which would only be a runtime concern, not a type error — but ordering it this way keeps each task's diff independently sensible).

- [ ] **Step 4: Manual verification**

Add Product → Standard → Suppliers tab → add a mapping (which becomes primary per Task 2) for a supplier with a configured `markupPercentage`, with no category/subcategory/brand markup set and `enableAutomaticMarkup` on. Confirm the markup hint near the Save button reads `Calculated from Supplier Markup (...)`.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/products/add-product/use-add-product-form.ts"
git commit -m "feat: markup calculation reads the primary supplier mapping in Add Product"
```

---

### Task 11: Remove the single Supplier field from Add Product

**Files:**
- Modify: `app/(app)/products/add-product/product-schema.ts`
- Modify: `app/(app)/products/add-product/use-add-product-form.ts`
- Modify: `app/(app)/products/add-product/tabs/inventory-tab.tsx`
- Modify: `app/(app)/products/actions.ts`
- Test: manual

**Interfaces:**
- Consumes: nothing new.
- Produces: `standardProductSchema` no longer has a `supplier` field. `createProduct` no longer references `formData.supplier` (dead after the schema change, but removed for clarity rather than left as always-`undefined`).

- [ ] **Step 1: Remove `supplier` from the Add schema**

In `app/(app)/products/add-product/product-schema.ts`, delete this line from `standardProductSchema`:

```typescript
  supplier: z.string().optional(),
```

`serviceProductSchema` already has `supplier: z.undefined(),` — leave that line as-is; a service still has no supplier concept, and removing an already-`z.undefined()` field isn't required (it's already inert on a schema with no `supplier` sibling on the standard side — but for consistency with the rest of this task, remove it too, since standard no longer declares `supplier` for it to be "undefined relative to"):

```typescript
  supplier: z.undefined(),
```

Delete this line from `serviceProductSchema` as well.

- [ ] **Step 2: Remove `supplier` from the form's default values and reset**

In `use-add-product-form.ts`, remove this line from the `useForm({ defaultValues: {...} })` block:

```typescript
      supplier: '',
```

Also check the "switching to Service clears every stock-side field" effect for a `form.setValue('supplier', undefined);` line — remove it if present (it was listed in this plan's own research as line ~384 of the pre-change file):

```typescript
      form.setValue('supplier', undefined);
```

- [ ] **Step 3: Remove the Supplier field block from Add Product's Inventory tab**

In `app/(app)/products/add-product/tabs/inventory-tab.tsx`, delete the `FormField` block for `name="supplier"` (the "Supplier (Optional)" `InlineEditableSelect`, structurally identical to the one removed from Edit Product in Task 6 — same field name, label, and `InlineEditableSelect` props).

- [ ] **Step 4: Remove the dead `formData.supplier` reference in `createProduct`**

In `app/(app)/products/actions.ts`, change:

```typescript
        supplier_id: formData.supplier || null,
```

to:

```typescript
        supplier_id: null,
```

(A standard product's `supplier_id` is now always `null` at creation — it only ever gets a real value from a `supplier_product_mapping` row, never from the product row itself, once this task ships.)

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit -p .
```

Expected: no new errors.

- [ ] **Step 6: Manual verification**

Add Product → Standard: confirm the Inventory tab no longer shows "Supplier (Optional)". Submit a new product with a Suppliers-tab mapping and confirm (query the DB) `products.supplier_id` is `NULL` for the new row while `supplier_product_mapping` has the correct row with `is_primary = 1`.

- [ ] **Step 7: Commit**

```bash
git add "app/(app)/products/add-product/product-schema.ts" \
        "app/(app)/products/add-product/use-add-product-form.ts" \
        "app/(app)/products/add-product/tabs/inventory-tab.tsx" \
        "app/(app)/products/actions.ts"
git commit -m "feat: remove single Supplier field from Add Product Inventory tab"
```

---

### Task 12: Conditional Reorder Point field in Add Product's Inventory tab

**Files:**
- Modify: `app/(app)/products/add-product/tabs/inventory-tab.tsx`
- Test: manual

**Interfaces:**
- Consumes: `form.watch('supplierMappings')` (existing field array).

- [ ] **Step 1: Add a derived "has primary mapping" value inside `InventoryTab`**

Near the top of the component body (after the existing context destructure), add:

```typescript
const watchedSupplierMappings = form.watch('supplierMappings');
const primaryMapping = (watchedSupplierMappings || []).find(m => m.isPrimary);
```

- [ ] **Step 2: Replace the ROP field block with a conditional version**

Locate the current block (identified earlier in this plan's research, lines ~405-417):

```tsx
        <FormField
          control={form.control}
          name="reorderPoint"
          render={({ field }) => (
            <FormItem className={hideInitialStock ? 'sm:col-span-2' : undefined}>
              <FormLabel>Reorder Point</FormLabel>
              <FormControl>
                <Input type="number" placeholder="0" value={field.value} onChange={(e) => field.onChange(parseInt(e.target.value) || 0)} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
```

Replace with:

```tsx
        {primaryMapping ? (
          <div className={hideInitialStock ? 'sm:col-span-2 space-y-2' : 'space-y-2'}>
            <Label>Reorder Point</Label>
            <div>
              <Input type="text" value={primaryMapping.rop} disabled />
            </div>
            <p className="text-sm text-muted-foreground">
              Set on the Suppliers tab (this product's primary supplier).
            </p>
          </div>
        ) : (
          <FormField
            control={form.control}
            name="reorderPoint"
            render={({ field }) => (
              <FormItem className={hideInitialStock ? 'sm:col-span-2' : undefined}>
                <FormLabel>Reorder Point</FormLabel>
                <FormControl>
                  <Input type="number" placeholder="0" value={field.value} onChange={(e) => field.onChange(parseInt(e.target.value) || 0)} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}
```

`Label` needs to be imported if not already present in this file:

```bash
grep -n "^import.*Label" "app/(app)/products/add-product/tabs/inventory-tab.tsx"
```

If missing, add `import { Label } from '@/components/ui/label';` to the file's imports.

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit -p .
```

Expected: no new errors.

- [ ] **Step 4: Manual verification**

Add Product → Standard, no supplier mapping yet: confirm ROP is editable as before. Add a supplier mapping on the Suppliers tab with ROP=25: switch back to Inventory tab and confirm ROP now shows a read-only "25" with the "Set on the Suppliers tab" note. Remove the mapping: confirm the editable field reappears (with whatever the form's `reorderPoint` value currently is — react-hook-form keeps it in state even while the field was hidden).

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/products/add-product/tabs/inventory-tab.tsx"
git commit -m "feat: Add Product's Reorder Point field defers to the primary supplier mapping"
```

---

### Task 13: Selling-unit cost suggestion from supplier (Add Product)

**Files:**
- Modify: `app/(app)/products/add-product/use-add-product-form.ts`
- Modify: `app/(app)/products/add-product/tabs/conversion-tab.tsx`
- Test: manual

**Interfaces:**
- Consumes: `form.watch('supplierMappings')`.
- Produces: same `costSuggestionSource` contract as Task 8/9, added to `use-add-product-form.ts`'s controller and consumed the same way in its own `conversion-tab.tsx`.

- [ ] **Step 1: Add the guard refs**

Alongside the existing `lastAutoRetailPrice`/`retailPriceEditedByUser` refs in `use-add-product-form.ts`:

```typescript
const lastAutoSuggestedCost = useRef<number | null>(null);
const costEditedByUser = useRef(false);
```

Add their reset inside the same `useEffect(() => { if (isOpen) { form.reset(); lastAutoRetailPrice.current = null; ... } }, [isOpen, form])` effect that already resets the price-suggestion refs on open:

```typescript
      lastAutoSuggestedCost.current = null;
      costEditedByUser.current = false;
```

- [ ] **Step 2: Add `costSuggestionSource` state and the suggestion effect**

```typescript
const [costSuggestionSource, setCostSuggestionSource] = useState<string | null>(null);

useEffect(() => {
  const primaryMapping = (watchedSupplierMappings || []).find(m => m.isPrimary);
  if (!primaryMapping || primaryMapping.cost == null) {
    setCostSuggestionSource(null);
    return;
  }
  if (costEditedByUser.current) {
    return;
  }

  const suggested = primaryMapping.cost;
  const currentValue = form.getValues('cost');
  if (lastAutoSuggestedCost.current !== null && currentValue !== lastAutoSuggestedCost.current) {
    costEditedByUser.current = true;
    return;
  }

  form.setValue('cost', suggested);
  lastAutoSuggestedCost.current = suggested;
  const supplierName = suppliers.find(s => s.id === primaryMapping.supplierId)?.name;
  setCostSuggestionSource(`Suggested from ${supplierName || 'the primary supplier'}'s cost`);
}, [watchedSupplierMappings, suppliers, form]);
```

This depends on `watchedSupplierMappings`, already declared in Task 10.

- [ ] **Step 3: Expose `costSuggestionSource` on the hook's returned object**

Add it in the `return { ... }` block, next to `markupSource,`:

```typescript
    markupSource,
    costSuggestionSource,
```

- [ ] **Step 4: Render the hint in Add Product's Selling Units tab**

In `app/(app)/products/add-product/tabs/conversion-tab.tsx`, add `costSuggestionSource` to the `useAddProductFormContext()` destructure at the top of `SellingUnitsTab`. Locate the base-unit Cost `FormField` (identified earlier in this plan's research, the one with `name="cost"` inside the "Base Unit" card) and add the hint under its `<FormMessage />`, identical to Task 9's version:

```tsx
                <FormField
                  control={form.control}
                  name="cost"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Cost</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          min="0.01"
                          placeholder="Required"
                          value={field.value ?? ''}
                          onChange={(e) => {
                            const parsed = parseFloat(e.target.value);
                            field.onChange(Number.isNaN(parsed) ? undefined : parsed);
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                      {costSuggestionSource && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Wand2 className="h-3 w-3" />
                          {costSuggestionSource}
                        </p>
                      )}
                    </FormItem>
                  )}
                />
```

`Wand2` is already imported in this file (used for barcode generation) — no new import needed.

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit -p .
```

Expected: no new errors.

- [ ] **Step 6: Manual verification**

Add Product → Standard → Suppliers tab → add a mapping with a Cost value. Switch to Selling Units tab: confirm the base unit's Cost field auto-fills and shows the hint. Manually change the Cost field, switch tabs away and back, confirm the suggestion does not reapply and the hint is gone.

- [ ] **Step 7: Commit**

```bash
git add "app/(app)/products/add-product/use-add-product-form.ts" \
        "app/(app)/products/add-product/tabs/conversion-tab.tsx"
git commit -m "feat: suggest base selling unit cost from the primary supplier's cost in Add Product"
```

---

### Task 14: Full regression pass

**Files:** none (verification only)

**Interfaces:** none.

- [ ] **Step 1: Full typecheck**

```bash
npx tsc --noEmit -p . 2>&1 | wc -l
```

Compare this count against the pre-Task-1 baseline (26 errors were present before the prior task on this branch; confirm with `git log` / by checking this plan's spec whether that baseline shifted). The count after all 13 tasks should be equal to or lower than the baseline immediately before Task 1 — never higher.

- [ ] **Step 2: Run the existing purchase-order e2e spec**

`tests/e2e/purchase-order.spec.ts` exercises `POST /api/products` → `CreateProductUseCase`, a path independent of `actions.ts`'s `createProduct` — confirm this task's changes to `app/(app)/products/actions.ts` (`createProduct`, `addSupplierMapping`, `updateSupplierMapping`) do not touch that use case at all:

```bash
grep -rn "supplier" src/core/products/domain/Product.ts src/infrastructure/repositories/MySqlProductRepository.ts
```

If this shows no results, `MySqlProductRepository`'s create path never touched supplier data and needs no changes — confirm this stays true (per this codebase's own documented rule that a product-read/write schema change must be checked against both `actions.ts` and `MySqlProductRepository.ts`, per CLAUDE.md's "Two separate product read paths" note). If it does show supplier-related code, stop and flag it — that would mean this plan is incomplete and `MySqlProductRepository.ts` needs its own version of Task 11/2's changes.

Then run:

```bash
npm run test:e2e -- purchase-order.spec.ts
```

Expected: same pass/fail status as the pre-existing baseline (per this repo's own documented flakiness — do not conclude a single run proves anything; check twice if it fails, per the "Flaky approval E2E test" pattern already known in this codebase).

- [ ] **Step 3: Manual end-to-end walkthrough**

1. Add Product → Standard → fill Basic Info → Suppliers tab: add a mapping (ROP=30, Cost=15.00, mark nothing as primary manually) → confirm it's automatically primary → Selling Units tab: confirm Cost auto-filled to 15.00 → Inventory tab: confirm ROP shows read-only "30" → Save.
2. Open the new product in Edit Product: confirm the Suppliers tab shows the same mapping as primary, Inventory tab shows read-only ROP "30" with the supplier's name, Selling Units tab's base cost still shows 15.00 (or whatever was saved).
3. On that product, add a second supplier mapping, then use "Set Primary" to switch to it (with a different ROP/cost) — confirm the confirmation dialog fires, and afterward Inventory tab's read-only ROP updates to the new primary's value.
4. Remove all supplier mappings from that product via delete: confirm Inventory tab's ROP field becomes editable again.

- [ ] **Step 4: No commit for this task** (verification only — if any step fails, return to the relevant task above and fix before proceeding)
