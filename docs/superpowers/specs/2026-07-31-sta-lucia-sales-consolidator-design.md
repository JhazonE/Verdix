# Sta. Lucia Sale Consolidator API Integration — Design

**Date:** 2026-07-31
**Status:** Approved for planning
**Source requirement:** `Sta Lucia POS API Requirements 100124_2.pdf` (MediaOne Software Solutions, © 2025)

---

## Purpose

Sta. Lucia malls run a Tenant Management System that consolidates each tenant's
daily sales. Tenants currently encode those numbers by hand. This integration
submits Verdix POS end-of-day figures to that system automatically, so the
store's sales appear in the mall's records without manual entry.

The integration is built inside the existing **External API Integrations**
feature (`/settings/external-api`) rather than as a standalone page, reusing its
API cards, sync logs, and retry queue.

---

## The external contract

Base domain is configurable. Production example is `sta-lucia-malls.com`; the
`get-transactions` example in the source PDF uses `sta-lucia-sys.com`, so the
domain must never be hardcoded.

| Purpose | Path | Method | Auth |
|---|---|---|---|
| Login | `{domain}/api/login` | POST | none (credentials in body) |
| Submit sales | `{domain}/api/get-sales` | POST | `Authorization: Bearer {token}` + `X-CUSTOM-TOKEN: {owner_token}` |
| Read transactions | `{domain}/api/get-transactions` | GET | same two headers |
| Logout | `{domain}/api/logout` | POST | `Authorization: Bearer {token}` |

### Login request / response

```json
// POST /api/login
{ "email": "user@example.com", "password": "user123" }
```

```json
// 200 response
{
  "status": 1,
  "role": "tenant",
  "token": "ehywdhysgcydsjhcdsjhj1jdsd…",
  "owner_token": "xclkvbnjaoshjfasd",
  "user": { "id": 101, "name": "John Doe", "email": "user@example.com", "status": 1 }
}
```

`status` is `1` active / `0` inactive. `role` is one of `admin`, `biller`,
`collector`, `operator`, `tenant`, `leaseadmin` — Verdix logs in as `tenant` but
does not branch on role. A login returning `status: 0` is treated as a failure.

### Sales request

```json
// POST /api/get-sales
{
  "credit": 1500.00,
  "debit": 200.00,
  "gross_sales": 1700.00,
  "date_time": "2025-09-24 14:30:00",
  "total_discounts": "10%",
  "vat_exempt_sales": 100.00,
  "vat_sales": 900.00,
  "non_vat_sales": 200.00,
  "vat_amount": 108.00,
  "other_taxes": 20.00,
  "net_sales": 1070.00,
  "sale_type": false
}
```

Every field is required except `debit` (defaults to 0), `company_id`
(required only for multi-store owners — out of scope here, see below), and
`sale_type`-dependent `is_reprocessed`/`remarks`. `total_discounts` is a
**string percentage** (`"10%"`), not an amount — this is the one field whose
type does not match its name.

**Updated 2026-08-05 per "Sales Submission API Documentation v2" (MediaOne,
June 23 2026):**

- `number_of_transactions` no longer exists in the contract. It was required
  in v1; the v2 field table and every v2 request/response example omit it
  entirely. `payload.ts` no longer sends it.
