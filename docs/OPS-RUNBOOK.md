# Verdix POS — Deployment & Operations Runbook

How to license and cloud-enable Verdix POS for many customers. Covers the
desktop POS, per-customer cloud sync, and the hosted web deployment.

> **Secrets:** every `<...>` below is a placeholder. Never commit real
> passwords or tokens — set them only in `.env` (gitignored) or the Railway
> service **Variables** tab. Treat `LICENSE_KEY`, `CLOUD_CONFIG_SECRET`, and all
> DB passwords as secrets.

---

## 1. Infrastructure

Two independent Railway projects:

| Project | Contains | Purpose |
|---|---|---|
| **Vendix-LMS** | `vendix-license-server` (deployed) + MySQL `verdix_license` | Issues/validates licenses. POS calls it to activate. |
| **Vendix_Pos** | `Verdix` web service + MySQL (`verdix` + per-customer `verdix_c_*`) | Customer POS data. Web app + tenant databases. |

- Desktop POS calls the license server at `LICENSE_SERVER_URL`
  (`https://vendix-license-server-production.up.railway.app`).
- Each customer's cloud data lives in its **own** database `verdix_c_<id>` on the
  Vendix_Pos MySQL, accessed by a **scoped user** that can touch only that DB.

---

## 2. One-time server setup

### 2a. License server (Vendix-LMS)

Set these on the **Vendix-LMS → vendix-license-server → Variables**:

```
CLOUD_CONFIG_SECRET=<strong random secret — NEVER change once set; back it up>
LICENSE_ADMIN_SECRET=<dashboard session secret>
```

> `CLOUD_CONFIG_SECRET` encrypts every stored cloud-DB password. If it is lost or
> changed, previously stored per-customer configs can no longer be decrypted.

Ensure the license DB schema is up to date (creates `cloud_configs` etc.). With
`LICENSE_DB_*` pointing at the Vendix-LMS MySQL:

```bash
npm run license:migrate
```

### 2b. Provisioning host (your admin machine)

The `cloud:provision` command runs from your machine. It needs the Vendix_Pos
MySQL **admin** credentials (to create tenant DBs + users) and the same
`CLOUD_CONFIG_SECRET` as the server. Requires `mysql` and `mysqldump` on PATH.

```
# Provisioning target = Vendix_Pos MySQL admin (public proxy)
CLOUD_PROVISION_HOST=<vendix_pos-mysql-proxy-host>
CLOUD_PROVISION_PORT=<port>
CLOUD_PROVISION_USER=root
CLOUD_PROVISION_PASSWORD=<vendix_pos root password>
CLOUD_PROVISION_REF_DB=verdix          # reference schema template (keep its schema current)
CLOUD_CONFIG_SECRET=<same value as the license server>

# License DB = Vendix-LMS MySQL (so cloud_configs is written where the server reads it)
LICENSE_DB_HOST=<vendix-lms-mysql-host>
LICENSE_DB_PORT=<port>
LICENSE_DB_USER=root
LICENSE_DB_PASSWORD=<vendix-lms root password>
LICENSE_DB_NAME=verdix_license
```

> **Keep `verdix` (the reference DB) schema current.** It is the template every
> new tenant DB is cloned from (`mysqldump --no-data`). After a schema migration
> to the POS, apply it to `verdix` too, or new customers miss the new tables.

---

## 3. Onboard a new customer (cloud sync)

1. **Create a license** in the license dashboard (`npm run license:server`) →
   issue a Product Key, e.g. `VRDX-XXXX-XXXX-XXXX`.

2. **Provision their isolated cloud DB:**
   ```bash
   npm run cloud:provision -- --license VRDX-XXXX-XXXX-XXXX
   ```
   Creates `verdix_c_<id>` + a scoped user, loads the schema, stores the
   (encrypted) connection, and adds the `cloud-sync` feature to the license.
   Idempotent; add `--rotate-password` to reset the scoped user's password.

   > To sell a customer **without** cloud sync, simply skip this step — their POS
   > runs offline-only.

