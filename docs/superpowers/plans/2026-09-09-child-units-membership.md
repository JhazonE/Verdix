# Child Unit Membership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user add an existing product to a family, remove a child from it, and move a child between parents — all from the child-units dialog — and retire `ReassignParentDialog`.

**Architecture:** The existing `reassignParent` server action already carries every guard these operations need (cycle detection, the stock rule, conversion-factor upsert, and the detach path), so it is reused unchanged and three of the four operations are pure UI work. Only "add an existing product that holds stock" needs new server code: one action that zeroes the stock through the audited movement helper and attaches, both inside a single transaction. A new pure tree helper answers "which products may not become a child of this parent", which is the inverse of the question the old reassign dialog asked.

**Tech Stack:** Next.js 16 (App Router, server actions), MySQL 8 via raw `mysql2/promise`, React with `@tanstack/react-query`, shadcn/ui dialogs and dropdowns, `node:assert/strict` unit tests, Playwright E2E.

**Spec:** `docs/superpowers/specs/2026-09-09-child-units-membership-design.md`

## Global Constraints

- **`reassignParent` is NOT modified.** It already has the cycle guard, the stock guard, the conversion-factor upsert, and the detach path. Every operation routes through it. Changing it is out of scope and risks the reassignment behaviour that already works.
- **Stock is never zeroed with a bare `UPDATE`.** Use `updateStockAndRecordMovement(...)` from `lib/stock-movements.ts` with movement type `'adjustment'`, so the change lands in inventory history like any other adjustment.
- **Clearing stock and attaching share ONE transaction.** If the attach fails, the stock adjustment must roll back. A partial success would destroy inventory without producing a child.
- **The search picker excludes the parent and its ANCESTORS — not its descendants.** Re-attaching a grandchild one level up is legal and `reassignParent` permits it. Excluding descendants would block a legitimate move.
- **Detach leaves `conversion_factors` in place.** That is existing behaviour (`actions.ts:836`); do not "clean up" those rows.
- **Markup behaviour is untouched.** No task here reads or writes `markup_percentage`, and nothing writes `products.price`.
- MySQL only, raw SQL, no ORM. Transactions use `withTransaction` from `@/lib/mysql`.
- **Unit tests** are plain `node:assert/strict` files that self-execute on import and MUST be registered in `tests/unit/run.ts`.
- **`npm run test:unit` cannot verify a new test here.** `tests/unit/business-date-lock-lifecycle.test.ts:67` throws and kills the process before later imports run — pre-existing and unrelated. Use `npx tsx tests/unit/<file>.test.ts` as the red/green signal, and still register the file in `run.ts`.
- **The verification baseline is red.** Lint is broken; typecheck has pre-existing errors; four `tests/e2e/products/price-levels.spec.ts` tests fail because that spec seeds no session; `product-reassign.spec.ts`'s auto-detect test fails on pre-branch code too. Compare against this baseline before calling any failure yours.
- **Never run `git stash`, `git restore`, `git checkout -- <file>`, `git reset`, or `git clean`.** The working tree holds unrelated uncommitted work. Stage only your own files by explicit path; never `git add -A` / `git add .` / `git commit -a`.

---

### Task 1: Tree helper for illegal child targets

**Files:**
- Modify: `lib/product-tree.ts`
- Modify: `tests/unit/product-tree.test.ts`

**Interfaces:**
- Consumes: existing `TreeProduct`, `getDescendantIds` from the same file.
- Produces: `getIllegalChildTargets(parentId: string, products: TreeProduct[]): Set<string>` — the ids that may NOT become a child of `parentId`. Task 4's picker filters with it.

**Context:** the file already has `getIllegalReassignTargets(childId, …)`, which returns the child plus its **descendants** — "who may not be this child's parent". This task adds the mirror question asked from the parent's side: "who may not be this parent's child" = the parent plus its **ancestors**, found by walking up the `parentId` chain.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/product-tree.test.ts` (the file already defines the tree `A -> B -> C`, `A -> D`, `E` standalone — reuse that `products` array):

