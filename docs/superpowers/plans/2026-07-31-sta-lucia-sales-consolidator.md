# Sta. Lucia Sale Consolidator Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Submit Verdix POS Z-reading sales figures to the Sta. Lucia Tenant Management System automatically, from inside the existing External API Integrations feature, testable end-to-end against local mock endpoints.

**Architecture:** A `provider` discriminator column on the existing `external_apis` table routes Sta Lucia configs to a dedicated client module in `lib/integrations/sta-lucia/`. A pure payload mapper converts a Z-reading into the external schema. Sends fire after the Z-reading is committed and can never fail it. All existing sync-log and retry infrastructure is reused.

**Tech Stack:** Next.js 16 App Router route handlers, raw `mysql2/promise` via `lib/mysql.ts`, `date-fns` for formatting, `uuid` v4, shadcn/ui components, `tsx`-based unit test runner, Playwright for E2E.

**Spec:** `docs/superpowers/specs/2026-07-31-sta-lucia-sales-consolidator-design.md`

## Global Constraints

- **No ORM.** All database access is raw SQL through `query()` from `@/lib/mysql`.
- **MySQL 8 only.** No abstraction layer.
- **BIR Z-readings are legally significant.** The Sta Lucia send must never fail, delay, block, or roll back a Z-reading. It fires after the row is committed, as a detached promise with a `.catch()`.
- **Unit tests self-execute on import.** Each file in `tests/unit/` uses `node:assert/strict`, runs its assertions at module top level, and ends with a `console.log('<name>: all assertions passed')`. Every new test file must be registered in `tests/unit/run.ts`. Run with `npm run test:unit`.
- **E2E tests never import from `lib/`.** The Playwright process points at the dev `verdix` database while the test server points at `verdix_test`. Use `testQuery` from `./helpers/db`. Tests run sequentially (`workers: 1`).
- **Schema changes ship twice:** as a numbered migration in `scripts/migrations/` (registered in `scripts/migrations/index.ts`) *and* as an additive `INFORMATION_SCHEMA`-guarded check in the existing `ensureTable()` so existing installs self-heal without a migration run.
- **The Sta Lucia domain is never hardcoded.** It comes from `external_apis.api_endpoint`.
- **`total_discounts` is a string percentage** (e.g. `"12.5%"`), not an amount. This is the external API's contract.
- **Provider enum values:** `'generic' | 'sta_lucia'`. Log `transaction_type` for these syncs is exactly `'STA_LUCIA_SALES'`.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/integrations/sta-lucia/types.ts` | Payload, credential, and response types. No logic. |
| `lib/integrations/sta-lucia/payload.ts` | Pure `buildSalesPayload()`. All VAT/discount arithmetic. No I/O. |
| `lib/integrations/sta-lucia/session.ts` | Read/write cached token + owner_token in `external_api_sessions`. |
| `lib/integrations/sta-lucia/client.ts` | `login()`, `sendSales()`, `getTransactions()`, `logout()`, 401 re-login. |
| `lib/integrations/sta-lucia/send-z-reading.ts` | Orchestration: load config + Z-reading, build, send, log, enforce idempotency. Lives in `lib/` so the Z-reading route and the scheduler can import it without importing a route module. |
| `app/api/dev/mock-sta-lucia/api/{login,get-sales,get-transactions,logout}/route.ts` | Local mock of the external API. The nested `api/` segment is required: the client appends `/api/login` etc. to the configured domain, so the mock base must behave like a domain root. |
| `app/api/integrations/sta-lucia/send/route.ts` | Thin HTTP wrapper over `send-z-reading.ts`. |
| `app/api/integrations/sta-lucia/test/route.ts` | Dry run; returns exact payload sent + raw response. |
| `scripts/migrations/103_sta_lucia_integration.ts` | Schema changes. |
| `tests/unit/sta-lucia-payload.test.ts` | Unit tests for the mapper. |
| `tests/e2e/sta-lucia-sync.spec.ts` | End-to-end send against the mock. |

Modified: `app/api/settings/external-api/route.ts`, `app/api/settings/external-api/[id]/route.ts`, `lib/external-api-config.ts`, `app/(app)/settings/external-api/{external-api-types.ts,ApiFormDialog.tsx,ApiCard.tsx,use-external-api.ts,ApiConnectionsTab.tsx,page.tsx}`, `app/api/sales/z-reading/route.ts`, `lib/scheduler.ts`, `scripts/migrations/index.ts`, `tests/unit/run.ts`.

---

## Task 1: Types and the pure payload mapper

The mapper is built first because everything else consumes its output type, and because it holds the arithmetic most worth testing.

**Files:**
- Create: `lib/integrations/sta-lucia/types.ts`
- Create: `lib/integrations/sta-lucia/payload.ts`
- Create: `tests/unit/sta-lucia-payload.test.ts`
- Modify: `tests/unit/run.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `StaLuciaSalesPayload`, `StaLuciaLoginResponse`, `StaLuciaCredentials`, `ZReadingLike` (types); `buildSalesPayload(z: ZReadingLike): StaLuciaSalesPayload`.

- [ ] **Step 1: Write the types file**

Create `lib/integrations/sta-lucia/types.ts`:

```ts
/**
 * Types for the Sta. Lucia Tenant Management System "Sale Consolidator" API.
 * Field names and types are dictated by the external contract — see
 * docs/superpowers/specs/2026-07-31-sta-lucia-sales-consolidator-design.md
 */

/** Credentials issued by the mall for the tenant account. NOT a Verdix login. */
export interface StaLuciaCredentials {
  email: string;
  password: string;
}

export interface StaLuciaLoginResponse {
  status: number | boolean;
  role?: string;
  token: string;
  owner_token: string;
  user?: { id: number; name: string; email: string; status: number };
}

export interface StaLuciaSalesPayload {
  credit: number;
  debit: number;
  gross_sales: number;
  date_time: string;
  /** String percentage, e.g. "12.5%". Named "total_discounts" but is not an amount. */
  total_discounts: string;
  vat_exempt_sales: number;
  vat_sales: number;
  non_vat_sales: number;
  vat_amount: number;
  other_taxes: number;
  net_sales: number;
  number_of_transactions: number;
}

/**
 * The subset of a Verdix Z-reading the mapper needs. Declared structurally so
 * the mapper stays a pure function with no dependency on the Z-reading route.
 */
export interface ZReadingLike {
  id: string;
  reportDate: Date | string;
  grossSales: number;
  netSales: number;
  discounts: number;
  vatSales: number;
  vatAmount: number;
  vatExempt: number;
  nonVat: number;
  transactionCount: number;
  cashSales: number;
  paymentMethods: Array<{ name: string; amount: number }>;
}

/** Cached session for one configured API. */
export interface StaLuciaSession {
  token: string;
  ownerToken: string;
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/unit/sta-lucia-payload.test.ts`:

```ts
import assert from 'node:assert/strict';
import { buildSalesPayload } from '../../lib/integrations/sta-lucia/payload';
import type { ZReadingLike } from '../../lib/integrations/sta-lucia/types';

const base: ZReadingLike = {
  id: 'Z-000001',
  reportDate: '2026-07-31 18:30:00',
  grossSales: 1700,
  netSales: 1530,
  discounts: 170,
  vatSales: 900,
  vatAmount: 108,
  vatExempt: 100,
  nonVat: 200,
  transactionCount: 42,
  cashSales: 200,
  paymentMethods: [
    { name: 'CASH', amount: 200 },
    { name: 'GCash', amount: 800 },
    { name: 'Credit Card', amount: 530 },
  ],
};

// --- full field mapping ---
const p = buildSalesPayload(base);
assert.equal(p.gross_sales, 1700, 'gross_sales maps straight through');
assert.equal(p.net_sales, 1530, 'net_sales maps straight through');
assert.equal(p.vat_sales, 900, 'vat_sales from vatSales');
assert.equal(p.vat_amount, 108, 'vat_amount from vatAmount');
assert.equal(p.vat_exempt_sales, 100, 'vat_exempt_sales from vatExempt');
assert.equal(p.non_vat_sales, 200, 'non_vat_sales from nonVat');
assert.equal(p.number_of_transactions, 42, 'transaction count maps');
assert.equal(p.other_taxes, 0, 'other_taxes is always 0 — Verdix models no tax beyond VAT');

// --- credit/debit split: credit = non-cash tender, debit = cash tender ---
assert.equal(p.debit, 200, 'debit is cash tender');
assert.equal(p.credit, 1330, 'credit is the sum of every non-CASH tender (800 + 530)');

// --- date formatting ---
assert.equal(p.date_time, '2026-07-31 18:30:00', 'date_time uses yyyy-MM-dd HH:mm:ss');
assert.equal(
  buildSalesPayload({ ...base, reportDate: new Date(2026, 0, 5, 9, 7, 3) }).date_time,
  '2026-01-05 09:07:03',
  'Date objects format with zero-padding',
);

// --- total_discounts is a percentage STRING ---
assert.equal(p.total_discounts, '10%', '170/1700 = 10%, trailing zeros trimmed');
assert.equal(
  buildSalesPayload({ ...base, discounts: 212.5 }).total_discounts,
  '12.5%',
  'fractional percentages keep one decimal',
);
assert.equal(
  buildSalesPayload({ ...base, discounts: 100 }).total_discounts,
  '5.88%',
  'percentages round to 2 decimal places',
);

// --- divide-by-zero guard: a Z-reading with no sales at all ---
const empty = buildSalesPayload({
  ...base,
  grossSales: 0, netSales: 0, discounts: 0, vatSales: 0, vatAmount: 0,
  vatExempt: 0, nonVat: 0, transactionCount: 0, cashSales: 0, paymentMethods: [],
});
assert.equal(empty.total_discounts, '0%', 'zero gross sales must not produce NaN%');
assert.equal(empty.credit, 0, 'no tender means zero credit');
assert.equal(empty.debit, 0, 'no tender means zero debit');

// --- tender edge cases ---
assert.equal(
  buildSalesPayload({ ...base, cashSales: 0, paymentMethods: [{ name: 'GCash', amount: 1530 }] }).credit,
  1530,
  'all non-cash goes to credit',
);
assert.equal(
  buildSalesPayload({ ...base, paymentMethods: [{ name: 'cash', amount: 200 }] }).credit,
  0,
  'CASH match is case-insensitive, so lowercase cash is not counted as credit',
);
assert.equal(
  buildSalesPayload({ ...base, paymentMethods: [{ name: 'CASH', amount: 200 }] }).credit,
  0,
  'a cash-only reading has zero credit',
);

// --- rounding: floating point tender must not leak into the payload ---
assert.equal(
  buildSalesPayload({
    ...base,
    paymentMethods: [{ name: 'GCash', amount: 0.1 }, { name: 'Card', amount: 0.2 }],
  }).credit,
  0.3,
  'credit is rounded to 2dp, not 0.30000000000000004',
);

console.log('sta-lucia-payload: all assertions passed');
```

