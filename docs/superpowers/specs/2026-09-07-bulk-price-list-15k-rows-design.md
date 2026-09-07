# Bulk Price List Upload — 15,000 Row Support

**Date:** 2026-09-07
**Status:** Approved for planning

## Problem

The Bulk Update Price drawer's "Upload Excel" path fails well before the
15,000 rows the business needs. No row cap is coded anywhere; the ceiling is
structural. Four independent walls stand between the current code and 15,000
rows, and removing any three of them still leaves a broken feature.

| # | Wall | Where | Effect at 15,000 rows |
|---|---|---|---|
| 1 | Server Action 1MB body limit | `use-upload-price-list.ts` → `previewPriceListUpload` | `Body exceeded 1mb limit` at ~4,000–5,000 rows |
| 2 | N+1 product lookups | `actions.ts:202-213` | Up to 30,000 sequential round-trips; 10–25 min against Railway MySQL; HTTP timeout |
| 3 | One unbounded transaction | `actions.ts:69-139` | 15,000 row locks held for minutes; blocks POS checkout; risks `innodb_lock_wait_timeout` |
| 4 | `addProduct()` called per row | `actions.ts:322-349` | 3,000 new products = 3,000 separate transactions + 3,000 approval checks |

Wall 1 is the one users hit first, which is why the failure looks like a size
limit rather than a performance problem. It is both.

### Expected file composition

Confirmed with the user: **mixed**. A representative 15,000-row file is roughly
12,000 updates to existing products and 3,000 new products to create. Both
paths therefore need batching; optimising only the update path would leave
wall 4 fully intact.

## Goals

- A 15,000-row `.xlsx`/`.csv` uploads, previews, and applies without error.
- Visible progress while it runs.
- No regression to the manual selection drawer, which shares this code.
- Every existing validation rule preserved exactly.

## Non-goals

- Background or resumable jobs. The dialog stays open for the duration; closing
  the tab cancels the run. Chosen deliberately over a job table — see
  "Alternatives considered".
- Redesigning the approvals card for huge batches. Bulk Excel upload is
  *blocked* while price approvals are on (see "Approval interaction"); making
  the card readable at 15,000 items is separate work.
- Raising the ceiling above 15,000. That is the stated business maximum.

## Design

### Transport: a streaming route handler

A new route replaces the Server Action for the Excel path only:

```
POST /api/products/price-list/process
```

Request is `multipart/form-data`:

| Field | Meaning |
|---|---|
| `file` | the uploaded `.xlsx` / `.xls` / `.csv` |
| `warehouseId` | warehouse scope for matching |
| `userId` | acting user, for creation attribution |
| `mode` | `preview` or `apply` |
| `confirmCreate` | `'1'` when the user has ticked the create-confirmation box |

Sending the *file* rather than parsed rows sidesteps wall 1 entirely: file
uploads are not subject to the Server Action body limit, and a 15,000-row xlsx
is only ~1–2 MB. Parsing moves from the browser to the server, using the
existing `parseXlsxBuffer` / `parseCsvText` from `lib/import/parse-file.ts`
unchanged.

The response is a streamed **NDJSON** body — one JSON object per line:

```jsonc
{"phase":"parsing"}
{"phase":"matching","done":4200,"total":15000}
{"phase":"applying","done":9000,"total":15000}
{"phase":"done","matched":12000,"created":3000,"skipped":42,"sample":[…],"skippedRows":[…]}
```

The client reads it with `response.body.getReader()` and a line buffer,
updating the progress bar on each `matching` / `applying` frame. Progress
frames are emitted per chunk, not per row, so the stream carries ~30 frames
rather than 15,000.

An `{"phase":"error","message":…}` frame is the failure channel once streaming
has begun. Errors detected *before* the first frame (approval gate, unreadable
file) return a normal non-streamed 4xx JSON body, so the client must check
`response.ok` before it starts reading lines.

### The file is uploaded twice

Preview and apply are two separate requests, each carrying the file. This is
intentional:

- The server stays stateless — no temp files to write, clean up, or leak, and
  no job table. This is what makes the "no background job" decision cheap.
