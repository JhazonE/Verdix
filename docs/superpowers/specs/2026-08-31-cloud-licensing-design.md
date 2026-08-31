# Cloud Licensing — Design

**Date:** 2026-08-31
**Status:** Approved for planning

## Problem

The Verdix license manager (`../verdix-license-server`) is deployed and live at
`https://vendix-license-server-production.up.railway.app`, and the POS already points at it via
`LICENSE_SERVER_URL`. It already implements everything cloud licensing needs: expiry with
auto-renewal, revocation, suspension, seat limits, feature lists, status-change webhooks, and
per-customer cloud DB provisioning.

None of it takes effect on the cloud (Railway-hosted) POS, because of one defect on the POS side:
**the license is read from an environment variable that the heartbeat cannot write to.**

`readLicenseKey()` in `lib/licensing/verify.ts:56-57` prefers `process.env.LICENSE_KEY` over the
license file. The heartbeat (`app/api/license/heartbeat/route.ts`) persists renewals with
`saveLicenseKey()` and enforces locks with `removeLicenseKey()` — both of which operate on
`%PROGRAMDATA%/Verdix/license.dat`. On a Railway container:

1. **Renewals are discarded.** The server signs a fresh token every heartbeat
   (`validateHeartbeat` in `src/service.ts` re-signs on every `active` response). The POS writes it
   to disk, then keeps reading the stale `LICENSE_KEY` env var. A paying customer expires anyway.
2. **Revocation does nothing.** `removeLicenseKey()` deletes a file; the env var survives. The kill
   switch requires manually editing Railway variables.
3. **The container filesystem is ephemeral** — even without the env-var precedence, any written
   token is lost on the next deploy.
4. **Seats are uncountable.** Every cloud terminal shares the `machineId = 'HOSTED'` sentinel, so
   the server sees exactly one activation no matter how many terminals are in use.

## Deployment model

One deployment per customer: each store gets its own Railway service and its own database. This is
not multi-tenant — no tenant/store partitioning is required.

## Solution

Move the authoritative license state from the container filesystem to the **customer's own
database**, where it survives restarts and redeploys. `LICENSE_KEY` is demoted to a one-time
bootstrap seed.

### 1. `license_state` table (new migration)

A single-row table in the POS database:

| Column | Purpose |
|---|---|
| `id` | Fixed primary key (always `1`) — enforces the single-row invariant |
| `signed_license` | Current signed token, refreshed by the heartbeat |
| `last_validated_at` | Timestamp of the last successful server contact; drives the grace window |
| `lock_reason` | `NULL` when healthy; `revoked` / `suspended` / `released` / `grace-expired` / `seat-exceeded` when locked |
| `updated_at` | Audit |

### 2. License resolution order

`readLicenseKey()` gains a cloud-aware path. Resolution order becomes:

```
license_state.signed_license (DB)  →  LICENSE_KEY env (bootstrap only)  →  license.dat (desktop)
```

Cloud mode is detected from the verified payload's `machineId === HOSTED_MACHINE_ID`. **The desktop
path is unchanged** — it stays file-first, with no database dependency, so an offline desktop POS
behaves exactly as it does today.

Because `readLicenseKey()` is currently synchronous and a database read is not, the cloud lookup is
introduced as an async resolver, with the synchronous function retained for the desktop file/env
path it already serves.

The callers are contained, so this is a mechanical change: `getLicenseInfo()` (used by
`app/api/license/status/route.ts`) and `readLicensePayload()` (used by
`app/api/license/heartbeat/route.ts`) gain async variants. Both call sites are API route handlers
that are already `async`. `evaluateLicenseKey()` takes a key as an argument and stays synchronous,
so `app/api/license/activate/route.ts` and `activate-online/route.ts` need no change.
`tests/unit/license-machine-match.test.ts` asserts the existing sync env-over-file precedence and
must keep passing unchanged.

### 3. Heartbeat writes to the database

- On `active` with a `signedLicense`: write it to `license_state.signed_license` and set
  `last_validated_at = NOW()`, clearing `lock_reason`. Renewals now persist across deploys.
- On `revoked` / `suspended` / `released`: set `lock_reason` instead of deleting a file. The lock
  takes effect even though `LICENSE_KEY` is still present in the environment.
- On network failure: leave `last_validated_at` untouched so the grace window advances.

### 4. Grace window — 7 days

When the license server is unreachable, the POS keeps operating on its cached license. If
`last_validated_at` falls more than **7 days** behind, the app locks with a message naming the cause
("cannot reach the license server") — distinct from a revocation message, so support can tell the
two apart.

