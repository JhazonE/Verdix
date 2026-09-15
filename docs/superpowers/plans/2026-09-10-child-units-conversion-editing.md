# Child Units: Conversion Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the child-units dialog's markup editing with conversion-factor editing, and make its Save button always enabled.

**Architecture:** Conversion factors are stored on the PARENT keyed by the child's unit of measure (`UNIQUE (product_id, unit)`), so the new server action is keyed by unit rather than by child id — matching the storage and making the shared-factor consequence explicit instead of hiding it behind a per-child illusion. The dialog's markup UI and draft state are deleted; the per-product markup feature itself (column, resolver, action, tests, Edit Product hint) is deliberately untouched.

**Tech Stack:** Next.js 16 (App Router, server actions), MySQL 8 via raw `mysql2/promise`, React with `@tanstack/react-query`, shadcn/ui, `node:assert/strict` unit tests, Playwright E2E.

**Spec:** `docs/superpowers/specs/2026-09-10-child-units-conversion-editing-design.md`

## Global Constraints

- **The per-product markup feature is NOT removed.** `products.markup_percentage`, the resolver override in `lib/purchase-utils.ts`, the `updateChildMarkups` server action, `lib/markup-validation.ts`, the markup unit tests, and the Edit Product markup hint all stay exactly as they are. Only the dialog's markup UI goes away. Deleting any of the above is a defect, not a cleanup.
- **`null` and `0` are different and must never collapse.** A blank conversion input means "no factor set" and DELETES the row; `0` is invalid and is rejected. Never write `0` for a blank, and never treat a blank as `0`.
- **A factor must be greater than 0.** A factor of `0` would make every synced quantity for that family member zero.
- **The Save button is ALWAYS enabled.** Clicking it with nothing changed performs no writes and closes, without an error. Never disable it, and never report "nothing to save" as a failure.
- **Conversion factors are keyed `(parent product_id, child's unit_of_measure)`** — verified against the live schema (`unique_product_unit`). Two children of one parent sharing a unit share ONE factor row. The UI must surface this, not hide it.
- **Changing a factor does NOT recompute existing stock.** It affects future family syncs only. The dialog says so.
- MySQL only, raw SQL, no ORM. Transactions use `withTransaction` from `@/lib/mysql`.
- **Unit tests** are `node:assert/strict` files that self-execute on import and MUST be registered in `tests/unit/run.ts`.
- **`npm run test:unit` cannot verify a new test here** — `tests/unit/business-date-lock-lifecycle.test.ts:67` throws and aborts the suite before later imports. Use `npx tsx tests/unit/<file>.test.ts` as the red/green signal, and still register the file.
- **The verification baseline is red.** Lint is broken; typecheck has pre-existing errors; four `tests/e2e/products/price-levels.spec.ts` tests fail because that spec seeds no session. Compare against this baseline before calling a failure yours.
- **Never run `git stash`, `git restore`, `git checkout -- <file>`, `git reset`, or `git clean`.** The working tree holds ~10 uncommitted files of a colleague's unrelated work; a previous agent stashed them and nearly lost them. Stage only your own files by explicit path; never `git add -A` / `git add .` / `git commit -a`.

---

### Task 1: `updateChildConversions` server action

**Files:**
- Modify: `app/(app)/products/actions.ts`

**Interfaces:**
- Consumes: `withTransaction` from `@/lib/mysql` (already imported at line 3).
- Produces: `updateChildConversions(parentId: string, rows: { unit: string; factor: number | null }[]): Promise<{ success: boolean; message: string }>` — Task 3's dialog calls it.

**Read first:** `updateChildMarkups` at `actions.ts:2392` — it is the shape to mirror (validate everything before opening the transaction, one `withTransaction`, `{success, message}` return). Also read the conversion-factor upsert inside `reassignParentOnConnection` (search for `ON DUPLICATE KEY UPDATE factor`) — you reuse that exact statement.