- Re-reading at apply time re-checks every row against current DB state.
  Products can be created, deleted, or repriced between preview and apply;
  re-matching is strictly safer than trusting a stale preview payload.
- The cost is one extra ~1–2 MB upload, about a second on a LAN.

The apply pass recomputes matches from scratch and applies them; it does not
receive the preview's item list. This preserves the existing apply-time
`markup` recomputation behaviour (`actions.ts:89-93`) and extends the same
principle to the whole batch.

### Batched matching

`previewPriceListUpload`'s per-row `SELECT` pair is replaced by:

1. Collect all non-empty SKUs and barcodes from the parsed rows.
2. Query them in chunks of 1,000:
   `SELECT id, name, sku, barcode, price, cost FROM products WHERE sku IN (…) AND warehouse_id = ?`
   and the same for `barcode IN (…)`.
3. Build two `Map`s — by SKU and by barcode.
4. Run the existing per-row validation loop against those maps, in memory.

30,000 queries become roughly 30. **All existing validation logic is preserved
verbatim** — the `isValidPriceValue` guards, the `Number.isFinite` check on
markup, the duplicate-SKU suppression, the missing-field reasons, the
markup-from-live-cost computation. Only the lookup mechanism changes.

SKU takes priority over barcode, exactly as today (`actions.ts:200-214`).

### Chunked apply

`applyPriceUpdateBatch` keeps its per-item logic but is wrapped in chunks of
**500 items per transaction** rather than one transaction for the whole batch.

This trades atomicity for liveness, and the trade is correct here: a 15,000-row
price update held in one transaction blocks POS checkout for minutes. With
chunking, a mid-run failure leaves earlier chunks committed. The result
reports exactly how many were applied, and re-running the same file is
naturally idempotent — it sets prices to the same values.

### Batched product creation

`createProductsFromExcel` currently calls `addProduct()` once per row. Reading
`addProduct` shows that for the Excel path this is far heavier than needed: the
Excel caller passes no shelf locations, no conversion factors, no price levels,
no supplier mappings, and `stock: 0` — so every optional sub-insert and the
`inventory_batches` insert are skipped. An Excel-path creation reduces to a
single `INSERT INTO products`.

So the Excel path gets its own multi-row insert (500 rows per statement,
inside the chunk transaction) rather than 3,000 `addProduct` calls. Column list
and defaults are copied from `addProduct`'s own INSERT (`actions.ts:513-521`)
so a product created via Excel is identical to one created via the dialog:
`type: 'standard'`, `vat_status: 'YES (Subject to 12% VAT)'`,
`availability: 'Available'`, `earns_points: true`, `conversion_factor: 1`,
`image_hint` derived from the name, `description` defaulting to the name.

`addProduct` itself is not modified. The manual Add Product dialog keeps using
it unchanged.

### Approval interaction — blocked, by decision

Before parsing anything, the route calls `checkApprovalRequired('PRICE_UPDATE')`,
and `checkApprovalRequired('PRODUCT_CREATE')` when the file contains rows to
create. If either is on, the route returns 409 with a plain message and does no
work:

> Bulk Excel upload is not available while price approvals are on. Turn off
> price approvals, or use the manual selection drawer.

Rationale: a 15,000-item batch lands in `approval_queue.transaction_data` as a
single ~4 MB JSON blob, and the approvals Kanban renders every item as a table
row (`components/approvals/approvals-kanban.tsx:461`). The approver cannot
meaningfully review it, and the card would freeze the browser. Blocking is
honest; a summary-only card is a real feature and belongs in its own task.

The manual selection drawer is unaffected and still routes through approvals
normally.

### Preview UI

The dialog cannot render 15,000 table rows. It shows:

- Counts: *12,000 products will be updated / 3,000 new products will be created
  / 42 rows skipped*.
- The first **50** rows of each section as a sample, labelled
  "Showing first 50 of 12,000".
- A **Download skipped rows (CSV)** button. Skipped rows are the ones that
  actually need review, so they are delivered complete rather than sampled.
  The CSV is generated client-side from the `skippedRows` array in the `done`
  frame, using the existing `xlsx` dependency.