- [ ] **Step 3: Register the test in the runner**

Add to the end of the import list in `tests/unit/run.ts`:

```ts
import './sta-lucia-payload.test';
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm run test:unit`
Expected: FAIL — `Cannot find module '../../lib/integrations/sta-lucia/payload'`

- [ ] **Step 5: Write the mapper**

Create `lib/integrations/sta-lucia/payload.ts`:

```ts
import { format } from 'date-fns';
import type { StaLuciaSalesPayload, ZReadingLike } from './types';

/** Money rounded to 2dp without floating-point tails (0.1 + 0.2 -> 0.3). */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Discounts as a string percentage of gross sales, e.g. "12.5%".
 *
 * The external field is called `total_discounts` but its type is a percentage
 * string, not an amount — that is their contract, not a mistake here.
 * A Z-reading with no sales would divide by zero, so it yields "0%".
 */
function discountPercent(discounts: number, grossSales: number): string {
  if (!grossSales) return '0%';
  const pct = round2((discounts / grossSales) * 100);
  return `${pct}%`;
}

/**
 * Convert a Verdix Z-reading into the Sta. Lucia sales payload.
 *
 * `credit` is non-cash tender and `debit` is cash tender. Note that in Verdix
 * these sum to NET sales, not gross: tender is recorded after discounts, since
 * the customer never hands over the undiscounted amount. The source PDF's
 * example has them summing to gross. Sending true tender is the only figure
 * Verdix can state honestly; confirm the expectation with MediaOne before
 * production cutover. If they want gross reconciliation, change it here.
 */
export function buildSalesPayload(z: ZReadingLike): StaLuciaSalesPayload {
  const nonCash = z.paymentMethods
    .filter(pm => String(pm.name).toUpperCase() !== 'CASH')
    .reduce((sum, pm) => sum + (Number(pm.amount) || 0), 0);

  return {
    credit: round2(nonCash),
    debit: round2(z.cashSales),
    gross_sales: round2(z.grossSales),
    date_time: format(new Date(z.reportDate), 'yyyy-MM-dd HH:mm:ss'),
    total_discounts: discountPercent(z.discounts, z.grossSales),
    vat_exempt_sales: round2(z.vatExempt),
    vat_sales: round2(z.vatSales),
    non_vat_sales: round2(z.nonVat),
    vat_amount: round2(z.vatAmount),
    other_taxes: 0,
    net_sales: round2(z.netSales),
    number_of_transactions: Math.trunc(z.transactionCount) || 0,
  };
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm run test:unit`
Expected: PASS — `sta-lucia-payload: all assertions passed`

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add lib/integrations/sta-lucia/types.ts lib/integrations/sta-lucia/payload.ts tests/unit/sta-lucia-payload.test.ts tests/unit/run.ts
git commit -m "feat(sta-lucia): add sales payload types and pure mapper"
```

---

## Task 2: Schema — provider columns and session table

**Files:**
- Create: `scripts/migrations/103_sta_lucia_integration.ts`
- Modify: `scripts/migrations/index.ts`
- Modify: `app/api/settings/external-api/route.ts`
- Modify: `app/api/settings/external-api/[id]/route.ts`
- Modify: `lib/external-api-config.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `external_apis.provider`, `external_apis.login_email`, `external_apis.login_password`; the `external_api_sessions` table; `ExternalApi` type gains `provider`, `loginEmail`, `loginPassword`; `rowToApi()` returns them; POST and PUT persist them.

- [ ] **Step 1: Write the migration**

Create `scripts/migrations/103_sta_lucia_integration.ts`:

```ts
import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

/**
 * Sta. Lucia Tenant Management System integration schema.
 *
 * `provider` discriminates rows in external_apis so a Sta Lucia config can
 * carry tenant-account credentials instead of an API key.
 *
 * The session token lives in its own table rather than as columns on
 * external_apis because that table's `updated_at` is ON UPDATE
 * CURRENT_TIMESTAMP — a rotating token stored there would make the
 * configuration appear edited on every refresh.
 */
const migration: Migration = {
  name: '103_sta_lucia_integration',
  timestamp: '2026-07-31_09-00-00',

  async up(): Promise<void> {
    const cols: any = await query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'external_apis'
    `);
    const have = new Set((cols as any[]).map(c => c.COLUMN_NAME));

    if (!have.has('provider')) {
      await query(`ALTER TABLE external_apis
        ADD COLUMN provider ENUM('generic','sta_lucia') NOT NULL DEFAULT 'generic'`);
      console.log('✅ Added external_apis.provider');
    }
    if (!have.has('login_email')) {
      await query(`ALTER TABLE external_apis ADD COLUMN login_email VARCHAR(255) NULL`);
      console.log('✅ Added external_apis.login_email');
    }
    if (!have.has('login_password')) {
      await query(`ALTER TABLE external_apis ADD COLUMN login_password VARCHAR(500) NULL`);
      console.log('✅ Added external_apis.login_password');
    }

    await query(`
      CREATE TABLE IF NOT EXISTS external_api_sessions (
        api_id      VARCHAR(36) PRIMARY KEY,
        token       TEXT,
        owner_token VARCHAR(500),
        obtained_at TIMESTAMP NULL DEFAULT NULL,
        CONSTRAINT fk_eas_api FOREIGN KEY (api_id)
          REFERENCES external_apis(id) ON DELETE CASCADE
      )
    `);
    console.log('✅ external_api_sessions ready');
  },

  async down(): Promise<void> {
    await query(`DROP TABLE IF EXISTS external_api_sessions`);

    const cols: any = await query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'external_apis'
    `);
    const have = new Set((cols as any[]).map(c => c.COLUMN_NAME));

    for (const col of ['login_password', 'login_email', 'provider']) {
      if (have.has(col)) {
        await query(`ALTER TABLE external_apis DROP COLUMN ${col}`);
        console.log(`✅ Dropped external_apis.${col}`);
      }
    }
  }
};

registerMigration(migration);
```

- [ ] **Step 2: Register the migration**

Append to `scripts/migrations/index.ts`, after the `102_unique_sales_order_reference` import:

```ts
import './103_sta_lucia_integration';
```

- [ ] **Step 3: Run the migration**

Run: `npm run migrate`
Expected: `✅ Added external_apis.provider`, `✅ Added external_apis.login_email`, `✅ Added external_apis.login_password`, `✅ external_api_sessions ready`

- [ ] **Step 4: Extend `ensureTable()` so existing installs self-heal**

In `app/api/settings/external-api/route.ts`, replace the whole `ensureTable` function with this. It generalises the existing single-column `role` check into a loop over every additive column, and creates the sessions table:

```ts
const ADDITIVE_COLUMNS: Array<[string, string]> = [
  ['role',           `ENUM('general','cloud_sync') NOT NULL DEFAULT 'general'`],
  ['provider',       `ENUM('generic','sta_lucia') NOT NULL DEFAULT 'generic'`],
  ['login_email',    `VARCHAR(255) NULL`],
  ['login_password', `VARCHAR(500) NULL`],
];

async function ensureTable() {
  await query(INIT_TABLE, []);

  const cols = await query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'external_apis'`,
    []
  ) as any[];
  const have = new Set(cols.map((c: any) => c.COLUMN_NAME));

  for (const [name, ddl] of ADDITIVE_COLUMNS) {
    if (!have.has(name)) {
      await query(`ALTER TABLE external_apis ADD COLUMN ${name} ${ddl}`, []);
    }
  }

  await query(`
    CREATE TABLE IF NOT EXISTS external_api_sessions (
      api_id      VARCHAR(36) PRIMARY KEY,
      token       TEXT,
      owner_token VARCHAR(500),
      obtained_at TIMESTAMP NULL DEFAULT NULL,
      CONSTRAINT fk_eas_api FOREIGN KEY (api_id)
        REFERENCES external_apis(id) ON DELETE CASCADE
    )
  `, []);
}
```

Also add the three columns to the `INIT_TABLE` DDL string so fresh installs get them directly. Insert these lines immediately before the `role` line:

```sql
    provider ENUM('generic','sta_lucia') NOT NULL DEFAULT 'generic',
    login_email VARCHAR(255),
    login_password VARCHAR(500),
```

- [ ] **Step 5: Return the new fields from `rowToApi`**

`rowToApi` is duplicated in both `app/api/settings/external-api/route.ts` and `app/api/settings/external-api/[id]/route.ts`. Add these three lines to the returned object in **both** files, immediately after the `role:` line:

```ts
    provider: row.provider ?? 'generic',
    loginEmail: row.login_email ?? '',
    loginPassword: row.login_password ?? '',
