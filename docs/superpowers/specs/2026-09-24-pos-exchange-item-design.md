# POS Exchange Item — Design Spec

**Date:** 2026-09-24
**Status:** Approved for planning

## Problem

The POS "Merchandise Credit" flow (`/pos` → Merchandise Credit) already lets a
cashier return item(s) from a past sale: the returned quantity goes back to
`products.stock` via `updateStockAndRecordMovement`, and a credit slip
(MC number) is issued. There is currently no way to swap the returned item
for a different one in a single flow — a cashier has to process a plain
return, then separately ring up a brand-new sale for the replacement, with
no link between the two records.

This feature adds an **Exchange** action to that flow: return the old item
to inventory, sell a new item (deducting its stock the normal way), and
settle whatever price difference results — all as one operator-facing flow
and one atomic database transaction.

## Goals (v1)

- 1-for-1 exchange: one returned line → one replacement product (any selling
  unit), in any quantity.
- Old item restored to stock exactly like today's return flow (FIFO/batch
  logic is unaffected by returns; returns always add back to `products.stock`
  and write a stock movement).
- New item deducts stock through the **same FIFO batch-costing path** as a
  normal checkout (`deductFromBatches`), so cost/margin reporting stays
  correct — this is core inventory accounting, not a "feature" to skip for
  simplicity.
- New item is a minimal sale: no discounts, no loyalty points, no
  charge-to-account. Cash or card only.
- Price difference is settled immediately:
  - New item costs more → collect the difference (cash/card, no split
    payments) before completing.
  - New item costs less → credit the difference to `customers.credit_balance`
    **only if** the original sale has a customer attached. Walk-in sales with
    no customer record fall back to the existing manual cash-refund handling
    (cashier hands back change) — no walk-in credit wallet is built.
  - Balances of exactly ₱0 skip the payment step entirely.
- One printed "Exchange Slip" showing both the SI number (new item) and the
  MC number (returned item), plus the balance collected or credited.
- Every existing report that already filters on `pos_transactions.transaction_type`
  (X-reading, Z-reading, sales-by-product, sales-by-date, approvals queue,
  e-journal) continues to work with **zero changes**, because this feature
  introduces no new `transaction_type` value.

## Non-goals (v1)

- Multiple items per exchange (many-for-many). Explicitly deferred.
- Discounts, loyalty points, or charge-to-account on the new item's leg.
- Split payments for the collected balance.
- A store-credit wallet for walk-in (no-customer) sales.
- Changing BIR SI/MC numbering rules or introducing a new numbering series.

## Architecture

### Why two linked existing transaction types, not a new one

`pos_transactions.transaction_type` is read directly (`= 'sale'` /
`= 'return'`) by at least: `app/api/sales/x-reading`, `app/api/sales/z-reading`,
`app/api/sales/by-product`, `app/api/sales/by-date`, `app/api/sales/transactions`,
`app/api/pos/shifts`, `app/api/approvals/queue`, `lib/ejournal/ejournal-data.ts`,
and `app/api/data-management/reset`. Adding a new `'exchange'` value would
require updating every one of these or have them silently drop exchange
transactions from totals — the same class of bug already seen once with void
transactions (`transaction_type` never got a `'void'` value, and every query
keyed on it silently returned 0 until it was found and fixed).

So an exchange is recorded as **two existing-shape rows**, each independently
correct under every current report:

1. A `transaction_type = 'return'` row for the old item — identical in shape
   to today's `/api/sales/returns` output (MC number, negative `sale_items`
   row, stock added back).
2. A `transaction_type = 'sale'` row for the new item — identical in shape to
   a normal `/api/pos/checkout` sale (real SI number, batch-deducted stock,
   positive `sale_items` row).

Both rows are written in the **same DB transaction** and share a new
`pos_transactions.exchange_group_id` column (nullable, `VARCHAR(50)`) so the
UI, receipts, and any future audit tooling can find the pair. Nothing that
reads `transaction_type` needs to know this column exists.

### New API route: `POST /api/sales/exchanges`

A new route (not a variant of `/returns` or `/checkout`) because it owns its
own atomicity: if either leg fails, the whole exchange rolls back — a
customer must never end up with their old item taken and no new item
recorded, or vice versa.

Request shape:

