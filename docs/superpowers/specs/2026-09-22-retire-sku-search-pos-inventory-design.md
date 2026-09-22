# Retire `products.sku` — Search, POS, Inventory UI (Sub-project B) — Design Spec

**Date:** 2026-09-22
**Status:** Approved for planning

## Problem

Sub-project A (merged) made `products.sku` a value mirrored from the base
selling unit's barcode on every write — it retired the *field* from
Add/Edit Product's forms, but the DB column itself stays populated so
every file still reading `.sku` today keeps working unmodified.

This sub-project is the first of three (B, C, D per the original design
spec, `docs/superpowers/specs/2026-09-22-retire-product-sku-design.md`)
that migrate those remaining readers off `.sku` and onto the base
selling unit's own barcode directly — not the mirrored value, the real
column (`product_selling_units.barcode` where `is_base = 1`). Mirroring
is a bridge for sub-projects that haven't run yet, not a target to keep
reading from once a sub-project's own turn comes: Sub-project D's final
cleanup drops `products.sku` entirely, so anything still reading it
directly at that point breaks. Reading the base unit's barcode directly
is future-proof against that; reading the mirrored `.sku` is not.

Scope: `lib/product-search.ts` (the shared client-side matcher), POS
(product search, cart, price inquiry, recent-sales detail), the
Products and Inventory listing pages (including their card/row/group
sub-components), the inventory boards (transfer, shelf, bulk
adjustment), and repackaging. Reports (Sub-project C) and bulk
import/export + sales/purchase selectors + e2e tests (Sub-project D)
are explicitly out of scope here.

## Core principle

Every matching, sorting, and display site touched by this sub-project
reads the base selling unit's barcode directly —
`product.sellingUnits?.find(su => su.isBase)?.barcode` — not the
mirrored `.sku` field, and not `products.barcode` (the legacy,
non-unique, per-product column from before selling units existed,
still out of scope per the original spec). `products.barcode` remains
available as a fallback only for the rare case a base unit somehow has
no barcode of its own; it is never the primary source.

**Two barcode columns, same distinction as Sub-project A:**
- `product_selling_units.barcode` (base unit) — the one this sub-project
  reads. Unique across all selling units, required as of Sub-project A.
- `products.barcode` — legacy, optional, non-unique. Untouched, used
  only as a last-resort fallback where noted below.

Every site that changes reads in this priority order:
`product.sellingUnits?.find(su => su.isBase)?.barcode || product.barcode || ''`
(or the equivalent for a non-empty check, `... || '-'`, etc., matching
each site's existing null-handling convention).

## Server-side search is unaffected

`getProducts` in `app/(app)/products/actions.ts` already matches
`p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ? OR EXISTS (...
su.barcode LIKE ?)` — the base unit's barcode is already searchable
server-side via the `EXISTS` subquery. This sub-project does not touch
that query. The gap is entirely in **client-side** re-filtering of an
already-fetched product list (the boards' local search-while-typing,
POS's local cache lookup) and in **display** (columns, labels,
sort keys) — both only look at `.sku`/`.barcode` today, never
`sellingUnits`.

## Cluster 1 — Shared search helper + POS (cashier-facing, highest risk)

**`lib/product-search.ts`:**
- `SearchableProduct` type gains an optional `sellingUnits` field:
  `{ isBase?: boolean; barcode?: string | null }[]`.
- `matchesNormalizedSearch` adds a match branch checking the base
  unit's barcode (`product.sellingUnits?.find(su => su.isBase)?.barcode`)
  alongside the existing name/`.barcode` (legacy) checks. The `.sku`
  branch is dropped.
- `tests/unit/product-search.test.ts` gets new fixtures/assertions for
  the `sellingUnits`-sourced match, and its existing `sku`-based
  assertions are replaced with base-unit-barcode ones.

**`app/(app)/pos/pos-content/use-pos.ts`:**
- `rankMatches`'s `unitBarcodeMatch` check currently excludes the base
  unit (`!u.isBase`) — deliberately, since the top-level `sku`/`barcode`
  checks used to cover it. Once those top-level checks stop reading
  `.sku`, the base unit's barcode needs its own explicit check (not
  folded into the existing extras-only `unitBarcodeMatch`, since the
  base unit is exactly-one-per-product and deserves the same "exact
  code" priority tier the extras get, not the fuzzy "partial" fallback
  tier).
- `matchesProductOrUnitCode` (used for the barcode-scanner-submits-a-full-code
  path) gets the same treatment.
- `p.barcode` (legacy) checks stay as a fallback tier, unchanged in
  spirit — this sub-project doesn't remove fallback safety, only stops
  `.sku` from being a *primary* match source.

