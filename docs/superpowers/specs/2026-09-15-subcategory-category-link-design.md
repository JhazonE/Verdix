# Subcategory–Category Link — Design

**Date:** 2026-09-15
**Status:** Approved, ready for implementation planning

## Problem

`categories` and `subcategories` are two independent, unrelated tables today —
`subcategories` has no `category_id` column, `getSubcategories()` returns a flat,
globally-unique-by-name list, and the Add/Edit Product form's Category and
Subcategory pickers are two separate `InlineEditableSelect` controls with no
relationship between what they show. Picking a Category has no effect on what
Subcategory options appear.

The user wants a real cascading relationship: pick a Category first, then the
Subcategory picker only offers (and only lets you add) subcategories that
belong to that Category.

## Goals

- `subcategories` gains a nullable `category_id` foreign key to `categories`.
- The Add/Edit Product form's Subcategory picker is scoped to the currently
  selected Category — changing Category clears any selected Subcategory.
- The Manage Subcategories settings page shows each subcategory's Category and
  requires one when adding/editing.
- A subcategory name only has to be unique within its own Category, not
  globally.
- Every other consumer of `categories`/`subcategories` (purchase orders,
  markup priority settings, bulk import, data-management reset) keeps working
  unchanged — they only read the flat lists for lookups, never present a
  picker, and are not touched by this work.

## Non-goals

- No change to markup-priority resolution logic (`lib/purchase-utils.ts`) —
  `subcategory` stays a same-tier sibling of `category`/`brand`/`supplier` in
  that priority list; a category→subcategory hierarchy does not change how
  markup percentage is chosen.
- No UI rework of the Manage Subcategories page beyond adding a Category
  column and a required Category field in its Add/Edit dialog — no
  grouping/accordion view.
- No retroactive assignment of existing subcategories to a category. They
  become "Unassigned" and stay that way until a person assigns them.
- No change to `productCount` on the `Category` type for subcategories — it is
  already unpopulated by `getSubcategories()` today (a pre-existing gap, not
  introduced or fixed by this work).

---

## 1. Data model

```sql
ALTER TABLE subcategories
  ADD COLUMN category_id VARCHAR(50) NULL,
  ADD CONSTRAINT fk_subcategories_category
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL;
```

`ON DELETE SET NULL`: deleting a Category unassigns its subcategories rather
than deleting them — consistent with the "don't lose data" choice below.

**Existing rows:** `category_id` stays `NULL` for every subcategory that
exists before this migration runs. They remain visible everywhere (Manage
Subcategories page, product form when no category-scoping applies) labeled
"Unassigned," not deleted or hidden. A person assigns them a Category later,
the same way they'd edit any other field.

**Uniqueness:** the current schema has `subcategories.name VARCHAR(100) NOT
NULL UNIQUE` (global). This migration drops that constraint and adds
`UNIQUE(category_id, name)` instead, so the same name can exist once per
Category — e.g. "Accessories" under both "Phones" and "Laptops."

`UNIQUE(category_id, name)` in MySQL treats each `NULL` in `category_id` as
distinct, so two *unassigned* subcategories could technically share a name
under that constraint alone. `addSubcategory`/`updateSubcategory` add an
application-level check (a `SELECT` before insert/update) that also rejects a
duplicate name among unassigned (`category_id IS NULL`) rows, so "Unassigned"
behaves like a single bucket rather than silently allowing duplicates there.

## 2. Server actions (`app/(app)/products/actions.ts`)

```typescript
// Before:
export async function addSubcategory(name: string, markupPercentage?: number)
export async function updateSubcategory(id: string, name: string, markupPercentage?: number)

// After:
export async function addSubcategory(name: string, categoryId: string | null, markupPercentage?: number)
export async function updateSubcategory(id: string, name: string, categoryId: string | null, markupPercentage?: number)
```

Both gain the application-level duplicate-name check described above (scoped
by `categoryId`, including the `IS NULL` case), returning the same
`{ success: false, message }` shape callers already handle for a conflict.

`getSubcategories()` returns `categoryId` on each row (mapped from the new
column) alongside the existing `id`/`name`/`markupPercentage`. Add a
`getSubcategoriesForCategory(categoryId: string)` variant (or a client-side
filter over the same flat list — see Task-level decision in the plan) for the
product form's scoped picker; the flat, unfiltered list stays available for
existing consumers (purchase orders, markup priority, import, reset) that
never scoped it.

`deleteSubcategory` is unchanged — cascading via `ON DELETE SET NULL` is on
the Category side, not the Subcategory side; deleting a subcategory itself
already only touches that one row.

## 3. Manage Subcategories settings page

`ManageSubcategoriesDialog` / `SubcategoryRow` (`app/(app)/products/subcategories/`):

- The table gains a **Category** column, showing the linked Category's name or
  "Unassigned" (styled as muted/secondary, not an error state).