```
{
  saleId: string;           // original sale being returned from
  returnItem: {             // the ONE line being returned (v1: 1-for-1)
    productId, productName, quantity, price,
    sellingUnitId?, sellingUnitName?, sellingUnitFactor?
  };
  newItem: {                // the ONE replacement line
    productId, productName, quantity, price,
    sellingUnitId?, sellingUnitName?, sellingUnitFactor?
  };
  balancePayment?: {        // present only when newItem total > returnItem total
    method: 'CASH' | 'CARD' | ...;   // from existing pos_payment_methods
    amountTendered: number;
    reference?: string;              // required if the method requires one, same rule as checkout
  };
  terminalId, userId, shiftId, customerId?: string | null;
}
```

Server logic, inside one `withTransaction`:

1. Validate: `newItem` total ≥ `returnItem` total requires `balancePayment`
   present and sufficient; `newItem` total < `returnItem` total requires
   `customerId` present (or the request is rejected — the client must not
   silently drop the difference on the floor for a walk-in; the UI enforces
   this earlier, this is the server-side backstop).
2. Allocate `mcNumber` via the existing `getNextMCNumber(connection)`.
3. Allocate `siNumber` via the existing `getNextSINumber(connection)` for the
   new item's sale leg — same training-mode/service-sale exclusion rules
   `checkout/route.ts` already applies (an exchange involving a service line
   is out of scope for v1; reject if either line is a service product).
4. Generate a shared `exchangeGroupId` (e.g. `EXG-${Date.now()}-${rand}`).
5. **Return leg** — reuse the exact logic in `app/api/sales/returns/route.ts`
   (selling-unit resolution, negative `sale_items` insert, `pos_transactions`
   insert with `transaction_type='return'`, `updateStockAndRecordMovement`
   with type `'return'`). Refactor that logic into a shared function
   (`lib/pos/process-return-leg.ts` or similar) that both `/api/sales/returns`
   and `/api/sales/exchanges` call, rather than copy-pasting it — the
   selling-unit resolution rules in particular are subtle enough that they
   must not drift between two copies.
6. **Sale leg** — reuse the batch-costing/stock-deduction/sale_items-insert
   block from `app/api/pos/checkout/route.ts` (lines ~200–360), extracted the
   same way into a shared function callable with a single item instead of a
   cart array. No loyalty accrual, no discount, no invoice/charge-to-account
   handling — just the batch deduction, `sale_items` insert, and
   `pos_transactions` insert with `transaction_type='sale'`.
7. Apply `balancePayment` (if collected) or credit the difference to
   `customers.credit_balance` (if `newItem` is cheaper and a customer is
   attached) — mirroring the existing credit-apply pattern in
   `checkout/route.ts`'s step 3a, but adding rather than subtracting.
8. Set `exchange_group_id` on both `pos_transactions` rows.
9. Trigger `saveEJournalFiles` for the affected business date, same as both
   `/returns` and `/checkout` already do.

### Extracted shared modules (avoids duplicating return/checkout logic)

- `lib/pos/process-return-leg.ts` — takes `(connection, { saleId, item,
  posTransId, mcNumber, shiftId, terminalId, userId, reason })`, returns
  the inserted IDs. Used by both `/api/sales/returns` and
  `/api/sales/exchanges`.
- `lib/pos/process-sale-leg.ts` — takes `(connection, { item, saleId,
  posTransId, siNumber, ... })` for a single line, returns cost/stock
  results. Used by `/api/sales/exchanges`; `/api/pos/checkout` keeps its
  existing loop but could adopt this later (not required for this feature).

Both extractions are refactors of existing, already-shipped code paths —
behavior must not change for `/returns` or `/checkout` themselves. This is
the kind of "fix the file you're already working in" cleanup the project's
conventions call for, not scope creep: without it, the exchange route would
otherwise hand-copy ~150 lines of selling-unit-resolution and batch-costing
logic that has already needed several bug fixes (see the selling-unit
resolution comments in `app/api/sales/returns/route.ts`).

## UI Flow

Entry point: inside the existing Merchandise Credit dialog
(`app/(app)/pos/return-sales/`), in `SelectItemsView`, after selecting exactly
one returnable line, add a second button next to "Issue Credit ({n})":

**"Exchange for Another Item"** (disabled unless exactly 1 item is selected,
tooltip explains why for 2+).

New step sequence added to `useReturnSales`'s `step` state machine:

```
input_so → select_items → [NEW] pick_replacement → [NEW] settle_balance? → [NEW] exchange_success
```

- **pick_replacement**: opens the existing `ProductSearchDialog` (already
  used elsewhere in POS) to choose the new product + selling unit + quantity.
  Shows a running comparison: old item credit vs. new item total.