```typescript
// --- getIllegalChildTargets: who may NOT become a child of X ---
// Mirror of getIllegalReassignTargets. Walking UP from the parent, not down.

// C's ancestors are B and A; adding either under C would make a loop.
{
  const illegal = getIllegalChildTargets('C', products);
  assert.deepEqual([...illegal].sort(), ['A', 'B', 'C'], 'C plus its ancestors');
}

// A is a root: only A itself is illegal (nothing is above it).
{
  const illegal = getIllegalChildTargets('A', products);
  assert.deepEqual([...illegal].sort(), ['A'], 'a root excludes only itself');
}

// A product cannot become its own child.
assert.equal(getIllegalChildTargets('E', products).has('E'), true, 'self is always illegal');

// DESCENDANTS ARE LEGAL: re-attaching a grandchild one level up is a real move,
// so C must NOT be excluded as a candidate child of A.
{
  const illegal = getIllegalChildTargets('A', products);
  assert.equal(illegal.has('C'), false, 'a descendant may be re-attached higher up');
  assert.equal(illegal.has('B'), false, 'a direct child is not excluded either');
}

// Cycle-safe: malformed data (a parent loop) must terminate, not hang.
{
  const cyclic: TreeProduct[] = [
    { id: 'X', parentId: 'Y' },
    { id: 'Y', parentId: 'X' },
  ];
  const illegal = getIllegalChildTargets('X', cyclic);
  assert.equal(illegal.has('X'), true, 'terminates on a cycle and includes self');
}
```

Update the file's import line to include the new function:

```typescript
import { getDescendantIds, getIllegalReassignTargets, getIllegalChildTargets, type TreeProduct } from '../../lib/product-tree';
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx tests/unit/product-tree.test.ts`
Expected: FAIL — `getIllegalChildTargets is not a function`.

- [ ] **Step 3: Implement the helper**

Append to `lib/product-tree.ts`:

```typescript
/**
 * The set of product ids that may NOT become a child of `parentId`:
 * the parent itself (a product can't be its own child) plus all its ancestors
 * (attaching an ancestor under its own descendant would create a parent_id loop).
 *
 * This is the mirror of getIllegalReassignTargets, asked from the parent's side.
 * Descendants are deliberately NOT excluded: re-attaching a grandchild one level
 * up is a legitimate move that reassignParent allows.
 */
export function getIllegalChildTargets(parentId: string, products: TreeProduct[]): Set<string> {
  const parentById = new Map<string, string | null>();
  for (const p of products) parentById.set(p.id, p.parentId ?? null);

  const illegal = new Set<string>([parentId]);
  let current = parentById.get(parentId) ?? null;
  // A visited set guarantees termination even if the data contains a loop.
  while (current !== null && !illegal.has(current)) {
    illegal.add(current);
    current = parentById.get(current) ?? null;
  }
  return illegal;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx tests/unit/product-tree.test.ts`
Expected: PASS, and the file's existing assertions still pass.

- [ ] **Step 5: Commit**

```bash
git add lib/product-tree.ts tests/unit/product-tree.test.ts
git commit -m "feat: add getIllegalChildTargets tree helper"
```

---

### Task 2: `clearStockAndReassign` server action

**Files:**
- Modify: `app/(app)/products/actions.ts`

**Interfaces:**
- Consumes: `reassignParent` (unchanged), `updateStockAndRecordMovement` from `@/lib/stock-movements`, `withTransaction` from `@/lib/mysql`.
- Produces: `clearStockAndReassign(childId: string, newParentId: string, conversionFactor: number): Promise<{ success: boolean; message: string }>` — Task 4's confirm button calls it.

**Read first:** `reassignParent` at `actions.ts:707`. Note its stock guard at line ~734 and that it wraps its own work in `withTransaction`. Also read `updateStockAndRecordMovement`'s signature at `lib/stock-movements.ts:330` — it accepts an optional `connection` as its 7th argument, which is how it joins a caller's transaction.

**The design problem you must solve:** `reassignParent` opens its own `withTransaction`. If you call it from inside another transaction, the stock adjustment and the attach end up in **separate** transactions and a failed attach will not roll back the stock — violating a Global Constraint. Read how `reassignParent` is structured and pick one of:

- extract its body into an internal helper that accepts a `connection`, and have both `reassignParent` and `clearStockAndReassign` call it (preferred — no duplicated guard logic), or
- inline the same guards inside one transaction in the new action.

**Do not** simply call `reassignParent()` from inside a `withTransaction` block and assume it joins. Whichever route you take, the resulting behaviour must be: a failed attach leaves stock unchanged. Task 3 tests exactly this.

- [ ] **Step 1: Implement the action**