This is the deliberate middle ground: a license-server outage cannot brick every customer at once,
but a customer cannot evade revocation indefinitely by blocking the server.

### 5. Seat enforcement via terminal count

The heartbeat includes the count of active terminals — `SELECT COUNT(*) FROM pos_terminals WHERE
is_active = TRUE` — in its `/api/validate` request body. The license server compares it against the
license's `max_activations` and returns a `seat-exceeded` status when the count is over the limit.

On `seat-exceeded` the store is **not** locked out. The POS surfaces a persistent warning to the
admin naming the overage (e.g. "6 terminals active, licensed for 4"), and blocks activation of
additional terminals until the count is back within the limit or the vendor raises it. Locking a
live store out of checkout over a seat count is disproportionate and would take down a paying
customer's business.

This requires an additive change to `/api/validate` in the license-server repo: accept an optional
`terminalCount` field and return the new status. The field is optional so existing desktop clients
that never send it are unaffected.

### 6. Feature gating

Signed payloads already carry `features[]`. Add a `hasFeature(name)` helper reading the verified
payload, and gate edition-specific routes and UI on it. The specific features per edition are a
product decision recorded outside this spec; the mechanism is what this design delivers.

### 7. Heartbeat interval

The client interval in `app/(app)/use-license-heartbeat.ts` is 24 hours. For cloud deployments it
drops to **1 hour**, so revocation takes effect within the hour. The desktop interval stays at 24
hours to avoid needless traffic from offline-tolerant installs.

### 8. Redirect target fix

`use-license-heartbeat.ts:24` redirects a revoked session to `/activate`, which is dead code —
`LicenseGate` renders its own activation screen and `app/activate/page.tsx` never mounts. The
heartbeat should trigger a `LicenseGate` re-check instead of navigating.

## Per-customer onboarding (operational, no code)

For each new cloud customer:

1. Create a license in the dashboard: set `max_activations` (terminal count), edition, and expiry.
2. `npm run provision-cloud -- --license VRDX-XXXX-XXXX-XXXX` — creates the customer's database and
   a scoped user.
3. `npm run new -- --product-key VRDX-XXXX-XXXX-XXXX --web --edition web` — mints the hosted token.
4. Paste the token into the customer's Railway service as `LICENSE_KEY`, and set
   `LICENSE_SERVER_URL`.

After the first heartbeat the database row is authoritative. Monthly renewal is then automatic:
extend the expiry in the dashboard and the next heartbeat pulls a freshly signed token. Revocation
is a single dashboard action.

## Security notes

- A hosted token remains a machine-unbound **bearer credential**. Anyone who copies it into
  `LICENSE_KEY` on another host is licensed until the license is revoked. Treat it as a secret; keep
  revocation as the kill switch. This design does not change that property — it makes revocation
  actually work, which is what makes the bearer model tolerable.
- The `HOSTED` sentinel only ever appears inside a vendor-signed Ed25519 payload, so the
  hardware-check bypass cannot be forged.
- Signature, product-id, and expiry checks stay enforced on every path.

## Testing

Unit tests for:

- Resolution order — DB row wins over env, env wins over file, desktop unchanged.
- Grace window — locks past 7 days, stays unlocked within it, resets on successful contact.
- Lock transitions — revoked/suspended set `lock_reason`; a later `active` clears it.
- Seat overage — `seat-exceeded` warns and blocks new terminals without locking checkout.

Existing hosted-license tests (`tests/unit/license-machine-match.test.ts`) must keep passing.

Note the repository's verification baseline is already red (lint broken, typecheck red, some E2E
failures pre-date this work) — new tests must be shown passing individually rather than relying on a
clean full-suite run.

## Files affected

**POS repo:**
- `scripts/migrations/` — new `license_state` migration
- `lib/licensing/verify.ts` — DB-backed resolution
- `app/api/license/heartbeat/route.ts` — DB writes, grace tracking, terminal count
- `app/api/license/status/route.ts` — surface `lock_reason` and grace state
- `components/license-gate.tsx` — lock messages distinguishing cause
- `app/(app)/use-license-heartbeat.ts` — 1-hour cloud interval, redirect fix

**License-server repo:**
- `src/server.ts` / `src/service.ts` — optional `terminalCount` on `/api/validate`, `seat-exceeded`

## Out of scope (YAGNI)

- **Billing/payment integration.** Renewal stays a manual dashboard action.
- **Multi-tenancy.** The model is one deployment per customer.
- **Per-device cloud activation.** Considered and rejected for now: it is the truest seat model but
  requires new device-identity logic and a per-device activation flow. Terminal counting delivers
  the same enforcement at a fraction of the cost.
- **Re-deploying the license server.** It is already live on Railway.