```

- [ ] **Step 6: Persist the new fields on create**

In `app/api/settings/external-api/route.ts`, in `POST`:

Add `provider, loginEmail, loginPassword` to the destructured `body`. Then replace the INSERT with:

```ts
    await query(
      `INSERT INTO external_apis
        (id, name, description, enabled, api_endpoint, auth_type, api_key, bearer_token,
         allowed_methods, timeout, retry_attempts, retry_delay, sync_mode, on_error_action, role,
         provider, login_email, login_password)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id, name.trim(), description ?? '', enabled ? 1 : 0, apiEndpoint.trim(),
        authType ?? 'none', apiKey ?? '', bearerToken ?? '',
        allowedMethods ?? 'full_access',
        timeout ?? 30000, retryAttempts ?? 3, retryDelay ?? 2000,
        syncMode ?? 'realtime', onErrorAction ?? 'log_only',
        role === 'cloud_sync' ? 'cloud_sync' : 'general',
        provider === 'sta_lucia' ? 'sta_lucia' : 'generic',
        loginEmail ?? '', loginPassword ?? '',
      ]
    );
```

- [ ] **Step 7: Persist the new fields on update**

In `app/api/settings/external-api/[id]/route.ts`, in the "Normal update" branch:

Add `provider, loginEmail, loginPassword` to the destructured `body`, then replace the UPDATE with:

```ts
    await query(
      `UPDATE external_apis SET
        name = ?, description = ?, enabled = ?, api_endpoint = ?, auth_type = ?,
        api_key = ?, bearer_token = ?, allowed_methods = ?,
        timeout = ?, retry_attempts = ?, retry_delay = ?, sync_mode = ?, on_error_action = ?,
        role = ?, provider = ?, login_email = ?, login_password = ?
       WHERE id = ?`,
      [
        name.trim(), description ?? '', enabled ? 1 : 0, apiEndpoint.trim(),
        authType ?? 'none', apiKey ?? '', bearerToken ?? '',
        allowedMethods ?? 'full_access',
        timeout ?? 30000, retryAttempts ?? 3, retryDelay ?? 2000,
        syncMode ?? 'realtime', onErrorAction ?? 'log_only',
        role === 'cloud_sync' ? 'cloud_sync' : 'general',
        provider === 'sta_lucia' ? 'sta_lucia' : 'generic',
        loginEmail ?? '', loginPassword ?? '',
        id,
      ]
    );
```

- [ ] **Step 8: Extend the shared type**

In `lib/external-api-config.ts`, add above the `ExternalApi` type:

```ts
export type ApiProvider = 'generic' | 'sta_lucia';
```

Add these three fields to the `ExternalApi` type, after `role: ApiRole;`:

```ts
  provider: ApiProvider;
  /** Sta. Lucia tenant-account email. Not a Verdix login. */
  loginEmail?: string;
  loginPassword?: string;
```

And add to `DEFAULT_EXTERNAL_API`, after `role: 'general',`:

```ts
  provider: 'generic',
  loginEmail: '',
  loginPassword: '',
```

- [ ] **Step 9: Verify the schema landed**

Run:
```bash
node -e "require('dotenv').config();const m=require('mysql2/promise');(async()=>{const c=await m.createConnection({host:process.env.DB_HOST,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});const [r]=await c.query('SHOW COLUMNS FROM external_apis');console.log(r.map(x=>x.Field).join(', '));const [s]=await c.query('SHOW TABLES LIKE \"external_api_sessions\"');console.log('sessions table:', s.length===1);await c.end();})()"
```
Expected: the column list includes `provider, login_email, login_password`, and `sessions table: true`.

- [ ] **Step 10: Typecheck and commit**

Run: `npm run typecheck`
Expected: no errors.

```bash
git add scripts/migrations/103_sta_lucia_integration.ts scripts/migrations/index.ts app/api/settings/external-api lib/external-api-config.ts
git commit -m "feat(sta-lucia): add provider discriminator and session table"
```

---

## Task 3: Mock Sta Lucia endpoints

These come before the client so the client has something real to talk to. They are the reason this integration is testable without credentials or internet.

**Files:**
- Create: `app/api/dev/mock-sta-lucia/guard.ts`
- Create: `app/api/dev/mock-sta-lucia/api/login/route.ts`
- Create: `app/api/dev/mock-sta-lucia/api/get-sales/route.ts`
- Create: `app/api/dev/mock-sta-lucia/api/get-transactions/route.ts`
- Create: `app/api/dev/mock-sta-lucia/api/logout/route.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `blockedInProduction(): NextResponse | null`, plus four HTTP endpoints under `/api/dev/mock-sta-lucia/api/`. `login` returns the fixed values `token: 'MOCK_TOKEN_ehywdhysgcydsjhcdsjhj1jdsd'` and `owner_token: 'MOCK_OWNER_xclkvbnjaoshjfasd'`. `get-sales` echoes the received body at `received`.

> **The nested `api/` segment is mandatory.** The configured domain is a base
> (`http://localhost:3000/api/dev/mock-sta-lucia`) and the client appends
> `/api/login`, `/api/get-sales`, and so on — exactly as it would against
> `https://sta-lucia-malls.com`. Placing the handlers one level up would make
> every mock call 404.

- [ ] **Step 0: Write the production guard**

Every mock route calls this first. Without it, an installed POS terminal would
expose an unauthenticated endpoint that mints tokens and accepts sales.

Create `app/api/dev/mock-sta-lucia/guard.ts`:

```ts
import { NextResponse } from 'next/server';

/**
 * Mock endpoints exist for development and E2E only. In a production build they
 * must not exist at all — returning 404 rather than 403 keeps them invisible.
 *
 * The E2E suite runs with NODE_ENV=test on port 3100, so it is unaffected.
 */
export function blockedInProduction(): NextResponse | null {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return null;
}
```

- [ ] **Step 1: Write the login mock**

Create `app/api/dev/mock-sta-lucia/api/login/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { blockedInProduction } from '../../guard';

/**
 * Local stand-in for POST {domain}/api/login on the Sta. Lucia Tenant
 * Management System. Mirrors the response shape documented in the source PDF
 * so the integration can be exercised with no credentials and no internet.
 */
export const MOCK_TOKEN = 'MOCK_TOKEN_ehywdhysgcydsjhcdsjhj1jdsd';
export const MOCK_OWNER_TOKEN = 'MOCK_OWNER_xclkvbnjaoshjfasd';

export async function POST(request: NextRequest) {
  const blocked = blockedInProduction();
  if (blocked) return blocked;

  const body = await request.json().catch(() => ({}));
  const { email, password } = body ?? {};

  if (!email || !password) {
    return NextResponse.json(
      { status: 0, message: 'Email and password are required' },
      { status: 422 },
    );
  }

  // A specific address lets tests exercise the inactive-account path.
  if (email === 'inactive@example.com') {
    return NextResponse.json({ status: 0, message: 'Account is inactive' }, { status: 200 });
  }

  return NextResponse.json({
    status: 1,
    role: 'tenant',
    token: MOCK_TOKEN,
    owner_token: MOCK_OWNER_TOKEN,
    user: { id: 101, name: 'Mock Tenant', email, status: 1 },
  });
}
```

- [ ] **Step 2: Write the get-sales mock**

Create `app/api/dev/mock-sta-lucia/api/get-sales/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { blockedInProduction } from '../../guard';

/**
 * Local stand-in for POST {domain}/api/get-sales.
 *
 * Rejecting when either required header is absent is the point of this mock:
 * it proves the client actually sends both Authorization and X-CUSTOM-TOKEN,
 * which no amount of reading the client code can prove.
 */
export async function POST(request: NextRequest) {
  const blocked = blockedInProduction();
  if (blocked) return blocked;

  const auth = request.headers.get('authorization');
  const custom = request.headers.get('x-custom-token');

  if (!auth?.startsWith('Bearer ')) {
    return NextResponse.json(
      { success: false, message: 'Missing or malformed Authorization header' },
      { status: 401 },
    );
  }
  if (!custom) {
    return NextResponse.json(
      { success: false, message: 'Missing X-CUSTOM-TOKEN header' },
      { status: 401 },
    );
  }

  const received = await request.json().catch(() => null);
  if (!received) {
    return NextResponse.json({ success: false, message: 'Invalid JSON body' }, { status: 400 });
  }

  const required = [
    'credit', 'gross_sales', 'date_time', 'total_discounts', 'vat_exempt_sales',
    'vat_sales', 'non_vat_sales', 'vat_amount', 'other_taxes', 'net_sales',
    'number_of_transactions',
  ];
  const missing = required.filter(k => received[k] === undefined || received[k] === null);
  if (missing.length) {
    return NextResponse.json(
      { success: false, message: `Missing required fields: ${missing.join(', ')}` },
      { status: 422 },
    );
  }

  return NextResponse.json({
    success: true,
    message: 'Sales recorded',
    received,
  });
}
```

- [ ] **Step 3: Write the get-transactions mock**

Create `app/api/dev/mock-sta-lucia/api/get-transactions/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { blockedInProduction } from '../../guard';

/** Local stand-in for GET {domain}/api/get-transactions. */
export async function GET(request: NextRequest) {
  const blocked = blockedInProduction();
  if (blocked) return blocked;

  const auth = request.headers.get('authorization');
  const custom = request.headers.get('x-custom-token');

  if (!auth?.startsWith('Bearer ') || !custom) {
    return NextResponse.json(
      { success: false, message: 'Missing authentication headers' },
      { status: 401 },
    );
  }

  return NextResponse.json({
    success: true,
    data: {
      total_transactions: 2,
      total_amount: 3400.0,
      individual_sales: [
        { id: 1, gross_sales: 1700.0, date_time: '2026-07-30 18:00:00' },
        { id: 2, gross_sales: 1700.0, date_time: '2026-07-31 18:00:00' },
      ],
    },
  });
}
```

- [ ] **Step 4: Write the logout mock**

Create `app/api/dev/mock-sta-lucia/api/logout/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { blockedInProduction } from '../../guard';

/** Local stand-in for POST {domain}/api/logout. */
export async function POST(request: NextRequest) {
  const blocked = blockedInProduction();
  if (blocked) return blocked;

  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) {
    return NextResponse.json(
      { success: false, message: 'Missing Authorization header' },
      { status: 401 },
    );
  }
  return NextResponse.json({ success: true, message: 'Logged out' });
}
```

- [ ] **Step 5: Verify the mocks by hand**

Start the dev server (`npm run dev`) in one terminal, then run:

```bash
curl -s -X POST http://localhost:3000/api/dev/mock-sta-lucia/api/login \
  -H "Content-Type: application/json" \
  -d '{"email":"tenant@example.com","password":"secret"}'
```
Expected: JSON with `"status":1`, a `token`, and an `owner_token`.

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/dev/mock-sta-lucia/api/get-sales \
  -H "Content-Type: application/json" -d '{}'
```
Expected: `401` — no headers were sent.

```bash
curl -s -X POST http://localhost:3000/api/dev/mock-sta-lucia/api/get-sales \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer MOCK_TOKEN_ehywdhysgcydsjhcdsjhj1jdsd" \
  -H "X-CUSTOM-TOKEN: MOCK_OWNER_xclkvbnjaoshjfasd" \
  -d '{"credit":1330,"debit":200,"gross_sales":1700,"date_time":"2026-07-31 18:30:00","total_discounts":"10%","vat_exempt_sales":100,"vat_sales":900,"non_vat_sales":200,"vat_amount":108,"other_taxes":0,"net_sales":1530,"number_of_transactions":42}'
```
Expected: `"success":true` with the body echoed back under `received`.

- [ ] **Step 6: Verify the production guard**

Run: `NODE_ENV=production npx tsx -e "process.env.NODE_ENV='production'; import('./app/api/dev/mock-sta-lucia/guard').then(m => console.log('blocked in prod:', m.blockedInProduction()?.status === 404))"`
Expected: `blocked in prod: true`

- [ ] **Step 7: Commit**

```bash
git add app/api/dev/mock-sta-lucia
git commit -m "feat(sta-lucia): add local mock endpoints for the consolidator API"
```

---

## Task 4: Session cache and API client

**Files:**
- Create: `lib/integrations/sta-lucia/session.ts`
- Create: `lib/integrations/sta-lucia/client.ts`

**Interfaces:**
- Consumes: `StaLuciaSession`, `StaLuciaSalesPayload`, `StaLuciaLoginResponse`, `StaLuciaCredentials` from `./types` (Task 1); `external_api_sessions` (Task 2); the mock endpoints (Task 3).
- Produces:
  - `getSession(apiId: string): Promise<StaLuciaSession | null>`
  - `saveSession(apiId: string, session: StaLuciaSession): Promise<void>`
  - `clearSession(apiId: string): Promise<void>`
  - `StaLuciaApiConfig` — `{ id: string; apiEndpoint: string; loginEmail: string; loginPassword: string; timeout: number; onErrorAction: 'retry' | 'queue' | 'log_only' }`
  - `SendResult` — `{ success: boolean; status?: number; response?: unknown; error?: string }`
  - `login(cfg: StaLuciaApiConfig): Promise<StaLuciaSession>`
  - `sendSales(cfg: StaLuciaApiConfig, payload: StaLuciaSalesPayload): Promise<SendResult>`
  - `getTransactions(cfg: StaLuciaApiConfig): Promise<SendResult>`
  - `logout(cfg: StaLuciaApiConfig): Promise<SendResult>`

- [ ] **Step 1: Write the session module**

Create `lib/integrations/sta-lucia/session.ts`:

```ts
import { query } from '@/lib/mysql';
import type { StaLuciaSession } from './types';

/**
 * Cached tenant session for one configured API.
 *
 * The source PDF gives no token TTL ("valid for the session"), so tokens are
 * cached indefinitely and refreshed reactively when the server answers 401.
 */
export async function getSession(apiId: string): Promise<StaLuciaSession | null> {
  const rows = await query(
    'SELECT token, owner_token FROM external_api_sessions WHERE api_id = ?',
    [apiId],
  ) as any[];

  const row = rows?.[0];
  if (!row?.token || !row?.owner_token) return null;

  return { token: row.token, ownerToken: row.owner_token };
}

export async function saveSession(apiId: string, session: StaLuciaSession): Promise<void> {
  await query(
    `INSERT INTO external_api_sessions (api_id, token, owner_token, obtained_at)
     VALUES (?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE
       token = VALUES(token),
       owner_token = VALUES(owner_token),
       obtained_at = VALUES(obtained_at)`,
    [apiId, session.token, session.ownerToken],
  );
}

export async function clearSession(apiId: string): Promise<void> {
  await query('DELETE FROM external_api_sessions WHERE api_id = ?', [apiId]);
}
```

- [ ] **Step 2: Write the client**

Create `lib/integrations/sta-lucia/client.ts`:

```ts
import type { StaLuciaSalesPayload, StaLuciaSession, StaLuciaLoginResponse } from './types';
import { getSession, saveSession, clearSession } from './session';

export interface StaLuciaApiConfig {
  id: string;
  /** Domain base, e.g. https://sta-lucia-malls.com — paths are appended. */
  apiEndpoint: string;
  loginEmail: string;
  loginPassword: string;
  timeout: number;
  /** Only 'retry' opts a failed submission into the automatic sweep. */
  onErrorAction: 'retry' | 'queue' | 'log_only';
}

export interface SendResult {
  success: boolean;
  status?: number;
  response?: unknown;
  error?: string;
}

function url(cfg: StaLuciaApiConfig, path: string): string {
  return `${cfg.apiEndpoint.replace(/\/+$/, '')}${path}`;
}

function authHeaders(session: StaLuciaSession): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Authorization': `Bearer ${session.token}`,
    'X-CUSTOM-TOKEN': session.ownerToken,
  };
}

