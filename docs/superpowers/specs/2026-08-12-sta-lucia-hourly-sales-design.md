# Sta. Lucia Hourly Sales Submission — Design

**Date:** 2026-08-12
**Status:** Approved, pending implementation plan

## Context

The Sta. Lucia Sale Consolidator API ("Sales Submission API Documentation v2",
MediaOne, June 23 2026) supports two submission kinds via the same
`POST /api/get-sales` endpoint, distinguished by `sale_type`:

- `sale_type: false` — End-of-Day (EOD), one per tenant per business date.
  **Already implemented** (`lib/integrations/sta-lucia/send-z-reading.ts`),
  triggered when a Z-reading is finalized.
- `sale_type: true` — Hourly, one per tenant per hour of the business date
  (validated by the hour component of `date_time`). **Not implemented.**
  This spec adds it.

See `docs/superpowers/specs/2026-07-31-sta-lucia-sales-consolidator-design.md`
for the original EOD design; this spec builds on the same provider/client
infrastructure rather than replacing it.

## Scope

In scope: automatic hourly aggregation and submission of store-wide sales
totals to Sta. Lucia, with retry-on-failure and catch-up for missed hours.

Out of scope (unchanged from the EOD spec): `company_id` (multi-store —
Verdix's Sta. Lucia tenant account is single-store), `is_reprocessed`/
`remarks` (EOD correction flow — hourly has no reprocess concept in the v2
doc at all).

## Components

1. **`lib/integrations/sta-lucia/hourly-payload.ts`** (new)
   Pure mapper: aggregated hourly totals → `StaLuciaSalesPayload` with
   `sale_type: true`. Mirrors `payload.ts`'s `buildSalesPayload()` shape but
   takes a pre-aggregated totals object instead of a `ZReadingLike`.

2. **`lib/integrations/sta-lucia/send-hourly-sales.ts`** (new)
   Orchestrator mirroring `send-z-reading.ts`: computes the hour window,
   runs the store-wide aggregation query, claims the hour via the new claim
   table, calls the shared `sendSales()` client, writes to
   `external_api_logs`, releases/keeps the claim per outcome. Also owns the
   catch-up sweep for missed hours (see Error Handling).

3. **New table `sta_lucia_hourly_submissions`**
   Same shape and semantics as `sta_lucia_submissions`, keyed by hour
   instead of Z-reading:
   ```sql
   CREATE TABLE sta_lucia_hourly_submissions (
     hour_start VARCHAR(19) PRIMARY KEY,  -- 'YYYY-MM-DD HH:00:00'
     claimed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
     succeeded  TINYINT(1) NOT NULL DEFAULT 0
   )
   ```

4. **`lib/scheduler.ts`** (modified)
   - New cron `5 * * * *` (:05 past every hour) calling
     `sendHourlyStaLuciaSales()` for the hour that just closed.
   - New `processHourlyStaLuciaRetries()`, swept alongside the existing
     `processStaLuciaRetries()` inside `processSyncQueue()`'s 2-minute cron.
   - One-time catch-up pass on scheduler start (see Error Handling).

5. **`lib/integrations/sta-lucia/client.ts`** (modified)
   `sendSales()` treats an HTTP 409 response as `{ success: true, duplicate:
   true }` instead of a failure. Applies to both EOD and hourly callers — a
   409 from this API always means "the mall already has this record," never
   a transient error, so retrying it forever (the current EOD behavior) is a
   latent bug this also fixes.

## Data Flow

### Identity

Each hour is keyed by `hour_start`, formatted `YYYY-MM-DD HH:00:00` in
Asia/Manila local time (e.g. `2026-08-12 13:00:00` for the 1–2 PM window).
This value is used as both the `sta_lucia_hourly_submissions` primary key
and the `external_api_logs.transaction_id` for a new
`transaction_type = 'STA_LUCIA_HOURLY_SALES'`. A re-run for an already-logged
hour is a no-op fast path, the same way `reading_number` dedupes Z-readings.

### Aggregation query

For a given `[hourStart, hourEnd)` (one hour, half-open):

- **Gross sales, discounts, transaction count** — same shape as the
  Z-reading's `salesSql` in `app/api/sales/z-reading/route.ts`, but:
  - no `AND pt.terminal_id = ?` (store-wide, all terminals)
  - date condition is `st.created_at >= ? AND st.created_at < ?` bound to
    the hour, not the business-date/shift range
- **VAT breakdown** (`vat_sales`, `vat_exempt_sales`, `non_vat_sales`,
  `vat_amount`) — same `pos_transaction_items.tax_type` GROUP BY as the
  Z-reading's `vatAdjustmentSql`, store-wide, same hour bound.
- **Payment methods** (for `credit`/`debit` split, same convention as
  `payload.ts`: `debit` = cash, `credit` = sum of non-cash tenders) — same
  `paymentSql` shape, store-wide, same hour bound.
- **Filters**, same as Z-reading: `pt.is_training = 0`,
  `st.status NOT IN ('Void', 'Voided', 'Cancelled', 'Returned')`.
- `net_sales` = gross − discounts. (No separate returns/void bucket needed
  here, unlike the Z-reading report, since those statuses are already
  excluded from the sum rather than reported as adjustments.)
- A zero-sales hour still produces and submits a zero-value payload — see
  Error Handling.

### Payload

```ts
{
  credit: number;        // non-cash tender sum for the hour
  debit: number;         // cash tender sum for the hour
  gross_sales: number;
  date_time: string;     // hourStart, 'yyyy-MM-dd HH:mm:ss'
  total_discounts: string; // percent-of-gross, same convention as EOD
  vat_exempt_sales: number;
  vat_sales: number;
  non_vat_sales: number;
  vat_amount: number;
  other_taxes: 0;
  net_sales: number;
  sale_type: true;
}
```

### Cron & retry

- `cron.schedule('5 * * * *', ...)` fires at :05 past every hour and submits
  the hour that just closed: `hourStart = floor(now, 1h) - 1h`. The 5-minute
  buffer avoids racing a checkout transaction still being written right at
  the hour boundary.
- `processHourlyStaLuciaRetries()` runs inside the existing 2-minute
  `processSyncQueue()` sweep, alongside (not merged with)
  `processStaLuciaRetries()` — same dedicated-`LIMIT` reasoning as the
  existing EOD sweep (a legacy backlog must not starve it), same
  `onErrorAction === 'retry'` gate, same 15-minute backoff via
  `next_retry_at`.
- A 409 from the mall (hour already recorded on their side) is treated as
  success by the shared `sendSales()` fix and logged accordingly — it does
  not re-enter the retry queue.

## Error Handling & Edge Cases

- **Scheduler down at :05** (machine off, POS closed overnight, Electron
  not running): the hour is never claimed — no row in
  `sta_lucia_hourly_submissions` or `external_api_logs`. On the next
  scheduler start, a one-time **catch-up pass** runs: find every closed hour
  since the later of (a) the first `sales_transactions.created_at` for the
  current business date, or (b) the most recent successfully-submitted hour,
  up to the most recently closed hour, that has no successful log — and
  enqueue each as a `pending` `external_api_logs` row so the normal retry
  sweep picks them up. This reuses the existing claim/retry machinery rather
  than adding a second code path.
- **Zero-sales hour** (e.g. 3–4 AM): still submits a zero-value payload
  rather than skipping. Skipping would be indistinguishable, to someone
  auditing gaps later, from a missed/crashed submission — better to have an
  explicit "zero sales" record on the mall's side.
- **At-least-once delivery**: identical trade-off to the EOD path — a crash
  between a successful send and the `succeeded = 1` write, or a timeout on a
  request the mall actually processed, can cause a duplicate submission for
  the same hour. The 409-as-success fix narrows the practical impact (the
  mall's own dedupe absorbs the retry) but does not eliminate the window,
  consistent with the EOD path's documented accepted risk.
- **`onErrorAction: 'log_only'` / `'queue'`**: no automatic retry, same as
  EOD — a failed hour sits in Sync Logs for manual retry. The Sync Logs UI
  renders `external_api_logs` generically (no special-casing found for
  `STA_LUCIA_SALES`), so the new `STA_LUCIA_HOURLY_SALES` type needs no UI
  changes.
- **Integration disabled**: `loadStaLuciaConfig()` returns `null` when no
  `enabled = 1` Sta Lucia row exists — both the hourly cron and the catch-up
  pass no-op immediately, same as EOD. One shared `enabled` toggle controls
  both EOD and hourly; no separate hourly on/off switch.

## Testing

- Unit test for the hourly payload mapper (`hourly-payload.test.ts`),
  mirroring `tests/unit/sta-lucia-payload.test.ts`: verifies field mapping,
  `sale_type: true`, discount-percent formatting, zero-sales-hour output.
- Extend `tests/e2e/sta-lucia-sync.spec.ts` (or a sibling spec) to cover: a
  completed hour with sales produces a correct submission; a 409 response is
  treated as success and does not requeue; a missed hour is picked up by the
  catch-up pass on next scheduler start.

## Migration

New migration (next available number) creating `sta_lucia_hourly_submissions`,
following the exact pattern of `106_sta_lucia_submission_claims.ts`.
