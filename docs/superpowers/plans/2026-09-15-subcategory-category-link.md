# Subcategory–Category Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `subcategories` a real parent `category_id`, so the Add/Edit Product form's Subcategory picker only shows the options that belong to whichever Category is currently selected, instead of a flat, unrelated list.

**Architecture:** One migration adds a nullable `category_id` FK column to `subcategories` and swaps its global `UNIQUE(name)` constraint for a composite `UNIQUE(category_id, name)`. Server actions (`addSubcategory`/`updateSubcategory`/`getSubcategories`) gain a `categoryId` parameter/field. The Manage Subcategories settings page gains a required Category picker. The product form resolves its selected Category name to an id, filters the subcategory list by it, clears Subcategory when Category changes, and scopes newly-added subcategories to the selected Category.

**Tech Stack:** Next.js 16 App Router, MySQL 8 via raw `mysql2/promise` (no ORM), React Hook Form + Zod, shadcn/ui (Radix-based `Select`).

**Spec:** `docs/superpowers/specs/2026-09-15-subcategory-category-link-design.md`

## Global Constraints

- Existing subcategories keep `category_id = NULL` ("Unassigned") after migration — never auto-assigned, never deleted.
- Deleting a Category sets its subcategories' `category_id` back to `NULL` (`ON DELETE SET NULL`) — never cascades a delete onto them.
- A subcategory name must be unique within its Category (`UNIQUE(category_id, name)`), and additionally unique among unassigned (`category_id IS NULL`) subcategories via an application-level check — MySQL's composite unique index treats each `NULL` as distinct, so the DB constraint alone would allow duplicate names among unassigned rows.
- No change to `lib/purchase-utils.ts`'s markup-priority resolution — `subcategory` stays a same-tier sibling of `category`/`brand`/`supplier`, not a nested lookup.
- Every field in this codebase that stores "which category/subcategory a product belongs to" (`ProductFormValues.category`, `.subcategory`) holds the **name** (a string), not an id — matches the existing `getValue={(c) => c.name}` convention already used by every `InlineEditableSelect` picker in this form. Do not introduce an id-based field; resolve name→id only where this plan's tasks need the id internally (filtering, and the `addSubcategory`/`updateSubcategory` calls).
- Files outside this plan's task list (purchase orders, markup priority settings, bulk import, `data-management/reset`) need no changes — confirmed during design; they only read the flat `categories`/`subcategories` lists for lookups, never present a picker.

---

### Task 1: Migration — link `subcategories` to `categories`

**Files:**
- Create: `scripts/migrations/122_link_subcategories_to_categories.ts`
- Modify: `scripts/migrations/index.ts`

**Interfaces:**
- Produces: `subcategories.category_id` column (nullable `VARCHAR(50)`, FK to `categories(id)` `ON DELETE SET NULL`), replacing the old `UNIQUE(name)` index with `UNIQUE(category_id, name)` named `subcat_category_name`.

**Read first:** `scripts/migrations/120_add_selling_unit_to_line_items.ts` (the `hasColumn` idempotency-check pattern this task reuses) and `scripts/migrations/121_create_selling_unit_price_levels.ts` (structure/comment style to match). The live `subcategories` table today has exactly 4 columns (`id`, `name`, `created_at`, `markup_percentage`) and one relevant index, a unique index literally named `name` (MySQL names a single-column unique index after the column by default) — confirmed by running `SHOW INDEX FROM subcategories` against the local DB during planning.

- [ ] **Step 1: Write the migration**

```typescript
import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

/**
 * Links subcategories to a parent category. Before this, subcategories was a
 * flat, globally-unique-by-name list with no relationship to categories —
 * the product form's Category and Subcategory pickers were two independent
 * lists with no cascading between them.
 *
 * Existing subcategories are left with category_id = NULL ("Unassigned").
 * Nothing here guesses which category an existing subcategory belongs to —
 * a person assigns it later via the Manage Subcategories page.
 */

async function hasColumn(table: string, column: string): Promise<boolean> {
  const rows: any = await query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column],
  );
  return Boolean(rows[0]);
}

async function hasIndex(table: string, indexName: string): Promise<boolean> {
  const rows: any = await query(
    `SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, indexName],
  );
  return Boolean(rows[0]);
}

