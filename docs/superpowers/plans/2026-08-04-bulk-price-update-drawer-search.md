# Bulk Price Update Drawer Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a debounced search box to the Bulk Update Price drawer's product-selection table, filtering by SKU, barcode, or product name.

**Architecture:** Reuse `getProducts`'s existing `filters.search` support (already does `name LIKE ? OR sku LIKE ? OR barcode LIKE ?`) via a new debounced `searchTerm` state in `use-bulk-price-update.ts`, included in the TanStack Query `queryKey` so it re-fires the same way the existing `warehouseId` change already does. UI is a single search `Input`, styled identically to the Products page's own search box.

**Tech Stack:** Next.js 16 (App Router, client components), TanStack Query, `hooks/use-debounce.ts` (existing), shadcn/ui `Input`, `lucide-react` `Search` icon.

## Global Constraints

- No new database tables, API routes, or server actions — this reuses `getProducts`'s existing `search` filter (`app/(app)/products/actions.ts:100-104`) unchanged.
- Debounce delay is 500ms, matching the Products page's own search box (`app/(app)/products/page.tsx:336`).
- Search resets to empty whenever the warehouse selection changes.
- Product checkbox selection (`selectedIds: Set<string>`) must survive a search-then-clear round-trip — this falls out of the existing `Set`-based implementation with no extra code, do not add any selection-clearing logic tied to search changes.
- Follow existing house style: `'use client'` files, no new dependencies.

---

### Task 1: Add debounced search to the Bulk Update Price drawer

**Files:**
- Modify: `app/(app)/products/bulk-price-update/use-bulk-price-update.ts`
- Modify: `app/(app)/products/bulk-price-update/BulkPriceUpdateDrawer.tsx`
- Test: manual (Step 5)

**Interfaces:**
- Consumes: `getProducts(limit, offset, filters)` where `filters.search?: string` (existing, `app/(app)/products/actions.ts:65`, `:100-104`); `useDebounce<T>(value: T, delay: number): T` (existing, `hooks/use-debounce.ts:9`).
- Produces: `useBulkPriceUpdate` now also returns `searchTerm: string` and `setSearchTerm: (v: string) => void` in its return object, consumed by the drawer's new search `Input`. The existing `setWarehouseId` key in the return object now also clears `searchTerm` as a side effect — no signature change, callers (the drawer) need no changes for that part.

- [ ] **Step 1: Add debounced search state to the hook**

In `app/(app)/products/bulk-price-update/use-bulk-price-update.ts`, add the import (after the existing `useToast` import on line 8):

```ts
import { useToast } from '@/hooks/use-toast';
import { useDebounce } from '@/hooks/use-debounce';
```

Replace the `warehouseId` state declaration (currently line 13: `const [warehouseId, setWarehouseId] = useState<string>('');`) with:

```ts
  const [warehouseId, setWarehouseIdState] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const debouncedSearchTerm = useDebounce(searchTerm, 500);

  // Switching warehouses starts a fresh product list — a stale search term
  // from the previous warehouse would otherwise silently filter it.
  const setWarehouseId = (id: string) => {
    setWarehouseIdState(id);
    setSearchTerm('');
  };
```

- [ ] **Step 2: Wire the debounced search term into the product query**

Replace the existing `useQuery` block (currently lines 23-27):

```ts
  const { data: products, isLoading } = useQuery({
    queryKey: ['bulk-price-update-products', warehouseId],
    queryFn: () => getProducts(500, 0, { warehouse: warehouseId || undefined }),
    enabled: !!warehouseId,
  });
```

with:

```ts
  const { data: products, isLoading } = useQuery({
    queryKey: ['bulk-price-update-products', warehouseId, debouncedSearchTerm],
    queryFn: () => getProducts(500, 0, { warehouse: warehouseId || undefined, search: debouncedSearchTerm || undefined }),
    enabled: !!warehouseId,
  });
```

- [ ] **Step 3: Return the new search state from the hook**