3. **Verify isolation** (recommended once): connect as the scoped user and
   confirm it can query its own DB but gets `access denied` on `verdix` or any
   other tenant DB.

---

## 4. Desktop POS install (per store machine)

No cloud credentials in the installer. The POS `.env` needs only:

```
LICENSE_SERVER_URL=https://vendix-license-server-production.up.railway.app
DB_HOST=<local store MySQL>
DB_PORT=3306
DB_USER=<...>
DB_PASSWORD=<...>
DB_NAME=verdix
```

The customer activates with their **Product Key** (POS activation screen →
Online). On success, the cloud config is delivered and written
(machine-encrypted) to `%PROGRAMDATA%\Verdix\cloud.dat`, and cloud sync starts
automatically — pushing to **their own** tenant DB.

- Licensing is **machine-bound**: the key is locked to that computer's hardware
  fingerprint. A different computer needs its own activation (seat).

---

## 5. Web deployment license (hosted mode)

The deployed web app (Vendix_Pos → **Verdix** service) is a **separate** license
from the desktop, held in an env var — because a container has no stable
hardware fingerprint.

1. **Mint a hosted license:**
   ```bash
   npm run license:new -- --product-key VRDX-WEB-XXXX-XXXX --web --edition web
   ```
   Prints a signed token whose `Machine ID : HOSTED`.

2. **Set it on Railway** → Vendix_Pos → **Verdix** service → Variables:
   ```
   LICENSE_KEY=<the signed token>
   ```

3. **Redeploy.** The activation wall is gone; `/api/license/status` returns
   `active` on any container (the `HOSTED` sentinel skips the hardware check;
   signature/product/expiry are still enforced).

> **`LICENSE_KEY` is a bearer secret.** Anyone who pastes it elsewhere is
> licensed — there is no per-seat enforcement for hosted licenses. **Revocation
> in the LMS is the only kill switch.** Keep it only in Railway Variables.
> Never set `LICENSE_KEY` on a desktop — it shadows the desktop's `license.dat`.

---

## 5b. Terminal-id uniqueness (multi-writer fiscal isolation)

Per-terminal fiscal records — `shifts`, `cash_transfers`, `x_readings`,
`z_readings`, and the OR/X/Z counters on `pos_terminals` — are pushed to the shared
cloud tagged by `terminal_id`, and are **never pulled back down** (they stay local
to their terminal). Their global uniqueness depends on **each writer having a
distinct `terminal_id`** — the web deployment and every desktop terminal must be
provisioned with a unique terminal id (analogous to the per-deployment
`SI_SERIES_PREFIX`). Colliding terminal ids would collide on push (e.g. the
`z_readings.reading_number` primary key). **Assign each terminal a unique id at
setup.**

---

## 6. Runtime flow (reference)

```
Desktop activate (Product Key)
  → license server validates + returns signed license (+ cloudConfig if feature)
  → POS: license.dat + cloud.dat written → cloud sync → own tenant DB
  → heartbeat re-validates (enforces revoke/renew), refreshes cloud config on change

Web (LICENSE_KEY env)
  → LicenseGate → /api/license/status → reads LICENSE_KEY → sentinel skips hardware
  → licensed; heartbeat sends machineId='HOSTED' → LMS enforces revoke/renew
```

Cloud sync (both): push every 1 min, pull master data every 5 min; no-op when
offline OR when the license lacks the `cloud-sync` feature. Offline-first — the
store keeps operating without internet.

---

## 7. Sta. Lucia Sale Consolidator go-live checklist

Per-store, one-time. Local mocks (`/api/dev/mock-sta-lucia/*`) are used for
development and testing only — they return `404` automatically in a production
build (`NODE_ENV` is inlined at build time), so there is nothing to disable.

1. **Get the tenant account from the mall.** The Sta. Lucia mall (via MediaOne)
   issues the store a login **email + password** for the Tenant Management
   System, alongside the lease. This is *not* a Verdix POS login.

