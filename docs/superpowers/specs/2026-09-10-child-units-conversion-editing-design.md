# Child Units: Conversion Editing (and Markup Removal) — Design

**Date:** 2026-09-10
**Status:** Approved, ready for implementation planning
**Builds on:** `2026-09-09-parent-child-reorg-design.md` and `2026-09-09-child-units-membership-design.md` (both shipped)

## Problem

The child-units dialog edits the wrong number.

It was built to tune **markup** per child, but markup is not what a user manages when
they open a family. The number that matters there is the **conversion factor** — how
many child units make one parent unit — and that is exactly the number the dialog
shows read-only. A factor mistyped when the child was created (24 instead of 25) can
only be corrected by detaching the child and adding it back.

Markup, meanwhile, is better set where a product's other pricing lives: the Edit
Product form, which already resolves and displays it.

## Goals

- Remove markup editing from the child-units dialog.
- Make the conversion factor editable in its place.
- The Save button is always enabled — a user may save with nothing entered, or with
  some rows left blank.

## Non-goals

- **The per-product markup feature is NOT removed.** `products.markup_percentage`, the
  resolver override in `lib/purchase-utils.ts`, the `updateChildMarkups` action, and the
  Edit Product form's markup hint all stay exactly as they are. Only the dialog's markup
  UI goes away. Any markup already saved keeps working.
- No change to how family stock sync consumes conversion factors.
- No change to membership actions (add existing, move, remove).

---

## 1. What is removed, and what deliberately stays

**Removed from `ChildUnitsDialog.tsx` / `use-child-units.ts`:**
the `Markup %` and `Suggested` columns; the markup draft state (`drafts`, `draftValue`,
`isRowValid`, `hasChanges`, `allValid`); the `inheritedFor` and `suggestedPrice` helpers;
and the `Save Markups` button.

**Deliberately kept, untouched:**

| Kept | Why |
|---|---|
| `products.markup_percentage` column | Dropping it would destroy any markup already saved |
| The resolver override in `lib/purchase-utils.ts` | Still the highest-precedence markup source |
| `updateChildMarkups` server action | Still correct; simply no longer called from the dialog |
| `lib/markup-validation.ts` | Consumed by `updateChildMarkups` |
| The markup unit tests | They cover the resolver and validation, not the dialog |
| The Edit Product markup hint | This is where per-product markup is set from now on |

A user who wants a per-product markup sets it in Edit Product. Nothing that already
works stops working.

---

## 2. The shared-factor constraint

`conversion_factors` is keyed `UNIQUE (product_id, unit)` — verified against the live
schema — and rows are stored on the **PARENT**, keyed by the **child's unit of measure**.
`lib/family-sync.ts` reads them that way (`WHERE product_id = ? AND unit = ?`).

**Consequence: two children of the same parent that share a unit of measure share ONE
factor row.** Editing one edits the other. There is no per-child factor to edit.

This is a real property of the existing data model, not something this work introduces,
and the design must not pretend otherwise. No such case exists in the current database
(checked), but the schema permits it.

**The dialog therefore tells the truth about it.** When two or more rows share a unit,
each shows a quiet note beside its factor — `shared with 1 other unit` — and editing
either updates both rows in the table live, before saving, so the link is visible rather
than discovered afterward.

The alternative — silently letting one edit change a number the user did not touch — is
rejected. A user correcting a factor must be able to see what else they are changing.

---

## 3. Conversion editing

**Columns after this change:** Name · Unit · **Conversion (editable)** · Stock · Cost ·
Current Price · `⋮`

**The input.** A number input per row, pre-filled with the current factor, blank when the
child has none. Blank means "no factor set" and saves as no row — it does not mean zero.
Valid values are greater than 0; `0` and negatives are rejected inline, because a factor
of zero would make a family member's synced stock always zero.

**Save.** The button reads `Save Conversions` and is **always enabled**, per the explicit
requirement. Clicking it with no changes performs no writes and closes — it never blocks
the user or reports an error for having changed nothing. Rows that are unchanged are not
written.

**Stock is not recomputed.** Changing a factor affects future family syncs only; it does
not retroactively adjust stock that was already synced under the old factor. The dialog
states this beneath the table, because a user correcting 24 to 25 may reasonably expect
existing quantities to move, and they will not.

### Server action

```
updateChildConversions(
  parentId: string,
  rows: { unit: string; factor: number | null }[]
): Promise<{ success: boolean; message: string }>
```

Keyed by **unit**, not by child id — matching how the data is actually stored, and making
the shared-factor behaviour explicit in the signature rather than hidden behind a
per-child illusion.

- One transaction via `withTransaction`.
- A numeric factor upserts: `INSERT … ON DUPLICATE KEY UPDATE factor = VALUES(factor)`,
  which the existing `unique_product_unit` key makes idempotent — the same statement
  `reassignParent` already uses.
- A `null` factor deletes that `(parentId, unit)` row.
- Validation before the transaction opens: every factor is `null` or a finite number
  `> 0`. One invalid row rejects the whole batch, so there is nothing partial to undo.

---

## 4. Testing

**Unit:**
- A factor `> 0` is accepted; `0`, a negative, and a non-finite value are rejected.
- `null` deletes the row rather than writing `0` — the two must not collapse.
- An invalid row rejects the batch and writes nothing.
- Two children sharing a unit produce ONE upsert, not two conflicting ones.

**E2E (`tests/e2e/child-units.spec.ts`, updated):**
- The dialog shows no `Markup %` or `Suggested` column and no `Save Markups` button.
- Editing a conversion factor and saving persists it across a reload.
- `Save Conversions` is enabled with nothing changed, and clicking it closes the dialog
  without error.
- A factor of `0` shows an inline error and is not saved.

The existing markup unit tests are **not** touched — they cover the resolver and
validation, which this work does not change.

**Baseline note.** Verification here is red independently of this work: lint is broken,
typecheck has pre-existing errors, `tests/unit/business-date-lock-lifecycle.test.ts:67`
aborts the unit suite, and four `tests/e2e/products/price-levels.spec.ts` tests fail
because that spec seeds no session. Compare against this before attributing a failure to
this change.

---

## Files touched

| File | Change |
|---|---|
| `app/(app)/products/child-units/ChildUnitsDialog.tsx` | drop markup columns/save; editable Conversion; shared-unit note; stock caveat |
| `app/(app)/products/child-units/use-child-units.ts` | drop markup drafts/helpers; add conversion drafts + save |
| `app/(app)/products/actions.ts` | new `updateChildConversions`; `updateChildMarkups` left in place |
| `tests/e2e/child-units.spec.ts` | markup assertions → conversion assertions |
| `tests/unit/…` | new coverage for `updateChildConversions` |