- **settle_balance** (skipped if balance = 0):
  - Balance > 0: a minimal payment step — reuse `PaymentInputs` component
    (`app/(app)/pos/payment-inputs/PaymentInputs.tsx`) for amount-tendered /
    change math, restricted to the subset of `paymentMethods` that don't
    require split/loyalty handling. Not the full `TenderDialog` — that
    component's loyalty/charge/split-payment branches are out of scope for
    v1 and would need to be conditionally suppressed throughout, which is
    more risk than building a focused step.
  - Balance < 0 and a customer is attached: no input needed, just a
    confirmation showing "₱X will be added to {customer}'s store credit."
  - Balance < 0 and no customer (walk-in): block proceeding, direct the
    cashier to use plain "Issue Credit" instead (an exchange that shorts a
    walk-in isn't representable in v1 — this is a hard stop, not a silent
    fallback).
- **exchange_success**: shows both numbers (SI + MC), the balance
  collected/credited, and a "Print Exchange Slip" button.

Auth gate (`enableReturnAuth`) is checked once, at dialog open, exactly as
today — the new steps don't re-trigger it.

## Receipt / Printing

New `ExchangeSlipGenerator` (or an extension of the existing
`CreditSlipGenerator`) that prints:
- Original SI (returned sale reference)
- MC number + returned item + credit amount
- New SI number + new item + price
- Balance line: "Additional Payment Collected: ₱X" or "Credit Added to
  Account: ₱X" or nothing if balance is zero
- Same business-header fields (`businessName`, `tin`, `minNumber`, etc.) the
  existing credit slip already prints.

Browser print path reuses `useReactToPrint` the same way
`ReturnSalesDialog`/`use-return-sales.ts` already does; ESC/POS path reuses
`usePrinter`/`print()` the same way.

## Data model changes

One migration (next number after 126):

```sql
ALTER TABLE pos_transactions ADD COLUMN exchange_group_id VARCHAR(50) NULL;
ALTER TABLE pos_transactions ADD INDEX idx_exchange_group_id (exchange_group_id);
```

No other schema changes — both legs use existing `sale_items`,
`pos_transaction_items`, and `pos_transactions` columns exactly as returns
and sales already do.

## Error handling

- **Insufficient stock on the new item**: governed by the same
  `oversellBlock` batch-costing setting checkout already respects. If
  blocking is on, the whole exchange transaction throws and rolls back
  (nothing returned, nothing sold, no numbers burned since both `getNextSINumber`
  and `getNextMCNumber` are called on the same connection that rolls back).
  If blocking is off, proceeds and logs a warning, same as checkout today.
- **Same product chosen as replacement** (e.g. exchanging Piece → Case of the
  same product): allowed, no special case — it's still a valid return+sale
  pair and a real-world scenario (unit exchange).
- **Service products**: rejected up front (either line being a service is out
  of scope — services carry no stock and SI/OR numbering branches differently).
- **Cancel mid-flow**: purely client-side; nothing is persisted until the
  final "Confirm Exchange" hits `/api/sales/exchanges`, so no server-side
  cleanup is ever needed for an abandoned exchange.
- **Training mode**: if `pos_settings.is_training_mode` is on, both the SI
  and MC numbers are skipped (`null`), exactly matching how checkout already
  excludes training sales from the real numbering series.

## Testing

- Unit/integration test for the new shared `process-return-leg.ts` /
  `process-sale-leg.ts` modules confirming `/api/sales/returns` and
  `/api/pos/checkout` behavior is byte-for-byte unchanged after extraction
  (regression guard for the refactor).
- New Playwright E2E test (`tests/e2e/pos-exchange.spec.ts`) covering:
  - Even exchange (balance = 0).
  - Upsell exchange (collect cash payment).
  - Downsell exchange with a customer attached (credit balance increases).
  - Downsell exchange attempted on a walk-in sale (blocked in UI).
  - Oversell-blocked exchange (new item out of stock) rolls back cleanly —
    old item's stock is unchanged, no MC/SI number was consumed permanently
    (allocated-then-rolled-back numbers are expected to leave a gap only if
    the transaction *commits* partially, which it must not).
- Verify X-reading and Z-reading totals correctly include both legs of a
  committed exchange with no code changes to those report routes (this is
  the acceptance test for the "no new transaction_type" architectural
  decision).

## Open questions deferred to implementation

None — all decisions needed to start planning were resolved above. Any
further tradeoffs (payment method restrictions, exact slip layout wording)
are implementation details to be handled with the same judgment used
elsewhere in the POS UI, not architectural choices.
