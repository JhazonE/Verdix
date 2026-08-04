# Bulk Price Update Drawer — Product Search Design

**Date:** 2026-08-04
**Status:** Approved

## Problem

The "Bulk Update Price" drawer's manual product-selection table (built in
Task 9 of the bulk price update feature, merged 2026-08-04) fetches up to
500 products for the selected warehouse with no way to filter them. For any
warehouse with more than 500 SKUs, products past the first 500
(`getProducts`'s default `created_at DESC` order) are unreachable in the
picker. This was a known, deliberately deferred limitation from that
feature's final review — this spec closes it.

## Goal

Add a search box to the drawer's product table that filters by SKU,
barcode, or product name, matching the existing search UX already used on
the Products page.

## Non-Goals

- No changes to the Excel upload path (`UploadPriceListDialog.tsx`) — it
  already does its own per-row SKU/barcode matching against the full
  warehouse, unaffected by the drawer's 500-row picker limit.
- No new API routes, server actions, or DB schema changes.
- No change to how "select all" or existing selections behave beyond what
  falls out naturally from filtering the displayed list (see Data Flow).

## Architecture

Reuse `getProducts`'s existing `filters.search` support
(`app/(app)/products/actions.ts:100-104`: `name LIKE ? OR sku LIKE ? OR
barcode LIKE ?`) — the same mechanism the Products page's own search box
already uses. This is a server-side, debounced re-query, not a client-side
filter of the already-fetched list — so it also fixes the >500-SKU
reachability gap as a side effect, since a search re-queries the DB
directly instead of filtering whatever the initial unfiltered fetch
happened to include.

## Components

- **`app/(app)/products/bulk-price-update/use-bulk-price-update.ts`**
  (modify): add a `searchTerm` state + `setSearchTerm`, debounce it with
  the existing `useDebounce` hook (`hooks/use-debounce.ts`, 500ms — same
  delay as the Products page), and include it in the `getProducts` call's
  filter object and the TanStack Query `queryKey` (so the query re-fires on
  search change, same as it already does on warehouse change). Reset
  `searchTerm` to `''` whenever `warehouseId` changes.
- **`app/(app)/products/bulk-price-update/BulkPriceUpdateDrawer.tsx`**
  (modify): render a search `Input` above the product-selection table,
  styled identically to the Products page's search box
  (`app/(app)/products/page.tsx:470-478` — `Search` icon from
  `lucide-react`, `type="search"`, same placeholder style, adapted text to
  "Search products...").

## Data Flow

1. User selects a warehouse → product query fires with `{ warehouse }`
   (unchanged from today).
2. User types in the new search box → `searchTerm` updates → debounced
   500ms → query re-fires with `{ warehouse, search: debouncedSearchTerm }`
   → `bp.products` becomes the server-filtered list.
3. The product-selection table renders `bp.products` as it already does —
   no table-rendering logic changes, since it always rendered whatever the
   hook returned.
4. Selection (`selectedIds: Set<string>`) is keyed by product ID and is
   already independent of what's currently fetched/displayed. Selecting
   products, then searching (which changes the displayed set), then
   clearing the search does not lose prior selections — this requires no
   new code, it's how the existing `Set`-based selection already behaves.
5. "Select all" (`selectAll(bp.products.map(p => p.id))`) already operates
   on whatever `bp.products` currently is — with a search active, "select
   all" naturally selects all current search matches, which is the
   intuitive behavior and requires no code change beyond what's described
   above.

## Error Handling

No new failure modes — this reuses `getProducts`'s existing query path,
which already has its own error handling (unchanged). An empty search
result renders the existing empty-table state (no products = no rows),
matching what already happens for a warehouse with zero products.

## Testing

- Manual verification in the browser (per this project's existing
  convention for this feature's UI tasks): select a warehouse, confirm the
  full (up to 500) list appears, type a known SKU/barcode/partial product
  name, confirm the table narrows to matching products only, confirm a
  prior checkbox selection survives a search-then-clear round-trip, confirm
  switching warehouses clears the search box.
- No new unit-testable logic (no new pure functions) — this is UI wiring
  onto an already-tested server action. No new E2E test is required for
  this narrow addition; the existing `bulk-price-update.spec.ts` drawer
  tests are unaffected since they don't search.
