# Retire `products.sku`, Use the Base Selling Unit's Barcode — Design Spec

**Date:** 2026-09-22
**Status:** Approved for planning

## Problem

`products.sku` and `product_selling_units.barcode` are two separate
identifiers doing overlapping jobs. `sku` is required, manually or
randomly generated, and unique per `(sku, warehouse_id)`. Barcode is
optional per selling unit, unique across all selling units, and is what a
physical scan actually resolves against. Staff have to think about two
codes per product where conceptually there should be one.

Separately, `supplier_product_mapping.supplier_sku` (added by the recent
supplier-mapping consolidation work) already exists to record a
*supplier's own* catalog code for an item — that is not the same concept
as a product-wide identifier and is not part of this change.

**Decision:** Retire `products.sku` entirely. The base selling unit's
barcode (`product_selling_units` row with `is_base = 1`) becomes the one
identifier the system searches, matches, and displays where `sku` is used
today. Supplier SKU stays exactly as it is now — a per-supplier,
optional, display-only field on the Suppliers tab, never used as a
product-wide key.

## Two barcode columns — do not confuse them

There are two different `barcode` columns in this schema and this project
touches only one of them:

- `product_selling_units.barcode` — per selling unit, **UNIQUE** across
  all selling units (migration 118). This is the one becoming the
  required, generated-by-default identifier on the base unit row. This is
  what POS scanning, the Selling Units tab, and everything built by the
  prior supplier-mapping-consolidation work already treats as
  authoritative.
- `products.barcode` — a legacy, optional, non-unique column from the
  original schema (migration 001), predating selling units. Several call
  sites (`actions.ts`, `MySqlProductRepository.ts`) already carry comments
  noting it is stale and that the real barcode lives on
  `product_selling_units` now. This column is **out of scope** — it is
  not being repurposed, migrated into, or read from by this work. A
  future cleanup may drop it, but that is not part of this plan.

## Scope of impact

`products.sku` is read or written in 96 files today: product forms,
`actions.ts` / `MySqlProductRepository.ts`, POS search/cart/price-inquiry,
inventory pages (cards, table rows, transfer, repackaging, bulk
adjustment, shelf board), 9 report pages + their API routes, bulk
price-list import/export, sales invoice/order product selectors, purchase
order product selector, and ~11 e2e test files.

This is decomposed into four sequential sub-projects, each independently
plannable and shippable. `products.sku` stays in the database and keeps
working exactly as it does today until the final sub-project drops it —
no sub-project leaves the app in a broken state.

## Sub-project A — Schema + Core Forms (this plan)

**Goal:** Make the base unit's barcode a required, auto-generated,
unique-guaranteed field; remove the SKU field from Add/Edit Product;
backfill barcodes for any pre-existing product whose base unit doesn't
have one yet. `products.sku` is *not* dropped in this sub-project — it
keeps being written (mirrored from the barcode) so every file that still
reads it in sub-projects B–D keeps working unmodified until its own turn.

- **Migration:**
  1. Backfill: for every product whose base selling unit has a `NULL` or
     empty `barcode`, set that barcode to the product's own current `sku`
     value (already unique, so this can't collide with an existing
     barcode — the pre-migration invariant is that `sku` values and
     `product_selling_units.barcode` values are drawn from disjoint
     "already assigned" pools, since nothing currently writes a selling
     unit's barcode from a product's sku). Products with duplicate `sku`
     across warehouses (allowed under the composite unique index) are
     flagged and logged rather than silently deduplicated — this needs a
     human decision per case, made before the migration is run in
     production, not resolved automatically by the migration itself.
  2. No `NOT NULL` constraint is added at the DB column level (keeping the
     column nullable avoids a hard migration failure if step 1's backfill
     logic ever misses a row) — "required" is enforced at the application
     layer (zod schema + `actions.ts`/`CreateProductUseCase` validation),
     matching how this codebase already enforces sku's "required" rule
     today (the column itself has no `NOT NULL` beyond the unique index).
