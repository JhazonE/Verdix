# Cloud Licensing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make license renewal, revocation, and seat limits actually take effect on the Railway-hosted (cloud) POS by moving authoritative license state from the ephemeral container filesystem into the customer's database.

**Architecture:** A single-row `license_state` table in the POS database becomes the source of truth for cloud deployments. `LICENSE_KEY` is demoted to a bootstrap seed used only until the first heartbeat writes a row. The heartbeat writes renewals and lock reasons to that row instead of to `license.dat`, and tracks `last_validated_at` to drive a 7-day offline grace window. Seats are counted from `pos_terminals` and reported to the license server. The desktop path (file + env, synchronous, no DB) is deliberately left unchanged.

**Tech Stack:** Next.js 16 App Router, raw `mysql2/promise` via `lib/mysql.ts`, Ed25519 verification in `lib/licensing/`, plain `node:assert` self-executing unit tests run by `tsx tests/unit/run.ts`.

**Spec:** `docs/superpowers/specs/2026-08-31-cloud-licensing-design.md`

## Global Constraints

- **Desktop behaviour must not change.** The synchronous `readLicenseKey()` file/env path stays exactly as it is. No desktop code path may acquire a database dependency.
- **`tests/unit/license-machine-match.test.ts` must keep passing unchanged.** It asserts the existing sync env-over-file precedence.
- **Cloud mode is detected by `payload.machineId === HOSTED_MACHINE_ID`** (`'HOSTED'`, from `lib/licensing/core.ts`). Never by `NODE_ENV` or a new env flag.
- **Grace window is 7 days** from `last_validated_at`.
- **Cloud heartbeat interval is 1 hour**; desktop stays 24 hours.
- **Seat overage warns and blocks new terminals — it never locks checkout.**
- **Never throw on a missing `license_state` table.** A desktop install will not have run the migration in every scenario; all DB reads must degrade to the env/file path.
- **Signature, product-id, and expiry checks stay enforced on every path.** Nothing in this plan may weaken `evaluateLicenseKey()`.
- **Migrations are additive and idempotent** — follow the `INFORMATION_SCHEMA` existence-check pattern used by `scripts/migrations/114_add_z_reading_cashier_breakdown.ts`.
- **Verification baseline is red** (lint broken, typecheck red, some E2E failures pre-date this work). Prove each new test passes individually with `npx tsx tests/unit/<file>.test.ts`; do not claim a clean full-suite run.

---

### Task 1: `license_state` table migration

**Files:**
- Create: `scripts/migrations/115_create_license_state.ts`
- Modify: `scripts/migrations/index.ts` (add the import after line 114)

**Interfaces:**
- Consumes: nothing (first task).
- Produces: table `license_state` with columns `id INT PK`, `signed_license TEXT NULL`, `last_validated_at DATETIME NULL`, `lock_reason VARCHAR(32) NULL`, `seat_limit INT NULL`, `updated_at TIMESTAMP`. The single row always uses `id = 1`.

`seat_limit` is here because `LicensePayload` carries no seat field and its shape is a frozen crypto contract shared with the license-server repo. The limit therefore arrives from the heartbeat (Task 4) and is consumed by Task 5's terminal guard.

- [ ] **Step 1: Write the migration**

Create `scripts/migrations/115_create_license_state.ts`:

```typescript
import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

const migration: Migration = {
  name: '115_create_license_state',
  timestamp: '2026-08-31_10-00-00',

  async up(): Promise<void> {
    const rows: any = await query(`
      SELECT COUNT(*) as cnt
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'license_state'
    `);
    if (rows[0]?.cnt > 0) {
      console.log('⏭️  license_state already exists, skipping');
      return;
    }
    await query(`
      CREATE TABLE license_state (
        id INT PRIMARY KEY,
        signed_license TEXT NULL,
        last_validated_at DATETIME NULL,
        lock_reason VARCHAR(32) NULL,
        seat_limit INT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ license_state table created');
  },

  async down(): Promise<void> {
    await query(`DROP TABLE IF EXISTS license_state`);
    console.log('✅ license_state table dropped');
  }
};

registerMigration(migration);
```

- [ ] **Step 2: Register it in the index**

In `scripts/migrations/index.ts`, add directly after the `import './114_add_z_reading_cashier_breakdown';` line:

```typescript
import './115_create_license_state';
```

- [ ] **Step 3: Run the migration**

Run: `npm run migrate`
Expected: output includes `✅ license_state table created`. Re-run it once more and expect `⏭️  license_state already exists, skipping` — this proves idempotency.

- [ ] **Step 4: Commit**

```bash
git add scripts/migrations/115_create_license_state.ts scripts/migrations/index.ts
git commit -m "feat(licensing): add license_state table for cloud license storage"
```

---

### Task 2: License state store module

**Files:**
- Create: `lib/licensing/state-store.ts`
- Create: `tests/unit/license-state-store.test.ts`
- Modify: `tests/unit/run.ts` (add the import at the end of the list)

**Interfaces:**
- Consumes: `license_state` table from Task 1; `query` from `lib/mysql.ts`.
- Produces:
  - `interface LicenseState { signedLicense: string | null; lastValidatedAt: Date | null; lockReason: string | null; }`
  - `readLicenseState(): Promise<LicenseState | null>` — `null` when the table is missing or has no row.
  - `writeLicenseState(patch: Partial<LicenseState>): Promise<void>` — upserts row `id = 1`, touching only supplied fields.
  - `GRACE_WINDOW_DAYS = 7`
  - `isGraceExpired(lastValidatedAt: Date | null, now?: Date): boolean` — pure, no DB. `false` when `lastValidatedAt` is `null` (never contacted yet — bootstrap must not lock).

The pure function `isGraceExpired` is what Task 2's test covers; the DB functions are exercised in Task 4's integration behaviour.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/license-state-store.test.ts`:

