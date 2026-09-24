# Consolidate to one supplier-mapping model

**Date:** 2026-09-21
**Status:** Approved for planning

## Problem

Verdix products currently carry supplier information in two places that
happened to diverge:

1. `products.supplier_id` — a single-supplier column, editable via a
   "Supplier (Optional)" dropdown on the Inventory tab of both Add and Edit
   Product. This is what `calculateMarkupPercentage` (`lib/purchase-utils.ts`)
   reads for the markup precedence chain's `supplier` link, and what
   `products.reorder_point` used to be driven from directly.
2. `supplier_product_mapping` — a many-to-many table (added in migration 036)
   letting a product carry several suppliers, each with its own SKU, lead
   time, ROP, and cost, with exactly one flagged `is_primary`. This table's
   full CRUD (`actions.ts`) and UI (`ProductSuppliers` / `AddSupplierMappingDialog`)
   already exist, and were wired into both Add and Edit Product's tabs in the
   prior task on this branch.

`getProducts` (the Products list read path) already prefers the primary
mapping's supplier for **display**, falling back to the legacy column only
when no mapping exists — but markup calculation, the Inventory tab's ROP
field, and selling-unit cost still only know about the single legacy column
or a manually-typed value. This spec finishes the consolidation: one
supplier concept per product, expressed entirely through
`supplier_product_mapping`.

## Goals

- Remove the single "Supplier (Optional)" field from both Add and Edit
  Product's Inventory tab.
- Markup precedence's `supplier` link reads the **primary** supplier mapping
  instead of the legacy column.
- Reorder Point is authored on the primary supplier's mapping row; the
  Inventory tab's ROP field is shown only as a fallback for a product with no
  primary supplier.
- A primary supplier's `supplier_cost` suggests the **base selling unit's**
  cost (not other selling units), using the same "suggest until the user
  edits it" pattern the markup→price effect already uses.
- A product's first supplier mapping is always primary, so markup/ROP/cost
  always have a definite mapping to read the moment one exists (see §5 —
  confirmed gap, not just a risk).

## Non-goals

- No backfill/migration of existing `products.supplier_id` data into
  `supplier_product_mapping` rows. Products created before this change keep
  working via the existing `primary_supplier_id || supplier_id` /
  `supplierId || product.supplier_id` fallbacks already present in
  `getProducts` and (after this change) `calculateMarkupPercentage`. This is
  forward-only, consistent with this codebase's existing "NULL means
  inherit" conventions.
- No change to `TransferStockService.ts`, PO receiving, or FIFO batch costing
  (`lib/batch-deduction.ts`). Supplier cost here only ever *suggests* a
  selling-unit cost value in the form — it does not write `sale_items.cost_at_sale`
  or touch `inventory_batches`.
- No change to how `product_selling_units.cost` is used at sale time, and no
  auto-multiplying a supplier's cost by a selling unit's `factor` into other
  units — a case's actual supplier price is not assumed to be
  `base_cost × factor`, so extra selling units are left for the user to fill
  in, exactly like every other per-unit cost/price field today.
- Does not remove or rename `products.supplier_id`. The column stays as a
  fallback for pre-migration data; only the UI's ability to *write* it goes
  away for standard products going forward.

## Design

### 1. Remove the single Supplier field

- **`add-product/tabs/inventory-tab.tsx`**: remove the `supplier`
  `InlineEditableSelect` field block.
- **`add-product/product-schema.ts`**: remove `supplier` from
  `standardProductSchema`. (`serviceProductSchema` already pins it
  `z.undefined()`.)
- **`add-product/use-add-product-form.ts`**: `onSubmit` no longer sends
  `values.supplier`; `actions.ts`'s `createProduct` stops writing
  `formData.supplier` into `products.supplier_id` for new standard products
  (it will always insert `NULL` there going forward — the row exists only for
  legacy reads).
