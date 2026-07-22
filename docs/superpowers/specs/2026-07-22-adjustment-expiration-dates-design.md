# Optional Expiration Dates on Stock Adjustments

**Date:** 2026-07-22
**Status:** Approved for planning

## Problem

Stock adjustments cannot record an expiration date. Perishable goods received through an
adjustment (rather than a purchase order) lose their expiry information entirely, so there is no
way to tell which stock on hand is close to expiring.

Purchase orders already capture expiry (`purchase_order_items.expiration_date`, migration 052),
but that date is never carried onto the inventory batch it creates. Adjustments have no expiry
field at all.

## Goals

- Let users optionally record an expiration date when **adding** stock via either adjustment UI.
- Store expiry **per batch**, so separate deliveries of the same product keep separate dates.
- Only surface the field for products explicitly marked as perishable.
- Never block an adjustment because expiry was left blank.
- Report on stock nearing expiry.

## Non-Goals

- Choosing which specific batch to deduct from on removal. FIFO (oldest-first) already pulls the
  oldest — and therefore soonest-expiring — batch.
- Backfilling expiry onto historical batches.
- Blocking sales of expired stock, or any automatic write-off of expired inventory.
- Carrying expiry through purchase-order receiving. Worth doing later; out of scope here.

## Data Model

One new migration, `100_add_expiration_tracking.ts`, with matching `down()`.

### `products.is_perishable`

```sql
ALTER TABLE products ADD COLUMN is_perishable TINYINT(1) NOT NULL DEFAULT 0;
```

Gates whether expiry inputs appear for a product. `products.expiration_date` already exists and is
retained as a denormalized cache of the nearest upcoming batch expiry — existing screens that read
it keep working.

### `inventory_batches.expiration_date`

```sql
ALTER TABLE inventory_batches ADD COLUMN expiration_date DATE NULL;
CREATE INDEX idx_ib_expiration ON inventory_batches (expiration_date);
```

The source of truth. Nullable, so every existing INSERT that omits it stays valid.

Both columns are additive and defaulted; no existing query breaks.

## Architecture

### Data flow

```
UI (Adjust Stock dialog | Bulk Adjustment row)
  -> adjustStock() action | POST /api/inventory/adjust/bulk
    -> recordStockMovement() / adjustStockWithMovement()   [optional expirationDate]
      -> INSERT inventory_batches (..., expiration_date)
      -> refresh products.expiration_date = MIN(expiration_date)
         over batches WHERE quantity_remaining > 0
```

### Why the change lands in `lib/stock-movements.ts`

The adjustment routes do not create batches. Batch creation is inside `lib/stock-movements.ts`,
which hardcodes the column list in two places:

- `lib/stock-movements.ts:196` — batch insert for single-product adjustments
- `lib/stock-movements.ts:422` — batch insert for generic stock movements

A third site, `lib/purchase-actions.ts:212`, handles purchase-order receiving and is left alone
(see Non-Goals).

Each touched function gains an **optional** `expirationDate?: string | null` parameter. Existing
callers — PO receiving, product import, family sync — compile and behave exactly as before.

### Product expiry cache

After any batch insert that carries an expiry, recompute:

```sql
UPDATE products p SET expiration_date = (
  SELECT MIN(b.expiration_date) FROM inventory_batches b
  WHERE b.product_id = p.id AND b.quantity_remaining > 0 AND b.expiration_date IS NOT NULL
) WHERE p.id = ?;
```

This keeps `products.expiration_date` meaningful as "soonest expiry currently in stock" without
making it authoritative.

### Approvals

Stock adjustments may be routed through the approval queue before applying. There are **two
separate** `submitToApprovalQueue('STOCK_ADJUSTMENT', ...)` payloads, and both must carry
`expirationDate`:

- `app/api/inventory/adjust/bulk/route.ts:71` — the bulk adjustment payload
- `app/(app)/inventory/history/actions.ts:235` — the single-product `adjustStock()` payload

