# BIR Annex F Compliance — Batch 2: Sales Invoice vs Official Receipt Split

Date: 2026-08-11
Status: Approved
Related: BIR RMO 24-2023 Annex F audit, checklist item #1 (MISSING — "Is the generated Principal Invoice/receipt aligned with the nature of business of the client/TP-user? Note: Sales Invoice must be used for the sale of goods, while Official Receipt for sale of services.")

## Context

Verdix POS currently prints every sale as either "CASH INVOICE" or "CHARGE INVOICE" — a title chosen purely from `payment_method`, never from what was actually sold. Per BIR rules, a sale of **goods** must be documented as a **Sales Invoice**; a sale of **services** must be documented as an **Official Receipt**. These are legally distinct document types with their own numbering series — not a cosmetic label choice.

Products already carry a `type: 'standard' | 'service'` column (`products.type`, added by migration `101_add_product_type.ts`), read via the `isService()` predicate in `lib/product-type.ts`. Checkout (`app/api/pos/checkout/route.ts:170`) already computes `itemIsService` **per line item**, inside the item-processing loop, for stock/batch-costing purposes — but this is computed *after* the single SI number for the whole sale has already been assigned (`route.ts:119`, before the item loop starts), and nothing about item type reaches the receipt printer's title logic (`lib/receipt-generator.ts:178`, a pure function of `payment_method`).

### The mixed-cart question

Nothing in the codebase today prevents a single cart from containing both `standard` and `service` products (confirmed: `use-pos.ts`'s `handleAddItem` has no type check; `checkout/route.ts`'s item loop computes `itemIsService` independently per row with no aggregate check). Per business confirmation, mixed carts do not happen in practice — but the system must not silently mis-document one if it ever does.

### Two counters that must not be confused

A pre-existing, unrelated counter already uses the letters "OR": `getNextReceiptNumber()` (`lib/mysql.ts:137-177`) increments either a per-terminal `pos_terminals.or_next_reference` column or a global `transaction_references.receipt_number` column, and is called on **every** sale regardless of type (`checkout/route.ts:114`, `receiptNo`). This is a generic receipt reference, not a BIR classification — its column name is coincidental. `app/api/sales/bir-summary/route.ts:47-48` currently sources its "Beginning/Ending SI/OR No." columns from this `receipt_number` field, not from `si_number` — a pre-existing bug this batch also fixes, since it touches the same numbering code.

To avoid perpetuating that confusion, the new BIR Official Receipt series introduced by this batch uses **`bir_or_number`** as its internal column/function name (never bare `or_number`), while the value **printed and displayed to users** is the short label "OR No." — matching how `si_number` prints as "SI NO." today.

### Blast radius of a real two-series split

An earlier research pass found that `si_number` is read as a single monotonic sequence in more places than checkout: Z-reading computes 3 separate MIN/MAX range pairs over it (sales, void, return), X-reading computes 1, the by-date report computes 1 per day, and the e-journal computes a begin/end pair by sorting all of a day's SI numbers together. Every one of these must become series-aware (a goods-range pair and a services-range pair, shown separately) once two series exist in the same column, or they will silently produce a range that mixes both series — corrupting exactly the artifact BIR examiners reconcile against the physical invoice/OR booklets.

A prior attempt at a *different* kind of SI prefixing (a per-deployment writer prefix, for multi-writer sync) was implemented and later reverted (`docs/superpowers/specs/2026-07-06-multi-writer-si-numbering-design.md`, commits `42147e6` → `e0e69aa`). That scheme is unrelated to this one (deployment identity, not document type) and is not being revived — noted here only so implementers don't confuse the two.

## Goals

1. A sale containing only `standard` products prints as a Sales Invoice, using the existing `si_number` series, unchanged in format (plain 6-digit, e.g. `000123`).
2. A sale containing only `service` products prints as an Official Receipt, using a new `bir_or_number` series, formatted with an `OR-` prefix (e.g. `OR-000045`), printed/displayed as "OR No.".
3. A cart that would mix `standard` and `service` products is blocked before checkout, both in the POS UI (immediate feedback while adding items) and in the checkout API (defense in depth).
4. Every report that currently shows one Beginning/Ending SI# range is extended to show two ranges — one for the goods/SI series, one for the services/OR series — never mixed in one MIN/MAX.
5. `bir-summary`'s "Beginning/Ending SI/OR No." columns are fixed to source from the real `si_number`/`bir_or_number` values instead of the unrelated `receipt_number` field.