**Why keyed by unit:** `conversion_factors` rows live on the PARENT and are keyed `(product_id, unit)`. There is no per-child row to update, so a per-child signature would be a lie that breaks the moment two children share a unit.

- [ ] **Step 1: Write the action**

Add to `app/(app)/products/actions.ts`, near `updateChildMarkups`:

```typescript
/**
 * Saves conversion factors for a parent's child units.
 *
 * Rows are keyed by UNIT, not by child id: conversion_factors lives on the
 * PARENT with UNIQUE (product_id, unit), so two children of the same parent
 * sharing a unit of measure share ONE row. A per-child signature would hide
 * that; this one makes it explicit.
 *
 * A numeric factor upserts; a null factor DELETES the row (meaning "no factor
 * set"). null and 0 are different: 0 is invalid, because a zero factor would
 * make every synced quantity for that family member zero.
 *
 * Changing a factor does not recompute stock already synced under the old one.
 */
export async function updateChildConversions(
  parentId: string,
  rows: { unit: string; factor: number | null }[],
): Promise<{ success: boolean; message: string }> {
  if (!parentId) {
    return { success: false, message: 'A parent product is required.' };
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    // Saving with nothing changed is a normal, successful no-op — the dialog's
    // Save button is always enabled by design.
    return { success: true, message: 'No conversion changes to save.' };
  }

  // Validate everything BEFORE opening a transaction: one bad row rejects the
  // whole batch, so there is nothing partial to undo.
  for (const row of rows) {
    if (!row?.unit) {
      return { success: false, message: 'A conversion row is missing its unit.' };
    }
    if (row.factor !== null) {
      const n = Number(row.factor);
      if (!Number.isFinite(n) || n <= 0) {
        return {
          success: false,
          message: `Invalid conversion factor for "${row.unit}". Enter a number greater than 0, or leave it blank to remove it.`,
        };
      }
    }
  }

  try {
    await withTransaction(async (connection) => {
      for (const row of rows) {
        if (row.factor === null) {
          await connection.query(
            'DELETE FROM conversion_factors WHERE product_id = ? AND unit = ?',
            [parentId, row.unit],
          );
          continue;
        }

        // unique_product_unit (product_id, unit) makes this idempotent — the
        // same upsert reassignParent uses.
        const cfId = `${parentId}-cf-${row.unit}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        await connection.query(
          `INSERT INTO conversion_factors (id, product_id, unit, factor)
           VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE factor = VALUES(factor)`,
          [cfId, parentId, row.unit, Number(row.factor)],
        );
      }
    });
    return { success: true, message: `Saved ${rows.length} conversion factor(s).` };
  } catch (error) {
    console.error('Error updating child conversions:', error);
    return { success: false, message: 'Error saving conversion factors.' };
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep "actions.ts"`
Expected: no NEW errors naming `actions.ts`. The repo baseline is red elsewhere — ignore pre-existing errors.

- [ ] **Step 3: Commit**

```bash
git add "app/(app)/products/actions.ts"
git commit -m "feat: add updateChildConversions server action"
```

---

### Task 2: Prove the action's semantics against the database

**Files:**
- Create: `tests/unit/child-conversions.test.ts`
- Modify: `tests/unit/run.ts`

**Interfaces:**
- Consumes: `updateChildConversions` (Task 1).
- Produces: nothing.

**Why its own task:** the null-deletes / 0-rejects distinction and the shared-unit upsert are the semantics the UI depends on. A reviewer could approve Task 1's code and still reject an untested claim about what it does to the database.

This test hits the real local MySQL `verdix` and must clean up after itself. `products` requires only `id`, `name`, and `price` as NOT NULL without a default.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/child-conversions.test.ts`:

```typescript
import assert from 'node:assert/strict';
import { query } from '../../lib/mysql';
import { updateChildConversions } from '../../app/(app)/products/actions';

/**
 * conversion_factors is keyed (product_id, unit) on the PARENT, so these tests
 * assert against that shape — including the case where two children sharing a
 * unit share one row.
 */

const SUFFIX = `cc_${Date.now()}`;
const PARENT_ID = `test_parent_${SUFFIX}`;
const CHILD_A = `test_child_a_${SUFFIX}`;
const CHILD_B = `test_child_b_${SUFFIX}`;

async function makeProduct(id: string, name: string, unit: string, parentId: string | null) {
  await query(
    `INSERT INTO products (id, name, sku, unit_of_measure, stock, price, cost, parent_id)
     VALUES (?, ?, ?, ?, 0, 10, 5, ?)`,
    [id, name, `SKU-${id}`, unit, parentId],
  );
}

async function factorFor(unit: string): Promise<number | null> {
  const rows: any = await query(
    'SELECT factor FROM conversion_factors WHERE product_id = ? AND unit = ?',
    [PARENT_ID, unit],
  );
  return rows[0] ? Number(rows[0].factor) : null;
}

async function rowCountFor(unit: string): Promise<number> {
  const rows: any = await query(
    'SELECT COUNT(*) AS n FROM conversion_factors WHERE product_id = ? AND unit = ?',
    [PARENT_ID, unit],
  );
  return Number(rows[0].n);
}

async function cleanup() {
  await query('DELETE FROM conversion_factors WHERE product_id = ?', [PARENT_ID]);
  await query('DELETE FROM products WHERE id IN (?, ?, ?)', [PARENT_ID, CHILD_A, CHILD_B]);
}

(async () => {
  try {
    await cleanup();
    await makeProduct(PARENT_ID, `CC Parent ${SUFFIX}`, 'Sack', null);
    await makeProduct(CHILD_A, `CC Child A ${SUFFIX}`, 'Kilo', PARENT_ID);
    await makeProduct(CHILD_B, `CC Child B ${SUFFIX}`, 'Kilo', PARENT_ID);

    // --- a numeric factor upserts ---
    {
      const r = await updateChildConversions(PARENT_ID, [{ unit: 'Kilo', factor: 25 }]);
      assert.equal(r.success, true, `upsert should succeed: ${r.message}`);
      assert.equal(await factorFor('Kilo'), 25, 'factor is written');
    }

    // --- upserting the same unit UPDATES rather than duplicating ---
    {
      const r = await updateChildConversions(PARENT_ID, [{ unit: 'Kilo', factor: 24 }]);
      assert.equal(r.success, true, 'second upsert succeeds');
      assert.equal(await factorFor('Kilo'), 24, 'factor is updated');
      assert.equal(await rowCountFor('Kilo'), 1, 'still exactly ONE row for this unit');
    }

    // --- 0 is REJECTED and writes nothing ---
    {
      const before = await factorFor('Kilo');
      const r = await updateChildConversions(PARENT_ID, [{ unit: 'Kilo', factor: 0 }]);
      assert.equal(r.success, false, 'a zero factor is rejected');
      assert.equal(await factorFor('Kilo'), before, 'a rejected batch writes nothing');
    }

    // --- a negative is REJECTED ---
    {
      const r = await updateChildConversions(PARENT_ID, [{ unit: 'Kilo', factor: -3 }]);
      assert.equal(r.success, false, 'a negative factor is rejected');
    }

    // --- one bad row rejects the WHOLE batch (nothing partial) ---
    {
      await updateChildConversions(PARENT_ID, [{ unit: 'Kilo', factor: 24 }]);
      const r = await updateChildConversions(PARENT_ID, [
        { unit: 'Kilo', factor: 30 },
        { unit: 'Gram', factor: 0 },
      ]);
      assert.equal(r.success, false, 'the batch is rejected');
      assert.equal(await factorFor('Kilo'), 24, 'the valid row in a rejected batch was NOT written');
      assert.equal(await factorFor('Gram'), null, 'the invalid row was not written either');
    }

    // --- null DELETES the row; it does not write 0 ---
    {
      const r = await updateChildConversions(PARENT_ID, [{ unit: 'Kilo', factor: null }]);
      assert.equal(r.success, true, `null should succeed: ${r.message}`);
      assert.equal(await rowCountFor('Kilo'), 0, 'null removes the row');
      assert.notEqual(await factorFor('Kilo'), 0, 'null must NOT be stored as 0');
    }

    // --- an empty batch is a successful no-op, not an error ---
    {
      const r = await updateChildConversions(PARENT_ID, []);
      assert.equal(r.success, true, 'saving nothing is a success, not a failure');
    }

    console.log('✅ child-conversions tests passed');
    await cleanup();
    process.exit(0);
  } catch (error) {
    console.error('❌ child-conversions tests FAILED');
    console.error(error);
    await cleanup();
    process.exit(1);
  }
})();
```

Note the exit handling: a failure must print the error and exit **non-zero**. Do not replace this with a bare `finally { process.exit(0) }` — that pattern makes a test incapable of failing, and it has already bitten this project once.

- [ ] **Step 2: Register the test**

In `tests/unit/run.ts`, add at the end of the import list:

```typescript
import './child-conversions.test';
```

- [ ] **Step 3: Run it**

Run: `npx tsx tests/unit/child-conversions.test.ts`
Expected: `✅ child-conversions tests passed`, exit 0.

- [ ] **Step 4: Prove the test can actually fail**

Temporarily break the action to confirm the test catches it: in `updateChildConversions`, change the null branch from `DELETE` to a no-op (e.g. comment out the DELETE and `continue`), then re-run.

Expected: FAIL — the `null removes the row` assertion reports 1 instead of 0, with a **non-zero exit code**.

Then restore the DELETE and confirm `git diff --stat "app/(app)/products/actions.ts"` is EMPTY before moving on. Paste both runs into your report.

- [ ] **Step 5: Confirm no rows were left behind**

Run:
```bash
npx tsx -e "require('./lib/mysql').query(\"SELECT id FROM products WHERE id LIKE 'test_%cc_%'\").then(r=>{console.log('leftover:', r.length); process.exit(0)})"
```
Expected: `leftover: 0`.

- [ ] **Step 6: Commit**

```bash
git add tests/unit/child-conversions.test.ts tests/unit/run.ts
git commit -m "test: cover conversion factor upsert, delete, and rejection"
```

---

### Task 3: Swap markup editing for conversion editing in the dialog

**Files:**
- Modify: `app/(app)/products/child-units/use-child-units.ts`
- Modify: `app/(app)/products/child-units/ChildUnitsDialog.tsx`

**Interfaces:**
- Consumes: `updateChildConversions` (Task 1).
- Produces: the finished dialog.

**Read first:** both files, fully. The hook currently holds markup draft state (`drafts`, `draftValue`, `isRowValid`, `hasChanges`, `allValid`, `isSaving`, `save`) plus `inheritedFor` and `suggestedPrice`; the dialog renders `Markup %` and `Suggested` columns and a `Save Markups` button.

**What to DELETE (dialog UI only):** the `Markup %` and `Suggested` columns and their cells, the markup draft state and helpers listed above, plus `inheritedFor` and `suggestedPrice`.

Those two are the ONLY consumers of `systemSettings` and `priceLevels` in this hook — I verified it (`use-child-units.ts:94,102,109,112`, and neither appears in the dialog at all). So once they go, delete with them: the `systemSettings` state, the `/pos-settings` fetch effect, the `priceLevels` derivation, and the now-unused imports `calculateMarkupPercentage`, `calculateSuggestedPrice`, `getApiUrl`, `SystemSettings`, `isValidMarkupValue`, `MARKUP_MAX`, and `updateChildMarkups`.

Re-grep before deleting each import — if something else in the file still uses one, keep it and say so in your report.

**What to KEEP — do not delete these while cleaning up:** `products.markup_percentage`, the resolver in `lib/purchase-utils.ts`, the `updateChildMarkups` action in `actions.ts`, `lib/markup-validation.ts`, and every markup unit test. They are used elsewhere. Only the dialog stops calling them.

- [ ] **Step 1: Replace the hook's draft state**

In `use-child-units.ts`, remove the markup draft block and add conversion drafts in its place. Drafts stay STRINGS so a blank stays distinguishable from a typed number:

```typescript
  /** unit -> raw input text. Absent = untouched. '' = cleared (delete the factor). */
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) setDrafts({});
  }, [open, viewedParent?.id]);

  const setDraft = useCallback((unit: string, text: string) => {
    setDrafts((d) => ({ ...d, [unit]: text }));
  }, []);

  /** The value a unit would save: null when blank, else the parsed number. */
  const draftValue = useCallback((row: ChildUnitRow): number | null => {
    const unit = row.unitOfMeasure ?? '';
    const text = drafts[unit];
    if (text === undefined) return row.conversionFactor ?? null;
    if (text.trim() === '') return null;
    return Number(text);
  }, [drafts]);

  const isRowValid = useCallback((row: ChildUnitRow) => {
    const v = draftValue(row);
    if (v === null) return true;
    return Number.isFinite(v) && v > 0;
  }, [draftValue]);

  const allValid = rows.every(isRowValid);
```

**Keying by unit, not by row id, is deliberate** — it is what makes two same-unit rows move together, matching how the data is stored.

- [ ] **Step 2: Add the save function**

```typescript
  const [isSaving, setIsSaving] = useState(false);

  const save = useCallback(async () => {
    if (!allValid) {
      return { success: false, message: 'Fix the highlighted conversion factors first.' };
    }

    // One entry per CHANGED unit (not per row) — two rows sharing a unit are
    // one factor, so sending both would write the same row twice.
    const byUnit = new Map<string, number | null>();
    for (const row of rows) {
      const unit = row.unitOfMeasure ?? '';
      if (!unit) continue;
      const text = drafts[unit];
      if (text === undefined) continue;
      const next = draftValue(row);
      if (next !== (row.conversionFactor ?? null)) byUnit.set(unit, next);
    }

    // Saving with nothing changed is a normal success — the button is always enabled.
    if (byUnit.size === 0) return { success: true, message: '' };

    setIsSaving(true);
    try {
      const result = await updateChildConversions(
        viewedParent!.id,
        [...byUnit.entries()].map(([unit, factor]) => ({ unit, factor })),
      );
      if (result.success) {
        setDrafts({});
        await refetch();
      }
      return result;
    } finally {
      setIsSaving(false);
    }
  }, [allValid, rows, drafts, draftValue, viewedParent, refetch]);
```

Import `updateChildConversions` from `../actions` and drop the `updateChildMarkups` import.

- [ ] **Step 3: Expose which units are shared**

Two rows with the same unit share one factor. The dialog needs to say so:

```typescript
  /** unit -> how many rows use it. Anything > 1 shares a single factor row. */
  const unitCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const unit = row.unitOfMeasure ?? '';
      if (!unit) continue;
      counts.set(unit, (counts.get(unit) ?? 0) + 1);
    }
    return counts;
  }, [rows]);
```

Return `unitCounts` alongside `drafts`, `setDraft`, `draftValue`, `isRowValid`, `allValid`, `isSaving`, and `save`. Remove `hasChanges`, `inheritedFor`, and `suggestedPrice` from the return.

- [ ] **Step 4: Rework the table**

In `ChildUnitsDialog.tsx`, delete the `Markup %` and `Suggested` `<TableHead>`s and their `<TableCell>`s. Columns become: Name · Unit · Conversion · Stock · Cost · Current Price · `⋮` — **seven**, down from nine.

**Update the `colSpan` on the empty and loading rows from `9` to `7`.** There are two of them (currently at `ChildUnitsDialog.tsx:189` and `:213`); a stale colSpan leaves the empty state visually misaligned. Confirm with `grep -n colSpan` that no `9` remains.

Make the Conversion cell an input:

```tsx
<TableCell className="text-center">
  <Input
    type="number"
    step="0.01"
    min={0}
    className={cn('w-24 mx-auto text-center', !isRowValid(row) && 'border-destructive')}
    placeholder="none"
    value={
      drafts[row.unitOfMeasure ?? ''] ??
      (row.conversionFactor === null || row.conversionFactor === undefined
        ? ''
        : String(row.conversionFactor))
    }
    onChange={(e) => setDraft(row.unitOfMeasure ?? '', e.target.value)}
  />
  {(unitCounts.get(row.unitOfMeasure ?? '') ?? 0) > 1 && (
    <div className="text-xs text-muted-foreground mt-1">
      shared with {(unitCounts.get(row.unitOfMeasure ?? '') ?? 1) - 1} other unit
    </div>
  )}
  {!isRowValid(row) && (
    <div className="text-xs text-destructive mt-1">
      Enter a number greater than 0, or leave it blank.
    </div>
  )}
</TableCell>
```

Because the input's value is keyed by unit, two same-unit rows update together as the user types — the shared factor is visible before saving, not discovered afterward.

- [ ] **Step 5: Add the stock caveat and rework the footer**

Beneath the table, add a muted line:

```tsx
<p className="text-xs text-muted-foreground mt-2">
  Changing a conversion factor affects future stock syncs only — it does not
  adjust quantities already recorded.
</p>
```

Change the save button to:

```tsx
<Button onClick={handleSave} disabled={isSaving}>
  {isSaving ? 'Saving…' : 'Save Conversions'}
</Button>
```

**It is disabled only while a save is in flight** — never for "nothing changed" and never for validity. (An invalid row is caught by `save()` itself, which returns a message the handler toasts.)

`handleSave` calls `save()`, toasts `result.message` when non-empty (destructive variant when `!result.success`), calls `onSaved?.()` on success, and closes the dialog on success.

- [ ] **Step 6: Update the unsaved-changes guard**

The close guard currently keys off `hasChanges`, which no longer exists. Replace it with a check for any touched draft:

```tsx
const hasEdits = Object.keys(drafts).length > 0;
const handleClose = () => {
  if (hasEdits && !window.confirm('Discard unsaved conversion changes?')) return;
  onOpenChange(false);
};
```

Keep routing the dialog's own `onOpenChange` through `handleClose` so the X and overlay click are guarded like Cancel.

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "child-units"`
Expected: no errors naming those files. In particular this catches any leftover reference to the removed `hasChanges` / `inheritedFor` / `suggestedPrice`.

- [ ] **Step 8: Verify the markup feature is still intact**

This task deletes markup UI, so prove you did not delete the feature:

```bash
npx tsx tests/unit/product-markup-resolution.test.ts
npx tsx tests/unit/markup-validation.test.ts
grep -n "updateChildMarkups" "app/(app)/products/actions.ts"
grep -rn "markupPercentage" "app/(app)/products/edit-product/use-edit-product-form.ts"
```
Expected: both tests pass, and both greps still find their targets.

- [ ] **Step 9: Verify in the running app**

Run the dev server in the FOREGROUND on port 3000 and check:

1. The dialog shows no `Markup %` and no `Suggested` column, and the button reads `Save Conversions`.
2. Click `Save Conversions` with nothing changed — it closes with no error.
3. Change a factor, save, reopen — the new value persists.
4. Type `0` — an inline error appears; saving toasts the rejection and does not persist it.
5. Clear a factor to blank and save — reopening shows it empty.

If you have no browser tooling, say so plainly in your report and verify as far as you can — do NOT claim a visual pass you did not perform.

- [ ] **Step 10: Commit**

```bash
git add "app/(app)/products/child-units/use-child-units.ts" "app/(app)/products/child-units/ChildUnitsDialog.tsx"
git commit -m "feat: edit conversion factors in the child units dialog"
```

---

### Task 4: Update the E2E

**Files:**
- Modify: `tests/e2e/child-units.spec.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

**Read first:** `tests/e2e/child-units.spec.ts`. Several of its tests assert on markup — the `Markup %` input, the `inherits N%` hint, `Save Markups`, and a NULL-vs-0 markup round trip. Those assert UI this plan deletes, so they are rewritten against conversions. Keep the file's existing helpers for opening the dialog, and keep every test that does NOT touch markup (the badge, the dialog listing, the `↳ parent` badge) exactly as it is.

**This is the only real check that the reworked dialog renders and works** — the preceding task may have been verified without a browser.

- [ ] **Step 1: Rewrite the markup tests as conversion tests**

Replace the markup-specific tests with coverage of:

1. **The markup UI is gone.** Open the dialog and assert there is no `Markup %` column header, no `Suggested` column header, and no `Save Markups` button — while the dialog itself and its child rows still render.
2. **A conversion factor persists.** Edit a child's factor, click `Save Conversions`, reload the page, reopen the dialog, and assert the input holds the new value. Use a `page.reload()` between write and read so this proves a server round trip rather than component state.
3. **Save with nothing changed.** Open the dialog and click `Save Conversions` immediately: assert the dialog closes and no error toast appears. (This is the explicit requirement that the button is always enabled.)
4. **A zero factor is rejected.** Type `0`, assert the inline error is visible, attempt to save, then reload and reopen and assert the original value is unchanged.

Do not write assertions that would pass against a broken UI — asserting an input "is visible" without checking its value proves nothing.

- [ ] **Step 2: Reset the test DB and run**

Run: `npm run test:e2e:db`
Then: `npx playwright test tests/e2e/child-units.spec.ts --reporter=line`
Expected: all tests in the file pass.

If `.next-test` wedges with a Turbopack panic (`exit 0xc0000142`), `rm -rf .next-test` — it is gitignored.

- [ ] **Step 3: Confirm the sibling spec still passes**

Run: `npx playwright test tests/e2e/product-reassign.spec.ts --reporter=line`
Expected: 7 passed. That spec drives the same dialog for membership actions, so it is the check that this rework did not break add/move/remove.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/child-units.spec.ts
git commit -m "test: cover conversion editing in the child units dialog"
```

---

### Task 5: Update project documentation

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Correct the product-families entry**

`CLAUDE.md`'s **Product families in the UI** entry currently says membership editing lives in the child-units dialog. That stays true. But the **Product markup** entry sits alongside it and a reader could reasonably infer markup is edited there too.

Append to the **Product families in the UI** entry:

```markdown
The dialog edits **conversion factors**, not markup: a row's factor is stored on the
parent keyed by the child's unit (`conversion_factors`, `UNIQUE (product_id, unit)`), so
two children sharing a unit share one factor and the dialog says so inline. A blank factor
deletes the row; `0` is rejected. Changing a factor affects future family syncs only — it
does not adjust stock already recorded. Per-product **markup** is set in the Edit Product
form, not here.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: note that the child units dialog edits conversions, not markup"
```

---

## Done When

- The child-units dialog has no markup UI, and its Conversion column is editable.
- `Save Conversions` is always enabled; saving with nothing changed closes without error.
- A blank factor deletes the row; `0` and negatives are rejected inline and server-side; `null` is never stored as `0`.
- Two children sharing a unit visibly share one factor, in the UI and in a single upsert.
- The per-product markup feature still works: its column, resolver, action, validation, tests, and Edit Product hint are all intact.
- `child-units.spec.ts` covers the reworked dialog and passes; `product-reassign.spec.ts` still passes 7.