The finalization path reads the stored payload back and replays the adjustment with
`isInternalFinalization = true`, so it must also forward the expiry. Missing either site means an
approved perishable adjustment silently loses its date.

### Removal and transfer

Unchanged. `deductFromBatches` continues to consume oldest-first. No expiry input is shown for
REMOVE or TRANSFER modes.

## UI

### Add/Edit Product

A "Perishable / tracks expiration" toggle. Ships first — nothing else activates without it.

### Adjust Stock dialog (`app/(app)/inventory/stock-adjustment-dialog/`)

When adjustment type is `add` **and** the product is perishable, render a date input between
"Quantity to Add" and "Reason for Adjustment":

```
Expiration Date (Optional)
[ yyyy-mm-dd                    ]
```

Hidden for `remove` and for non-perishable products. Blank submits as `NULL`.

Physical Count mode does not show the field: a count reconciles an existing quantity rather than
receiving new stock.

### Bulk Adjustment page (`app/(app)/inventory/bulk-adjustment/`)

- New EXPIRY column between QUANTITY and NOTE.
- Column renders only when mode is ADD **and** at least one row in the batch is perishable.
- Perishable rows get a date input; non-perishable rows show a dimmed `—`.
- The right-hand Batch Configuration panel gains an "apply expiry to all perishable rows" control,
  since one delivery usually shares a single expiry date.

### Batch / stock history views

Read-only expiry column in the product batch listing, so users can confirm what was recorded.

## Expiring Soon Report

`GET /api/reports/expiring-soon?days=30`

Returns batches where `quantity_remaining > 0` and `expiration_date IS NOT NULL`, filtered to the
window, grouped by product, sorted soonest-first. Already-expired batches form a separate
highlighted bucket. New page under `/reports`.

Sequenced last: it is fully independent and can be deferred without affecting anything above.

## Validation Rules

| Case | Behavior |
|---|---|
| Perishable, expiry blank | Allowed. Batch gets `NULL`. |
| Non-perishable | Field never rendered; any submitted value ignored. |
| Expiry in the past | Allowed, with a non-blocking inline warning. Recording already-expired stock found during a count is legitimate. |
| REMOVE / TRANSFER mode | Field never rendered. |
| Malformed date string | Rejected server-side with a 400; the input is a native date picker so this is a direct-API guard. |

## Testing

Playwright E2E on port 3100 against `verdix_test`:

1. Mark a product perishable, add stock with an expiry -> assert the new `inventory_batches` row
   carries the date and `products.expiration_date` matches.
2. Add stock with expiry blank -> assert `NULL` batch expiry and no error.
3. Non-perishable product -> assert the field never renders in either UI.
4. Approval-queued adjustment -> assert expiry survives the approve-and-finalize round trip.
5. Bulk adjustment, mixed perishable and non-perishable rows -> assert only perishable rows persist
   a date.
6. Remove stock from a product with multiple dated batches -> assert FIFO consumes the
   soonest-expiring batch first.

## Risks

- **Silent batch failures.** Batch inserts in `lib/stock-movements.ts` are wrapped in try/catch that
  only logs (a pre-migration guard). A bad expiry column reference would fail quietly rather than
  loudly. Verify the migration ran before relying on the field.
- **Approval payload drift.** `approvalData` is an untyped JSON blob; a missed field is not a
  compile error. Test 4 covers this specifically.
- **Family sync.** Adding stock to a family parent cascades to children via `addFamilyStock`
  (`lib/family-sync.ts:163`), which recurses into `updateStockAndRecordMovement` and therefore hits
  the `lib/stock-movements.ts:422` batch insert for every descendant. Those child batches will not
  inherit the parent's expiry in this round — the recursion carries `refType` and `notes` but no
  expiry. Threading it through is a contained follow-up (add the parameter to the recursive call);
  documented here as a known limitation rather than left as silently wrong behavior.
