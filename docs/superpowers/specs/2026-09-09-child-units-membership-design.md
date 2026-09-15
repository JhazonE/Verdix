# Child Unit Membership — Design

**Date:** 2026-09-09
**Status:** Approved, ready for implementation planning
**Builds on:** `2026-09-09-parent-child-reorg-design.md` (shipped — the child-units dialog this extends)

## Problem

The child-units dialog can only *create* a brand-new child. An existing top-level
product cannot be brought into a family from there, so the only way to change a
product's parentage is the `ReassignParentDialog`, reached from a completely
different screen — the view-product dialog of the **child**.

That split has two costs. Family membership is edited in two unrelated places, and
the two work in opposite directions: the dialog adds children from the *parent*, while
reassignment attaches a child from the *child*. A user managing a family has to know
both.

## Goals

- Add an existing product to a family from inside the child-units dialog.
- Remove a child from a family, and move it to a different parent, from the same place.
- Retire `ReassignParentDialog` and its entry point in the view-product dialog.

## Non-goals

- No change to `reassignParent` in `app/(app)/products/actions.ts`. It already carries
  the cycle guard, the stock guard, the conversion-factor upsert, and the detach path.
  Every action here routes through it unchanged.
- No change to family stock sync or to how conversion factors are stored.
- Markup behaviour is untouched.

---

## 1. Why membership changes are guarded

Two existing rules shape this design and must survive it.

**A child may not carry its own stock.** `reassignParent` refuses to attach a product
holding stock (`actions.ts:734`), because a family member's stock is derived from its
parent through `lib/family-sync.ts`. Attaching a product that already has stock would
let the next sync overwrite a real inventory figure.

This matters more here than it did before: "add an existing product" will hit this rule
constantly, since an existing product usually *does* have stock. The design therefore
surfaces the rule rather than hiding it — see §3.

**Detach deliberately leaves `conversion_factors` in place** (`actions.ts:836`). Removing
a child and adding it back keeps its factor. That is existing behaviour and is preserved.

---

## 2. Server actions

`reassignParent(childId, newParentId, conversionFactor)` is reused as-is for three of the
four operations:

| Operation | Call |
|---|---|
| Add existing product (no stock) | `reassignParent(child, parent, factor)` |
| Move to another parent | `reassignParent(child, newParent, factor)` |
| Remove from family | `reassignParent(child, null, 0)` |
| Add existing product (has stock) | `clearStockAndReassign(...)` — new, below |

### New: `clearStockAndReassign(childId, newParentId, conversionFactor)`

Backs the "Clear stock and add as child" confirmation only.

1. Reads the product's current stock.
2. Calls `updateStockAndRecordMovement(childId, -currentStock, 'adjustment', …)` with the
   note `Stock cleared to attach as child of <parent name>`. Stock is zeroed through the
   movement helper, never a bare `UPDATE`, so the change appears in inventory history like
   any other adjustment.
3. Calls `reassignParent(childId, newParentId, conversionFactor)`.

**Both steps share one transaction.** If the attach fails — a cycle, a missing parent —
the stock adjustment rolls back with it. Splitting them would let a user lose inventory
without gaining a child, which is the worst outcome available here.

Returns the same `{ success, message }` shape as `reassignParent`.

---

## 3. UI

### `+ Add Child Unit` becomes two choices

- **Create new** — the existing `QuickAddChildDialog`, unchanged.
- **Add existing product** — a new dialog, below.

### New: `app/(app)/products/child-units/AddExistingChildDialog.tsx`

Three fields.

**Search.** Reuses `buildProductQuery` and `PRODUCT_SEARCH_DEBOUNCE_MS` from
`lib/product-search.ts` — the same whole-catalogue SQL search the reassign picker used, so
a product outside the current page is still reachable.

Results exclude the parent itself and all of its **ancestors**: making an ancestor into a
child of its own descendant is exactly the loop `reassignParent`'s cycle guard rejects.
Note this is the *inverse* of what `getIllegalReassignTargets(childId, …)` computes — that
helper answers "which products may not become this child's parent" (the child plus its
descendants), which is the question the old reassign dialog asked from the child's side.
Here the question is asked from the parent's side, so the walk goes up the `parentId` chain
from the parent rather than down. `lib/product-tree.ts` gains a small pure companion for
this (`getIllegalChildTargets` or equivalent), tested alongside the existing helpers.