In the hook's `return` statement (currently lines 91-100), add `searchTerm, setSearchTerm,` right after the `warehouseId, setWarehouseId,` line:

```ts
  return {
    warehouseId, setWarehouseId,
    searchTerm, setSearchTerm,
    products: products || [], isLoading,
    selectedIds, toggleSelected, selectAll, clearSelection,
    targetField, setTargetField,
    priceLevelId, setPriceLevelId, priceLevelName, setPriceLevelName,
    adjustmentType, setAdjustmentType,
    adjustmentValue, setAdjustmentValue,
    preview, isSubmitting, submit,
  };
```

- [ ] **Step 4: Add the search input to the drawer UI**

In `app/(app)/products/bulk-price-update/BulkPriceUpdateDrawer.tsx`, add `Search` to the `lucide-react` import (add this import line after the existing `Label` import on line 9):

```ts
import { Label } from '@/components/ui/label';
import { Search } from 'lucide-react';
```

Insert a search box right before the product-selection table's wrapping `<div>` (currently line 137, `<div className="border rounded-lg max-h-64 overflow-y-auto">` that contains the checkbox/Product/SKU table — the one immediately after the Value/Target-Markup `Input` block ending at line 135):

```tsx
              <div className="relative">
                <Search className="absolute left-3 top-[0.65rem] h-4 w-4 text-muted-foreground" />
                <Input
                  type="search"
                  placeholder="Search products by SKU, barcode, or name..."
                  className="pl-9"
                  value={bp.searchTerm}
                  onChange={(e) => bp.setSearchTerm(e.target.value)}
                />
              </div>

              <div className="border rounded-lg max-h-64 overflow-y-auto">
```

(The rest of that table block — `<Table>` through its closing `</div>` at line 161 — is unchanged; only the new search `<div>` is inserted immediately above it.)

- [ ] **Step 5: Manual verification in the browser**

Run `npm run dev`, open `/products`, click "Bulk Update Price", select a warehouse with several products. Confirm:
1. The full product list (up to 500) appears with no search text entered.
2. Typing a known product's SKU, barcode, or partial name into the new search box narrows the table to matching products only, after a brief debounce pause.
3. Select a product's checkbox, then type a search term that filters it out of view, then clear the search box — the checkbox is still checked when the product reappears (selection survives the round-trip).
4. Switch to a different warehouse — the search box clears itself and the full product list for the new warehouse appears.
5. Clear the search box entirely — the full list for the current warehouse reappears.

- [ ] **Step 6: Commit**

```bash
git add app/(app)/products/bulk-price-update/use-bulk-price-update.ts app/(app)/products/bulk-price-update/BulkPriceUpdateDrawer.tsx
git commit -m "feat: add product search to Bulk Update Price drawer"
```

---

## Self-Review Notes

- **Spec coverage:** search box filtering by SKU/barcode/name (spec's Goal, Components) — Task 1 Steps 1-4; server-side re-query fixing >500-SKU reachability (spec's Architecture) — Task 1 Step 2, since `search` re-queries the DB directly rather than filtering the capped client-side list; search resets on warehouse change (spec's Data Flow #1) — Task 1 Step 1's `setWarehouseId` wrapper; selection survives search changes (spec's Data Flow #4) — verified in Step 5.3, no code needed since `selectedIds` is untouched by this change; "select all" operates on current search matches (spec's Data Flow #5) — no code change needed, `selectAll(bp.products.map(...))` already operates on whatever `bp.products` currently is. Excel upload path is explicitly out of scope per the spec's Non-Goals and is untouched by this plan.
- **Type consistency:** `searchTerm: string` / `setSearchTerm: (v: string) => void` are defined once in Task 1 Step 1 and consumed once in Task 1 Step 4 — same names, no drift. `getProducts`'s `filters.search` and `useDebounce`'s signature are pre-existing and used exactly as declared in the codebase (verified against `app/(app)/products/actions.ts` and `hooks/use-debounce.ts` before writing this plan).