const migration: Migration = {
  name: '122_link_subcategories_to_categories',
  timestamp: '2026-09-15_09-00-00',

  async up(): Promise<void> {
    if (await hasColumn('subcategories', 'category_id')) {
      console.log('⏭️  subcategories.category_id already exists, skipping column add');
    } else {
      await query(`
        ALTER TABLE subcategories
          ADD COLUMN category_id VARCHAR(50) NULL,
          ADD CONSTRAINT fk_subcategories_category
            FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
      `);
      console.log('✅ subcategories: added category_id column + FK');
    }

    // The old global UNIQUE(name) constraint (MySQL names a single-column
    // unique index after the column by default: "name") must go before the
    // composite one can be added, or two rows in different categories with
    // the same name would still collide on the old index.
    if (await hasIndex('subcategories', 'name')) {
      await query('ALTER TABLE subcategories DROP INDEX `name`');
      console.log('✅ subcategories: dropped old global UNIQUE(name) index');
    } else {
      console.log('⏭️  subcategories: old UNIQUE(name) index already gone, skipping drop');
    }

    if (await hasIndex('subcategories', 'subcat_category_name')) {
      console.log('⏭️  subcategories: subcat_category_name index already exists, skipping');
    } else {
      await query(`
        ALTER TABLE subcategories
          ADD CONSTRAINT subcat_category_name UNIQUE (category_id, name)
      `);
      console.log('✅ subcategories: added UNIQUE(category_id, name)');
    }
  },

  async down(): Promise<void> {
    if (await hasIndex('subcategories', 'subcat_category_name')) {
      await query('ALTER TABLE subcategories DROP INDEX subcat_category_name');
      console.log('✅ subcategories: dropped UNIQUE(category_id, name)');
    }
    if (await hasColumn('subcategories', 'category_id')) {
      await query('ALTER TABLE subcategories DROP FOREIGN KEY fk_subcategories_category');
      await query('ALTER TABLE subcategories DROP COLUMN category_id');
      console.log('✅ subcategories: dropped category_id column + FK');
    }
    if (!(await hasIndex('subcategories', 'name'))) {
      await query('ALTER TABLE subcategories ADD CONSTRAINT `name` UNIQUE (name)');
      console.log('✅ subcategories: restored global UNIQUE(name) index');
    }
  }
};

registerMigration(migration);
```

This migration is fully reversible (unlike `121`'s irreversible table-drop) because it only adds/removes a column and swaps indexes — no data is destroyed by `up()`, so `down()` can cleanly restore the prior shape. **The one exception:** if `down()` runs after real subcategory names were changed such that restoring the plain `UNIQUE(name)` index would now collide (two categories both have a subcategory named "Widgets," which was legal under the new composite constraint), `down()`'s final `ALTER TABLE ... ADD CONSTRAINT` will fail with a duplicate-key error. That failure is correct and expected in that scenario — do not attempt to resolve it automatically; it means the data itself now conflicts with the old constraint, and a decision about which "Widgets" is not this migration's to make silently.

- [ ] **Step 2: Register the migration**

Add to `scripts/migrations/index.ts`, after the existing `121` import:

```typescript
import './122_link_subcategories_to_categories';
```

- [ ] **Step 3: Run the migration**

Run: `npm run migrate`
Expected: console shows `✅ subcategories: added category_id column + FK`, `✅ subcategories: dropped old global UNIQUE(name) index`, `✅ subcategories: added UNIQUE(category_id, name)`.

- [ ] **Step 4: Verify against the database**

```bash
npx tsx -e "
const {query}=require('./lib/mysql');
(async()=>{
  const cols = await query('SHOW COLUMNS FROM subcategories');
  const idx = await query('SHOW INDEX FROM subcategories');
  console.log('cols:', JSON.stringify(cols));
  console.log('idx:', JSON.stringify(idx));
  process.exit(0);
})();
"
```

Expected: `cols` includes a `category_id` row; `idx` includes `subcat_category_name` (non-unique flag `Non_unique: 0`, two rows for `category_id` then `name`) and does NOT include a `name`-named index. **If this command produces no visible output in your environment**, this repo is known to leave a background cron/sync worker running after a plain script exits, which can swallow terminal output — run the DB check from a small script file inside the repo (not `npx tsx -e`) and note in your report if output still doesn't surface; do not treat silent/empty output as a failing check on its own without independently confirming via a second method (e.g. `npm run migrate` a second time and confirming every step now prints `⏭️`, proving it already ran).

- [ ] **Step 5: Commit**

```bash
git add scripts/migrations/122_link_subcategories_to_categories.ts scripts/migrations/index.ts
git commit -m "feat: link subcategories to a parent category"
```

---

### Task 2: Server actions — `categoryId` on subcategory CRUD

**Files:**
- Modify: `app/(app)/products/actions.ts`

**Interfaces:**
- Consumes: `subcategories.category_id` (Task 1).
- Produces:
  - `addSubcategory(name: string, categoryId: string | null, markupPercentage?: number): Promise<{ success: boolean; message: string }>`
  - `updateSubcategory(id: string, name: string, categoryId: string | null, markupPercentage?: number): Promise<{ success: boolean; message: string }>`
  - `getSubcategories(): Promise<{ id: string; name: string; categoryId: string | null; markupPercentage?: number }[]>`

**Read first:** `getSubcategories`, `addSubcategory`, `updateSubcategory` in `app/(app)/products/actions.ts` (search `export async function addSubcategory` — currently at line ~1892-1935, but confirm by search since earlier tasks in this plan don't touch this file).

- [ ] **Step 1: Add a duplicate-name helper**

Add this function near the top of the subcategory-related functions in `actions.ts` (immediately before `getSubcategories`):

```typescript
/**
 * A subcategory name must be unique within its own category — or, for an
 * unassigned (categoryId: null) subcategory, unique among other unassigned
 * ones. MySQL's UNIQUE(category_id, name) index treats every NULL as
 * distinct, so it alone would allow duplicate names among unassigned rows;
 * this closes that gap explicitly.
 */