- **`lib/sku.ts`**: keep the file (rename is optional, low-value churn) but
  stop calling it for the top-level SKU. The base unit's default-barcode
  generator uses the existing `generateBarcode()` already implemented in
  both product forms (EAN-8: 7 random digits + 1 check digit) — that
  function already exists specifically to produce a scannable barcode, so
  it is the generator used by default, not `lib/sku.ts`'s
  brand/name-based format. The implementation plan confirms this call
  site by file/line before wiring it in.
- **Add Product form**: remove the SKU field from Basic Info. Base unit's
  Barcode field (Selling Units tab) becomes required
  (`z.string().min(1, 'Barcode is required')`), pre-filled by the existing
  EAN-8 `generateBarcode()` the moment the dialog opens for a new product
  (mirrors the existing guarded-suggestion-effect pattern already used for
  markup/cost), still user-editable.
- **Edit Product form**: same schema change. For a product with no
  existing barcode on its base unit (only reachable for data the
  migration's backfill step flagged rather than fixed), the field opens
  blank and required — the user must supply one before saving, same as
  any other newly-required field.
- **`actions.ts` / `CreateProductUseCase` (`MySqlProductRepository.ts`)**:
  stop reading `formData.sku` for the insert; `products.sku` is written
  from the base unit's barcode value instead (keeping the column in sync,
  not removing the write) so sub-projects B–D's still-`sku`-reading code
  keeps seeing a value that matches the barcode. `updateProduct` gets the
  same mirroring on edit.

**Explicitly not in this sub-project:** `lib/product-search.ts`, any
report, bulk price-list import/export, sales/purchase product selectors,
e2e tests, and dropping the `products.sku` column itself. Those are
sub-projects B, C, D, and a final cleanup step after D, respectively.

## Sub-project B — Search, POS, Inventory UI

`lib/product-search.ts`'s name/SKU/barcode matcher drops the SKU branch
(barcode across all selling units already covers it, since `sku` is now
always mirrored from the base unit's barcode by Sub-project A). POS
product search, cart, price inquiry, inventory pages (ProductCard, table
rows, transfer, repackaging, bulk adjustment, shelf board), and the
Products page's own listing/table swap their "SKU" column label and data
source for the base unit's barcode.

## Sub-project C — Reports

The ~9 report pages (`sales/by-product`, `purchases/by-product`,
`profit-margin`, `top-sales`, `top-volume`, `velocity`, `expiring-soon`,
`cost-vs-retail`, `batch-profit`) and their API routes rename their "SKU"
column to "Barcode" and source it from the base unit's barcode instead of
`products.sku`.

## Sub-project D — Bulk Import/Export + Sales/Purchase Selectors

`lib/price-list-import.ts`'s Excel template and matching logic
(`maps.bySku` → `maps.byBarcode`) switch to barcode-based matching. The
data-management CSV export/import (`app/api/data-management/*`) drops its
`sku` column. Add Invoice/Order and Purchase Order product selectors
switch their displayed/searched code to barcode. The ~11 e2e test files
referencing `sku` are updated to barcode-based fixtures and assertions.

**Final cleanup (after D, not its own sub-project):** once no file reads
`products.sku`, drop the column and its composite unique index in one
small migration.

## Out of scope for all four sub-projects

- `products.barcode` (the legacy per-product column) — untouched.
- `supplier_product_mapping.supplier_sku` — untouched; stays exactly as
  shipped in the supplier-mapping consolidation work (optional,
  per-mapping, display-only on the Suppliers tab).
- BIR-format sales invoice numbering (`sales_invoice_number`) — unrelated
  numbering scheme, not touched by this change.
- Printed receipts — already don't print SKU today (confirmed by
  inspection of `lib/receipt-generator.ts`); no receipt-format change
  needed.