- **`edit-product/tabs/inventory-tab.tsx`** and **`edit-product/product-schema.ts`**:
  same removal. `updateProduct` in `actions.ts` stops writing
  `formData.supplier`.
- Existing `getSuppliers()`/`refreshSuppliers` plumbing in both forms stays —
  it's still needed to populate the supplier dropdown inside
  `AddSupplierMappingDialog` on the Suppliers tab.

### 2. Markup reads the primary supplier mapping

- `calculateMarkupPercentage` (`lib/purchase-utils.ts`) keeps its existing
  signature and `suppliers[]` lookup list, but the **caller** changes what it
  passes as `supplierId`:
  - **Add Product** (`use-add-product-form.ts`): replace
    `watchedSupplierId = form.watch('supplier')` with a derived value —
    `form.watch('supplierMappings')?.find(m => m.isPrimary)?.supplierId`.
  - **Edit Product** (`use-edit-product-form.ts`): replace
    `selectedSupplierId = form.watch('supplier')`. Edit's supplier mappings
    are NOT form state (they're loaded/saved live via `getSupplierMappings`/
    `ProductSuppliers`, independently of `react-hook-form`) — so this hook
    needs its own lightweight fetch of the current primary mapping's
    `supplierId` (a small `useEffect` calling `getSupplierMappings(product.id)`
    on open, mirroring how `ProductSuppliers` already loads the same data,
    or — preferred, since it avoids a second fetch of data the Suppliers tab
    already holds — lift `ProductSuppliers`' loaded `mappings` up one level
    into `useEditProductForm`'s controller so both the Suppliers tab and this
    markup effect share one fetch). Pick the lifted-state approach: add
    `supplierMappings`/`refreshSupplierMappings` to the controller, have
    `ProductSuppliers` accept them as props instead of loading its own, and
    the markup effect reads `supplierMappings.find(m => m.isPrimary)?.supplierId`.
  - Fallback: if there is no primary mapping, keep reading the legacy
    `product.supplierId` (Edit) so a pre-migration product's existing markup
    behavior does not regress.
- `calculateMarkupPercentage`'s own body is unchanged — it already accepts
  a plain `supplierId` and looks it up in the `suppliers[]` list.

### 3. Reorder Point moves to the primary supplier mapping

- **Inventory tab (both forms)**: the ROP field becomes conditional.
  - No primary supplier mapping → field renders exactly as today (editable,
    the value the product will use).
  - A primary supplier mapping exists → field is replaced with a read-only
    line: `Reorder Point: {rop} — managed by {supplierName} (Suppliers tab)`.