**Display-only sites** (`PosCartTable.tsx`, `PriceInquiryDialog.tsx`,
`product-search/ProductSearchDialog.tsx`, `recent-sales/SaleDetailView.tsx`):
replace each `product.sku` (or `unit?.barcode || product.barcode ||
product.sku` style fallback chain) with the base-unit-barcode-first
chain. `SaleDetailView.tsx` is a **historical record** (`it.product?.sku`
reads a *sale line item's* stored product summary, not a live product) —
confirm at implementation time whether that summary snapshot even
carries a `sellingUnits` shape before assuming the same fix pattern
applies; if the sale-item snapshot has no such shape, this site may
need to keep reading whatever field the snapshot actually stores
(likely staying on `.sku`, since it is a historical value, not a live
lookup) rather than being force-fit into the pattern.

## Cluster 2 — Products + Inventory listing pages

**`app/(app)/products/page.tsx`:** the table currently renders two
separate columns, "SKU" (`product.sku`) and "Barcode" (`product.barcode`,
legacy, frequently empty). Consolidate to one "Barcode" column reading
the base-unit-barcode-first chain; drop the redundant legacy-only
column.

**`app/(app)/inventory/page.tsx` + `ProductTableRowGroup.tsx` +
`CondensedProductRow.tsx` + `ProductCard.tsx`:** same duplicate-column
problem, same consolidation. `ProductTableRowGroup.tsx` has this in
**two places** (the parent row and the child/family row inside the
expandable group) — both change. `CondensedProductRow.tsx`'s
"SKU: {sku} | BC: {barcode}" single-line format becomes a single
"Barcode: {value}" line. `ProductCard.tsx`'s two-line "SKU:" +
conditional "BC:" becomes one conditional "Barcode:" line.

**`app/(app)/inventory/use-inventory-page.ts` + `page.tsx`'s sort
control:** `sortBy: 'name' | 'stock' | 'sku'` → rename the `'sku'`
member and its `SelectItem` label to `'barcode'`/"Barcode"; the sort
comparator (`a.sku.localeCompare(b.sku)`) reads the base-unit-barcode
chain instead. `a.sellingUnits?.find(su => su.isBase)?.barcode` can be
undefined for a service product (no selling units) — the comparator
must handle that without throwing (`??` to an empty string, matching
`localeCompare`'s existing tolerance for empty strings).

## Cluster 3 — Boards (transfer, shelf, bulk adjustment)

`transfer-board/source-pane.tsx`, `shelf-board/ShelfBoard.tsx`,
`bulk-adjustment/adjustment-mobile-card.tsx`,
`bulk-adjustment/adjustment-table-row.tsx`,
`bulk-adjustment/search-results-dropdown.tsx`: each has its own
inline `product.sku` / `product.barcode || product.sku` display line
(distinct from the *matching* logic already covered by Cluster 1's
`lib/product-search.ts` fix, which these boards already call) —
replace with the base-unit-barcode-first chain. Placeholder text
("Search name, SKU or barcode...") becomes "Search name or barcode..."
since there is conceptually one code now, not two.

## Cluster 4 — Repackaging + misc

`repackaging/actions.ts`'s SQL (`sp.sku AS source_sku`, `tp.sku AS
target_sku`) is a server-side query building a source/target product
summary for the repackaging UI — change to select the base unit's
`barcode` via the same join pattern `getProducts` already uses
elsewhere in `actions.ts`, aliased consistently.
`consolidation-form.tsx` and `repackaging-form.tsx` (both display-only,
reading `p.sku`/`selectedSource.sku`/`selectedTarget.sku`) follow the
renamed field. `stock-transfer-dialog/StockTransferDialog.tsx`'s
"SKU / Barcode:" label and `product.sku || product.barcode || 'N/A'`
fallback becomes "Barcode:" and the base-unit-first chain.

## Testing

- `tests/unit/product-search.test.ts` is updated in place (existing
  file, not a new one) — its `sku`-based fixtures/assertions become
  base-unit-barcode ones, and a new assertion confirms a product with
  `sellingUnits: [{ isBase: true, barcode: '...' }]` and no top-level
  `.sku` still matches by barcode.
- No other automated test in this repo covers the touched display
  components or the POS ranking logic directly. `tests/e2e/purchase-order.spec.ts`
  (the one e2e spec Sub-project A relied on) does not touch Products,
  Inventory, or POS pages, so it is unaffected and not part of this
  sub-project's verification — no e2e test needs to be run as part of
  this plan, only the unit test above plus manual verification.
- Manual verification: this environment has DB access (confirmed
  working during Sub-project A). Sub-project A's final review found
  this dataset currently has **zero** products where the base unit's
  barcode diverges from `products.sku`/`products.barcode` — every value
  agrees today, so a query alone cannot prove a fix reads the *right*
  column versus one that merely happens to agree. The implementation
  plan must include a step that deliberately edits one test product's
  base-unit barcode directly in the DB (`UPDATE product_selling_units
  SET barcode = '<distinct-test-value>' WHERE ...`) without touching
  `products.sku`/`products.barcode`, then confirms the touched UI
  actually displays/matches `<distinct-test-value>` — only a real
  divergence proves the fix reads the intended column.

## Out of scope (unchanged from the original spec)

- `products.barcode` (legacy column) — untouched, used only as a
  fallback per the priority order above.
- `supplier_product_mapping.supplier_sku` — untouched.
- Reports (Sub-project C), bulk import/export, sales/purchase product
  selectors, e2e test files (Sub-project D).
- Dropping `products.sku` itself — still deferred to the final cleanup
  after Sub-project D.