/**
 * Authenticate with the tenant account and cache the resulting session.
 *
 * `status: 0` means the tenant account is inactive. That arrives with HTTP 200,
 * so it must be checked explicitly or an inactive account would look like a
 * successful login with an empty token.
 */
export async function login(cfg: StaLuciaApiConfig): Promise<StaLuciaSession> {
  if (!cfg.loginEmail || !cfg.loginPassword) {
    throw new Error('Sta Lucia tenant email and password are required');
  }

  const res = await fetch(url(cfg, '/api/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ email: cfg.loginEmail, password: cfg.loginPassword }),
    signal: AbortSignal.timeout(cfg.timeout || 30000),
  });

  const data = await res.json().catch(() => ({})) as Partial<StaLuciaLoginResponse> & { message?: string };

  if (!res.ok) {
    throw new Error(`Login failed (${res.status}): ${data.message ?? res.statusText}`);
  }
  if (data.status === 0 || data.status === false) {
    throw new Error(`Login rejected: tenant account is inactive${data.message ? ` — ${data.message}` : ''}`);
  }
  if (!data.token || !data.owner_token) {
    throw new Error('Login response did not contain token and owner_token');
  }

  const session: StaLuciaSession = { token: data.token, ownerToken: data.owner_token };
  await saveSession(cfg.id, session);
  return session;
}

/** Return the cached session, logging in if there is none. */
async function ensureSession(cfg: StaLuciaApiConfig): Promise<StaLuciaSession> {
  return (await getSession(cfg.id)) ?? (await login(cfg));
}

/**
 * Submit a daily sales record.
 *
 * On 401 the cached token is discarded, a fresh login is performed, and the
 * send is retried exactly once. A second 401 is reported as a failure rather
 * than looping.
 */
