# Cloud Licensing Runbook

How to onboard a new **cloud-hosted** Verdix POS customer on Railway, and how
to renew, revoke, and troubleshoot their license afterward. This covers the
web/hosted deployment path specifically — the license server itself is
already deployed and does not need to be stood up.

> **Secrets:** every `<...>` below is a placeholder. Never commit real
> tokens or passwords — set them only in the Railway service **Variables**
> tab. Treat `LICENSE_KEY` and all DB passwords as secrets.

---

## 0. Before you start

- The License Management Server is a **separate repo**, already deployed and
  live at `https://vendix-license-server-production.up.railway.app`. You do
  not deploy it as part of this runbook.
- All `npm run provision-cloud` / `npm run new` / `npm run server` commands
  below run **from that repo** (`../verdix-license-server` relative to the
  POS repo, or `d:/VERDIX_POS/verdix-license-server` as an absolute path),
  not from the Verdix POS repo.

---

## 1. Provision the customer database

From the **license-server repo**:

```bash
npm run provision-cloud -- --license VRDX-XXXX-XXXX-XXXX
```

This creates a database named `verdix_c_<hash>` plus a scoped user that can
touch only that database, clones the schema **structure-only** (no data,
`mysqldump --no-data`) from the reference DB, encrypts and stores the
connection details, and adds the `cloud-sync` feature to the license.

- **Idempotent** — safe to re-run; it reuses the existing DB/user instead of
  recreating them.
- Add `--rotate-password` to reset the scoped user's password if it needs to
  be rotated.

---

## 2. Create the license in the dashboard

Open the license server's dashboard and create a new license for the
customer, setting:

- **Product key** — e.g. `VRDX-XXXX-XXXX-XXXX` (the same key used in step 1).
- **`max_activations`** — set this to the customer's **terminal count**. See
  §9 for what happens if they exceed it later.
- **Edition** — the plan/tier they purchased.
- **Expiry date** — the paid-through date for their current billing period.

---

## 3. Mint the hosted token

From the **license-server repo**:

```bash
npm run new -- --product-key VRDX-XXXX-XXXX-XXXX --web --edition web
```

The `--web` flag sets the license's machine ID to the `HOSTED` sentinel,
which skips the hardware-fingerprint binding check that desktop licenses
enforce (signature, product key, and expiry are still fully enforced). This
prints a signed token — copy it, you'll paste it into Railway in step 5.

---

## 4. Create the Railway service

Create a new Railway service from the Verdix POS repo for this customer.

> ### ⚠️ Trap 1 — config-as-code path
>
> **You must explicitly set the service's config-as-code path to
> `railway.pos.json`.** Railway defaults to looking for `railway.json`,
> which the POS repo does **not** have. If you skip this, the build either
> fails outright or silently builds against the wrong Dockerfile. Set this
> in the service's Settings before the first deploy.

> ### ⚠️ Trap 2 — fixed Server Actions encryption key
>
> **`NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` must be set to a fixed value,
> generated once for this service.** If it is left unset, Next.js
> regenerates it on every build, so Server Action IDs change between builds
> and between replicas — the app then fails at runtime with
> `Failed to find Server Action "..."`.
>
> Generate one value and set it once, before the first deploy:
> ```bash
> node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
> ```
> Do not change it later — rotating it breaks any page already loaded in a
> user's browser until they refresh.

---

## 5. Set the environment variables

On the new service's **Variables** tab:

```
DB_HOST=<provisioned DB host from step 1>
DB_PORT=<provisioned DB port>
DB_USER=<scoped user from step 1>
DB_PASSWORD=<scoped user password from step 1>
DB_NAME=verdix_c_<hash from step 1>
DB_SSL=true
LICENSE_KEY=<token minted in step 3>
LICENSE_SERVER_URL=https://vendix-license-server-production.up.railway.app
```

Plus the two values from step 4 (config-as-code path set in service
Settings, not Variables; `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` set in
Variables). Deploy the service.

---

## 6. Verify the bootstrap handoff

1. Load the app at the service's public URL and confirm it comes up
   licensed (no activation wall).
2. Connect to the customer's `verdix_c_<hash>` database and confirm a row
   exists in `license_state` with a recent `last_validated_at`.

That row appearing is the proof that the bootstrap handoff worked: the app
read `LICENSE_KEY` on first boot, validated it against the license server,
and persisted the signed result into the database. From this point on, the
**database row is authoritative** — `LICENSE_KEY` has done its job and is no
longer read.

---