Add to `app/(app)/products/actions.ts`, near `reassignParent`:

```typescript
/**
 * Attaches a product as a child AFTER zeroing its stock.
 *
 * reassignParent refuses a product holding stock, because a child's stock is
 * derived from its parent by lib/family-sync.ts. This backs the UI's explicit
 * "Clear stock and add as child" confirmation, so the user has already been told
 * the stock will go.
 *
 * The clear and the attach share ONE transaction: if the attach fails (a loop, a
 * missing parent) the stock adjustment rolls back with it. Splitting them would
 * destroy inventory without producing a child.
 */
export async function clearStockAndReassign(
  childId: string,
  newParentId: string,
  conversionFactor: number,
): Promise<{ success: boolean; message: string }> {
  if (!newParentId) {
    return { success: false, message: 'A target parent is required.' };
  }
  if (!Number.isFinite(conversionFactor) || conversionFactor <= 0) {
    return { success: false, message: 'Conversion factor must be a number greater than 0.' };
  }

  try {
    return await withTransaction(async (connection) => {
      const [rows]: any = await connection.query(
        'SELECT id, name, stock FROM products WHERE id = ?',
        [childId],
      );
      const child = rows?.[0];
      if (!child) {
        return { success: false, message: 'Product not found.' };
      }

      const [parentRows]: any = await connection.query(
        'SELECT id, name FROM products WHERE id = ?',
        [newParentId],
      );
      const parent = parentRows?.[0];
      if (!parent) {
        return { success: false, message: 'Target parent product not found.' };
      }

      const currentStock = Number(child.stock || 0);
      if (currentStock > 0) {
        await updateStockAndRecordMovement(
          childId,
          -currentStock,
          'adjustment',
          childId,
          'adjustment',
          `Stock cleared to attach as child of ${parent.name}`,
          connection,
        );
      }

      // Attach within the SAME transaction — see the note above.
      // Use whichever internal helper you extracted; the behaviour required is
      // identical to reassignParent's attach path, guards included.
      return await attachToParentOnConnection(childId, newParentId, conversionFactor, connection);
    });
  } catch (error) {
    console.error('Error in clearStockAndReassign:', error);
    return { success: false, message: 'There was an error adding the product as a child.' };
  }
}
```

`attachToParentOnConnection` is the internal helper described above — name it as you like, but it must run the same guards `reassignParent` runs (self-parent, cycle via `getIllegalReassignTargets`, parent exists) and perform the same `UPDATE products SET parent_id` plus the `conversion_factors` upsert. Refactor `reassignParent` to call it too, so the guards exist in exactly one place.

Add the import if it is not already present:

```typescript
import { updateStockAndRecordMovement } from '@/lib/stock-movements';
```

- [ ] **Step 2: Verify `reassignParent` still behaves identically**

If you refactored `reassignParent` onto the shared helper, prove you did not change it. Run the existing E2E that covers it:

Run: `npx playwright test tests/e2e/product-reassign.spec.ts --reporter=line`
Expected: the same results as before your change — 2 passed, 1 failed (`auto-fills the factor`, which fails on pre-branch code too). If a previously passing test now fails, you changed behaviour; fix it before continuing.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep "actions.ts"`
Expected: no NEW errors naming `actions.ts` (the repo has pre-existing errors elsewhere — ignore those).

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/products/actions.ts"
git commit -m "feat: add clearStockAndReassign server action"
```

---

### Task 3: Prove the transaction rolls back

**Files:**
- Create: `tests/unit/clear-stock-and-reassign.test.ts`
- Modify: `tests/unit/run.ts`

**Interfaces:**
- Consumes: `clearStockAndReassign` (Task 2).
- Produces: nothing.

**Why this is its own task:** the atomicity of clear-then-attach is the property that makes this feature safe to ship. A reviewer could reasonably approve Task 2's code and still reject an untested rollback claim. It gets its own gate.

This test talks to the real local MySQL (`verdix`), which is how the other DB-touching checks in this repo are done. It must clean up after itself.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/clear-stock-and-reassign.test.ts`:

```typescript
import assert from 'node:assert/strict';
import { query } from '../../lib/mysql';
import { clearStockAndReassign } from '../../app/(app)/products/actions';

/**
 * The safety property: clearing stock and attaching are ONE transaction.
 * A failed attach must leave the product's stock exactly as it was — otherwise
 * a user loses inventory and gains nothing.
 */