- `SubcategoryDialog`'s form gains a required Category picker (reuses the
  existing categories list already loaded for the product form's own Category
  field — no new data source) above the Name field. Saving with no Category
  selected is a validation error, matching the existing empty-name check's
  pattern (`use-subcategory-form.ts`'s `handleSave`).
- `useSubcategoryForm` gains `categoryId` state alongside `name`, reset on
  open the same way `name` already is.
- `useManageSubcategories`'s `handleAddSubcategory`/`handleUpdateSubcategory`
  pass `categoryId` through to the updated server actions.

## 4. Add/Edit Product form

`app/(app)/products/add-product/tabs/basic-info-tab.tsx` and the `edit-product`
equivalent (both already group Category and Subcategory in one bordered card
per this session's earlier layout change):

- Subcategory's `InlineEditableSelect` `items` prop becomes the subcategories
  belonging to the currently-watched `category` field's id — computed as
  `subcategories.filter(s => s.categoryId === selectedCategoryId)`, not a
  server round-trip (the full subcategories list is already loaded once on
  form open, same as today).
- If no Category is selected yet, the Subcategory field is disabled with a
  placeholder explaining why ("Select a Category first") rather than hidden —
  hiding it would shift the card's layout every time Category changes, which
  reads as more jarring than a disabled state.
- Clearing Subcategory on a Category change must distinguish a genuine user
  edit from the form's own load/reset. `edit-product`'s form is populated via
  `form.reset(sanitizedProduct)` when the dialog opens (`use-edit-product-form.ts`),
  which sets `category` and `subcategory` together from the saved product — a
  plain `useEffect` watching `category` would also fire then and wipe the
  already-correct saved Subcategory the instant the dialog opens. Instead,
  wire the clear directly into the Category field's `onChange` handler (fired
  only by an actual user selection, not by `form.reset`): after calling the
  existing `field.onChange` for `category`, also call
  `form.setValue('subcategory', '')`. `add-product`'s form has no pre-existing
  category/subcategory to preserve (it always starts blank), so the same
  onChange-based clear is correct there too, and keeping both forms'
  implementations identical avoids a subtle behavioral difference between Add
  and Edit that nothing else in this spec calls for.
- `InlineEditableSelect`'s existing `onAdd` handler for Subcategory calls
  `addSubcategory(name, selectedCategoryId)` instead of `addSubcategory(name)`
  — a subcategory created from inside the product form is automatically
  scoped to whichever Category is currently selected. If no Category is
  selected, `onAdd` is unreachable anyway (the field is disabled per the point
  above).
- `use-add-product-form.ts` / `use-edit-product-form.ts`: no schema change —
  `subcategory` stays a plain optional string field holding the subcategory's
  `id`, exactly as today. The scoping is a read-side filter on the client, not
  a new validation rule (a stale/orphaned `subcategory` value predating this
  change, e.g. on an existing product being edited, is still submittable as-is
  — this design doesn't retroactively invalidate existing product data; see
  Non-goals).

## 5. Everything else — unchanged

Confirmed by reading each site: `add-purchase-order-dialog.tsx` /
`use-add-purchase-order.ts` only read the flat `subcategories` list for a
`calculateMarkupPercentage` lookup keyed by a product's already-saved
subcategory id — no picker, no scoping needed. `MarkupPriorityCard.tsx` only
uses the string `'subcategory'` as a priority-list label. `entity-schemas.ts`
treats `subcategory` as a plain text column in bulk product import, unrelated
to the `subcategories` table's id/category link. `app/api/data-management/reset/route.ts`
only references the table name in a clear/truncate list. None of these need
code changes.

---

## Testing

**Unit:**
- `addSubcategory`/`updateSubcategory`: creating "Accessories" under Category
  A succeeds; creating "Accessories" under Category B also succeeds (different
  category_id); creating a second "Accessories" under Category A fails with
  the duplicate-name message; two unassigned (`categoryId: null`) subcategories
  named "Accessories" — the second fails the same way.
- Migration: existing subcategories (pre-migration) resolve to
  `categoryId: null` after running; the old global `UNIQUE(name)` constraint
  is confirmed gone and the new composite one confirmed present.

**E2E:**
- Manage Subcategories: the table shows a Category column; adding a
  subcategory without selecting a Category is blocked with a validation
  message; editing an existing "Unassigned" row to assign it a Category
  persists across a reload.
- Product form: selecting a Category populates the Subcategory picker with
  only that Category's subcategories; changing Category clears a previously
  selected Subcategory; adding a new Subcategory from inside the product form
  auto-assigns it to the selected Category, and it later shows correctly
  scoped in the Manage Subcategories page.

**Baseline note.** Verification here is red independently of this work — see
prior specs and `CLAUDE.md`'s "Verification baseline is red" guidance. Compare
against that baseline before attributing a failure to this change.

---

## Files touched

| File | Change |
|---|---|
| New migration | `subcategories.category_id` column + FK + unique-constraint swap |
| `app/(app)/products/actions.ts` | `addSubcategory`/`updateSubcategory` gain `categoryId` param + duplicate-name check; `getSubcategories` returns `categoryId` |
| `app/(app)/products/subcategories/subcategory-dialog.tsx` | Category picker field added |
| `app/(app)/products/subcategories/use-subcategory-form.ts` | `categoryId` state |
| `app/(app)/products/subcategories/use-manage-subcategories.ts` | pass `categoryId` through to server actions |
| `app/(app)/products/subcategories/subcategory-row.tsx` | show Category column |
| `app/(app)/products/subcategories/ManageSubcategoriesDialog.tsx` | Category column header |
| `app/(app)/products/add-product/tabs/basic-info-tab.tsx` | scoped Subcategory picker, clear-on-Category-change, `onAdd` passes `categoryId` |
| `app/(app)/products/edit-product/tabs/basic-info-tab.tsx` | same |
| `app/(app)/products/add-product/use-add-product-form.ts` | none expected (see §4) — confirm during planning |
| `app/(app)/products/edit-product/use-edit-product-form.ts` | none expected (see §4) — confirm during planning |