## Non-goals

- No change to historical/pre-split sales records. Every existing `si_number` row predates this split and is implicitly part of the goods/SI series — no backfill, no reclassification by inspecting old items.
- No supplementary-document series (delivery receipts, provisional receipts, etc. — checklist item #2). Confirmed not needed for current operations; that checklist item is marked N/A on the evaluation form.
- No revival of the reverted per-deployment multi-writer SI prefix scheme.
- No change to the existing `receipt_number`/`or_next_reference`/`getNextReceiptNumber()` counter's behavior or callers — it continues to run for every sale exactly as today. This batch only stops `bir-summary` from mis-reading it.
- No majority-vote or best-guess document-type resolution for mixed carts — mixed carts are always rejected, never auto-classified.

## Design

### 1. Mixed-cart prevention

**Client-side** (`app/(app)/pos/pos-content/use-pos.ts`, `handleAddItem`, currently lines 563-586): before adding a new item, if the cart is non-empty, compare the new product's `type` against the type of items already in the cart (all existing cart items are guaranteed the same type once this rule is enforced, so checking against any one existing item suffices). If they differ, block the add and show a toast: something like "Cannot mix goods and services in one sale — please complete this as two separate transactions." Do not add the item; leave the cart and input state unchanged otherwise.

**Server-side** (`app/api/pos/checkout/route.ts`): before the existing per-item loop reaches its stock/batch-costing work, do a lightweight pre-pass over `items` that resolves each item's `type` (the same `products.type` lookup already done per-item at `route.ts:160-167`, but consulted for validation before any state-mutating work begins) and rejects the whole request with a 4xx error and a clear message if more than one type is present. This must run before `getNextSINumber`/`getNextBirOrNumber` is called (see below), since the choice of which counter to increment depends on this check passing.

### 2. New `bir_or_number` counter

**Schema** (new migration, following the `099_add_mc_number.ts` pattern exactly):
- `transaction_references.bir_or_number VARCHAR(20) NOT NULL DEFAULT '000000'` — the counter, incremented the same way `si_number` and `mc_number` already are.
- `sales_transactions.bir_or_number VARCHAR(20) NULL` with a UNIQUE index (NULLs exempted, matching `si_number`'s existing UNIQUE column pattern) — so a goods sale has `si_number` set and `bir_or_number` NULL, a services sale has the reverse.
- `pos_transactions.bir_or_number VARCHAR(20) NULL`, same UNIQUE-with-NULL treatment, mirroring how `pos_transactions.si_number` and `.mc_number` already coexist.

**`lib/mysql.ts`** — new function `getNextBirOrNumber(connection?: mysql.PoolConnection): Promise<string>`, structurally identical to `getNextSINumber()` (`lib/mysql.ts:241-257`) and `getNextMCNumber()` (`lib/mysql.ts:268-284`): `UPDATE transaction_references SET bir_or_number = LPAD(...+1, 6, '0') WHERE id = 1`, then read it back, then return `` `OR-${value}` `` (prefixed, matching `getNextMCNumber`'s `MC-` prefix pattern, not `si_number`'s unprefixed format).

**`lib/si-number.ts`** — `validateSINumber`'s existing regex (`/^[A-Z0-9]{1,8}-\d{6,}$/`) already accepts a prefixed format like `OR-000045`, so no change needed there. `formatSINumber` already leaves prefixed values as-is (`if (s.includes('-')) return s;`) — also no change needed. These helpers were already general enough for this.

### 3. Checkout routing

**`app/api/pos/checkout/route.ts`**: after the mixed-cart pre-pass (§1) confirms a single type, replace the unconditional `getNextSINumber` call (currently line 119) with a branch:

```ts
const isServiceSale = /* result of the pre-pass: true if the (single) item type is 'service' */;
const siNumber = isTrainingMode ? null : (isServiceSale ? null : await getNextSINumber(connection));
const birOrNumber = isTrainingMode ? null : (isServiceSale ? await getNextBirOrNumber(connection) : null);
```

Both `sales_transactions` and `pos_transactions` INSERTs gain the `bir_or_number` column alongside the existing `si_number` column, writing whichever one is non-null for this sale (mirrors how `mc_number` was added as a sibling nullable column to the returns INSERT in migration 099).

Training-mode sales continue to burn neither number, for the same reason `si_number` is already skipped in training mode (CLAUDE.md: training sales are excluded from official BIR totals — must not create unexplained jumps in either series).

### 4. Receipt title and printed number

**`lib/receipt-generator.ts`** (`generateReceipt()`, currently line 178): the title decision changes from a pure function of `paymentMethod` to a pure function of document type — the cash/charge distinction is dropped from the title entirely on both sides (payment method remains visible lower on the receipt, in the existing `CASH:`/`CHARGE:` payment-section line, unchanged):

- Goods sale (`sale.siNumber` present) → title is always `SALES INVOICE`, replacing today's `CASH INVOICE`/`CHARGE INVOICE` distinction. Prints the `SI NO.:` line as today.
- Services sale (`sale.birOrNumber` present) → title is always `OFFICIAL RECEIPT`. Prints an `OR NO.:` line using the prefixed `bir_or_number` value instead of `SI NO.:`.

The browser-print `ReceiptView.tsx` component (already carrying `isReprint`/`isTrainingMode` as sibling flags on `saleDetails` per Batch 1's pattern) gets the same treatment, so both print paths agree — following the same "keep both ESC/POS and React paths in sync" discipline established in Batch 1.

### 5. Reports — split every SI-range query into an SI-range and an OR-range

Each of the following gets a second MIN/MAX (or sort-based begin/end) pair, scoped to `bir_or_number IS NOT NULL` rows, alongside the existing pair now explicitly scoped to `si_number IS NOT NULL` rows:

- **Z-reading** (`app/api/sales/z-reading/route.ts`): the sales-range, void-range, and return-range MIN/MAX queries (currently ~lines 133-134, 153-154, 168-169, and the per-shift variant ~62-63) each gain an OR counterpart. The printed report gains "Beg./End. OR #" lines alongside the existing "Beg./End. SI #" lines (`lib/receipt-generator.ts` / `lib/z-reading-generator.ts`, wherever `Beg. SI #`/`End. SI #` are currently emitted).
- **X-reading** (`app/api/sales/x-reading/route.ts:178-179`): same treatment, one additional pair.
- **By-date report** (`app/api/sales/by-date/route.ts:76-77`): the existing code already has a comment warning against mixing numbering schemes in one range (guarding against a *different* pre-existing mixing risk, SI vs. order number) — this batch adds the second, genuinely-needed OR pair the same way, with an equivalent guarding comment.
- **E-journal** (`app/api/sales/ejournal/route.ts:126-133`): the sort-and-take-first/last computation splits into two independent sorts, one over `si_number` values, one over `bir_or_number` values, each producing its own begin/end pair in the printed file.

### 6. `bir-summary` fix

**`app/api/sales/bir-summary/route.ts:47-48`**: change `MIN(st.receipt_number)`/`MAX(st.receipt_number)` to two pairs — `MIN(st.si_number)`/`MAX(st.si_number)` WHERE `si_number IS NOT NULL`, and `MIN(st.bir_or_number)`/`MAX(st.bir_or_number)` WHERE `bir_or_number IS NOT NULL` — so the report's existing "Beginning/Ending SI/OR No." label finally matches its data source. The UI (`app/(app)/reports/sales/bir-summary/page.tsx`) is updated to render both pairs distinctly rather than one combined "SI/OR" column.

## Testing

- Unit: `getNextBirOrNumber()` increments independently of `getNextSINumber()` and is rollback-safe on the same connection (mirroring existing `si-number.test.ts` / MC-number test coverage patterns).
- Unit: receipt title/number selection — a `standard`-only sale produces `SALES INVOICE` + `SI NO.`; a `service`-only sale produces `OFFICIAL RECEIPT` + `OR NO.`; verify both ESC/POS (`lib/receipt-generator.ts`) and browser (`ReceiptView.tsx`) paths agree, following Batch 1's cross-path consistency testing pattern.
- Integration/manual: attempt to add a service item to a cart already containing a standard item (and vice versa) in the POS UI — confirm the add is blocked with a clear message, and the cart is unchanged.
- Integration/manual: craft a mixed-type checkout request directly against the API (bypassing the UI) — confirm the server rejects it and neither counter is incremented (no gap created).
- Manual: run a mixed day (some goods sales, some services sales) through to a Z-reading — confirm both an SI range and an OR range print, each showing only that day's actual transactions of that type, with no cross-contamination.
- Manual: confirm training-mode sales (both goods and services) still burn neither `si_number` nor `bir_or_number`.
- Manual: confirm `bir-summary` for a day with both sale types shows two distinct, correct ranges, and no residual `receipt_number`-derived values.