- `sale_type` (boolean, required) is new: `true` = hourly sale, `false` =
  end-of-day. Verdix only ever submits full-day Z-readings (see "Out of
  scope" below), so `buildSalesPayload()` always sets `sale_type: false`.
- `is_reprocessed` (boolean, optional, default `false`) and conditional
  `remarks` (required when `is_reprocessed` is `true`, max 1000 chars) are
  also new — they let the mall accept a one-time correction to an
  already-submitted EOD, within 24h of the original submission. **Not wired
  up in this codebase**: nothing here ever resends an already-succeeded
  Z-reading (see the fast-path skip in `sendZReadingToStaLucia()`), so there
  is no caller that would ever need to set these. If a future feature adds a
  manual "resend as correction" action, this is the field pair to use, and it
  needs a required remarks prompt in the UI per the mall's validation rule.

---

## Architecture

### Approach

A `provider` discriminator on the existing `external_apis` table. When
`provider = 'sta_lucia'`, the settings form collects login credentials instead
of an API key, and the send path dispatches to a Sta Lucia client module.

Two alternatives were rejected:

- **A generic configurable "login flow" auth type** — would let any tenant
  system be wired up from settings alone. Rejected: the Sta Lucia specifics
  (`X-CUSTOM-TOKEN`, percent-string discounts, the credit/debit split) cannot be
  expressed as configuration, so provider code would still be needed on top of a
  large and error-prone config surface. YAGNI.
- **A standalone feature with its own page, table, and routes** — rejected
  because it duplicates the sync-log, retry, and UI machinery that already
  exists and works.

### Modules

New folder `lib/integrations/sta-lucia/`:

| File | Responsibility | Depends on |
|---|---|---|
| `types.ts` | `StaLuciaCredentials`, `StaLuciaSalesPayload`, `StaLuciaLoginResponse` | — |
| `payload.ts` | Pure function `buildSalesPayload(zReading) → StaLuciaSalesPayload`. No I/O, no DB. | `types.ts` |
| `session.ts` | Read/write the cached `token` + `owner_token` for an API config | `types.ts`, `lib/mysql` |
| `client.ts` | `login()`, `sendSales()`, `getTransactions()`, `logout()`; handles one 401 re-login retry | all of the above |

`payload.ts` is isolated deliberately: it holds all the VAT and discount
arithmetic, which is the part most likely to be wrong and the part that most
needs testing without a network.

### Data model

Both changes ship as a numbered migration in `scripts/migrations/` **and** as an
additive guard in the existing `ensureTable()` in
`app/api/settings/external-api/route.ts`, following the `INFORMATION_SCHEMA`
column-check pattern already used there for the `role` column. The guard keeps
existing installs working without a migration run; the migration keeps fresh
installs correct.

**1. `external_apis` — new columns**

```sql
provider       ENUM('generic','sta_lucia') NOT NULL DEFAULT 'generic',
login_email    VARCHAR(255) NULL,
login_password VARCHAR(500) NULL
```

The existing `api_endpoint` column holds the **domain base** (e.g.
`http://localhost:3000/api/dev/mock-sta-lucia`). The client appends `/login`,
`/get-sales`, `/get-transactions`, and `/logout`.

**2. New `external_api_sessions` table**

```sql
CREATE TABLE IF NOT EXISTS external_api_sessions (
  api_id      VARCHAR(36) PRIMARY KEY,
  token       TEXT,
  owner_token VARCHAR(500),
  obtained_at TIMESTAMP NULL DEFAULT NULL,
  FOREIGN KEY (api_id) REFERENCES external_apis(id) ON DELETE CASCADE
)
```

Session state lives in its own table rather than as columns on `external_apis`
because `external_apis.updated_at` is `ON UPDATE CURRENT_TIMESTAMP` — storing a
rotating token there would make the configuration look edited on every token
refresh. Config and runtime state stay separate.

The source PDF gives no token TTL ("valid for the session"), so the token is
cached indefinitely and refreshed reactively on a 401.

### These are not Verdix credentials

`login_email` and `login_password` hold the **Sta. Lucia tenant account** — the
account the mall issues to the store alongside its lease. They are unrelated to
Verdix POS user accounts, which authenticate with a `username`, not an email
(see `app/api/auth/login/route.ts`).

The two must not be confused, and a form labelled only "Email" and "Password"
invites exactly that confusion: a store admin types their own Verdix login,
every submission fails with a 401, and the cause is not obvious from the sync
log. The UI therefore labels these fields **Tenant Email** and **Tenant
Password** under a "Sta. Lucia Tenant Account" heading, with helper text stating
plainly that these are not the Verdix login.

The email format is fixed by the external API (page 6 of the source PDF: "Email
linked to the tenant account") and cannot be substituted with a username.

### Credential storage

`login_password` is stored in the local MySQL database in plaintext, matching
how `api_key` and `bearer_token` are already stored in this table. This is a
deliberate consistency choice, not an endorsement: the whole table is
unencrypted secrets today, and encrypting one column while leaving the others
would be false assurance. Noted here so it is a known, visible property of the
system rather than an accident. The password field is masked in the UI and
excluded from sync-log payloads.

---

## Payload mapping

Source is the Z-reading object produced by `app/api/sales/z-reading/route.ts`.

| Sta Lucia field | Z-reading source | Notes |
|---|---|---|
| `credit` | Σ `paymentMethods[].amount` where `name.toUpperCase() !== 'CASH'` | non-cash tender |
| `debit` | `cashSales` | cash tender |
| `gross_sales` | `grossSales` | |
| `date_time` | `reportDate` formatted `yyyy-MM-dd HH:mm:ss` | matches PDF format |
| `total_discounts` | `(discounts / grossSales) * 100`, rounded to 2 dp, suffixed `%` | `"0%"` when `grossSales === 0` |
| `vat_exempt_sales` | `vatExempt` | |
| `vat_sales` | `vatSales` | |
| `non_vat_sales` | `nonVat` | |
| `vat_amount` | `vatAmount` | |
| `other_taxes` | `0.00` | Verdix models no taxes beyond VAT |
| `net_sales` | `netSales` | |
| `sale_type` | always `false` | Verdix only submits full-day Z-readings, never hourly |

`zeroRated` has no counterpart in the Sta Lucia schema and is not sent.

### Open question for MediaOne: does credit + debit sum to gross or net?

In the source PDF example, `credit + debit == gross_sales` (1500 + 200 = 1700).
In Verdix these two values sum to **net** sales instead.

The reason is structural, not a defect: `paymentMethods` is
`SUM(st.total) GROUP BY st.payment_method` over non-void, non-returned
transactions, and `st.total` is the transaction total *after* discounts. Tender
recorded at the drawer is necessarily net of discount — the customer never hands
over the discounted amount.

This design sends the true tender split, because that is the money actually
received and it is the only figure Verdix can state truthfully. If MediaOne
confirms they want the two fields to reconcile against `gross_sales` instead,
the change is confined to `payload.ts` and is a one-line adjustment.

**Action:** confirm with MediaOne before production cutover.

---

## Flow

### Automatic (primary)

1. Cashier finalizes a Z-reading.
2. The Z-reading is **committed to the database first**.
3. *After* the commit, outside its transaction, the Sta Lucia send fires.
4. Success or failure, the Z-reading stands.

The send is fire-and-forget by design. BIR Z-readings are legally significant
records with gapless sequential numbering; a third-party HTTP failure must never
be able to fail, delay, or roll back a Z-reading. A failed send surfaces as a
toast and a sync-log row, and is picked up by the retry queue.

### Manual

- **"Send Z-Reading"** button on the Sta Lucia API card — pick a Z-reading, send it.
- **`POST /api/integrations/sta-lucia/test`** — runs login → sample sales → logout
  against the configured domain and returns *the exact payload sent* alongside the
  raw response. This is the primary development feedback loop.

### Routes

| Route | Purpose |
|---|---|
| `POST /api/integrations/sta-lucia/send` | Body `{ apiId, zReadingId }`. Build, send, log. |
| `POST /api/integrations/sta-lucia/test` | Dry run; returns sent payload + raw response. |
| `app/api/dev/mock-sta-lucia/api/login/route.ts` | Mock: validates email/password present, returns a fixed token + owner_token. |
| `app/api/dev/mock-sta-lucia/api/get-sales/route.ts` | Mock: **rejects with 401 if `Authorization` or `X-CUSTOM-TOKEN` is missing**; echoes the received body. |
| `app/api/dev/mock-sta-lucia/api/get-transactions/route.ts` | Mock: returns a fixed `{ success, data }` shape. |
| `app/api/dev/mock-sta-lucia/api/logout/route.ts` | Mock: requires Bearer token; returns success. |

**The `api/` segment is doubled on purpose.** The configured endpoint is a
*domain base* and the client appends `/api/<name>`, so with a base of
`/api/dev/mock-sta-lucia` the actual route is
`/api/dev/mock-sta-lucia/api/get-sales`. Point a test config at the base only —
never at a path already ending in `/api`.

The mock endpoints are what makes the integration testable with no internet, no
credentials, and no data leaving the machine. They are the target for both
manual testing and the E2E suite.

---

## Error handling

- Honors the existing per-API `onErrorAction` (`retry` / `queue` / `log_only`)
  and the retry queue in `lib/scheduler.ts`, using
  `transaction_type = 'sta_lucia_sales'`. The Sync Logs tab and its per-row
  Retry button therefore work with no changes.
- **401 on send** → re-login once, retry the send once. If it fails again, record
  a failure. No further automatic re-login within a single attempt.
- Every attempt writes an `external_api_logs` row containing the full request
  payload and the response body.
- **Idempotency (revised during Task 5 review):** `transaction_id` is the
  Z-reading ID, and an existing-`success`-log check runs first as a fast path.
  That check alone is not sufficient: it is check-then-act, and
  `external_api_logs` deliberately permits duplicate success rows (see
  `scripts/migrations/095_dedupe_external_api_logs.ts`), so two concurrent sends
  — the finalize hook firing automatically and a manual click landing in the same
  window — could both pass it and submit the same day's sales twice. Philippine
  mall rent is commonly a percentage of reported sales, so a double submission
  double-reports revenue.

  The actual guard is an atomic claim in `sta_lucia_submissions`
  (`z_reading_id` PRIMARY KEY, `claimed_at`, `succeeded`), created by migration
  `104_sta_lucia_submission_claims.ts`. The sender INSERTs a claim row; a
  duplicate-key error means another send owns it. On success the claim is marked
  `succeeded = 1`; on failure it is deleted so retries can proceed. A claim older
  than 15 minutes still holding `succeeded = 0` is treated as abandoned and taken
  over — without that escape, a crash between claim and completion would block
  that Z-reading permanently, recoverable only by manual SQL.
- **Delivery is at-least-once, not exactly-once (accepted, documented risk).**
  The claim row removes concurrent double-sends and routine resends after a
  recorded success. It does not make double submission impossible. Two windows
  remain. (1) *Crash after send, before `succeeded = 1`:* `sendSales` returns
  success and the process dies before the UPDATE persists; the claim goes stale
  after 15 minutes and the next sweep re-sends. (2) *Timeout on a request the
  mall actually processed:* the POST is recorded by MediaOne but no response
  arrives within the configured timeout, so the claim is deleted, the attempt is
  logged `failed`, and a later retry submits the day again. The `sendSucceeded`
  guard in `send-z-reading.ts` prevents the *immediate* release in case (1) but
  not the *later* stale takeover. Closing either properly requires an
  idempotency key that MediaOne de-duplicates against, which is outside our
  control. Neither window is reachable without a crash or a >30 s timeout, so
  this is documented rather than engineered around; if a day's figures ever
  double at the mall, this is the cause, and the remedy is a manual correction
  with MediaOne plus the `sta_lucia_submissions` row for that Z-reading.
- **A failed attempt updates its existing log row rather than inserting a new
  one** (`writeLog` in `send-z-reading.ts`). `next_retry_at` defaults to NULL
  and the sweep reads NULL as "due now", so an always-INSERT logger would clone
  the row on every pass — saturating the sweep's `LIMIT 10` with live HTTP
  attempts and growing the table by thousands of rows a day during an outage.
  This mirrors the dedupe in `lib/services/api-sync-logger.ts`.
- **A terminal failure is parked, not retried.** If the `z_readings` row a log
  points at has been deleted, the send returns `permanent: true` and the row is
  moved to `status = 'abandoned'`, which the sweep's `WHERE` clause does not
  select. Otherwise it would re-resolve the same dead reference every 15 minutes
  forever.
- **The connection Test button is read-only.** It runs login →
  get-transactions → logout and never POSTs to `get-sales`. This overrides the
  "login → submit → read back → logout" flow described earlier in this
  document: the project owner ruled that a test must not write, because each
  run recorded a ₱0 sales entry dated today in the mall's system against a
  tenant billed on a percentage of reported sales, with no way to retract it.
  The sample payload is still built and returned for inspection.
- Network timeout uses the per-API configured `timeout` (default 30000 ms).

---

## Testing

1. **Unit — `payload.ts`.** Pure function, so tested directly: zero gross sales
   (guards divide-by-zero in the discount percentage), no cash tender, all-cash
   tender, discount percentage rounding to 2 dp, and full field-by-field mapping
   against a representative Z-reading.
2. **Mock endpoint contract.** `get-sales` returns 401 when either required
   header is absent, proving the client actually sends both.
3. **E2E (Playwright, port 3100).** Configure a `sta_lucia` API pointed at the
   mock, finalize a Z-reading, then assert an `external_api_logs` row exists with
   `status = 'success'` and a payload matching the expected mapping. A second
   send of the same Z-reading asserts the idempotency skip.

---

## UI changes

No new page. Three edits inside `app/(app)/settings/external-api/`:

- **`ApiFormDialog.tsx`** — a **Provider** dropdown at the top. When
  `sta_lucia` is selected, hide the API Key and Bearer Token fields and show:

  - **Domain** — base URL, e.g. `https://sta-lucia-malls.com`
  - A **"Sta. Lucia Tenant Account"** section heading, with helper text:
    *"Credentials issued by the Sta. Lucia mall for the Tenant Management
    System — not your Verdix login."*
  - **Tenant Email** and **Tenant Password** (masked) beneath it.
- **`ApiCard.tsx`** — a **Send Z-Reading** action on Sta Lucia cards.
- **`external-api-types.ts`** / **`lib/external-api-config.ts`** — add `provider`,
  `loginEmail`, and `loginPassword` to the `ExternalApi` type and the empty-form
  default.

The Sync Logs tab needs no changes.

---

## Out of scope

- Per-transaction (real-time) sales submission. The Sta Lucia API is a daily
  consolidator; Z-reading granularity is the correct fit.
- Consuming `get-transactions` for reconciliation. The client method exists and
  is exercised by the test route, but nothing in the UI reads it yet.
- Multi-tenant support. One store, one `owner_token`, matching the Verdix
  single-store deployment model.