const SUFFIX = `csr_${Date.now()}`;
const PARENT_ID = `test_parent_${SUFFIX}`;
const CHILD_ID = `test_child_${SUFFIX}`;

async function makeProduct(id: string, name: string, stock: number, parentId: string | null) {
  await query(
    `INSERT INTO products (id, name, sku, unit_of_measure, stock, price, cost, parent_id)
     VALUES (?, ?, ?, 'Pieces', ?, 10, 5, ?)`,
    [id, name, `SKU-${id}`, stock, parentId],
  );
}

async function stockOf(id: string): Promise<number> {
  const rows: any = await query('SELECT stock FROM products WHERE id = ?', [id]);
  return Number(rows[0].stock);
}

async function parentOf(id: string): Promise<string | null> {
  const rows: any = await query('SELECT parent_id FROM products WHERE id = ?', [id]);
  return rows[0].parent_id;
}

async function cleanup() {
  await query('DELETE FROM conversion_factors WHERE product_id IN (?, ?)', [PARENT_ID, CHILD_ID]);
  await query('DELETE FROM stock_movements WHERE product_id IN (?, ?)', [PARENT_ID, CHILD_ID]);
  await query('DELETE FROM products WHERE id IN (?, ?)', [PARENT_ID, CHILD_ID]);
}

(async () => {
  await cleanup();
  try {
    // --- happy path: stock is cleared AND the child is attached ---
    await makeProduct(PARENT_ID, `CSR Parent ${SUFFIX}`, 0, null);
    await makeProduct(CHILD_ID, `CSR Child ${SUFFIX}`, 8, null);

    const ok = await clearStockAndReassign(CHILD_ID, PARENT_ID, 4);
    assert.equal(ok.success, true, `attach should succeed: ${ok.message}`);
    assert.equal(await stockOf(CHILD_ID), 0, 'stock is cleared on success');
    assert.equal(await parentOf(CHILD_ID), PARENT_ID, 'child is attached on success');

    // the clear is auditable, not a silent UPDATE
    const movements: any = await query(
      'SELECT COUNT(*) AS n FROM stock_movements WHERE product_id = ?',
      [CHILD_ID],
    );
    assert.ok(Number(movements[0].n) > 0, 'clearing stock records a movement');

    // --- rollback: a failed attach leaves stock untouched ---
    // Reset the child to standalone with stock again.
    await query('UPDATE products SET parent_id = NULL, stock = 8 WHERE id = ?', [CHILD_ID]);

    // Attaching the PARENT under its own CHILD is a loop — the attach must fail.
    const bad = await clearStockAndReassign(PARENT_ID, PARENT_ID, 2);
    assert.equal(bad.success, false, 'a product cannot become its own child');

    // And the child we did not touch still holds its stock.
    assert.equal(await stockOf(CHILD_ID), 8, 'unrelated stock untouched');

    // Now the real rollback case: give the parent stock, then fail its attach.
    await query('UPDATE products SET stock = 5 WHERE id = ?', [PARENT_ID]);
    const before = await stockOf(PARENT_ID);
    const failed = await clearStockAndReassign(PARENT_ID, 'no_such_parent_id_zzz', 2);
    assert.equal(failed.success, false, 'attach to a missing parent fails');
    assert.equal(
      await stockOf(PARENT_ID),
      before,
      'ROLLBACK: a failed attach must leave stock exactly as it was',
    );

    console.log('✅ clear-stock-and-reassign tests passed');
  } finally {
    await cleanup();
    process.exit(0);
  }
})();
```

- [ ] **Step 2: Register the test**

In `tests/unit/run.ts`, add at the end of the import list:

```typescript
import './clear-stock-and-reassign.test';
```

- [ ] **Step 3: Run it**

Run: `npx tsx tests/unit/clear-stock-and-reassign.test.ts`
Expected: `✅ clear-stock-and-reassign tests passed`.

If the rollback assertion fails, Task 2's two operations are in separate transactions — go back and fix Task 2 rather than weakening this test. That assertion is the entire point of this task.

- [ ] **Step 4: Confirm cleanup left nothing behind**

Run:
```bash
npx tsx -e "require('./lib/mysql').query(\"SELECT id FROM products WHERE id LIKE 'test_%csr_%'\").then(r=>{console.log('leftover rows:', r.length); process.exit(0)})"
```
Expected: `leftover rows: 0`.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/clear-stock-and-reassign.test.ts tests/unit/run.ts
git commit -m "test: prove clear-stock-and-attach is atomic"
```