async function subcategoryNameConflicts(
  name: string,
  categoryId: string | null,
  excludeId?: string,
): Promise<boolean> {
  const params: any[] = [name];
  let sql = 'SELECT id FROM subcategories WHERE name = ?';
  if (categoryId === null) {
    sql += ' AND category_id IS NULL';
  } else {
    sql += ' AND category_id = ?';
    params.push(categoryId);
  }
  if (excludeId) {
    sql += ' AND id != ?';
    params.push(excludeId);
  }
  const rows: any = await query(sql, params);
  return rows.length > 0;
}
```

- [ ] **Step 2: Update `getSubcategories`**

Replace the existing `getSubcategories` function body with:

```typescript
export async function getSubcategories() {
  try {
    const subcategories = await query('SELECT * FROM subcategories ORDER BY name');
    return subcategories.map((sub: any) => ({
      id: sub.id,
      name: sub.name,
      categoryId: sub.category_id ?? null,
      markupPercentage: sub.markup_percentage ? parseFloat(sub.markup_percentage) : undefined
    }));
  } catch (error) {
    console.error('Error fetching subcategories:', error);
    return [];
  }
}
```

- [ ] **Step 3: Update `addSubcategory`**

Replace the existing `addSubcategory` function with:

```typescript
export async function addSubcategory(name: string, categoryId: string | null, markupPercentage?: number) {
  try {
    if (await subcategoryNameConflicts(name, categoryId)) {
      return { success: false, message: `A subcategory named "${name}" already exists in this category.` };
    }
    const id = `subcat_${Date.now()}`;
    await query(
      'INSERT INTO subcategories (id, name, category_id, markup_percentage) VALUES (?, ?, ?, ?)',
      [id, name, categoryId, markupPercentage || null],
    );
    return { success: true, message: 'Subcategory added successfully.' };
  } catch (error) {
    console.error('Error adding subcategory:', error);
    return { success: false, message: 'Error adding subcategory.' };
  }
}
```

- [ ] **Step 4: Update `updateSubcategory`**

Replace the existing `updateSubcategory` function with:

```typescript
export async function updateSubcategory(id: string, name: string, categoryId: string | null, markupPercentage?: number) {
  try {
    if (await subcategoryNameConflicts(name, categoryId, id)) {
      return { success: false, message: `A subcategory named "${name}" already exists in this category.` };
    }
    await query(
      'UPDATE subcategories SET name = ?, category_id = ?, markup_percentage = ? WHERE id = ?',
      [name, categoryId, markupPercentage || null, id],
    );
    return { success: true, message: 'Subcategory updated successfully.' };
  } catch (error) {
    console.error('Error updating subcategory:', error);
    return { success: false, message: 'Error updating subcategory.' };
  }
}
```

`deleteSubcategory` is unchanged — do not modify it.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep "actions.ts"`
Expected: new errors ONLY in files that call `addSubcategory`/`updateSubcategory` with their old 2/3-arg signature (this is expected and intentional — Tasks 3 and 4 fix those call sites). Confirm every new error traces to a call site this plan's later tasks touch; if you find one that doesn't, report it rather than silently patching outside this task's scope.

- [ ] **Step 6: Verify against the database**

