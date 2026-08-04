# Stop Auto-Recalculating Price-Level Rows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the Add/Edit Product cost-change effect from overwriting every existing price-level row's price on every Cost/Category/Brand/Supplier change, while keeping the main `price` field's auto-suggestion and the one-time per-row suggestion that fires when picking a level from a row's dropdown.

**Architecture:** Delete the "Apply to all price levels" block from the shared-shape effect in both `use-add-product-form.ts` and `use-edit-product-form.ts`. Nothing else in either effect changes.

**Tech Stack:** Next.js 16, react-hook-form (`useFieldArray`, `form.setValue`).

## Global Constraints

- The main `price` field's auto-suggestion-from-cost+markup (the `form.setValue('price', ...)` line, and everything computing `suggestedMainPrice`) is unchanged in both files — do not touch it.
- The one-time suggestion in `price-levels-tab.tsx`'s `onValueChange` (both Add and Edit Product variants) is a separate code path — do not touch either tab file.
- No new tracking of "manually edited" state per row — this is a straight deletion, not a conditional.
- No changes to `lib/price-level-calc.ts`, `calculateSuggestedPrice`, or `calculatePriceLevelPrice` — the formulas are unaffected.

---

### Task 1: Remove the price-level-row recalculation loop from both forms

**Files:**
- Modify: `app/(app)/products/add-product/use-add-product-form.ts`
- Modify: `app/(app)/products/edit-product/use-edit-product-form.ts`
- Test: manual (Step 3)

**Interfaces:**
- None — this is a deletion within an existing `useEffect`; no exported signatures change in either file.

- [ ] **Step 1: Remove the block from `add-product/use-add-product-form.ts`**

Inside the `useEffect` that computes `suggestedMainPrice` (currently ~lines 291-316), delete the "Apply to all price levels" block, leaving `form.setValue('price', ...)` as the last statement inside `if (watchedCost && watchedCost > 0)`:

```ts
    if (source) {
      setMarkupSource(`Calculated from ${source} Markup (${markup}%)`);
      if (watchedCost && watchedCost > 0) {
          // Calculate base price and default level price
          const defaultLevel = priceLevels.find((l: any) => l.isDefault) || priceLevels[0];
          const suggestedMainPrice = calculateSuggestedPrice(watchedCost, markup, 0, defaultLevel);

          form.setValue('price', parseFloat(suggestedMainPrice.toFixed(2)));
      }
    } else {
      setMarkupSource(null);
    }

  }, [watchedCost, watchedCategoryName, watchedSubcategoryName, watchedBrandName, watchedSupplierId, categories, subcategories, brands, suppliers, form, priceLevels, systemSettings]);
```

(The `// Apply to all price levels` comment, the `if (priceLevels.length > 0) { ... priceLevels.forEach(...) ... }` block, and the blank line that separated it from `form.setValue('price', ...)` are all removed. The effect's dependency array is unchanged — `priceLevels` stays in it because `defaultLevel` still reads from it.)

- [ ] **Step 2: Remove the equivalent block from `edit-product/use-edit-product-form.ts`**

Same change, same surrounding structure (currently ~lines 265-280):

```ts
    if (source) {
      setMarkupSource(`Calculated from ${source} Markup (${markup}%)`);
      if (watchedCost && watchedCost > 0) {
          // Calculate base price and default level price
          const defaultLevel = priceLevels.find((l: any) => l.isDefault) || priceLevels[0];
          const suggestedMainPrice = calculateSuggestedPrice(watchedCost, markup, 0, defaultLevel);

          form.setValue('price', parseFloat(suggestedMainPrice.toFixed(2)));
      }
    } else {
      setMarkupSource(null);
    }
  }, [watchedCost, watchedCategoryName, watchedSubcategoryName, watchedBrandName, selectedSupplierId, categories, subcategories, brands, suppliers, form, priceLevels, systemSettings, isInitialized]);
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: no new errors in either file (pre-existing baseline errors in unrelated files are expected — see the project's documented baseline).

- [ ] **Step 4: Manual verification in the browser**

Run `npm run dev`. For **both** Add Product and Edit Product (use an existing product for the Edit case):
1. Set a Cost value. Confirm the main "Price" field still auto-updates from cost+markup (unchanged behavior).
2. Add a price-level row (pick any level from the dropdown) — confirm it still gets an initial suggested price (the one-time dropdown-pick suggestion still works).
3. Manually type a different value into that row's price field.
4. Change the Cost value again (or Category/Brand, whichever is configured to drive automatic markup in this environment).
5. Confirm the price-level row's manually-typed value is **unchanged** — it must not revert to a recomputed value. Confirm the main Price field **did** update in the same step.

- [ ] **Step 5: Commit**

```bash
git add app/(app)/products/add-product/use-add-product-form.ts app/(app)/products/edit-product/use-edit-product-form.ts
git commit -m "fix: stop auto-recalculating existing price-level rows on cost/category/brand change"
```

---

## Self-Review Notes

- **Spec coverage:** the design's Architecture (delete the loop, keep the main-price suggestion, keep the dropdown-pick suggestion) is the entirety of Task 1 — a one-task plan matches a one-change design. Both files named in the design's Architecture section are covered.
- **Type consistency:** N/A — no new types, functions, or signatures introduced or changed; this is a deletion within an existing effect body in both files.