---

### Task 4: Add-existing-child dialog

**Files:**
- Create: `app/(app)/products/child-units/AddExistingChildDialog.tsx`
- Modify: `app/(app)/products/child-units/ChildUnitsDialog.tsx`

**Interfaces:**
- Consumes: `getIllegalChildTargets` (Task 1), `clearStockAndReassign` (Task 2), `reassignParent` (existing), `buildProductQuery` + `PRODUCT_SEARCH_DEBOUNCE_MS` from `@/lib/product-search`, `getApiUrl` from `@/lib/api-config`.
- Produces: `<AddExistingChildDialog parentProduct open onOpenChange onAdded />`. Task 5 reuses it for "Move to another parent".

**Read first:** `app/(app)/products/reassign-parent/reassign-parent-dialog.tsx`. It already implements the debounced whole-catalogue search (lines ~59-75), the illegal-target filter (~86-89), and the conversion-factor auto-detect (~100-115). **Lift those patterns** — this dialog is largely a re-framing of that one from the parent's side. That file is deleted in Task 6, so this is where its useful parts live on.

- [ ] **Step 1: Build the dialog**

Create `AddExistingChildDialog.tsx` with:

- Props: `{ parentProduct: Product; open: boolean; onOpenChange: (o: boolean) => void; onAdded: () => void }`.
- **Search field.** Debounced by `PRODUCT_SEARCH_DEBOUNCE_MS`, fetching `getApiUrl(buildProductQuery(search))`. Guard against out-of-order responses with a request-id ref, exactly as the reassign dialog does — without it a slow early response can overwrite a fast later one.
- **Candidate filter.** Fetch the id/parent map (`SELECT id, parent_id` equivalent — the products API already returns `parentId`) and drop any candidate in `getIllegalChildTargets(parentProduct.id, treeProducts)`. Also drop products that are already children of this parent — they are in the table already.
- **Selected product panel.** Shows the chosen product's unit, stock, and cost.
- **Conversion factor input.** Auto-fill from `parentProduct.conversionFactors` when one matches the selected product's `unitOfMeasure`, showing an "Auto-detected" hint; otherwise blank for the user to type. Require a value > 0 before the confirm button enables.
- **Stock warning.** When the selected product's `stock > 0`, render:

```tsx
<div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
  ⚠️ <strong>{selected.name}</strong> has <strong>{selected.stock} {selected.unitOfMeasure}</strong> in
  stock. Adding it as a child clears that stock, because a child's stock is derived
  from its parent.
</div>
```

- **Confirm button.** Label and action depend on stock:
  - `stock > 0` → label `Clear stock and add as child`, calls `clearStockAndReassign(selected.id, parentProduct.id, factor)`.
  - `stock === 0` → label `Add as child`, calls `reassignParent(selected.id, parentProduct.id, factor)`.
- On success: toast `result.message`, call `onAdded()`, close. On failure: toast destructive with `result.message` and stay open so the user can adjust.

Match the structure and imports of `ChildUnitsDialog.tsx` (same shadcn `Dialog`, `Input`, `Button`, `useToast`) rather than inventing a new layout.

- [ ] **Step 2: Turn `+ Add Child Unit` into two choices**

In `ChildUnitsDialog.tsx`, the footer currently has a single `Add Child Unit` button mounting `QuickAddChildDialog` (around lines 172-196). Replace the single button with a `DropdownMenu` offering:

- `Create new` → opens the existing `QuickAddChildDialog` (leave that component and its props untouched).
- `Add existing product` → opens `AddExistingChildDialog` with `parentProduct={viewedParent}`.

Wire `AddExistingChildDialog`'s `onAdded` to the same handlers the existing `onChildAdded` uses — `refetch()` for the dialog's list and `onSaved?.()` so the parent's child-count badge updates behind it.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "AddExistingChildDialog|ChildUnitsDialog"`
Expected: no errors naming either file.

- [ ] **Step 4: Verify in the running app**

Start the dev server in the FOREGROUND (`npm run dev`, port 3000) and check, in the browser:

1. Open a product's `Manage Child Units`, click `+ Add Child Unit` → both choices appear.
2. `Add existing product` → search returns products; the parent itself is not offered.
3. Select a product **with** stock → the amber warning appears and the button reads `Clear stock and add as child`.
4. Confirm → the product appears in the child table, and its stock reads 0.
5. Select a product **without** stock → the button reads `Add as child`, no warning.

If you have no browser tooling, say so plainly in your report and verify as far as you can — do not claim a visual pass you did not perform.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/products/child-units/AddExistingChildDialog.tsx" "app/(app)/products/child-units/ChildUnitsDialog.tsx"
git commit -m "feat: add an existing product as a child unit"
```

---

### Task 5: Per-row Remove and Move

**Files:**
- Modify: `app/(app)/products/child-units/ChildUnitsDialog.tsx`

**Interfaces:**
- Consumes: `reassignParent` (existing), `AddExistingChildDialog` (Task 4, reused as the move picker).
- Produces: nothing.

- [ ] **Step 1: Add the `⋮` menu**

Add a final column to the child table holding a `DropdownMenu` per row (match the trigger the products list uses — a ghost icon button with `MoreVertical`), with two items:

- **Move to another parent** — opens a picker for choosing the new parent, then calls `reassignParent(row.id, newParentId, factor)`. The row is already a child so its stock is zero; the stock warning cannot fire and no `clearStockAndReassign` is needed. Reuse `AddExistingChildDialog`'s search/factor UI rather than writing a second picker — if its props do not fit a "pick a parent for this child" framing, generalise it minimally (e.g. an optional `mode` prop) instead of duplicating the component.
- **Remove from family** — opens a confirm first:

```
Remove <name> from this family?
It becomes a top-level product.
[Cancel] [Remove]
```

  On confirm: `reassignParent(row.id, null, 0)`.

After either action succeeds: toast the result message, `refetch()`, and `onSaved?.()`.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep "ChildUnitsDialog"`
Expected: no errors naming that file.

- [ ] **Step 3: Verify in the running app**

With the dev server running:

1. Open a family with at least one child; each row shows a `⋮` menu.
2. `Remove from family` → confirm appears; on confirm the row leaves the table, the badge count drops, and the product is now top-level in the products list.
3. `Move to another parent` → pick a different parent; the row leaves this family and appears under the other one.

Same honesty rule as Task 4 if you cannot drive a browser.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/products/child-units/ChildUnitsDialog.tsx"
git commit -m "feat: remove and move child units from the dialog"
```

---

### Task 6: Retire ReassignParentDialog

**Files:**
- Modify: `app/(app)/products/view-product/view-product-dialog.tsx:322-337`
- Delete: `app/(app)/products/reassign-parent/reassign-parent-dialog.tsx` (and the directory)

**Interfaces:**
- Consumes: `Product.parentName` (already populated by `getProducts`).
- Produces: nothing.

- [ ] **Step 1: Replace the reassign block**

In `view-product-dialog.tsx`, the block at roughly lines 322-337 wraps `<ReassignParentDialog … />` in a tooltip. Find it by content (`ReassignParentDialog`), not by line number. Remove the whole block along with the now-unused import.

In its place, when the product has a parent, render a read-only line:

```tsx
{product.parentName && (
  <div className="text-sm text-muted-foreground">
    Child of <span className="font-medium text-foreground">{product.parentName}</span>
    {onManageFamily && (
      <Button variant="link" size="sm" className="px-1" onClick={() => onManageFamily(product)}>
        Manage
      </Button>
    )}
  </div>
)}
```

`Manage` must open the **parent's** child-units dialog. The view-product dialog does not own that state, so thread a callback down from whoever renders it (the products page already holds `manageChildrenProduct` / `setManageChildrenProduct` for exactly this). If the parent product object is not to hand, the callback can take the parent's id and let the page resolve it — pick whichever fits the existing wiring, and say which you chose in your report.

- [ ] **Step 2: Delete the retired component**

```bash
git rm -r "app/(app)/products/reassign-parent"
```

- [ ] **Step 3: Confirm nothing else referenced it**

Run: `grep -rn "ReassignParentDialog\|reassign-parent" app/ lib/ --include=*.tsx --include=*.ts`
Expected: no matches outside `tests/`. If a match remains in `app/` or `lib/`, fix that reference before committing.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "view-product-dialog|reassign"`
Expected: no errors naming those.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/products/view-product/view-product-dialog.tsx"
git commit -m "refactor: retire ReassignParentDialog for the child units dialog"
```

---

### Task 7: Rewrite the reassignment E2E

**Files:**
- Modify: `tests/e2e/product-reassign.spec.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