```typescript
import assert from 'node:assert/strict';
import { isGraceExpired, GRACE_WINDOW_DAYS } from '../../lib/licensing/state-store';

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-08-31T12:00:00Z');

assert.equal(GRACE_WINDOW_DAYS, 7, 'grace window is 7 days');

// Never validated yet (bootstrap) must NOT lock.
assert.equal(isGraceExpired(null, now), false, 'null lastValidatedAt does not lock');

// Inside the window.
assert.equal(
  isGraceExpired(new Date(now.getTime() - 1 * DAY), now), false, '1 day ago is inside grace');
assert.equal(
  isGraceExpired(new Date(now.getTime() - 6.9 * DAY), now), false, '6.9 days is inside grace');

// Outside the window.
assert.equal(
  isGraceExpired(new Date(now.getTime() - 7.1 * DAY), now), true, '7.1 days is expired');
assert.equal(
  isGraceExpired(new Date(now.getTime() - 30 * DAY), now), true, '30 days is expired');

// A future timestamp (clock skew) must not lock.
assert.equal(
  isGraceExpired(new Date(now.getTime() + 1 * DAY), now), false, 'future timestamp does not lock');

console.log('license-state-store: all assertions passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/unit/license-state-store.test.ts`
Expected: FAIL — cannot find module `../../lib/licensing/state-store`.

- [ ] **Step 3: Write the implementation**

Create `lib/licensing/state-store.ts`:

```typescript
/**
 * DB-backed license state (cloud deployments).
 * ----------------------------------------------------------------------------
 * A Railway container's filesystem is ephemeral and LICENSE_KEY is read-only to
 * the app, so a hosted POS has nowhere durable to record a renewal or a lock.
 * This single-row table is that place. Desktop installs never touch it.
 *
 * Every read degrades to null rather than throwing: a desktop database may not
 * have the table at all, and licensing must never crash the app.
 */
import { query } from '../mysql';

export interface LicenseState {
  signedLicense: string | null;
  lastValidatedAt: Date | null;
  lockReason: string | null;
  /** Licensed terminal count, delivered by the heartbeat. Null = unlimited. */
  seatLimit: number | null;
}

/** Days the POS keeps working after the last successful license-server contact. */
export const GRACE_WINDOW_DAYS = 7;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * True when the last successful validation is older than the grace window.
 * A null timestamp means "never validated" (fresh bootstrap) and never locks;
 * a future timestamp (clock skew) never locks either.
 */
export function isGraceExpired(lastValidatedAt: Date | null, now: Date = new Date()): boolean {
  if (!lastValidatedAt) return false;
  const age = now.getTime() - lastValidatedAt.getTime();
  if (age < 0) return false;
  return age > GRACE_WINDOW_DAYS * MS_PER_DAY;
}

export async function readLicenseState(): Promise<LicenseState | null> {
  try {
    const rows: any = await query(
      `SELECT signed_license, last_validated_at, lock_reason, seat_limit
         FROM license_state WHERE id = 1`
    );
    const row = rows?.[0];
    if (!row) return null;
    return {
      signedLicense: row.signed_license ?? null,
      lastValidatedAt: row.last_validated_at ? new Date(row.last_validated_at) : null,
      lockReason: row.lock_reason ?? null,
      seatLimit: row.seat_limit ?? null,
    };
  } catch {
    // Table missing (desktop) or DB unreachable — fall back to env/file.
    return null;
  }
}

export async function writeLicenseState(patch: Partial<LicenseState>): Promise<void> {
  const sets: string[] = [];
  const values: any[] = [];
  if ('signedLicense' in patch) { sets.push('signed_license = ?'); values.push(patch.signedLicense); }
  if ('lastValidatedAt' in patch) { sets.push('last_validated_at = ?'); values.push(patch.lastValidatedAt); }
  if ('lockReason' in patch) { sets.push('lock_reason = ?'); values.push(patch.lockReason); }
  if ('seatLimit' in patch) { sets.push('seat_limit = ?'); values.push(patch.seatLimit); }
  if (!sets.length) return;

  try {
    await query(
      `INSERT INTO license_state (id, signed_license, last_validated_at, lock_reason, seat_limit)
       VALUES (1, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE ${sets.join(', ')}`,
      [
        patch.signedLicense ?? null,
        patch.lastValidatedAt ?? null,
        patch.lockReason ?? null,
        patch.seatLimit ?? null,
        ...values,
      ]
    );
  } catch (e) {
    console.error('license_state write failed:', e);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/unit/license-state-store.test.ts`
Expected: PASS — `license-state-store: all assertions passed`.

- [ ] **Step 5: Register the test in the runner**

In `tests/unit/run.ts`, add at the end of the import list:

```typescript
import './license-state-store.test';
```

- [ ] **Step 6: Commit**

```bash
git add lib/licensing/state-store.ts tests/unit/license-state-store.test.ts tests/unit/run.ts
git commit -m "feat(licensing): add DB-backed license state store with 7-day grace"
```

---

### Task 3: Async license resolution

**Files:**
- Modify: `lib/licensing/verify.ts` (add async functions; leave lines 55-66 `readLicenseKey` untouched)
- Create: `tests/unit/license-resolution-order.test.ts`
- Modify: `tests/unit/run.ts`

**Interfaces:**
- Consumes: `readLicenseState`, `isGraceExpired` from Task 2; existing `evaluateLicenseKey`, `readLicenseKey`, `HOSTED_MACHINE_ID`.
- Produces:
  - `resolveLicenseKey(state: LicenseState | null): string | null` — pure. Returns `state.signedLicense` when present, else falls back to `readLicenseKey()`.
  - `getLicenseInfoAsync(): Promise<LicenseInfo>` — DB-aware version of `getLicenseInfo()`.
  - `readLicensePayloadAsync(): Promise<LicensePayload | null>`
  - `LicenseInfo` gains two optional fields: `lockReason?: string` and `graceExpired?: boolean`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/license-resolution-order.test.ts`:

```typescript
import assert from 'node:assert/strict';
import { resolveLicenseKey } from '../../lib/licensing/verify';

// (a) DB row wins over the env bootstrap seed.
process.env.LICENSE_KEY = 'VRDX1.env-token';
assert.equal(
  resolveLicenseKey({
    signedLicense: 'VRDX1.db-token', lastValidatedAt: null, lockReason: null, seatLimit: null,
  }),
  'VRDX1.db-token',
  'DB signed_license wins over env'
);

// (b) No DB row at all → env bootstrap seed is used.
assert.equal(resolveLicenseKey(null), 'VRDX1.env-token', 'null state falls back to env');

// (c) A row that exists but has no token yet → env bootstrap seed is used.
assert.equal(
  resolveLicenseKey({
    signedLicense: null, lastValidatedAt: null, lockReason: null, seatLimit: null,
  }),
  'VRDX1.env-token',
  'empty signed_license falls back to env'
);

delete process.env.LICENSE_KEY;

// (d) With neither DB nor env, resolution yields nothing (no license.dat in CI).
process.env.LICENSE_FILE = '/nonexistent/path/license.dat';
assert.equal(resolveLicenseKey(null), null, 'no DB, no env, no file → null');
delete process.env.LICENSE_FILE;

console.log('license-resolution-order: all assertions passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/unit/license-resolution-order.test.ts`
Expected: FAIL — `resolveLicenseKey` is not exported from `verify`.

- [ ] **Step 3: Add the async resolution to `verify.ts`**

In `lib/licensing/verify.ts`, add these imports at the top alongside the existing ones:

```typescript
import { readLicenseState, isGraceExpired, LicenseState } from './state-store';
```

Add these two optional fields to the `LicenseInfo` interface (after `features?: string[];`):

```typescript
  /** Set when a vendor action or the grace window locked this install. */
  lockReason?: string;
  /** True when the license server has been unreachable past the grace window. */
  graceExpired?: boolean;
```

Then append to the end of the file:

```typescript
/**
 * Pure resolution order: DB row → LICENSE_KEY env (bootstrap) → license.dat.
 * Split out from getLicenseInfoAsync so it can be unit-tested without a DB.
 */
export function resolveLicenseKey(state: LicenseState | null): string | null {
  if (state?.signedLicense) return state.signedLicense;
  return readLicenseKey();
}

/**
 * DB-aware license status. Used by the API routes. Desktop installs have no
 * license_state row, so this degrades to exactly the synchronous behaviour.
 */
export async function getLicenseInfoAsync(): Promise<LicenseInfo> {
  const state = await readLicenseState();
  const info = evaluateLicenseKey(resolveLicenseKey(state));

  // A vendor lock (revoked/suspended/released) outranks local verification —
  // this is what makes the kill switch work while LICENSE_KEY is still set.
  if (state?.lockReason) {
    return { ...info, licensed: false, status: 'invalid', lockReason: state.lockReason };
  }

  // Only a hosted license is subject to the grace window; desktop is offline-first.
  const hosted = isHostedLicense(resolveLicenseKey(state));
  if (hosted && isGraceExpired(state?.lastValidatedAt ?? null)) {
    return {
      ...info,
      licensed: false,
      status: 'invalid',
      lockReason: 'grace-expired',
      graceExpired: true,
    };
  }

  return info;
}

/** True when the given key is a vendor-signed HOSTED (cloud) license. */
export function isHostedLicense(key: string | null): boolean {
  if (!key) return false;
  const res = verifyLicenseSignature(key, PUBLIC_KEY_PEM);
  if (!res.valid || !res.payload) return false;
  return normalizeMachineId(res.payload.machineId) === normalizeMachineId(HOSTED_MACHINE_ID);
}

/** DB-aware payload read, used by the heartbeat. */
export async function readLicensePayloadAsync(): Promise<LicensePayload | null> {
  const state = await readLicenseState();
  const key = resolveLicenseKey(state);
  if (!key) return null;
  const res = verifyLicenseSignature(key, PUBLIC_KEY_PEM);
  return res.valid && res.payload ? res.payload : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/unit/license-resolution-order.test.ts`
Expected: PASS — `license-resolution-order: all assertions passed`.

- [ ] **Step 5: Verify the pre-existing test still passes**

Run: `npx tsx tests/unit/license-machine-match.test.ts`
Expected: PASS — the synchronous env-over-file behaviour is unchanged.

- [ ] **Step 6: Register the test and commit**

In `tests/unit/run.ts` add:

```typescript
import './license-resolution-order.test';
```

```bash
git add lib/licensing/verify.ts tests/unit/license-resolution-order.test.ts tests/unit/run.ts
git commit -m "feat(licensing): DB-first license resolution with grace-window lock"
```

---

### Task 4: Heartbeat writes to the database

**Files:**
- Modify: `app/api/license/heartbeat/route.ts` (whole file)
- Create: `tests/unit/license-heartbeat-transitions.test.ts`
- Modify: `tests/unit/run.ts`

**Interfaces:**
- Consumes: `writeLicenseState` (Task 2), `readLicensePayloadAsync` and `evaluateLicenseKey` (Task 3), `HOSTED_MACHINE_ID` / `normalizeMachineId` (`lib/licensing/core.ts`).
- Produces:
  - `decideHeartbeatWrite(status, signedLicense, now)` from `lib/licensing/heartbeat-decide.ts` — a pure function returning the `Partial<LicenseState>` patch to persist, so the transition logic is testable without a DB or a network.
  - `countActiveTerminals(): Promise<number>` from `lib/licensing/terminal-count.ts` — created here because the heartbeat is its first caller. Task 5 adds the pure `isSeatOverage` alongside it and the guard that consumes both.

**Create the two small modules first, then wire the route to them.**

- [ ] **Step 1: Write the failing test**

Create `tests/unit/license-heartbeat-transitions.test.ts`:

```typescript
import assert from 'node:assert/strict';
import { decideHeartbeatWrite } from '../../lib/licensing/heartbeat-decide';

const now = new Date('2026-08-31T12:00:00Z');

// Active with a renewed token: store it, stamp contact, clear any lock.
assert.deepEqual(
  decideHeartbeatWrite('active', 'VRDX1.renewed', now),
  { signedLicense: 'VRDX1.renewed', lastValidatedAt: now, lockReason: null },
  'active + token stores renewal and clears lock'
);

// Active with no token returned: still a successful contact, still clears lock.
assert.deepEqual(
  decideHeartbeatWrite('active', undefined, now),
  { lastValidatedAt: now, lockReason: null },
  'active without token stamps contact only'
);

// Vendor locks record a reason and are still a successful contact.
for (const status of ['revoked', 'suspended', 'released']) {
  assert.deepEqual(
    decideHeartbeatWrite(status, undefined, now),
    { lastValidatedAt: now, lockReason: status },
    `${status} records a lock reason`
  );
}

// Expired is left to local verification — no lock reason written.
assert.deepEqual(
  decideHeartbeatWrite('expired', undefined, now),
  { lastValidatedAt: now, lockReason: null },
  'expired defers to local expiry check'
);

// Offline / unknown must NOT stamp contact — that is what advances the grace window.
assert.equal(decideHeartbeatWrite('offline', undefined, now), null, 'offline writes nothing');
assert.equal(decideHeartbeatWrite('unknown', undefined, now), null, 'unknown writes nothing');

console.log('license-heartbeat-transitions: all assertions passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/unit/license-heartbeat-transitions.test.ts`
Expected: FAIL — cannot find module `../../lib/licensing/heartbeat-decide`.

- [ ] **Step 3: Write the decision module**

Create `lib/licensing/heartbeat-decide.ts`:

```typescript
/**
 * Pure heartbeat transition logic.
 * ----------------------------------------------------------------------------
 * Split from the route so the rules can be tested without a DB or a network.
 *
 * The critical rule: only an ANSWER from the server stamps last_validated_at.
 * A network failure must leave the timestamp alone, because that is exactly
 * what lets the grace window advance and eventually lock.
 */
import type { LicenseState } from './state-store';

const VENDOR_LOCKS = new Set(['revoked', 'suspended', 'released']);

export function decideHeartbeatWrite(
  status: string,
  signedLicense: string | undefined,
  now: Date = new Date()
): Partial<LicenseState> | null {
  // No answer from the server — write nothing so the grace window advances.
  if (status === 'offline' || status === 'unknown') return null;

  if (VENDOR_LOCKS.has(status)) {
    return { lastValidatedAt: now, lockReason: status };
  }

  // 'active', 'expired', and anything else the server answered with.
  const patch: Partial<LicenseState> = { lastValidatedAt: now, lockReason: null };
  if (status === 'active' && signedLicense) patch.signedLicense = signedLicense;
  return patch;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/unit/license-heartbeat-transitions.test.ts`
Expected: PASS — `license-heartbeat-transitions: all assertions passed`.

- [ ] **Step 5: Create the terminal counter the route needs**

Create `lib/licensing/terminal-count.ts`:

```typescript
/**
 * Seat counting for cloud licenses.
 * ----------------------------------------------------------------------------
 * Every cloud terminal shares the 'HOSTED' fingerprint, so the license server
 * cannot count seats from activations the way it does for desktop. Instead the
 * POS reports how many terminals are configured and the server compares that
 * against the license's max_activations.
 */
import { query } from '../mysql';

export async function countActiveTerminals(): Promise<number> {
  try {
    const rows: any = await query(
      `SELECT COUNT(*) AS cnt FROM pos_terminals WHERE is_active = TRUE`
    );
    return Number(rows?.[0]?.cnt ?? 0);
  } catch {
    // Never let a counting failure break the heartbeat.
    return 0;
  }
}
```

- [ ] **Step 6: Rewrite the heartbeat route to use it**

Replace the whole body of `app/api/license/heartbeat/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import {
  readLicensePayloadAsync,
  evaluateLicenseKey,
  saveLicenseKey,
  removeLicenseKey,
} from '@/lib/licensing/verify';
import { HOSTED_MACHINE_ID, normalizeMachineId } from '@/lib/licensing/core';
import { writeLicenseState } from '@/lib/licensing/state-store';
import { decideHeartbeatWrite } from '@/lib/licensing/heartbeat-decide';
import { countActiveTerminals } from '@/lib/licensing/terminal-count';

export const dynamic = 'force-dynamic';

const LICENSE_SERVER_URL = (process.env.LICENSE_SERVER_URL || 'http://localhost:4100').replace(/\/$/, '');

// POST /api/license/heartbeat — periodic re-validation against the license
// server. Enforces revocation/suspension and pulls renewals.
//
// Cloud (hosted) installs persist the result to the license_state table, which
// survives a redeploy; desktop installs keep using license.dat. Offline-safe on
// both: a network failure never locks immediately — only an explicit negative
// answer, or (cloud only) 7 days without any answer, does.
export async function POST() {
  try {
    const payload = await readLicensePayloadAsync();
    if (!payload) {
      return NextResponse.json({ success: true, status: 'unlicensed', changed: false });
    }

    // Cloud mode is detected from the signed payload's sentinel machine id.
    const hosted = normalizeMachineId(payload.machineId) === normalizeMachineId(HOSTED_MACHINE_ID);
    const terminalCount = hosted ? await countActiveTerminals() : undefined;

    let resp: Response;
    try {
      resp = await fetch(LICENSE_SERVER_URL + '/api/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          licenseId: payload.lid,
          machineId: payload.machineId,
          appVersion: process.env.npm_package_version || '1.0',
          ...(terminalCount !== undefined ? { terminalCount } : {}),
        }),
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      // Offline / unreachable → keep working on the cached license. Nothing is
      // written, so the grace window advances.
      return NextResponse.json({ success: true, status: 'offline', changed: false });
    }

    const json = await resp.json().catch(() => ({} as any));
    if (!resp.ok || !json?.success) {
      return NextResponse.json({ success: true, status: 'unknown', changed: false });
    }

    const status: string = json.status;

    if (hosted) {
      // Cloud: the DB row is authoritative. Never touch license.dat here — the
      // container filesystem does not survive a redeploy.
      const patch = decideHeartbeatWrite(status, json.signedLicense);
      if (patch) await writeLicenseState(patch);
      // The seat limit lives only on the server side of the contract, so cache
      // whatever it reported for Task 5's terminal-creation guard to read.
      if (typeof json.seatLimit === 'number' || json.seatLimit === null) {
        await writeLicenseState({ seatLimit: json.seatLimit });
      }
      const changed = status !== 'active' && status !== 'seat-exceeded';
      return NextResponse.json({
        success: true,
        status,
        changed,
        // Task 7's client reads this to poll hourly instead of daily.
        hosted: true,
        ...(json.seatLimit !== undefined ? { seatLimit: json.seatLimit, terminalCount } : {}),
      });
    }

    // Desktop: unchanged file-based behaviour.
    if (status === 'active') {
      if (json.signedLicense) {
        const info = evaluateLicenseKey(json.signedLicense);
        if (info.status === 'active' || info.status === 'expired') saveLicenseKey(json.signedLicense);
      }
      return NextResponse.json({ success: true, status: 'active', changed: false });
    }

    if (status === 'revoked' || status === 'suspended' || status === 'released') {
      removeLicenseKey();
      return NextResponse.json({ success: true, status, changed: true });
    }

    return NextResponse.json({ success: true, status, changed: false });
  } catch (error) {
    console.error('Heartbeat error:', error);
    return NextResponse.json({ success: false, error: 'Heartbeat failed' }, { status: 500 });
  }
}
```

Note this route also returns `hosted: true` in the cloud branch — Task 7's client uses that flag to pick its polling interval.

- [ ] **Step 7: Register the test and commit**

In `tests/unit/run.ts` add:

```typescript
import './license-heartbeat-transitions.test';
```

```bash
git add lib/licensing/heartbeat-decide.ts lib/licensing/terminal-count.ts app/api/license/heartbeat/route.ts tests/unit/license-heartbeat-transitions.test.ts tests/unit/run.ts
git commit -m "feat(licensing): persist heartbeat result to license_state on cloud"
```

---

### Task 5: Terminal seat counting

**Files:**
- Modify: `lib/licensing/terminal-count.ts` (created in Task 4 — append `isSeatOverage`)
- Modify: `app/api/pos-terminals/route.ts:210` (guard before the INSERT)
- Create: `tests/unit/license-seat-overage.test.ts`
- Modify: `tests/unit/run.ts`

**Interfaces:**
- Consumes: `countActiveTerminals` (Task 4), `readLicenseState` (Task 2), the cached `seatLimit` written by Task 4's heartbeat.
- Produces: `isSeatOverage(terminalCount: number, seatLimit: number | null): boolean` — pure. `false` when `seatLimit` is `null` (unlimited).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/license-seat-overage.test.ts`:

```typescript
import assert from 'node:assert/strict';
import { isSeatOverage } from '../../lib/licensing/terminal-count';

assert.equal(isSeatOverage(3, 4), false, 'under the limit is fine');
assert.equal(isSeatOverage(4, 4), false, 'exactly at the limit is fine');
assert.equal(isSeatOverage(5, 4), true, 'over the limit is an overage');

// A null limit means unlimited seats — never an overage.
assert.equal(isSeatOverage(100, null), false, 'null seatLimit is unlimited');

// Zero terminals is never an overage, whatever the limit.
assert.equal(isSeatOverage(0, 1), false, 'zero terminals is never an overage');

console.log('license-seat-overage: all assertions passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/unit/license-seat-overage.test.ts`
Expected: FAIL — `isSeatOverage` is not exported from `terminal-count`.

- [ ] **Step 3: Write the implementation**

Append to `lib/licensing/terminal-count.ts` (the file Task 4 created):

```typescript
/** Pure overage check. A null limit means unlimited. */
export function isSeatOverage(terminalCount: number, seatLimit: number | null): boolean {
  if (seatLimit === null) return false;
  return terminalCount > seatLimit;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/unit/license-seat-overage.test.ts`
Expected: PASS — `license-seat-overage: all assertions passed`.

- [ ] **Step 5: Block new terminals while over the seat limit**

`isSeatOverage` needs a consumer, or it is dead code. The spec requires that an
overage **blocks activation of additional terminals** while never locking
checkout.

**Where the seat limit comes from.** `LicensePayload` in `lib/licensing/core.ts`
carries no seat field, and that shape is a frozen crypto contract shared with the
license-server repo — changing it would break every already-issued license. So
the limit is *not* read from the token. It is the `seatLimit` the license server
returns on each heartbeat, persisted on the `license_state` row.

Everything needed is already in place: the `seat_limit` column (Task 1), the
`seatLimit` field on `LicenseState` (Task 2), and the heartbeat write that
caches the server's reported limit (Task 4). This step only adds the consumer.

Add the guard to the terminal-creation route. In
`app/api/pos-terminals/route.ts`, in the `POST` handler immediately before the
`INSERT INTO pos_terminals` at line 210:

```typescript
import { countActiveTerminals, isSeatOverage } from '@/lib/licensing/terminal-count';
import { readLicenseState } from '@/lib/licensing/state-store';

// ... inside POST, before inserting the new terminal:
const state = await readLicenseState();
const seatLimit = state?.seatLimit ?? null;
const current = await countActiveTerminals();
// Adding one more must not exceed the limit. A null limit (desktop, or a
// license with no cap) never blocks.
if (isSeatOverage(current + 1, seatLimit)) {
  return NextResponse.json(
    {
      success: false,
      error: `Licensed for ${seatLimit} terminal(s); ${current} are already active. Contact your vendor to add seats.`,
    },
    { status: 403 }
  );
}
```

Desktop installs have no `license_state` row, so `seatLimit` is `null` and this
guard is inert — desktop seat enforcement stays with the license server's
activation check, exactly as it is today.

- [ ] **Step 6: Register the test and commit**

In `tests/unit/run.ts` add:

```typescript
import './license-seat-overage.test';
```

```bash
git add lib/licensing/terminal-count.ts app/api/pos-terminals/route.ts tests/unit/license-seat-overage.test.ts tests/unit/run.ts
git commit -m "feat(licensing): block new terminals when over the licensed seat count"
```

---

### Task 6: License server accepts `terminalCount`

**Files:**
- Modify: `../verdix-license-server/src/server.ts:256-295` (the `/api/validate` handler)
- Modify: `../verdix-license-server/src/service.ts` (the `validateHeartbeat` function and `HeartbeatResult`)

**This task is in the SEPARATE repo `d:/VERDIX_POS/verdix-license-server`. Commit there, not in the POS repo.**

**Interfaces:**
- Consumes: `terminalCount` sent by Task 4's heartbeat.
- Produces: `/api/validate` responses gain `seatLimit: number | null`, and may return `status: 'seat-exceeded'`.

The change is **additive**: `terminalCount` is optional, so existing desktop clients that never send it behave exactly as before.

- [ ] **Step 1: Extend `HeartbeatResult` and `validateHeartbeat` in `src/service.ts`**

Add `seatLimit` to the interface:

```typescript
export interface HeartbeatResult {
  status: HeartbeatStatus;
  signedLicense?: string;
  expires?: string | null;
  seatLimit?: number | null;
}
```

Add `terminalCount` to the options parameter and the seat check. In `validateHeartbeat`, change the signature to:

```typescript
export async function validateHeartbeat(
  licenseId: string,
  machineId: string,
  opts: { appVersion?: string; ip?: string; terminalCount?: number } = {}
): Promise<HeartbeatResult> {
```

Then, immediately before the final `issueSignedLicense` call (after the expiry check), insert:

```typescript
  const seatLimit = license.max_activations ?? null;

  // Cloud seat check: every hosted terminal shares one activation, so seats are
  // counted from the POS-reported terminal total instead. Report the overage —
  // never withhold the license, which would lock a paying store out of checkout.
  if (opts.terminalCount !== undefined && seatLimit !== null && opts.terminalCount > seatLimit) {
    const { signedLicense } = await issueSignedLicense(license, machineId, { record: false });
    return { status: 'seat-exceeded', signedLicense, expires, seatLimit };
  }
```

and add `seatLimit` to the existing success return:

```typescript
  const { signedLicense } = await issueSignedLicense(license, machineId, { record: false });
  return { status: 'active', signedLicense, expires, seatLimit };
```

Add `'seat-exceeded'` to the `HeartbeatStatus` union type where it is declared in this file.

- [ ] **Step 2: Pass `terminalCount` through in `src/server.ts`**

In the `/api/validate` handler, change the `validateHeartbeat` call to forward the field:

```typescript
      const result = await svc.validateHeartbeat(licenseId, machineId, {
        appVersion: body.appVersion,
        ip: clientIp(req),
        terminalCount:
          typeof body.terminalCount === 'number' ? body.terminalCount : undefined,
      });
```

- [ ] **Step 3: Confirm `seat-exceeded` does not fire a status webhook**

`shouldFireStatusChanged` gates on `STORED_LICENSE_STATUSES`. Verify `'seat-exceeded'` is NOT in that set — it is a transient report, not a stored license status, and must not spam `license.status_changed` webhooks on every heartbeat. If adding it to the `HeartbeatStatus` union caused it to be included, exclude it explicitly.

Run: `npm run typecheck` (in the license-server repo)
Expected: PASS.

- [ ] **Step 4: Commit in the license-server repo**

```bash
cd d:/VERDIX_POS/verdix-license-server
git add src/server.ts src/service.ts
git commit -m "feat: accept terminalCount on /api/validate for cloud seat checks"
```

---

### Task 7: Status route and LicenseGate surface the new states

**Files:**
- Modify: `app/api/license/status/route.ts:11`
- Modify: `components/license-gate.tsx` (the `LicenseInfo` type, `STATUS_COPY`, and `ActivationScreen`)
- Modify: `app/(app)/use-license-heartbeat.ts`

**Interfaces:**
- Consumes: `getLicenseInfoAsync` (Task 3), the `seat-exceeded` heartbeat status (Tasks 4-6).
- Produces: user-visible lock messaging that distinguishes a vendor revocation from an unreachable license server.

- [ ] **Step 1: Switch the status route to the async resolver**

In `app/api/license/status/route.ts`, change the import and the call:

```typescript
import { getLicenseInfoAsync } from '@/lib/licensing/verify';
```

```typescript
    const info = await getLicenseInfoAsync();
```

- [ ] **Step 2: Add the new fields to the client type**

In `components/license-gate.tsx`, add to the `LicenseInfo` interface:

```typescript
  lockReason?: string;
  graceExpired?: boolean;
```

- [ ] **Step 3: Give each lock cause its own message**

In `components/license-gate.tsx`, inside `ActivationScreen`, derive the title from `lockReason` before falling back to `STATUS_COPY`. Add above the returned JSX:

```typescript
  const LOCK_COPY: Record<string, string> = {
    revoked: 'This license has been revoked. Please contact your vendor.',
    suspended: 'This license is suspended. Please contact your vendor.',
    released: 'This activation was released. Please re-activate.',
    'grace-expired':
      'Cannot reach the license server. This system has been offline for more than 7 days and needs to reconnect to continue.',
  };
  const lockMessage = info?.lockReason ? LOCK_COPY[info.lockReason] : undefined;
```

Render `lockMessage` in the card description when it is set, so support can tell a revocation apart from a connectivity failure at a glance.

- [ ] **Step 4: Fix the dead redirect and use a 1-hour cloud interval**

In `app/(app)/use-license-heartbeat.ts`, replace the whole file:

```typescript
'use client';

import { useEffect, useRef } from 'react';

// Desktop installs are offline-tolerant and only need a daily check. Cloud
// installs poll hourly so a revocation takes effect within the hour.
const DESKTOP_INTERVAL = 24 * 60 * 60 * 1000;
const CLOUD_INTERVAL = 60 * 60 * 1000;

/**
 * Periodically pings the license server to pull renewals and enforce
 * revocations. Offline-safe: a network failure never locks immediately.
 *
 * On a lock the page reloads so LicenseGate re-runs its status check and
 * renders the activation screen. (It does NOT navigate to /activate — that
 * route is dead code; LicenseGate owns the activation UI.)
 */
export function useLicenseHeartbeat() {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let interval = DESKTOP_INTERVAL;

    async function beat() {
      try {
        const res = await fetch('/api/license/heartbeat', { method: 'POST' });
        if (!res.ok) return;
        const json = await res.json().catch(() => ({}));

        if (json?.hosted) interval = CLOUD_INTERVAL;
        if (json?.changed) window.location.reload();
      } catch {
        // Network unreachable — keep working on the cached license.
      }
    }

    beat();
    timerRef.current = setInterval(beat, interval);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);
}
```

The `hosted: true` flag this reads was already added to the heartbeat response in Task 4, Step 5 — no further route change is needed here.

- [ ] **Step 5: Typecheck the touched files**

Run: `npx tsc --noEmit 2>&1 | grep -E "license|heartbeat|state-store|terminal-count"`
Expected: no errors naming these files. (The repo's global typecheck is already red — see Global Constraints — so filter to the files this plan touches.)

- [ ] **Step 6: Commit**

```bash
git add app/api/license/status/route.ts components/license-gate.tsx app/(app)/use-license-heartbeat.ts app/api/license/heartbeat/route.ts
git commit -m "feat(licensing): surface lock reasons and use hourly cloud heartbeat"
```

---

### Task 8: Feature gating helper

**Files:**
- Create: `lib/licensing/features.ts`
- Create: `tests/unit/license-features.test.ts`
- Modify: `tests/unit/run.ts`

**Interfaces:**
- Consumes: `readLicensePayloadAsync` (Task 3).
- Produces:
  - `hasFeatureIn(features: string[] | undefined, name: string): boolean` — pure.
  - `hasFeature(name: string): Promise<boolean>` — reads the installed payload.

The spec states the mechanism is the deliverable; which features map to which edition is a separate product decision and is deliberately not encoded here.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/license-features.test.ts`:

```typescript
import assert from 'node:assert/strict';
import { hasFeatureIn } from '../../lib/licensing/features';

assert.equal(hasFeatureIn(['cloud-sync', 'reports'], 'cloud-sync'), true, 'present feature');
assert.equal(hasFeatureIn(['cloud-sync'], 'reports'), false, 'absent feature');

// A license with no features array grants nothing.
assert.equal(hasFeatureIn(undefined, 'cloud-sync'), false, 'undefined features grants nothing');
assert.equal(hasFeatureIn([], 'cloud-sync'), false, 'empty features grants nothing');

// Matching is case-insensitive and tolerates surrounding whitespace.
assert.equal(hasFeatureIn(['Cloud-Sync'], 'cloud-sync'), true, 'case-insensitive');
assert.equal(hasFeatureIn([' cloud-sync '], 'cloud-sync'), true, 'trims whitespace');

console.log('license-features: all assertions passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/unit/license-features.test.ts`
Expected: FAIL — cannot find module `../../lib/licensing/features`.

- [ ] **Step 3: Write the implementation**

Create `lib/licensing/features.ts`:

```typescript
/**
 * Edition feature gating. Features are carried inside the vendor-signed
 * payload, so they cannot be granted by editing local config.
 */
import { readLicensePayloadAsync } from './verify';

/** Pure membership check — case-insensitive, whitespace-tolerant. */
export function hasFeatureIn(features: string[] | undefined, name: string): boolean {
  if (!features?.length) return false;
  const want = name.trim().toLowerCase();
  return features.some((f) => String(f).trim().toLowerCase() === want);
}

/** True when the installed license grants the named feature. */
export async function hasFeature(name: string): Promise<boolean> {
  const payload = await readLicensePayloadAsync();
  return hasFeatureIn(payload?.features, name);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/unit/license-features.test.ts`
Expected: PASS — `license-features: all assertions passed`.

- [ ] **Step 5: Register the test and commit**

In `tests/unit/run.ts` add:

```typescript
import './license-features.test';
```

```bash
git add lib/licensing/features.ts tests/unit/license-features.test.ts tests/unit/run.ts
git commit -m "feat(licensing): add signed-payload feature gating helper"
```

---

### Task 9: Cloud customer onboarding runbook

**Files:**
- Create: `docs/CLOUD-LICENSING-RUNBOOK.md`

**Interfaces:**
- Consumes: everything above.
- Produces: the operational procedure. No code.

- [ ] **Step 1: Write the runbook**

Create `docs/CLOUD-LICENSING-RUNBOOK.md` covering, in this order:

1. **Provision the customer database** — `npm run provision-cloud -- --license VRDX-XXXX-XXXX-XXXX` from the license-server repo. Note it clones the schema structure-only from `CLOUD_PROVISION_REF_DB` and is idempotent.
2. **Create the license** in the dashboard: set `max_activations` to the customer's terminal count, the edition, and the expiry date.
3. **Mint the hosted token** — `npm run new -- --product-key VRDX-XXXX-XXXX-XXXX --web --edition web`.
4. **Create the Railway service** — new service from the POS repo. Record the two traps explicitly:
   - **Set the config-as-code path to `railway.pos.json`.** Without it Railway looks for the default `railway.json`, which the POS repo no longer has.
   - **Set a fresh fixed `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`.** If it is unset the key is regenerated every build and the app fails with `Failed to find Server Action`.
5. **Set the environment variables** — `DB_*` pointing at the provisioned database, `DB_SSL=true`, `LICENSE_KEY` (the minted token), and `LICENSE_SERVER_URL=https://vendix-license-server-production.up.railway.app`.
6. **Verify** — load the app, confirm it is licensed, then confirm a `license_state` row exists with a recent `last_validated_at`. That row appearing is the proof that the bootstrap handoff worked.
7. **Monthly renewal** — extend the expiry in the dashboard. No Railway change is needed; the next hourly heartbeat pulls the new token. State plainly that `LICENSE_KEY` becomes stale after bootstrap and is *not* the live license.
8. **Revocation** — revoke in the dashboard; the customer locks within the hour.
9. **Security note** — a hosted token is a machine-unbound bearer credential. Anyone who copies it into `LICENSE_KEY` on another host is licensed until the license is revoked. Treat it as a secret.

- [ ] **Step 2: Commit**

```bash
git add docs/CLOUD-LICENSING-RUNBOOK.md
git commit -m "docs: add cloud customer onboarding and licensing runbook"
```

---

### Task 10: Full-suite verification

**Files:** none modified.

- [ ] **Step 1: Run the whole unit suite**

Run: `npm run test:unit`
Expected: PASS, including all five new test files. If a failure appears in a test unrelated to licensing, confirm against `git stash` whether it pre-dates this work before treating it as a regression — the baseline is known red in lint/typecheck/E2E.

- [ ] **Step 2: Verify the desktop path is untouched**

Run: `npx tsx tests/unit/license-machine-match.test.ts`
Expected: PASS. This is the guard on the Global Constraint that desktop behaviour did not change.

- [ ] **Step 3: Manually exercise the bootstrap handoff**

With a hosted token in `LICENSE_KEY` and the migration applied to a scratch database, start the app and hit `POST /api/license/heartbeat`. Confirm:
- a `license_state` row appears with `last_validated_at` set;
- deleting the `LICENSE_KEY` env var and restarting still leaves the app licensed (the DB row now carries it).

That second check is the whole point of this work — record the result explicitly.
