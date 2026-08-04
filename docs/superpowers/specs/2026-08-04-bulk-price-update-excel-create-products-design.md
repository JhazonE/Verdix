# Bulk Price Update — Lean Template + Auto-Create Missing Products — Design

**Date:** 2026-08-04
**Status:** Approved

## Problem

1. "Download Template" currently dumps every product in the selected
   warehouse (up to 500) as pre-filled rows — a heavy file when the intent
   is just to show the expected format.
2. When an uploaded row's SKU/barcode doesn't match any existing product,
   it's silently skipped ("No product found..."). There's no way to bulk
   price-update products that don't exist in the system yet without a
   separate trip to the Guided Import Wizard (Settings → Data Management).

## Goal

- Template downloads only 3 real sample product rows, not the whole catalog.
- An unmatched row that includes enough information (`name`, `brand`,
  `category`, `unit_of_measure`, plus a price) is treated as **a new
  product to create**, not a skip.
- The preview clearly separates "will update" from "will create," and
  submission is blocked behind an explicit confirmation whenever any row
  would create a new product.

## Non-Goals

- Not replacing or duplicating the Guided Import Wizard's general-purpose
  column-mapping flow — this stays scoped to the Bulk Price Update Excel
  path's own fixed column set. The user confirmed this overlap is
  acceptable given the convenience of doing it in the same flow.
- No batched/combined approval request for multiple new products — each
  created product goes through `addProduct` individually, so if
  `require_product_confirmation` is on, each shows as its own separate
  `PRODUCT_CREATE` approval card. Not building a new batch-approval type
  for this — out of scope, matches how `addProduct` already works
  everywhere else in the app.
- No new required column beyond `name`/`brand`/`category`/`unit_of_measure`
  — `description` (required by the Add Product *client* form's zod schema,
  but not enforced by the `addProduct` server action itself) defaults to
  the row's `name` when creating from Excel, rather than adding a fifth
  column.
- Price levels are not settable from a to-create row — same restriction
  the existing update path already has (Excel path is price/cost/markup
  only).

## Architecture

**Template (`price-list-template.ts`):**
- `downloadPriceListTemplate` takes only the first 3 products passed to it
  (callers slice before calling — the function itself doesn't need to know
  "why 3", keeping it a pure formatter).
- Header gains four columns: `name`, `brand`, `category`, `unit_of_measure`
  — inserted after `barcode`, before the existing `current_*`/`new_*`
  columns, since they're per-product identity/classification fields, not
  price data.
- Sample rows populate `name` from the real product (as today); `brand`/
  `category`/`unit_of_measure` are also populated from the real product's
  data so the 3 sample rows double as a self-documenting example of the
  new columns' expected content.

**Classification (`previewPriceListUpload` in `actions.ts`):** when no
product matches by SKU or barcode, instead of unconditionally skipping:
1. Check whether `name`, `brand`, `category`, `unitOfMeasure` are all
   present (non-empty) **and** `newPrice` is present and valid (reusing the
   existing price column — for a to-create row it's the initial price, not
   an "update from" value).
2. If all present → push to a new `toCreate: NewProductFromExcel[]` array
   instead of `matched`.
3. If any are missing → still `skipped`, with a reason naming exactly which
   required field(s) are missing (e.g., `"Product not found and missing
   required fields to create it: brand, category"`), so the difference
   between "row is fine, just no such product, needs data to create" and
   "row is genuinely incomplete" is visible to the user.

**Submission:** a new server action, `createProductsFromExcel(warehouseId,
rows: NewProductFromExcel[], userId)`, loops the rows and calls the
*existing* `addProduct` action once per row (not a new creation code path)
— `warehouse` is set to the batch's `warehouseId`, `description` defaults
to `name`, `stock`/`reorderPoint` default to `0`. This means each row
independently goes through `addProduct`'s existing `PRODUCT_CREATE`
approval gate exactly as manual product creation does. Results (created /
pending-approval / failed) are aggregated and returned, mirroring
`PriceUpdateResult`'s shape (`applied`/`skipped` counts + messages) so the
UI can report both halves of the batch consistently.

**UI (`UploadPriceListDialog.tsx` / `use-upload-price-list.ts`):** preview
renders two tables when applicable — the existing "will update" table
(unchanged) and a new "N new product(s) will be created" table (Name, SKU,
Brand, Category, Price). When `toCreate.length > 0`, a checkbox ("I
understand N new product(s) will be created") must be checked before the
Submit button enables — this is the confirmation gate; submitting calls
both `submitPriceUpdateBatch` (for `matched`) and `createProductsFromExcel`
(for `toCreate`) and reports a combined result.

## Data Flow

1. User clicks "Download Template" → gets a file with 3 sample rows and
   the expanded column set.
2. User fills in rows for existing products (leaves `name`/`brand`/
   `category`/`unit_of_measure` blank — they're not needed for an update)
   and/or adds new rows for products that don't exist yet (fills in all
   four new columns + `new_price`).
3. Upload → `previewPriceListUpload` classifies each row into `matched`
   (existing product, price/cost/markup change), `toCreate` (new product),
   or `skipped` (unmatched and missing required creation fields, or
   genuinely invalid).
4. Preview shows both tables. If `toCreate.length > 0`, the confirmation
   checkbox gates the Submit button.
5. Submit runs both flows; the result toast reports both counts (e.g.,
   "Updated 5 product(s), created 2 new product(s)." / "3 pending
   approval.").

## Error Handling

- A to-create row missing any of the four new required fields is skipped
  with a reason naming the missing fields — never silently dropped, and
  never partially created with placeholder data.
- A to-create row's SKU colliding with another to-create row in the *same*
  file (duplicate SKU among new rows) is skipped with a reason — same
  existing-file-duplicate-SKU handling `previewPriceListUpload` already has
  for update rows, extended to also check within `toCreate` candidates.
- If `addProduct` itself fails for a given row (e.g., a race where another
  process created that SKU in the meantime), that row's failure is reported
  individually in the result summary, not silently swallowed and not
  aborting the rest of the batch.

## Testing

- Unit tests for the classification logic in `previewPriceListUpload`
  (already has DB-dependent tests via the existing test conventions for
  this file — extend with cases for: all-required-fields-present →
  `toCreate`; missing one required field → `skipped` with the right
  reason; duplicate SKU among to-create rows → second one skipped).
- Extend `tests/e2e/bulk-price-update.spec.ts` with a case that uploads a
  file containing one update row and one create-new-product row, confirms
  the preview shows both sections, confirms the confirmation checkbox gates
  the Submit button, submits, and confirms both the price update and the
  new product landed correctly (approval OFF, matching the file's existing
  test pattern).