**Read first:** the current `tests/e2e/product-reassign.spec.ts`. It covers attach, move, and detach through the view-product dialog's reassign button — a route Task 6 deleted. **All three behaviours still exist**, so this file is rewritten against the new route, not deleted. Its `fetchParentId` helper and its assertions on resulting parentage carry over unchanged; only the UI steps change.

Also read `tests/e2e/child-units.spec.ts` for the helpers that open the child-units dialog — reuse them rather than writing new ones.

- [ ] **Step 1: Rewrite the three existing tests**

Keep each test's *name* and its `fetchParentId` assertions. Replace the UI steps:

- **Attach** (`admin mo-reassign sa child ngadto sa bag-ong parent`): open the new parent's child-units dialog → `+ Add Child Unit` → `Add existing product` → search the child → set the factor → confirm. Assert `fetchParentId` now returns the new parent.
- **Move**: open the current parent's dialog → the child row's `⋮` → `Move to another parent` → pick the target → confirm. Assert the new parentage.
- **Detach**: open the parent's dialog → the child row's `⋮` → `Remove from family` → confirm. Assert `fetchParentId` returns `null`.

- [ ] **Step 2: Add the stock-clearing flow**

Add one test: pick a fixture product that HAS stock, add it as a child through the new dialog, assert the amber warning is visible, confirm, and then assert both that the product is now a child (`fetchParentId`) **and** that its stock reads 0. This is the user-visible half of Task 3's rollback property.

- [ ] **Step 3: Assert the retired UI is gone**

Add one test: open a child product's view dialog and assert there is no reassign control, and that the `Child of <parent>` line is visible.

- [ ] **Step 4: Reset the test DB and run**

Run: `npm run test:e2e:db`
Then: `npx playwright test tests/e2e/product-reassign.spec.ts --reporter=line`

Expected: all tests in the file pass. Note the pre-existing `auto-fills the factor` test — if you kept an auto-detect test, it may still fail for the same pre-existing reason; say so explicitly rather than quietly deleting it.

If `.next-test` wedges with a Turbopack panic, `rm -rf .next-test` (it is gitignored).

- [ ] **Step 5: Confirm the sibling spec still passes**

Run: `npx playwright test tests/e2e/child-units.spec.ts --reporter=line`
Expected: 6 passed.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/product-reassign.spec.ts
git commit -m "test: cover membership changes through the child units dialog"
```

---

### Task 8: Update project documentation

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Amend the product-families entry**

`CLAUDE.md` has a **Product families in the UI** entry under Key Domain Patterns (added by the previous plan). Extend it so it describes the finished picture:

```markdown
**Product families in the UI** — the products list is a flat list of top-level
products (`parent_id IS NULL`) when unfiltered; children are reached through the
child-units dialog (`app/(app)/products/child-units/`) or by searching, and a
filtered row carries a `↳ parent` badge. There is no inline tree — a recursive CTE
in `getProducts` used to hydrate one and was removed. **All family membership is
edited in that one dialog**: create a new child, add an existing product as a child,
move a child to another parent, or remove one (which makes it top-level again).
`ReassignParentDialog` was retired in favour of it; the view-product dialog now shows
only a read-only "Child of X — Manage" pointer. Every membership change routes through
`reassignParent` in `app/(app)/products/actions.ts`, which owns the cycle guard and the
rule that a product holding stock cannot become a child — `clearStockAndReassign` is the
one path that clears that stock first, in the same transaction, via an audited movement.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: describe child unit membership management"
```

---

## Done When

- An existing product can be added as a child from the child-units dialog, with the stock consequence stated before the click.
- Clearing stock to attach is atomic and audited: a failed attach leaves stock untouched, and a successful one writes a stock movement.
- A child can be removed (becoming top-level) and moved to another parent from the same dialog.
- `ReassignParentDialog` and its directory are gone; the view-product dialog shows a read-only "Child of X — Manage" pointer.
- `reassignParent` still behaves exactly as before, with its guards in one place.
- The search picker excludes the parent and its ancestors, and still offers its descendants.
- `product-reassign.spec.ts` covers attach/move/detach through the new route and passes; `child-units.spec.ts` still passes.