2. **In Verdix, go to Settings → External API Integrations → edit the Sta.
   Lucia entry** (or add one if none exists, Provider = "Sta. Lucia Tenant
   System") and set:

   | Field | Value |
   |---|---|
   | Domain | The real Sta. Lucia domain (e.g. `https://sta-lucia-malls.com`) — **not** `localhost` |
   | Tenant Email | The real tenant account email from step 1 |
   | Tenant Password | The real tenant account password from step 1 |
   | Enabled | On |

3. **Click Test.** This runs login → read-back → logout against the real
   domain and writes nothing to the mall — safe to run as many times as
   needed. A failure here (bad credentials, unreachable domain, wrong header
   names) means nothing has been submitted yet; fix and retry before step 4.

4. **Let one real Z-reading go through**, then check **Sync Logs** for a
   `STA_LUCIA_SALES` row with `status = success`. This is the first real
   submission — there is no dry-run for the sales payload itself.

5. **Confirm the credit/debit interpretation with MediaOne before relying on
   it for reconciliation.** Verdix sends `credit` (non-cash tender) and
   `debit` (cash tender) as the true amounts collected, which sum to **net**
   sales. The source PDF's own example has them summing to **gross**. If
   MediaOne expects gross reconciliation, the fix is one line in
   `lib/integrations/sta-lucia/payload.ts` (`buildSalesPayload`).

**Known limitation — at-least-once, not exactly-once delivery.** A crash
between the mall accepting a submission and Verdix recording that success, or
a timeout on a request the mall actually processed, can cause a Z-reading to
be resubmitted once by the automatic recovery logic. This requires either a
crash or a >30s timeout to trigger, and is documented in
`docs/superpowers/specs/2026-07-31-sta-lucia-sales-consolidator-design.md`.
There is no way to close it without a MediaOne-side idempotency key on their
API, which does not currently exist.

**To pause submissions without disabling the integration:** set the API's
*On Error Action* to `Log Only` and *toggle it off* — a disabled config never
submits (checked on every send). Toggling back on resumes automatic sends
from the next Z-reading; nothing is submitted retroactively.

---

## 8. Troubleshooting

| Symptom | Cause / Fix |
|---|---|
| Web shows activation wall | `LICENSE_KEY` not set (or blank) on the Verdix service → set it, redeploy. |
| Web activation `500` | `CLOUD_CONFIG_SECRET` missing on the license server (degrades to no cloud config, but check it is set). |
| `cloud:provision` skips a table on Railway | The `verdix` reference DB is missing that table — update the reference schema. |
| Customer's data not syncing | License lacks the `cloud-sync` feature (didn't run `cloud:provision`), or no internet, or `cloud.dat` missing (re-activate). |
| Scoped user can read another customer's DB | Provisioning bug — re-run `cloud:provision`; verify `GRANT` is scoped to `verdix_c_<id>.*` only. |
| Desktop stuck on "wrong computer" | Key was issued for a different machine — re-issue for this machine's Machine ID. |
| Revoked customer still working | Revocation applies on the next heartbeat; ensure the machine has reached the license server since revocation. |
| Sta. Lucia Test fails with a connection error | Domain is wrong or unreachable — confirm it's the real mall domain, not `localhost`, and that the store has internet access. |
| Sta. Lucia Test fails with `401`/inactive account | Tenant credentials are wrong, or the mall has deactivated the account (`status: 0` in their login response) — contact MediaOne. |
| Sta. Lucia Z-reading has no Sync Logs row at all | The API config is disabled, or no `provider='sta_lucia'` config is enabled — check Settings → External API Integrations. |
| Sta. Lucia Sync Logs row stuck on `failed` | Click **Retry** on that row, or check *On Error Action* is `Automatic Retry` for it to self-heal every 2 minutes. |

---

## 9. Related design docs

- Multi-tenant cloud sync: `docs/superpowers/specs/2026-07-06-multi-tenant-cloud-sync-design.md`
- Web/hosted license mode: `docs/superpowers/specs/2026-07-06-web-hosted-license-design.md`
- Sta. Lucia Sale Consolidator integration: `docs/superpowers/specs/2026-07-31-sta-lucia-sales-consolidator-design.md`
- Architecture overview: `CLAUDE.md`