```bash
npx tsx -e "
const {addSubcategory, getSubcategories} = require('./app/(app)/products/actions.ts');
(async()=>{
  const cats = require('./lib/mysql').query;
  const catRows = await cats('SELECT id FROM categories LIMIT 1');
  if (catRows.length === 0) { console.log('No categories in DB to test against — skipping live check, code review only.'); process.exit(0); }
  const catId = catRows[0].id;
  const r1 = await addSubcategory('__test_sub_a__', catId);
  console.log('add under category:', r1);
  const r2 = await addSubcategory('__test_sub_a__', catId);
  console.log('duplicate under same category (expect success:false):', r2);
  const r3 = await addSubcategory('__test_sub_a__', null);
  console.log('same name, unassigned (expect success:true):', r3);
  const subs = await getSubcategories();
  console.log('has categoryId field:', subs.some((s) => 'categoryId' in s));
  process.exit(0);
})();
"
```

Expected: `r1.success === true`, `r2.success === false` (duplicate within the same category), `r3.success === true` (different scope — unassigned — so no conflict), `categoryId` present on returned rows. **Clean up the two `__test_sub_a__` rows this creates** via `DELETE FROM subcategories WHERE name = '__test_sub_a__'` before finishing this step — do not leave test data in the database. This repo's branch has a documented prior incident where a verification step destroyed live data by not being careful about test/live data separation; use a name obviously not a real subcategory (as above) and delete it when done, not `TRUNCATE` or anything broader.

- [ ] **Step 7: Commit**

```bash
git add "app/(app)/products/actions.ts"
git commit -m "feat: scope subcategory CRUD to a parent category"
```

---

### Task 3: Manage Subcategories settings page — Category field

**Files:**
- Modify: `app/(app)/products/subcategories/subcategory-dialog.tsx`
- Modify: `app/(app)/products/subcategories/use-subcategory-form.ts`
- Modify: `app/(app)/products/subcategories/use-manage-subcategories.ts`
- Modify: `app/(app)/products/subcategories/subcategory-row.tsx`
- Modify: `app/(app)/products/subcategories/ManageSubcategoriesDialog.tsx`

**Interfaces:**
- Consumes: `addSubcategory(name, categoryId, markupPercentage?)`, `updateSubcategory(id, name, categoryId, markupPercentage?)` (Task 2), `getCategories()` (existing, unchanged, returns `{ id, name, markupPercentage? }[]`).
- Produces: nothing consumed by a later task in this plan — this is the settings-page surface, independent of Task 4's product-form surface.

**Read first:** all 5 files listed above in full — each is under 70 lines. Also read `getCategories` in `app/(app)/products/actions.ts` (already exists, unchanged) for the exact shape of the categories list this task's new picker needs.

- [ ] **Step 1: Add `categoryId` state to `use-subcategory-form.ts`**

Replace the full contents of `app/(app)/products/subcategories/use-subcategory-form.ts`:

```typescript
'use client';

import { useEffect, useState } from 'react';

import { useToast } from '@/hooks/use-toast';
import type { Category } from '@/lib/types';

export type SubcategorySaveHandler = (name: string, categoryId: string | null) => Promise<void>;

export interface UseSubcategoryFormProps {
  subcategory?: Category & { categoryId?: string | null };
  onSave: SubcategorySaveHandler;
}

/**
 * Controller for the add/edit subcategory dialog form: name + categoryId
 * state, reset-on-open, and the validated save flow.
 */
export function useSubcategoryForm({ subcategory, onSave }: UseSubcategoryFormProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState(subcategory?.name || '');
  const [categoryId, setCategoryId] = useState<string | null>(subcategory?.categoryId ?? null);
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (isOpen) {
      setName(subcategory?.name || '');
      setCategoryId(subcategory?.categoryId ?? null);
    }
  }, [isOpen, subcategory]);

  const handleSave = async () => {
    if (!name.trim()) {
      toast({
        variant: 'destructive',
        title: 'Validation Error',
        description: 'Subcategory name cannot be empty.',
      });
      return;
    }
    if (!categoryId) {
      toast({
        variant: 'destructive',
        title: 'Validation Error',
        description: 'Select a category for this subcategory.',
      });
      return;
    }
    setIsSaving(true);
    try {
      await onSave(name, categoryId);
      toast({
        title: subcategory ? 'Subcategory Updated' : 'Subcategory Added',
        description: `Subcategory "${name}" has been successfully saved.`,
      });
      setIsOpen(false);
      if (!subcategory) { setName(''); setCategoryId(null); }
    } catch (error) {
      console.error('Failed to save subcategory', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to save subcategory. Please try again.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  return {
    isOpen,
    setIsOpen,
    name,
    setName,
    categoryId,
    setCategoryId,
    isSaving,
    handleSave,
  };
}
```