export async function sendSales(
  cfg: StaLuciaApiConfig,
  payload: StaLuciaSalesPayload,
): Promise<SendResult> {
  try {
    let session = await ensureSession(cfg);

    let res = await fetch(url(cfg, '/api/get-sales'), {
      method: 'POST',
      headers: authHeaders(session),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(cfg.timeout || 30000),
    });

    if (res.status === 401) {
      await clearSession(cfg.id);
      session = await login(cfg);
      res = await fetch(url(cfg, '/api/get-sales'), {
        method: 'POST',
        headers: authHeaders(session),
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(cfg.timeout || 30000),
      });
    }

    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      return {
        success: false,
        status: res.status,
        response: body,
        error: `Sales submission failed (${res.status}): ${(body as any)?.message ?? res.statusText}`,
      };
    }

    return { success: true, status: res.status, response: body };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

/** Read back consolidated transactions. Exposed for the test route; no UI consumes it yet. */
export async function getTransactions(cfg: StaLuciaApiConfig): Promise<SendResult> {
  try {
    const session = await ensureSession(cfg);
    const res = await fetch(url(cfg, '/api/get-transactions'), {
      method: 'GET',
      headers: authHeaders(session),
      signal: AbortSignal.timeout(cfg.timeout || 30000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { success: false, status: res.status, response: body, error: `HTTP ${res.status}` };
    }
    return { success: true, status: res.status, response: body };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

/** End the session. Always clears the local cache, even if the call fails. */
export async function logout(cfg: StaLuciaApiConfig): Promise<SendResult> {
  try {
    const session = await getSession(cfg.id);
    if (!session) return { success: true, response: { message: 'No active session' } };

    const res = await fetch(url(cfg, '/api/logout'), {
      method: 'POST',
      headers: authHeaders(session),
      signal: AbortSignal.timeout(cfg.timeout || 30000),
    });
    const body = await res.json().catch(() => ({}));
    await clearSession(cfg.id);

    if (!res.ok) {
      return { success: false, status: res.status, response: body, error: `HTTP ${res.status}` };
    }
    return { success: true, status: res.status, response: body };
  } catch (e) {
    await clearSession(cfg.id).catch(() => {});
    return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/integrations/sta-lucia/session.ts lib/integrations/sta-lucia/client.ts
git commit -m "feat(sta-lucia): add session cache and API client"
```

---

## Task 5: Send orchestration and routes

**Files:**
- Create: `lib/integrations/sta-lucia/send-z-reading.ts`
- Create: `app/api/integrations/sta-lucia/send/route.ts`
- Create: `app/api/integrations/sta-lucia/test/route.ts`

**Interfaces:**
- Consumes: `buildSalesPayload` (Task 1), `StaLuciaApiConfig`/`sendSales`/`login`/`logout`/`getTransactions` (Task 4), `external_apis` provider columns (Task 2).
- Produces:
  - `TRANSACTION_TYPE` — the string constant `'STA_LUCIA_SALES'`
  - `loadStaLuciaConfig(apiId?: string): Promise<StaLuciaApiConfig | null>`
  - `sendZReadingToStaLucia(zReadingId?: string, apiId?: string): Promise<{ success: boolean; error?: string; skipped?: boolean; zReadingId?: string; payload?: unknown; response?: unknown }>` — omitting `zReadingId` submits the most recent Z-reading
  - `POST /api/integrations/sta-lucia/send` — body `{ apiId?: string; zReadingId?: string }`
  - `POST /api/integrations/sta-lucia/test` — body `{ apiId?: string }` → `{ success, steps, payload, response }`

- [ ] **Step 1: Write the orchestration module**

This lives in `lib/`, not in the route, so that `lib/scheduler.ts` and the
Z-reading route can call it without importing a module that exports HTTP
handlers.

Create `lib/integrations/sta-lucia/send-z-reading.ts`:

```ts
import { query } from '@/lib/mysql';
import { buildSalesPayload } from './payload';
import { sendSales, type StaLuciaApiConfig } from './client';
import type { ZReadingLike } from './types';

export const TRANSACTION_TYPE = 'STA_LUCIA_SALES';

export interface SendZReadingResult {
  success: boolean;
  error?: string;
  skipped?: boolean;
  zReadingId?: string;
  payload?: unknown;
  response?: unknown;
}

/** Load a specific Sta Lucia config by id, or the single enabled one. */
export async function loadStaLuciaConfig(apiId?: string): Promise<StaLuciaApiConfig | null> {
  const rows = apiId
    ? await query(`SELECT * FROM external_apis WHERE id = ? AND provider = 'sta_lucia'`, [apiId]) as any[]
    : await query(
        `SELECT * FROM external_apis WHERE provider = 'sta_lucia' AND enabled = 1
         ORDER BY created_at ASC LIMIT 1`, []) as any[];

  const row = rows?.[0];
  if (!row) return null;

  return {
    id: row.id,
    apiEndpoint: row.api_endpoint,
    loginEmail: row.login_email ?? '',
    loginPassword: row.login_password ?? '',
    timeout: row.timeout ?? 30000,
    onErrorAction: row.on_error_action ?? 'log_only',
  };
}

/**
 * Map a z_readings row onto the shape the pure mapper expects.
 *
 * NOTE: the table carries BOTH `vat_sales` and `vatable_sales`. Only
 * `vatable_sales` is written by the Z-reading INSERT; `vat_sales` is a legacy
 * column that is left at its default. Reading the wrong one silently reports
 * zero VAT-able sales to the mall.
 */
function rowToZReading(row: any): ZReadingLike {
  let paymentMethods: Array<{ name: string; amount: number }> = [];
  try {
    const parsed = typeof row.payment_methods === 'string'
      ? JSON.parse(row.payment_methods)
      : row.payment_methods;
    if (Array.isArray(parsed)) paymentMethods = parsed;
  } catch {
    paymentMethods = [];
  }

  const num = (v: any) => parseFloat(v) || 0;

  return {
    id: String(row.reading_number),
    reportDate: row.report_date,
    grossSales: num(row.gross_sales),
    netSales: num(row.net_sales),
    discounts: num(row.discounts),
    vatSales: num(row.vatable_sales),
    vatAmount: num(row.vat_amount),
    vatExempt: num(row.vat_exempt),
    nonVat: num(row.non_vat),
    transactionCount: parseInt(row.transaction_count) || 0,
    cashSales: num(row.cash_sales),
    paymentMethods,
  };
}

async function writeLog(entry: {
  transactionId: string; endpoint: string; payload: unknown;
  response: unknown; status: string; errorMessage?: string | null;
}) {
  const id = `log_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  await query(
    `INSERT INTO external_api_logs
      (id, transaction_type, transaction_id, endpoint, payload, response, status, error_message, retry_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [
      id, TRANSACTION_TYPE, entry.transactionId, entry.endpoint,
      JSON.stringify(entry.payload),
      entry.response == null ? null : JSON.stringify(entry.response),
      entry.status, entry.errorMessage ?? null,
    ],
  );
  return id;
}

/**
 * Build and submit one Z-reading. Omit `zReadingId` to submit the latest.
 *
 * Idempotent: a Z-reading that already has a successful log for this
 * transaction type is skipped, so a retry sweep, a double-click, or a
 * re-finalize can never submit the same day's sales twice.
 */
export async function sendZReadingToStaLucia(
  zReadingId?: string,
  apiId?: string,
): Promise<SendZReadingResult> {
  const cfg = await loadStaLuciaConfig(apiId);
  if (!cfg) return { success: false, error: 'No enabled Sta Lucia API is configured' };

  const rows = zReadingId
    ? await query('SELECT * FROM z_readings WHERE reading_number = ? LIMIT 1', [zReadingId]) as any[]
    : await query('SELECT * FROM z_readings ORDER BY id DESC LIMIT 1', []) as any[];

  if (!rows?.length) {
    return {
      success: false,
      error: zReadingId ? `Z-reading ${zReadingId} not found` : 'No Z-readings have been saved yet',
    };
  }

  const row = rows[0];
  const resolvedId = String(row.reading_number);

  const done = await query(
    `SELECT id FROM external_api_logs
     WHERE transaction_type = ? AND transaction_id = ? AND status = 'success' LIMIT 1`,
    [TRANSACTION_TYPE, resolvedId],
  ) as any[];
  if (done?.length) {
    return { success: true, skipped: true, zReadingId: resolvedId };
  }

  const payload = buildSalesPayload(rowToZReading(row));
  const endpoint = `${cfg.apiEndpoint.replace(/\/+$/, '')}/api/get-sales`;
  const result = await sendSales(cfg, payload);

  await writeLog({
    transactionId: resolvedId,
    endpoint,
    payload,
    response: result.response ?? null,
    status: result.success ? 'success' : 'failed',
    errorMessage: result.success ? null : result.error,
  });

  return {
    success: result.success,
    error: result.error,
    zReadingId: resolvedId,
    payload,
    response: result.response,
  };
}
```

- [ ] **Step 1b: Write the send route**

Create `app/api/integrations/sta-lucia/send/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { sendZReadingToStaLucia } from '@/lib/integrations/sta-lucia/send-z-reading';

/**
 * POST /api/integrations/sta-lucia/send
 * Body: { zReadingId?: string, apiId?: string }
 *
 * Omitting zReadingId submits the most recent Z-reading.
 */
export async function POST(request: NextRequest) {
  try {
    const { zReadingId, apiId } = await request.json().catch(() => ({}));
    const result = await sendZReadingToStaLucia(zReadingId, apiId);
    return NextResponse.json(result, { status: result.success ? 200 : 502 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Sta Lucia send failed:', error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
```

- [ ] **Step 2: Write the test route**

Create `app/api/integrations/sta-lucia/test/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { login, sendSales, getTransactions, logout } from '@/lib/integrations/sta-lucia/client';
import { loadStaLuciaConfig } from '@/lib/integrations/sta-lucia/send-z-reading';
import type { StaLuciaSalesPayload } from '@/lib/integrations/sta-lucia/types';

/**
 * A representative payload used only for connection testing. It never touches
 * real sales data, so a test run cannot pollute the mall's records with
 * figures that look real — the values are deliberately small and round.
 */
const SAMPLE_PAYLOAD: StaLuciaSalesPayload = {
  credit: 0,
  debit: 0,
  gross_sales: 0,
  date_time: '',
  total_discounts: '0%',
  vat_exempt_sales: 0,
  vat_sales: 0,
  non_vat_sales: 0,
  vat_amount: 0,
  other_taxes: 0,
  net_sales: 0,
  number_of_transactions: 0,
};

/**
 * POST /api/integrations/sta-lucia/test
 * Body: { apiId: string }
 *
 * Runs the documented integration flow — login, submit, read back, logout —
 * and returns the exact payload that was sent alongside each raw response.
 * Seeing the literal bytes sent is the whole point; a boolean "connection OK"
 * would not tell you whether the mapping is right.
 */
export async function POST(request: NextRequest) {
  try {
    const { apiId } = await request.json().catch(() => ({}));
    const cfg = await loadStaLuciaConfig(apiId);
    if (!cfg) {
      return NextResponse.json(
        { success: false, error: 'No Sta Lucia API configured' },
        { status: 400 },
      );
    }

    const steps: Record<string, unknown> = {};

    try {
      const session = await login(cfg);
      steps.login = { success: true, ownerToken: session.ownerToken };
    } catch (e) {
      steps.login = { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
      return NextResponse.json({ success: false, steps, error: (steps.login as any).error });
    }

    const payload: StaLuciaSalesPayload = {
      ...SAMPLE_PAYLOAD,
      date_time: new Date().toISOString().slice(0, 19).replace('T', ' '),
    };

    const sales = await sendSales(cfg, payload);
    steps.sendSales = sales;

    steps.getTransactions = await getTransactions(cfg);
    steps.logout = await logout(cfg);

    return NextResponse.json({
      success: sales.success,
      endpoint: `${cfg.apiEndpoint.replace(/\/+$/, '')}/api/get-sales`,
      payload,
      response: sales.response,
      steps,
      error: sales.success ? undefined : sales.error,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Sta Lucia test failed:', error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
```

- [ ] **Step 3: Verify the test route end to end**

With `npm run dev` running, insert a Sta Lucia config pointing at the mock and call the test route:

```bash
node -e "require('dotenv').config();const m=require('mysql2/promise');const {randomUUID}=require('crypto');(async()=>{const c=await m.createConnection({host:process.env.DB_HOST,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});await c.query(\"DELETE FROM external_apis WHERE name='Sta Lucia (mock)'\");const id=randomUUID();await c.query(\"INSERT INTO external_apis (id,name,description,enabled,api_endpoint,auth_type,allowed_methods,timeout,retry_attempts,retry_delay,sync_mode,on_error_action,role,provider,login_email,login_password) VALUES (?,'Sta Lucia (mock)','',1,'http://localhost:3000/api/dev/mock-sta-lucia','none','send_only',30000,3,2000,'realtime','retry','general','sta_lucia','tenant@example.com','secret')\",[id]);console.log('apiId',id);await c.end();})()"
```

Then:
```bash
curl -s -X POST http://localhost:3000/api/integrations/sta-lucia/test \
  -H "Content-Type: application/json" -d '{}'
```
Expected: `"success":true`, a `payload` object with all twelve fields, `steps.login.success` true, `steps.sendSales.success` true, `steps.logout.success` true, and `response.received` echoing the payload.

- [ ] **Step 4: Typecheck and commit**

Run: `npm run typecheck`
Expected: no errors.

```bash
git add lib/integrations/sta-lucia/send-z-reading.ts app/api/integrations/sta-lucia
git commit -m "feat(sta-lucia): add send orchestration, send route, and test route"
```

---

## Task 6: Fire-and-forget hook on Z-reading finalize

**Files:**
- Modify: `app/api/sales/z-reading/route.ts` (around line 686)

**Interfaces:**
- Consumes: `sendZReadingToStaLucia` from Task 5.
- Produces: nothing new. A Z-reading POST now triggers a detached send.

- [ ] **Step 1: Import the sender**

At the top of `app/api/sales/z-reading/route.ts`, alongside the existing imports, add:

```ts
import { sendZReadingToStaLucia } from '@/lib/integrations/sta-lucia/send-z-reading';
```

- [ ] **Step 2: Fire the send after the reading is committed**

In the `POST` handler, find the existing e-journal line (near line 686):

```ts
        const ejDate = format(new Date(endDate), 'yyyy-MM-dd');   // `format` from date-fns is already imported here
        saveEJournalFiles(ejDate, ejTerminal).catch((e) => console.error('e-journal auto-save failed:', e));
```

Add immediately below it:

```ts
        // Sta. Lucia tenant-system submission. Detached on purpose: the Z-reading
        // row is already committed and its BIR sequence is already consumed, so a
        // third-party HTTP failure must not be able to fail, delay, or roll back
        // this response. Failures land in external_api_logs and are picked up by
        // the sync-queue sweep in lib/scheduler.ts.
        sendZReadingToStaLucia(String(readingNumber)).catch((e) =>
          console.error('Sta Lucia sales submission failed:', e),
        );
```

- [ ] **Step 3: Verify the Z-reading still returns when the send fails**

Point the config at an unroutable address so the send is guaranteed to fail, then confirm the Z-reading POST still succeeds:

```bash
node -e "require('dotenv').config();const m=require('mysql2/promise');(async()=>{const c=await m.createConnection({host:process.env.DB_HOST,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});await c.query(\"UPDATE external_apis SET api_endpoint='http://127.0.0.1:9' WHERE provider='sta_lucia'\");console.log('pointed at a dead port');await c.end();})()"
```

```bash
curl -s -X POST http://localhost:3000/api/sales/z-reading \
  -H "Content-Type: application/json" \
  -d '{"terminalId":"all","cashierName":"Admin"}' | head -c 200
```
Expected: `{"success":true,...` — the Z-reading completes despite the failing send. The server log shows `Sta Lucia sales submission failed:` or a failed log row appears in `external_api_logs`.

Restore the endpoint afterwards:
```bash
node -e "require('dotenv').config();const m=require('mysql2/promise');(async()=>{const c=await m.createConnection({host:process.env.DB_HOST,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});await c.query(\"UPDATE external_apis SET api_endpoint='http://localhost:3000/api/dev/mock-sta-lucia' WHERE provider='sta_lucia'\");await c.end();})()"
```

- [ ] **Step 4: Typecheck and commit**

Run: `npm run typecheck`
Expected: no errors.

```bash
git add app/api/sales/z-reading/route.ts
git commit -m "feat(sta-lucia): submit sales after Z-reading finalize"
```

---

## Task 7: Retry queue support

**Files:**
- Modify: `lib/scheduler.ts` (`processSyncQueue`, around lines 96–137)

**Interfaces:**
- Consumes: `sendZReadingToStaLucia` and `loadStaLuciaConfig` from Task 5.
- Produces: `STA_LUCIA_SALES` log rows are retried by the existing 2-minute sweep, but only when the config's `onErrorAction` is `'retry'`.

- [ ] **Step 1: Import the sender**

Add to the imports at the top of `lib/scheduler.ts`:

```ts
import { sendZReadingToStaLucia, loadStaLuciaConfig } from './integrations/sta-lucia/send-z-reading';
```

- [ ] **Step 2: Stop the legacy config gate from blocking Sta Lucia retries**

`processSyncQueue` currently begins with an early return driven by
`getExternalApiConfig()`, which reads the legacy `external_api_settings` table —
unrelated to `external_apis` rows. Left as-is, Sta Lucia retries would never run
unless that legacy config happened to be enabled.

Replace the opening of `processSyncQueue`:

```ts
export async function processSyncQueue(): Promise<void> {
  try {
    const apiConfig = await getExternalApiConfig();
    if (!apiConfig.enabled) return;
```

with:

```ts
/** Types gated by the legacy external_api_settings config. */
const LEGACY_SYNC_TYPES = ['PURCHASE_ORDER', 'SUPPLIER_PAYMENT', 'SALES_INVOICE', 'ACCOUNTS_PAYABLE'];

export async function processSyncQueue(): Promise<void> {
  try {
    // NOTE: no early return on `!apiConfig.enabled`. That flag comes from the
    // legacy external_api_settings table and says nothing about external_apis
    // rows; returning here would silently disable Sta Lucia retries. The gate
    // is applied per-item below, to legacy types only.
    const apiConfig = await getExternalApiConfig();
```

- [ ] **Step 3: Add the per-item gate and the new case**

Inside the `for` loop, immediately before the `switch (log.transaction_type) {` line, add:

```ts
        if (LEGACY_SYNC_TYPES.includes(log.transaction_type) && !apiConfig.enabled) continue;
```

Then add this case to the `switch`, before `default:`:

```ts
          case 'STA_LUCIA_SALES': {
            // The log row does not carry an apiId; the sender resolves the
            // enabled Sta Lucia config itself. Single-store deployment means
            // there is exactly one.
            //
            // Only 'retry' opts into the automatic sweep. 'queue' means the
            // operator retries by hand from the Sync Logs tab, and 'log_only'
            // means never — auto-retrying either would ignore the setting.
            const staCfg = await loadStaLuciaConfig();
            if (staCfg?.onErrorAction !== 'retry') continue;

            const r = await sendZReadingToStaLucia(log.transaction_id);
            syncResult = { success: r.success, error: r.error };
            break;
          }
```

- [ ] **Step 4: Verify the retry path**

Insert a failed log row for a Z-reading that exists, with the config pointing at the working mock, then trigger a retry through the existing retry endpoint:

```bash
node -e "require('dotenv').config();const m=require('mysql2/promise');(async()=>{const c=await m.createConnection({host:process.env.DB_HOST,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});const [z]=await c.query('SELECT reading_number FROM z_readings ORDER BY id DESC LIMIT 1');if(!z.length){console.log('no z_readings — run a Z-reading first');process.exit(1)}const zn=z[0].reading_number;await c.query(\"DELETE FROM external_api_logs WHERE transaction_type='STA_LUCIA_SALES' AND transaction_id=?\",[zn]);await c.query(\"INSERT INTO external_api_logs (id,transaction_type,transaction_id,endpoint,payload,response,status,error_message,retry_count) VALUES (?,'STA_LUCIA_SALES',?,'http://127.0.0.1:9','{}',NULL,'failed','seeded failure',0)\",['log_retry_test_'+Date.now(),zn]);console.log('seeded failed log for',zn);await c.end();})()"
```

Wait for the 2-minute sweep (or restart the dev server to trigger scheduler init), then check:

```bash
node -e "require('dotenv').config();const m=require('mysql2/promise');(async()=>{const c=await m.createConnection({host:process.env.DB_HOST,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});const [r]=await c.query(\"SELECT transaction_id,status,error_message FROM external_api_logs WHERE transaction_type='STA_LUCIA_SALES' ORDER BY created_at DESC LIMIT 5\");console.table(r);await c.end();})()"
```
Expected: a row with `status: 'success'` for that Z-reading.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck`
Expected: no errors.

```bash
git add lib/scheduler.ts
git commit -m "feat(sta-lucia): retry failed sales submissions in the sync queue"
```

---

## Task 8: Settings UI

**Files:**
- Modify: `app/(app)/settings/external-api/external-api-types.ts`
- Modify: `app/(app)/settings/external-api/ApiFormDialog.tsx`
- Modify: `app/(app)/settings/external-api/ApiCard.tsx`
- Modify: `app/(app)/settings/external-api/ApiConnectionsTab.tsx`
- Modify: `app/(app)/settings/external-api/use-external-api.ts`
- Modify: `app/(app)/settings/external-api/page.tsx`

**Interfaces:**
- Consumes: `ExternalApi` with `provider`/`loginEmail`/`loginPassword` (Task 2); `POST /api/integrations/sta-lucia/{test,send}` (Task 5).
- Produces: a Provider dropdown, tenant credential fields, and a Send Z-Reading action.

- [ ] **Step 1: Extend the form defaults and re-export the provider type**

In `app/(app)/settings/external-api/external-api-types.ts`:

Change the import line to include `ApiProvider`:

```ts
import type { ExternalApi, AllowedMethods, ApiRole, ApiProvider } from '@/lib/external-api-config';

export type { ExternalApi, AllowedMethods, ApiRole, ApiProvider };
```

Add to `EMPTY_FORM`, after `role: 'general',`:

```ts
  provider: 'generic',
  loginEmail: '',
  loginPassword: '',
```

- [ ] **Step 2: Carry the new fields through the edit dialog**

In `app/(app)/settings/external-api/use-external-api.ts`, inside `openEditDialog`, add to the `setForm({...})` object after `role: api.role ?? 'general',`:

```ts
      provider: api.provider ?? 'generic',
      loginEmail: api.loginEmail ?? '',
      loginPassword: api.loginPassword ?? '',
```

- [ ] **Step 3: Route the Test button for Sta Lucia configs**

In the same file, replace the body of `handleTestConnection` with:

```ts
  const handleTestConnection = async (api: ExternalApi) => {
    setTestingId(api.id);
    try {
      if (api.provider === 'sta_lucia') {
        const res = await fetch(getApiUrl('/integrations/sta-lucia/test'), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiId: api.id }),
        });
        const data = await res.json();
        if (data.success) {
          toast({
            title: 'Sta Lucia Connection OK',
            description: `Login, sales submission, and logout all succeeded against ${api.apiEndpoint}.`,
          });
          console.log('Sta Lucia test — payload sent:', data.payload);
          console.log('Sta Lucia test — response:', data.response);
        } else {
          toast({ variant: 'destructive', title: 'Sta Lucia Test Failed', description: data.error });
        }
        return;
      }

      const res = await fetch(getApiUrl(`/settings/external-api/${api.id}`), {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test', apiEndpoint: api.apiEndpoint, authType: api.authType, apiKey: api.apiKey, bearerToken: api.bearerToken, timeout: api.timeout, role: api.role }),
      });
      const data = await res.json();
      if (data.success) toast({ title: 'Connection Successful', description: data.message });
      else toast({ variant: 'destructive', title: 'Connection Failed', description: data.error });
    } catch { toast({ variant: 'destructive', title: 'Test Failed', description: 'Network error.' }); }
    finally { setTestingId(null); }
  };
```

- [ ] **Step 4: Add the Send Z-Reading handler**

First add the state, alongside the other `useState` declarations near the top of
the hook — directly below the existing `const [testingId, setTestingId] = ...`
line:

```ts
  const [sendingId, setSendingId] = useState<string | null>(null);
```

Then add this function after `handleTestConnection`:

```ts
  /**
   * Submit the most recent Z-reading on demand. The server resolves "most
   * recent" itself — the Z-reading GET route takes mode/startDate/endDate/
   * terminalId and has no "latest" parameter, so asking it here would mean
   * fetching the whole history just to read one row.
   */
  const handleSendZReading = async (api: ExternalApi) => {
    setSendingId(api.id);
    try {
      const res = await fetch(getApiUrl('/integrations/sta-lucia/send'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiId: api.id }),
      });
      const data = await res.json();

      if (data.skipped) {
        toast({ title: 'Already Sent', description: `Z-reading ${data.zReadingId} was submitted previously.` });
      } else if (data.success) {
        toast({ title: 'Sales Submitted', description: `Z-reading ${data.zReadingId} sent to Sta Lucia.` });
      } else {
        toast({ variant: 'destructive', title: 'Submission Failed', description: data.error });
      }
      fetchLogs();
    } catch { toast({ variant: 'destructive', title: 'Submission Failed', description: 'Network error.' }); }
    finally { setSendingId(null); }
  };
```

Add `sendingId` and `handleSendZReading` to the returned object of the hook, next to `handleTestConnection`.

- [ ] **Step 5: Add the Provider dropdown and tenant credential fields**

In `app/(app)/settings/external-api/ApiFormDialog.tsx`:

Change the type import line to include `ApiProvider`:

```ts
import type { ExternalApi, AllowedMethods, ApiRole, ApiProvider } from './external-api-types';
```

Add `Building2` to the `lucide-react` import.

Replace the "API Role" grid cell (the `<div className="space-y-2">` containing the `API Role` label and its Select) with a Provider select:

```tsx
            <div className="space-y-2">
              <Label>Provider</Label>
              <Select value={form.provider} onValueChange={v => set('provider', v as ApiProvider)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="generic">
                    <div className="flex items-center gap-2"><Globe className="h-4 w-4 text-muted-foreground" />Generic API</div>
                  </SelectItem>
                  <SelectItem value="sta_lucia">
                    <div className="flex items-center gap-2"><Building2 className="h-4 w-4 text-muted-foreground" />Sta. Lucia Tenant System</div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
```

Change the endpoint field's label and placeholder so it reads correctly for both providers — replace the `api-endpoint` `<Label>` and `<Input>` with:

```tsx
            <Label htmlFor="api-endpoint">
              {form.provider === 'sta_lucia' ? 'Domain' : 'API Endpoint URL'} <span className="text-destructive">*</span>
            </Label>
            <div className="relative">
              <Globe className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                id="api-endpoint" className="pl-9"
                placeholder={form.provider === 'sta_lucia' ? 'https://sta-lucia-malls.com' : 'https://api.example.com'}
                value={form.apiEndpoint} onChange={e => set('apiEndpoint', e.target.value)}
              />
            </div>
            {form.provider === 'sta_lucia' && (
              <p className="text-xs text-muted-foreground">
                Base domain only — <code>/api/login</code> and <code>/api/get-sales</code> are appended automatically.
              </p>
            )}
```

Wrap the existing authentication grid (the `<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">` containing "Authentication Type") so it only renders for generic APIs:

```tsx
          {form.provider === 'generic' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* ...existing Authentication Type select and the api_key / bearer_token blocks, unchanged... */}
            </div>
          )}
```

Immediately after that block, add the tenant credentials section:

```tsx
          {form.provider === 'sta_lucia' && (
            <div className="space-y-3 rounded-lg border p-4">
              <div className="space-y-1">
                <Label className="text-base">Sta. Lucia Tenant Account</Label>
                <p className="text-sm text-muted-foreground">
                  Credentials issued by the Sta. Lucia mall for the Tenant Management System —
                  <span className="font-medium text-foreground"> not your Verdix login.</span>
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="tenant-email">Tenant Email <span className="text-destructive">*</span></Label>
                  <Input
                    id="tenant-email" type="email" placeholder="tenant@example.com"
                    value={form.loginEmail ?? ''} onChange={e => set('loginEmail', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tenant-password">Tenant Password <span className="text-destructive">*</span></Label>
                  <div className="relative">
                    <ShieldCheck className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="tenant-password" type="password" className="pl-9" placeholder="Enter tenant password"
                      value={form.loginPassword ?? ''} onChange={e => set('loginPassword', e.target.value)}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
```

- [ ] **Step 6: Validate the credentials on save**

In `use-external-api.ts`, inside `handleSave`, add after the existing `apiEndpoint` validation:

```ts
    if (form.provider === 'sta_lucia' && (!form.loginEmail?.trim() || !form.loginPassword?.trim())) {
      toast({ variant: 'destructive', title: 'Validation Error', description: 'Tenant email and password are required for Sta. Lucia.' });
      return;
    }
```

- [ ] **Step 7: Add the Send Z-Reading button to the card**

In `app/(app)/settings/external-api/ApiCard.tsx`:

Add `Upload` to the `lucide-react` import. Extend the `Props` interface:

```ts
  sendingId: string | null;
  onSendZReading: (api: ExternalApi) => void;
```

Add `sendingId, onSendZReading` to the destructured parameters.

Add a Sta Lucia badge next to the Enabled badge:

```tsx
              {api.provider === 'sta_lucia' && (
                <Badge variant="outline" className="bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300">
                  Sta. Lucia
                </Badge>
              )}
```

Add the button immediately before the existing Test button:

```tsx
            {api.provider === 'sta_lucia' && (
              <Button variant="outline" size="sm" onClick={() => onSendZReading(api)} disabled={sendingId === api.id}>
                {sendingId === api.id
                  ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  : <Upload className="mr-1.5 h-3.5 w-3.5" />}
                Send Z-Reading
              </Button>
            )}
```

- [ ] **Step 8: Thread the props through**

In `app/(app)/settings/external-api/ApiConnectionsTab.tsx`, add `sendingId: string | null` and `onSendZReading: (api: ExternalApi) => void` to its `Props`, accept them, and pass both to each `<ApiCard />`.

In `app/(app)/settings/external-api/page.tsx`, pass them from the hook into `<ApiConnectionsTab ... sendingId={m.sendingId} onSendZReading={m.handleSendZReading} />`.

- [ ] **Step 9: Verify in the browser**

Run `npm run dev`, open `http://localhost:3000/settings/external-api`, then:

1. Click **Add API**. Set Provider to **Sta. Lucia Tenant System**. Confirm the API Key / Bearer Token fields disappear and the "Sta. Lucia Tenant Account" panel appears with the "not your Verdix login" note.
2. Try to save with an empty tenant email. Expected: validation toast, dialog stays open.
3. Fill in Name `Sta Lucia (mock)`, Domain `http://localhost:3000/api/dev/mock-sta-lucia`, Tenant Email `tenant@example.com`, Tenant Password `secret`, toggle Enable on, and save.
4. Confirm the card shows a **Sta. Lucia** badge and both **Send Z-Reading** and **Test** buttons.
5. Click **Test**. Expected: a success toast; the browser console logs the payload sent and the response.
6. Click **Send Z-Reading**. Expected: either a success toast or "No Z-Reading" if none exists yet. Clicking it a second time gives **Already Sent**.
7. Open the **Sync Logs** tab. Expected: a `STA_LUCIA_SALES` row.

- [ ] **Step 10: Lint, typecheck, and commit**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

```bash
git add "app/(app)/settings/external-api"
git commit -m "feat(sta-lucia): add provider selection and tenant credentials to settings UI"
```

---

## Task 9: End-to-end test

**Files:**
- Create: `tests/e2e/sta-lucia-sync.spec.ts`

**Interfaces:**
- Consumes: the mock endpoints (Task 3), the send route (Task 5), the schema (Task 2).
- Produces: automated proof that a Z-reading reaches the mock with correct headers and payload, and is not sent twice.

- [ ] **Step 1: Write the E2E test**

Create `tests/e2e/sta-lucia-sync.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { testQuery } from './helpers/db';

/**
 * Sta. Lucia sales submission against verdix_test.
 *
 * NOTE: do NOT import from `lib/` here — the test process points at the dev
 * `verdix` database while the test server runs against `verdix_test`. All
 * database access goes through testQuery.
 */

const API_ID = 'sta_lucia_e2e_api';
const Z_NUMBER = 'Z-E2E-0001';
const MOCK_BASE = 'http://127.0.0.1:3100/api/dev/mock-sta-lucia';

async function seedApi(endpoint: string) {
  await testQuery('DELETE FROM external_apis WHERE id = ?', [API_ID]);
  await testQuery(
    `INSERT INTO external_apis
       (id, name, description, enabled, api_endpoint, auth_type, allowed_methods,
        timeout, retry_attempts, retry_delay, sync_mode, on_error_action, role,
        provider, login_email, login_password)
     VALUES (?, 'Sta Lucia E2E', '', 1, ?, 'none', 'send_only',
             10000, 1, 500, 'realtime', 'log_only', 'general',
             'sta_lucia', 'tenant@example.com', 'secret')`,
    [API_ID, endpoint],
  );
}

async function seedZReading() {
  await testQuery('DELETE FROM z_readings WHERE reading_number = ?', [Z_NUMBER]);
  await testQuery(
    `INSERT INTO z_readings
       (reading_number, report_date, terminal_id, cashier_name, gross_sales, returns,
        discounts, net_sales, vat_amount, payment_methods, transaction_count,
        starting_cash, cash_sales, cash_in_drawer, vatable_sales, vat_exempt,
        zero_rated, non_vat)
     VALUES (?, '2026-07-31 18:30:00', 'terminal_default_01', 'Admin', 1700, 0,
             170, 1530, 108, ?, 42,
             0, 200, 200, 900, 100,
             0, 200)`,
    [Z_NUMBER, JSON.stringify([
      { name: 'CASH', amount: 200 },
      { name: 'GCash', amount: 800 },
      { name: 'Credit Card', amount: 530 },
    ])],
  );
}

test.describe('Sta Lucia sales submission', () => {
  test.beforeEach(async () => {
    await testQuery(
      `DELETE FROM external_api_logs WHERE transaction_type = 'STA_LUCIA_SALES' AND transaction_id = ?`,
      [Z_NUMBER],
    );
    await testQuery('DELETE FROM external_api_sessions WHERE api_id = ?', [API_ID]);
    await seedZReading();
  });

  test.afterAll(async () => {
    await testQuery('DELETE FROM external_apis WHERE id = ?', [API_ID]);
    await testQuery('DELETE FROM z_readings WHERE reading_number = ?', [Z_NUMBER]);
  });

  test('sends a correctly mapped payload and logs success', async ({ request }) => {
    await seedApi(MOCK_BASE);

    const res = await request.post('/api/integrations/sta-lucia/send', {
      data: { apiId: API_ID, zReadingId: Z_NUMBER },
    });
    expect(res.ok()).toBe(true);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.skipped).toBeFalsy();

    // The mapping is the part worth asserting: tender split, percentage string,
    // and the VAT breakdown.
    expect(body.payload).toMatchObject({
      credit: 1330,
      debit: 200,
      gross_sales: 1700,
      net_sales: 1530,
      total_discounts: '10%',
      vat_sales: 900,
      vat_amount: 108,
      vat_exempt_sales: 100,
      non_vat_sales: 200,
      other_taxes: 0,
      number_of_transactions: 42,
      date_time: '2026-07-31 18:30:00',
    });

    // The mock echoes what it received, which proves it arrived intact.
    expect(body.response?.received?.credit).toBe(1330);
    expect(body.response?.success).toBe(true);

    const logs = await testQuery(
      `SELECT status, endpoint, payload FROM external_api_logs
       WHERE transaction_type = 'STA_LUCIA_SALES' AND transaction_id = ?`,
      [Z_NUMBER],
    );
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe('success');
    expect(logs[0].endpoint).toBe(`${MOCK_BASE}/api/get-sales`);
    expect(JSON.parse(logs[0].payload).total_discounts).toBe('10%');
  });

  test('a session is cached after the first send', async ({ request }) => {
    await seedApi(MOCK_BASE);
    await request.post('/api/integrations/sta-lucia/send', {
      data: { apiId: API_ID, zReadingId: Z_NUMBER },
    });

    const sessions = await testQuery(
      'SELECT token, owner_token FROM external_api_sessions WHERE api_id = ?',
      [API_ID],
    );
    expect(sessions).toHaveLength(1);
    expect(sessions[0].owner_token).toBe('MOCK_OWNER_xclkvbnjaoshjfasd');
  });

  test('the same Z-reading is never submitted twice', async ({ request }) => {
    await seedApi(MOCK_BASE);

    await request.post('/api/integrations/sta-lucia/send', {
      data: { apiId: API_ID, zReadingId: Z_NUMBER },
    });
    const second = await request.post('/api/integrations/sta-lucia/send', {
      data: { apiId: API_ID, zReadingId: Z_NUMBER },
    });

    const body = await second.json();
    expect(body.success).toBe(true);
    expect(body.skipped).toBe(true);

    const logs = await testQuery(
      `SELECT id FROM external_api_logs
       WHERE transaction_type = 'STA_LUCIA_SALES' AND transaction_id = ?`,
      [Z_NUMBER],
    );
    expect(logs).toHaveLength(1);
  });

  test('a failed send is logged as failed and leaves no session', async ({ request }) => {
    await seedApi('http://127.0.0.1:9');

    const res = await request.post('/api/integrations/sta-lucia/send', {
      data: { apiId: API_ID, zReadingId: Z_NUMBER },
    });
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBeTruthy();

    const logs = await testQuery(
      `SELECT status FROM external_api_logs
       WHERE transaction_type = 'STA_LUCIA_SALES' AND transaction_id = ?`,
      [Z_NUMBER],
    );
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe('failed');

    const sessions = await testQuery(
      'SELECT api_id FROM external_api_sessions WHERE api_id = ?',
      [API_ID],
    );
    expect(sessions).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Ensure the test database has the new schema**

Run: `npm run test:e2e:db`
Expected: the test database is re-seeded from the dev schema, so it includes `external_apis.provider` and `external_api_sessions`.

Verify:
```bash
node -e "require('dotenv').config();const m=require('mysql2/promise');(async()=>{const c=await m.createConnection({host:process.env.DB_HOST,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:'verdix_test'});const [r]=await c.query('SHOW COLUMNS FROM external_apis');console.log(r.map(x=>x.Field).filter(f=>['provider','login_email','login_password'].includes(f)).join(', '));const [s]=await c.query('SHOW TABLES LIKE \"external_api_sessions\"');console.log('sessions table:', s.length===1);await c.end();})()"
```
Expected: `provider, login_email, login_password` and `sessions table: true`.

- [ ] **Step 3: Run the E2E test**

Run: `npx playwright test tests/e2e/sta-lucia-sync.spec.ts`
Expected: 4 passed.

- [ ] **Step 4: Run the full suites for regressions**

Run: `npm run test:unit && npm run typecheck && npm run test:e2e`
Expected: unit assertions pass, no type errors, and the E2E suite is green with no new failures.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/sta-lucia-sync.spec.ts
git commit -m "test(sta-lucia): cover payload mapping, session caching, and idempotency"
```

---

## Task 10: Documentation

**Files:**
- Modify: `docs/API_ENDPOINTS.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: everything above.
- Produces: no code.

- [ ] **Step 1: Document the new endpoints**

Add to `docs/API_ENDPOINTS.md`, following the formatting of the surrounding entries:

```markdown
### Sta. Lucia Tenant System Integration

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/integrations/sta-lucia/send` | POST | Submit one Z-reading. Body `{ zReadingId, apiId? }`. Idempotent — a Z-reading already logged as `success` is skipped. |
| `/api/integrations/sta-lucia/test` | POST | Dry run: login → sample sales → get-transactions → logout. Returns the exact payload sent plus each raw response. |
| `/api/dev/mock-sta-lucia/*` | POST/GET | Local mock of the external API for development and E2E tests. |

Configured at **Settings → External API Integrations** with Provider set to
"Sta. Lucia Tenant System". The credentials are the mall-issued **tenant
account**, not a Verdix login.
```

- [ ] **Step 2: Add a line to the domain patterns in CLAUDE.md**

Add to the "Key Domain Patterns" section of `CLAUDE.md`, after the Printing entry:

```markdown
**Sta. Lucia Tenant System** — Z-reading sales are pushed to the mall's Sale
Consolidator API from `lib/integrations/sta-lucia/`. Configured as a
`provider = 'sta_lucia'` row in `external_apis`; reuses the external-API sync
logs and retry queue. The send is fired detached after the Z-reading commits and
can never fail it. `lib/integrations/sta-lucia/payload.ts` is a pure mapper and
is where the credit/debit and discount-percentage decisions live. Local mocks at
`/api/dev/mock-sta-lucia` make it testable without credentials.
```

- [ ] **Step 3: Commit**

```bash
git add docs/API_ENDPOINTS.md CLAUDE.md
git commit -m "docs(sta-lucia): document integration endpoints and domain pattern"
```

---

## Done When

- `npm run test:unit` passes, including `sta-lucia-payload`.
- `npm run typecheck` and `npm run lint` are clean.
- `npx playwright test tests/e2e/sta-lucia-sync.spec.ts` passes all 4 tests.
- A Z-reading finalized in the UI produces a `STA_LUCIA_SALES` row in the Sync Logs tab.
- Pointing the config at a dead port still lets a Z-reading complete successfully.

## Follow-Ups (not in this plan)

- **Confirm the credit/debit question with MediaOne** before production cutover — see the spec's "Open question" section. If they expect the two to reconcile against `gross_sales`, the change is one line in `payload.ts`.
- Obtain the real staging domain and tenant credentials, then re-run Task 5 Step 3 against them instead of the mock.
- Consuming `get-transactions` for reconciliation reporting.