- **Add Product**: no backend change needed. `createProduct` already computes
  `reorder_point: formData.reorderPoint || formData.supplierMappings?.find(m => m.isPrimary)?.rop || 0`
  ([actions.ts:657](../../../app/(app)/products/actions.ts#L657)) — once the
  Inventory field is hidden/blank when a primary mapping exists, its `rop`
  flows through unchanged.
- **Edit Product**: `setPrimarySupplier` already pushes the newly-primary
  mapping's `supplier_specific_rop` into `products.reorder_point`
  ([actions.ts:2494-2510](../../../app/(app)/products/actions.ts#L2494-L2510)).
  Gap to close: `updateSupplierMapping` does **not** currently sync
  `products.reorder_point` when the row being edited is already primary —
  editing that row's ROP value today silently desyncs it until the user
  re-triggers "Set Primary". Fix: after `updateSupplierMapping`'s existing
  update, if the edited row's resulting `is_primary = 1`, also
  `UPDATE products SET reorder_point = ? WHERE id = ?` using its
  (possibly just-changed) `rop`.
- No changes anywhere else: the 71 files reading `products.reorder_point`/
  `reorderPoint` keep reading that column exactly as now. Only what's allowed
  to *write* it changes.

### 4. Selling-unit cost suggestion from supplier

- New suggestion effect in both forms, modeled on the existing markup→price
  effect (guarded by a "last auto-written value" ref so a manual edit
  permanently stops the suggestion for that session — same contract as
  `lastAutoRetailPrice`/`retailPriceEditedByUser`):
  - Trigger: the primary supplier mapping has a non-null `cost`.
  - Target: the **base selling unit's cost field only** —
    `values.cost` (Add Product's top-level `cost` field, written by the base
    row in `conversion-tab.tsx`) / the equivalent base-unit cost control in
    Edit's Selling Units tab. Extra selling units (`sellingUnits[i].cost`)
    are never touched by this effect.
  - Suggested value = the primary mapping's `cost` verbatim — no
    factor-multiplication, no rounding beyond what the input already does.
  - UI hint: a small text near the Cost field, same placement/style as
    `markupSource` near the Save button — e.g.
    `Suggested from {supplierName}'s cost`. Cleared the moment the user edits
    the field, exactly like `markupSource` semantics.
- This only ever writes into the **form's** cost field before submit — it
  does not reach into `product_selling_units` or `inventory_batches`
  directly. The existing save path (`writeSellingUnits` in `actions.ts`)
  persists whatever the form holds at submit time, same as today.

### 5. First supplier mapping is always primary

Confirmed by reading `use-supplier-mapping-form.ts`: `isPrimary` defaults to
`false` and `AddSupplierMappingDialog` has no primary toggle at all — the
only existing way to mark a mapping primary is `ProductSuppliers`' star
icon → `setPrimarySupplier`, a separate confirmed action. This means a
product's very first mapping is never automatically primary today, which
would leave markup/ROP/cost with nothing to read until the user remembers
a second, unrelated step.

Fix, both forms:

- **Add Product** (`suppliers-tab.tsx`'s `handleDialogSuccess` /
  `use-add-product-form.ts`'s field array): when appending the first row to
  an empty `supplierMappings` array, force `isPrimary: true` regardless of
  the dialog's (always-false) value.
- **Edit Product** (`addSupplierMapping` in `actions.ts`): when the
  product currently has zero mappings, force `is_primary = 1` on the new
  row server-side (the authoritative place, since this table can in
  principle be written from more than one entry point) — and, since it
  is now primary, also apply the `products.reorder_point` sync from §3 to
  this insert path, not just to `updateSupplierMapping`/`setPrimarySupplier`.

## Data flow summary (after this change)

```
supplier_product_mapping (is_primary = 1 row)
        │
        ├─ supplierId ──────► calculateMarkupPercentage's `supplier` link
        │                     (fallback: products.supplier_id if no mapping)
        │
        ├─ supplier_specific_rop ─► products.reorder_point
        │                          (Add: via createProduct's existing fallback
        │                           Edit: via setPrimarySupplier + the
        │                           updateSupplierMapping fix in §3)
        │
        └─ supplier_cost ────► suggests base selling unit's cost
                               (form-only; user can override; never
                                auto-applied to extra selling units)
```

## Risks / edge cases

- **A product with mappings but none primary.** Prevented going forward by
  §5 (first mapping is forced primary at creation). Can still exist from
  data written before this change ships, or if a primary row is ever deleted
  directly — the markup/ROP/cost effects all already have an explicit
  "no primary found" fallback (legacy column / Inventory tab field /
  no suggestion, respectively), so this degrades gracefully rather than
  crashing; it does not self-heal by picking a new primary automatically.
- **Switching primary supplier on Edit.** `setPrimarySupplier` already
  prompts the user to reconfirm ROP/lead time (`confirmPrimaryOpen` dialog in
  `use-product-suppliers.ts`) — unchanged by this spec. The markup and cost
  suggestions should re-run the same "reload after mutation" path
  (`onUpdate?.()` already wired) so they reflect the new primary immediately.
- **Legacy products with `supplier_id` set but no mapping row.** Continue to
  work via fallbacks in both markup and (implicitly) ROP/cost — those
  products simply never get a cost/ROP suggestion until a mapping is added,
  same as before this feature existed.