Descendants of the parent are *not* excluded: a grandchild being re-attached one level up
is a legitimate move, and `reassignParent` allows it.

**Selected product.** Shows its unit, stock, and cost, so the user can confirm they picked
the right one before committing.

**Conversion factor.** Auto-fills when the parent already has a `conversion_factors` row for
the selected product's unit, with an "Auto-detected" hint — the same logic the reassign
dialog used. Otherwise the user types it.

**The stock guard, surfaced.** When the selected product has stock > 0:

> ⚠️ **Jolly Mushrooms 500g** has **8 Pieces** in stock. Adding it as a child clears that
> stock, because a child's stock is derived from its parent.
>
> `[Cancel]` `[Clear stock and add as child]`

With stock, the confirm button calls `clearStockAndReassign`. Without stock, the button
reads `[Add as child]` and calls `reassignParent`. Either way the consequence is stated
before the click, not reported as an error after it.

### Per-row `⋮` menu in the child table

The table already carries eight columns, so the actions go in a dropdown — the same pattern
the products list uses, rather than two more buttons per row.

- **Move to another parent** — opens the same picker. Only `reassignParent` is needed: the
  row is already a child, so its stock is already zero and the guard cannot fire.
- **Remove from family** — confirms first: *"Remove Jolly Mushrooms 500g from this family?
  It becomes a top-level product."* Then `reassignParent(id, null, 0)`.

After any of these: refetch the dialog's child list, and call `onSaved()` so the parent's
child-count badge updates behind the dialog.

### View-product dialog

The `ReassignParentDialog` block at `view-product-dialog.tsx:322-337` is removed. In its
place, when the product has a parent, a read-only line:

> Child of **Sugar 25kg** — [Manage]

`Manage` opens the parent's child-units dialog. This keeps a path from the child's own view
— a user looking at a child is not stranded — while all real editing stays in one place.

The `app/(app)/products/reassign-parent/` directory is deleted; the view-product dialog was
its only consumer.

---

## 4. Testing

**Unit:**
- `clearStockAndReassign` zeroes stock and attaches in one transaction.
- A failing attach (cycle, missing parent) rolls the stock adjustment back — stock is
  unchanged after the failure. This is the property that makes the combined action safe,
  so it is tested directly rather than inferred.
- The new tree helper excludes the parent and its ANCESTORS, and does NOT exclude its
  descendants (re-attaching a grandchild one level up is legal).

**E2E — `tests/e2e/product-reassign.spec.ts` is rewritten, not deleted.** The three
behaviours it covers (attach, move, detach) all survive this change; only the route to them
moves, from the view-product dialog to the child-units dialog. Rewriting keeps that coverage
and proves the new path works. Its assertions on the resulting parentage (`fetchParentId`)
carry over unchanged.

New/updated flows:
- Add an existing stock-less product as a child; it appears in the table and the badge count rises.
- Add an existing product **with** stock: the warning appears, the confirm clears stock and
  attaches, and the product's stock reads 0 afterward.
- Remove a child; it becomes top-level and leaves the parent's list.
- Move a child to another parent.
- The view-product dialog of a child shows the "Child of X" line and no reassign button.

**Baseline note.** Verification in this repo is red independently of this work: lint is
broken, typecheck has pre-existing errors, `tests/unit/business-date-lock-lifecycle.test.ts`
aborts the unit suite, and four `tests/e2e/products/price-levels.spec.ts` tests fail because
that spec seeds no session. The auto-detect test in `product-reassign.spec.ts` also fails on
pre-branch code. Compare against these before attributing a failure to this work.

---

## Files touched

| File | Change |
|---|---|
| `app/(app)/products/actions.ts` | new `clearStockAndReassign`; `reassignParent` unchanged |
| `app/(app)/products/child-units/AddExistingChildDialog.tsx` | new |
| `app/(app)/products/child-units/ChildUnitsDialog.tsx` | two-choice Add, per-row `⋮` menu |
| `app/(app)/products/child-units/use-child-units.ts` | membership actions + refetch |
| `app/(app)/products/view-product/view-product-dialog.tsx` | drop reassign, add "Child of X" line |
| `app/(app)/products/reassign-parent/` | deleted |
| `tests/e2e/product-reassign.spec.ts` | rewritten against the new route |
| `tests/unit/…` | new coverage per §4 |