To keep the `done` frame small, the server sends at most 50 sample rows per
section, but **all** skipped rows (with their reasons). A pathological file
where all 15,000 rows are skipped yields roughly a 2 MB frame, which is
acceptable for a streamed response.

### Bug fixed as part of this work

`actions.ts:243` — when a to-create row has a blank SKU, `generateSku()`
produces a code checked only against `seenSkus` (SKUs seen in *this file*) and
never against the products table. It can collide with an existing product's
SKU, producing either a failed insert or a duplicate SKU in the catalogue.

Batched matching already loads the relevant SKU set, so the fix is cheap: check
generated SKUs against both the in-file set and the DB set, regenerating on
collision (bounded retries, then skip the row with a clear reason). Confirmed
in scope with the user.

## Code organisation

The matching and applying logic moves to a new **`lib/price-list-import.ts`**,
so the route handler and the existing Server Actions share one implementation
rather than diverging.

| File | Change |
|---|---|
| `lib/price-list-import.ts` | **new** — batched matching, chunked apply, batched create, SKU generation with collision check |
| `app/api/products/price-list/process/route.ts` | **new** — multipart intake, approval gate, NDJSON streaming |
| `app/(app)/products/bulk-price-update/actions.ts` | Server Actions delegate to the shared lib; signatures unchanged |
| `app/(app)/products/bulk-price-update/use-upload-price-list.ts` | posts the file to the route; reads the NDJSON stream; exposes progress |
| `app/(app)/products/bulk-price-update/UploadPriceListDialog.tsx` | progress bar; summary + 50-row samples; skipped-CSV download |

The Server Actions are kept because the manual selection drawer uses
`submitPriceUpdateBatch` for small hand-picked batches, and the approvals
finalizer calls it with `isInternalFinalization: true`
(`app/api/approvals/process/route.ts:189`). Both continue to work unchanged.

## Testing

**Unit tests** against `lib/price-list-import.ts`, which is pure logic over
injected lookup maps and therefore needs no database:

- SKU-priority matching; barcode fallback when SKU is absent or unmatched.
- Duplicate SKU within a file — first row wins, later rows skipped with reason.
- Every validation branch: negative price, non-numeric cell, NaN markup,
  negative markup accepted, missing required fields for creation.
- Generated-SKU collision against an existing DB SKU and against an in-file SKU.
- Chunk boundaries: 999 / 1,000 / 1,001 rows produce correct query batching;
  499 / 500 / 501 items chunk correctly for apply.

**Integration**: a generated 15,000-row xlsx (12,000 matching seeded products,
3,000 new) posted to the route end-to-end. Assert counts reconcile
(`matched + created + skipped == rows`), the DB reflects the changes, the run
completes under a minute, and progress frames arrive throughout rather than all
at the end.

**Regression**: the existing `tests/e2e/bulk-price-update.spec.ts` must still
pass — it covers the manual drawer path that shares this code.

## Expected outcome

A mixed 15,000-row file completes in roughly **15–40 seconds**, versus not
completing at all today.

## Alternatives considered

**Background job table.** Persist the upload, process it in a worker, let the
user close the dialog and return later. More robust — survives a tab close —
but needs a migration, a new table, a worker, and status-polling UI. Rejected
for now as disproportionate; the streaming design can be upgraded to this later
without changing the matching or applying logic, since that lives in a
standalone lib.

**Server-side temp file between preview and apply.** Would avoid the second
upload, at the cost of temp-file lifecycle, cleanup, and a stateful server.
Rejected: the second upload is cheap, and re-matching at apply time is a
correctness *benefit*, not just an acceptable cost.

**Virtualized full preview table.** Render all 15,000 rows with a
virtualization library. Rejected: adds a dependency and still pushes ~4 MB to
the browser, to show rows nobody reads. Skipped rows — the ones that matter —
are delivered in full as CSV instead.

**Raising `serverActions.bodySizeLimit`.** Removes wall 1 only, leaving the
30,000-query matcher and the giant transaction untouched. It would convert a
clear error message into an indefinite hang.