## 7. Monthly renewal

Extend the expiry date on the customer's license in the dashboard.

**No Railway change is needed.** This is the point of the architecture:
`LICENSE_KEY` is only a bootstrap seed, read once on first heartbeat after
deploy. Every renewal after that is picked up automatically — the cloud
heartbeat runs hourly, re-validates against the license server, and writes
the freshly-signed token into the customer's `license_state` row.

Do **not** re-paste `LICENSE_KEY` into Railway for a routine renewal. It is
stale after the first successful heartbeat and editing it has no effect on
an already-bootstrapped service.

If the license server is unreachable for more than **7 days**, the POS locks
itself with a message stating the license server could not be reached —
distinct from a revocation message (see §8). This is a grace-period
safeguard, not something you need to act on for a normal renewal.

---

## 8. Revocation

Revoke the license in the dashboard. This is a single action — no Railway
change, no redeploy.

The customer's POS locks within the hour, on its next hourly heartbeat. The
lock screen shows a revocation-specific message, distinct from the
"server unreachable" message in §7.

---

## 9. Seat limits

`max_activations` (set in step 2) is the customer's terminal count.

On the cloud deployment, **going over the limit does not lock checkout.**
Locking a paying store out of checkout over a seat count would be
unacceptable — a business mid-transaction cannot be told to stop selling.
Instead, exceeding `max_activations` blocks the creation of **additional**
terminals. Existing terminals keep working normally.

> **Note:** the block is the only signal the customer gets. When they try to
> add a terminal beyond the limit, the request is refused with a message
> naming the count and the limit. There is **no** standing in-app banner
> warning an admin that the store is already over its seat count — the
> heartbeat reports `seatLimit` and `terminalCount`, but no screen displays
> them yet. Check the license dashboard if you need to know a customer's
> current standing.

To let the customer add another terminal, either raise `max_activations` on
their license in the dashboard (if they're paying for the extra seat) or
have them retire an existing terminal first.

---

## 10. Security note — treat the hosted token as a secret

A hosted token (the value minted in step 3 and set as `LICENSE_KEY`) is a
**machine-unbound bearer credential**. Unlike a desktop license, it is not
tied to any hardware fingerprint — the `HOSTED` sentinel skips that check by
design, because a container has no stable hardware identity.

This means **anyone who copies the token into `LICENSE_KEY` on another host
is licensed**, indistinguishable from the legitimate deployment, until the
license is revoked. There is no per-seat enforcement to fall back on for a
leaked hosted token.

- Keep it only in the Railway service's Variables tab.
- Never paste it into chat, tickets, or shared docs.
- **Revocation in the dashboard is the only kill switch.** If a token leaks,
  revoke the license (§8) immediately.

---

## Troubleshooting

| Symptom | Cause / Fix |
|---|---|
| New service build fails or builds the wrong app | Config-as-code path not set to `railway.pos.json` (Trap 1, §4). |
| App loads then errors with `Failed to find Server Action "..."` | `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` unset or changed after first deploy (Trap 2, §4). Set it once to a fixed value and redeploy. |
| App shows activation wall after deploy | `LICENSE_KEY` missing/blank, or the token was rejected (wrong product key, expired, or revoked) — check the license in the dashboard. |
| Renewed the license but app still shows old expiry / still locked | Wait for the next hourly heartbeat, or confirm `LICENSE_SERVER_URL` is reachable from the service. Do not re-paste `LICENSE_KEY` — see §7. |
| `license_state` row never appears after deploy | `LICENSE_KEY` was never set, or the DB variables point at the wrong database — recheck step 5 against the DB created in step 1. |
| Customer locked with "server could not be reached" | License server has been unreachable from this service for over 7 days — check `LICENSE_SERVER_URL`, network egress, and that the license server itself is up. |
| Customer locked with a revocation message | License was revoked in the dashboard — this is expected behavior, not a bug; re-activate by un-revoking or issuing a new license. |
| Customer can't add a new terminal | Seat count is at or over `max_activations` (§9) — raise the limit in the dashboard or retire an existing terminal. |
| Suspect a leaked `LICENSE_KEY` | Revoke the license immediately (§8) — it is the only kill switch for a bearer token. |

---

## Related docs

- Desktop licensing and cloud-sync onboarding (non-hosted customers):
  `docs/OPS-RUNBOOK.md`
- Railway deployment mechanics (MySQL wiring, public URL, local POS
  connection): `RAILWAY_DEPLOYMENT.md`
- Architecture overview: `CLAUDE.md`