Per the spec, Category is REQUIRED in this dialog (unlike the product form, where an existing "Unassigned" subcategory can be edited without forcing an immediate category pick everywhere else it appears) — the empty-`categoryId` check above blocks save exactly like the existing empty-name check.

- [ ] **Step 2: Add a Category picker to `subcategory-dialog.tsx`**

Replace the full contents of `app/(app)/products/subcategories/subcategory-dialog.tsx`:

```typescript
'use client';

import { Loader2 } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Category } from '@/lib/types';

import { useSubcategoryForm, type SubcategorySaveHandler } from './use-subcategory-form';

export function SubcategoryDialog({
  subcategory,
  categories,
  onSave,
  children,
  disabled,
}: {
  subcategory?: Category & { categoryId?: string | null };
  categories: Category[];
  onSave: SubcategorySaveHandler;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  const { isOpen, setIsOpen, name, setName, categoryId, setCategoryId, isSaving, handleSave } =
    useSubcategoryForm({ subcategory, onSave });

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild disabled={disabled}>{children}</DialogTrigger>
      <DialogContent className="z-[100] sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{subcategory ? 'Edit Subcategory' : 'Add New Subcategory'}</DialogTitle>
          <DialogDescription>
            {subcategory ? `Editing the subcategory "${subcategory.name}".` : 'Enter the name for the new subcategory.'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="subcategory-category" className="text-right">
              Category
            </Label>
            <div className="col-span-3">
              <Select value={categoryId ?? undefined} onValueChange={(v) => setCategoryId(v)}>
                <SelectTrigger id="subcategory-category">
                  <SelectValue placeholder="Select a category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="name" className="text-right">
              Name
            </Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="col-span-3"
              placeholder="e.g., Gaming Mice"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setIsOpen(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={isSaving || !name.trim() || !categoryId}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {isSaving ? 'Saving...' : 'Save Subcategory'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Wire `categoryId` through `use-manage-subcategories.ts`**

Replace the full contents of `app/(app)/products/subcategories/use-manage-subcategories.ts`:

```typescript
'use client';

import { useEffect, useState } from 'react';

import { useToast } from '@/hooks/use-toast';
import type { Category } from '@/lib/types';

import { addSubcategory, deleteSubcategory, getCategories, getSubcategories, updateSubcategory } from '../actions';

export interface UseManageSubcategoriesProps {
  onSubcategoryAdded?: () => void;
}

/**
 * Controller for the Manage Subcategories list: loads categories +
 * subcategories and exposes the add/update/delete handlers (data + toasts).
 */
export function useManageSubcategories({ onSubcategoryAdded }: UseManageSubcategoriesProps) {
  const [subcategories, setSubcategories] = useState<(Category & { categoryId: string | null })[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  const loadSubcategories = async () => {
    const [subs, cats] = await Promise.all([getSubcategories(), getCategories()]);
    setSubcategories(subs as (Category & { categoryId: string | null })[]);
    setCategories(cats);
    setIsLoading(false);
  };

  useEffect(() => {
    loadSubcategories();
  }, []);

  const handleAddSubcategory = async (name: string, categoryId: string | null) => {
    const result = await addSubcategory(name, categoryId);
    if (result.success) {
      loadSubcategories();
      onSubcategoryAdded?.();
    } else {
      toast({ variant: 'destructive', title: 'Error', description: result.message });
    }
  };

  const handleUpdateSubcategory = async (id: string, name: string, categoryId: string | null) => {
    const result = await updateSubcategory(id, name, categoryId);
    if (result.success) {
      toast({ title: 'Subcategory Updated', description: result.message });
      loadSubcategories();
    } else {
      toast({ variant: 'destructive', title: 'Error', description: result.message });
    }
  };

  const handleDeleteSubcategory = async (id: string) => {
    const result = await deleteSubcategory(id);
    if (result.success) {
      toast({ title: 'Subcategory Deleted', description: result.message });
      loadSubcategories();
    } else {
      toast({ variant: 'destructive', title: 'Error', description: result.message });
    }
  };

  return {
    subcategories,
    categories,
    isLoading,
    handleAddSubcategory,
    handleUpdateSubcategory,
    handleDeleteSubcategory,
  };
}
```

Note: the old `handleAddSubcategory` silently dropped a failure (no `else` branch reporting it) — this rewrite adds one, matching `handleUpdateSubcategory`'s existing pattern. This is a genuine (small) bug fix bundled into this task because the new duplicate-name validation from Task 2 makes a silent add-failure much more likely to actually occur in practice (before, `addSubcategory` essentially never failed post-validation; now a same-category duplicate name will, routinely).

- [ ] **Step 4: Show a Category column in `subcategory-row.tsx`**

Replace the full contents of `app/(app)/products/subcategories/subcategory-row.tsx`:

```typescript
'use client';

import { Pencil, Trash2 } from 'lucide-react';

import { TableCell, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import type { Category } from '@/lib/types';

import { SubcategoryDialog } from './subcategory-dialog';

export function SubcategoryRow({
  subcategory,
  categories,
  onUpdate,
  onDelete,
}: {
  subcategory: Category & { categoryId: string | null };
  categories: Category[];
  onUpdate: (id: string, name: string, categoryId: string | null) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const hasProducts = subcategory.productCount !== undefined && subcategory.productCount > 0;
  const categoryName = categories.find((c) => c.id === subcategory.categoryId)?.name;

  return (
    <TableRow>
      <TableCell className="font-medium">{subcategory.name}</TableCell>
      <TableCell>
        {categoryName ?? <span className="text-muted-foreground">Unassigned</span>}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-2">
          <SubcategoryDialog
            subcategory={subcategory}
            categories={categories}
            onSave={(name, categoryId) => onUpdate(subcategory.id, name, categoryId)}
          >
            <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-muted">
              <Pencil className="h-4 w-4 text-muted-foreground transition-colors hover:text-primary" />
              <span className="sr-only">Edit</span>
            </Button>
          </SubcategoryDialog>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 hover:bg-muted"
            onClick={() => onDelete(subcategory.id)}
            disabled={hasProducts}
            title={hasProducts ? "Cannot delete subcategory with products assigned" : "Delete subcategory"}
          >
            <Trash2 className={`h-4 w-4 ${hasProducts ? 'text-muted-foreground/50' : 'text-muted-foreground transition-colors hover:text-destructive'}`} />
            <span className="sr-only">Delete</span>
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
```

- [ ] **Step 5: Add the Category column header and pass `categories` down in `ManageSubcategoriesDialog.tsx`**

In `app/(app)/products/subcategories/ManageSubcategoriesDialog.tsx`:

Replace:
```typescript
  const { subcategories, isLoading, handleAddSubcategory, handleUpdateSubcategory, handleDeleteSubcategory } =
    useManageSubcategories({ onSubcategoryAdded });
```
with:
```typescript
  const { subcategories, categories, isLoading, handleAddSubcategory, handleUpdateSubcategory, handleDeleteSubcategory } =
    useManageSubcategories({ onSubcategoryAdded });
```

Replace:
```typescript
            <div className="flex justify-end mb-4">
                <SubcategoryDialog onSave={handleAddSubcategory}>
```
with:
```typescript
            <div className="flex justify-end mb-4">
                <SubcategoryDialog categories={categories} onSave={handleAddSubcategory}>
```

Replace:
```typescript
                        <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>
                            <span className="sr-only">Actions</span>
                        </TableHead>
                        </TableRow>
```
with:
```typescript
                        <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>
                            <span className="sr-only">Actions</span>
                        </TableHead>
                        </TableRow>
```

Replace:
```typescript
                        {isLoading && Array.from({ length: 4 }).map((_, i) => <SubcategorySkeleton key={i} />)}
                        {!isLoading && subcategories.map((subcategory) => (
                        <SubcategoryRow key={subcategory.id} subcategory={subcategory} onUpdate={handleUpdateSubcategory} onDelete={handleDeleteSubcategory} />
                        ))}
                         {!isLoading && subcategories.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={2} className="text-center h-24">
```
with:
```typescript
                        {isLoading && Array.from({ length: 4 }).map((_, i) => <SubcategorySkeleton key={i} />)}
                        {!isLoading && subcategories.map((subcategory) => (
                        <SubcategoryRow key={subcategory.id} subcategory={subcategory} categories={categories} onUpdate={handleUpdateSubcategory} onDelete={handleDeleteSubcategory} />
                        ))}
                         {!isLoading && subcategories.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={3} className="text-center h-24">
```

(`colSpan={2}` → `colSpan={3}` — the empty-state row must span all 3 columns now, not 2.)

- [ ] **Step 6: Add a Category skeleton cell to `subcategory-skeleton.tsx`**

The current file renders exactly 2 fixed `<TableCell>`s (Name, Actions) — confirmed by reading it during planning. Replace the full contents of `app/(app)/products/subcategories/subcategory-skeleton.tsx`:

```typescript
'use client';

import { TableCell, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';

export function SubcategorySkeleton() {
  return (
    <TableRow>
      <TableCell>
        <Skeleton className="h-5 w-48" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-5 w-24" />
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-2">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-28" />
        </div>
      </TableCell>
    </TableRow>
  );
}
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "subcategories|ManageSubcategoriesDialog"`
Expected: no new errors.

- [ ] **Step 8: Verify in the running app**

Run the dev server in the FOREGROUND on port 3000. Open Settings → Manage Subcategories (or wherever this dialog is triggered from — check `grep -rn "ManageSubcategoriesDialog" app/` if the trigger location isn't obvious). Confirm:
1. The table shows a Category column; any pre-existing subcategory shows "Unassigned".
2. Clicking Add Subcategory shows a required Category dropdown above Name; Save is disabled until both are filled.
3. Adding a subcategory under a category, then reloading, shows it correctly scoped in the Category column.
4. Editing an "Unassigned" row to assign it a Category persists after reload.

If you have no browser tooling, say so plainly in your report and verify as far as possible via typecheck and a direct DB query (`SELECT name, category_id FROM subcategories`) instead — do NOT claim a visual pass you did not perform.

- [ ] **Step 9: Commit**

```bash
git add "app/(app)/products/subcategories"
git commit -m "feat: require and show a category on the Manage Subcategories page"
```

---

### Task 4: Product form — cascading Subcategory picker

**Files:**
- Modify: `app/(app)/products/components/inline-editable-select.tsx`
- Modify: `app/(app)/products/add-product/tabs/basic-info-tab.tsx`
- Modify: `app/(app)/products/edit-product/tabs/basic-info-tab.tsx`

**Interfaces:**
- Consumes: `getSubcategories()` returning `categoryId` per row (Task 2), `InlineEditableSelect`'s existing props (this task adds one new optional prop, `disabled`).
- Produces: nothing consumed by a later task — this is the final task in this plan.

**Read first:** `app/(app)/products/components/inline-editable-select.tsx` in full (currently ~230 lines). Both `basic-info-tab.tsx` files already group Category and Subcategory in one bordered card (from an earlier session's layout work) — read both in full before editing, since this task edits the existing Category and Subcategory `FormField` blocks in place rather than replacing the whole file.

- [ ] **Step 1: Add a `disabled` prop to `InlineEditableSelect`**

In `app/(app)/products/components/inline-editable-select.tsx`, add `disabled?: boolean;` to the `InlineEditableSelectProps<T>` interface (after `itemClassName?: string;`), add `disabled,` to the destructured props in the function signature, and pass it to the root `Select`:

Find:
```typescript
    <Select
      open={open}
      onOpenChange={onOpenChange}
```
Replace with:
```typescript
    <Select
      disabled={disabled}
      open={open}
      onOpenChange={onOpenChange}
```

Radix's `Select` root already supports a `disabled` prop natively (it disables the trigger and prevents opening) — this is a pure pass-through, no new logic.

- [ ] **Step 2: Typecheck the component change alone**

Run: `npx tsc --noEmit 2>&1 | grep "inline-editable-select"`
Expected: no new errors (an optional prop addition cannot break any existing caller).

- [ ] **Step 3: Wire the cascading Category → Subcategory behavior in `add-product/tabs/basic-info-tab.tsx`**

Read the current Category and Subcategory `FormField` blocks (inside the bordered card added in an earlier session — search for `name="category"` and `name="subcategory"` in this file). Make these changes:

**3a.** Add a `form.watch('category')` near the top of the component, alongside any other existing `form.watch` calls, and resolve it to the matching category's id:

```typescript
const watchedCategoryName = form.watch('category');
const selectedCategoryId = categories.find((c) => c.name === watchedCategoryName)?.id ?? null;
```

**3b.** In the Category `FormField`'s `InlineEditableSelect`, change:
```typescript
                onChange={field.onChange}
```
to:
```typescript
                onChange={(v) => { field.onChange(v); form.setValue('subcategory', ''); }}
```
(Confirmed during planning: exactly one `name="category"` `FormField` exists in this file, so this edit is unambiguous.)

**3c.** In the Subcategory `FormField`'s `InlineEditableSelect`, make these changes together:
- `items={subcategories}` → `items={subcategories.filter((s: any) => s.categoryId === selectedCategoryId)}`
- Add `disabled={!selectedCategoryId}`
- `placeholder="Select a subcategory"` → `placeholder={selectedCategoryId ? "Select a subcategory" : "Select a Category first"}`
- In its `onAdd` handler (confirmed during planning to read exactly as follows in both files, before Task 2's signature change):
  ```typescript
  onAdd={async (name) => {
    const r = await addSubcategory(name, 0);
    if (r.success) { await refreshSubcategories(); return name; }
    return undefined;
  }}
  ```
  change the first line to `const r = await addSubcategory(name, selectedCategoryId, 0);` — leave the rest of the handler unchanged.

Do not change `getId`/`getValue`/`getOptionLabel`/`getName`/`onRename` on the Subcategory picker — those are unaffected by scoping.

- [ ] **Step 4: Apply the identical changes to `edit-product/tabs/basic-info-tab.tsx`**

Same three sub-steps (3a, 3b, 3c) in this file. Two differences to preserve:
- This file's Subcategory (and Category) `InlineEditableSelect` calls include an `orphanLabel={(v) => `${v} (Missing in Settings)`}` prop — do NOT remove it. A product being edited may have a saved Subcategory whose Category no longer matches the currently-selected one (e.g. the subcategory was reassigned to a different category via the Manage Subcategories page after this product was last saved); the existing `orphanLabel` mechanism already exists specifically to keep an out-of-list saved value visible and selectable rather than silently blanking it, and that behavior is still correct and desired after this task's filtering is added on top.
- This file destructures `categories` from `useEditProductFormContext()` under that same name (confirmed during planning — unlike the unit-of-measure list, which the add/edit forms name differently, `categories` is named identically in both), so `3a`'s resolution line needs no adjustment here.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "add-product/tabs/basic-info-tab|edit-product/tabs/basic-info-tab"`
Expected: no new errors beyond this repo's known pre-existing baseline in these two files (an `InlineEditableSelect` `value` prop type mismatch — confirm any error you see is that exact pre-existing one, by checking it's unrelated to `category`/`subcategory`/`disabled`, not a new one this task introduced).

- [ ] **Step 6: Verify in the running app**

Run the dev server in the FOREGROUND. Open Add Product:
1. Confirm the Subcategory field is disabled with "Select a Category first" before any Category is chosen.
2. Pick a Category that has at least one subcategory assigned to it (create one via Manage Subcategories first if none exist yet, using Task 3's new required-Category flow). Confirm the Subcategory picker now shows only that category's subcategories.
3. Pick a Subcategory, then change Category to a different one. Confirm Subcategory clears back to empty.
4. With a Category selected, use the Subcategory picker's inline "Add" flow to create a new subcategory. Confirm it appears immediately in the picker, and later confirm (via Manage Subcategories or a DB query) that it was saved with `category_id` set to the Category that was selected at the time.

Repeat the same checks in Edit Product against an existing product, additionally confirming that a saved Category/Subcategory pair that's still valid survives opening and closing the dialog WITHOUT being cleared (this is the specific regression this plan's spec called out — clearing must only fire on a genuine user change, not on the form's own load).

If you have no browser tooling, say so plainly in your report and verify as far as possible via typecheck and a direct DB query instead — do NOT claim a visual pass you did not perform.

- [ ] **Step 7: Commit**

```bash
git add "app/(app)/products/components/inline-editable-select.tsx" "app/(app)/products/add-product/tabs/basic-info-tab.tsx" "app/(app)/products/edit-product/tabs/basic-info-tab.tsx"
git commit -m "feat: cascade the product form's Subcategory picker from Category"
```

---

## Done When

- `subcategories.category_id` exists, nullable, FK to `categories(id) ON DELETE SET NULL`; the old global `UNIQUE(name)` is gone, replaced by `UNIQUE(category_id, name)`.
- Every subcategory that existed before this plan's migration ran shows as "Unassigned" until a person assigns it a Category — none were deleted or auto-assigned.
- `addSubcategory`/`updateSubcategory` reject a duplicate name within the same category (or among unassigned subcategories), verified both in a direct call and by checking the database.
- Manage Subcategories shows a Category column and requires a Category when adding or editing a subcategory.
- The Add and Edit Product forms' Subcategory picker is disabled until a Category is chosen, shows only that Category's subcategories once one is, clears on an actual Category change (not on form load/reset), and scopes a newly-added subcategory to the selected Category.
- `npx tsc --noEmit` shows no new errors in any touched file beyond this repo's known pre-existing baseline.
