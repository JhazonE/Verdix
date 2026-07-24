# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

**Verdix POS** — a Philippine retail point-of-sale system built as a Next.js 16 web app wrapped in Electron 33 for Windows desktop deployment. Its **License Management Server** lives in a separate repository at `../verdix-license-server` and runs independently on port 4100.

---

## Commands

```bash
# Development
npm run dev                  # Next.js + Turbopack on port 3000
npm run build && npm start   # Production build

# Code quality
npm run lint
npm run typecheck

# Database
npm run migrate              # Run all pending migrations
npm run migrate:down         # Roll back last migration
npm run seed                 # Seed reference/lookup data
npm run set-admin            # Promote a user to admin role

# Electron desktop
npm run electron-dev         # Dev: Next.js + Electron together
npm run electron-admin-dev   # Dev: Admin UI variant
npm run dist                 # Build portable .exe
npm run build:installer      # Build Inno Setup installer

# E2E tests (isolated DB on port 3100)
npm run test:e2e             # Run all Playwright tests headless
npm run test:e2e:ui          # Open Playwright UI mode
npm run test:e2e:report      # Show last test report
npm run test:e2e:db          # Re-seed the test database only

# License server — now a SEPARATE REPO at ../verdix-license-server
# (run these from that repo, not here)
#   npm run migrate      # Create verdix_license DB tables
#   npm run seed-admin -- --username admin --password "..."
#   npm run server       # Start dashboard at http://localhost:4100
#   npm run new -- --product-key VRDX-XXXX-XXXX-XXXX --machine "..."
```

---

## Environment

`.env` at the repo root. Key variables:

| Variable | Purpose |
|---|---|
| `DB_HOST/PORT/USER/PASSWORD/DB_NAME` | Local MySQL (default: `verdix`) |
| `CLOUD_DB_HOST/PORT/USER/PASSWORD/DB_NAME` | Railway MySQL (optional — enables cloud sync) |
| `NEXT_PUBLIC_API_BASE_URL` | Used by the browser to call API routes |
| `LICENSE_DB_*` | Separate DB for the license server (`verdix_license`) |
| `LICENSE_ADMIN_SECRET` | HMAC secret for license dashboard sessions |
| `LICENSE_UI_PORT` | License server port (default `4100`) |
| `GEMINI_API_KEY` | Optional — AI features |

---

## Architecture

### Next.js App (port 3000)

**Two route groups under `app/`:**
- `(app)/` — All authenticated pages (dashboard, inventory, sales, purchases, suppliers, customers, reports, POS, settings, approvals, user management)
- `api/` — 150+ REST route handlers. All database logic lives here, not in Server Components.

**Auth pattern** — `POST /api/auth/login` returns `{ uid, displayName, userType, permissions[] }` stored in `localStorage` as `mock-user-session`. Every API route reads it from the request body or headers. POS-type users are hard-redirected to `/pos`.

**No ORM** — raw `mysql2/promise` queries everywhere via `lib/mysql.ts`. Two pools: local (`query()`) and cloud (`cloudQuery()`). The cloud pool is lazily initialized and never blocks the app if Railway is unreachable.

### Database (MySQL 8)

Migrations in `scripts/migrations/` — numbered TypeScript files (001–088+), each with `up()` and `down()`. Run by `npm run migrate`; executed migrations tracked in a `migrations` table.

### Key Domain Patterns

**Stock / Inventory:**
- `lib/batch-deduction.ts` — FIFO cost depletion on every sale. Each product has `inventory_batches` rows; sales pull from oldest batch first.
- `lib/family-sync.ts` — Products can belong to a family (e.g., 1kg bag → 250g sachets). Any stock change recursively syncs all family members.
- `lib/stock-movements.ts` — Every stock change writes a movement record for audit/history.

**Approvals workflow** — A multi-level queue pattern used for purchase orders, stock counts, stock transfers, bad orders, and bulk adjustments. Items are inserted with `status='pending'`, moved through approval levels, then finalized to update actual stock/accounts.

**POS (Point of Sale) — `/pos` route** — Fullscreen checkout UI. The Electron window is the primary deployment target. POS uses its own terminal/shift/cash-drawer management separate from the back-office UI. Checkout hits `POST /api/pos/checkout`.

**Cloud Sync** — Railway direct-MySQL sync. Not event-based: API routes call `cloudQuery()` in parallel after local write. Sync status tracked in `cloud_sync_log`. The `POST /api/cloud-sync/push` and `/pull` endpoints do full-table reconciliation.

**Printing** — ESC/POS via Windows Spooler. `lib/receipt-generator.ts` builds byte buffers using `@point-of-sale/receipt-printer-encoder`. Electron exposes `window.printerBridge` (from `main.js`/`preload.js`) to call the native Windows spooler DLL at `lib/sdk/`. Web builds fall back to `window.navigator.serial` (Web Serial API).

**BIR Compliance (Philippine Tax)** — Sales invoices use BIR-format SI numbers (sequential, never gapped). Z-readings and X-readings are locked reports required for tax filing. `lib/fiscal-utils.ts` handles VAT calculations. These are legally significant — do not change numbering logic without understanding the impact.

### License System (separate repo: `../verdix-license-server`)

A completely standalone HTTP server (no Next.js), in its own git repository. Manages Ed25519-signed, machine-bound license keys for the POS.

- **Private key** lives only on that server (`keys/` in that repo, gitignored)
- **Public key** embedded in the POS at `lib/licensing/public-key.ts`
- **Shared crypto is duplicated, not shared.** `lib/licensing/core.ts` here and `src/licensing/core.ts` in the license repo are intentional copies of the same Ed25519 contract. If you change the key format or algorithm in one, you MUST make the identical change in the other or previously issued licenses stop verifying.
- This repo keeps `lib/licensing/` + `lib/crypto/aes-gcm.ts` because the POS **verifies** licenses (`app/api/license/*`); only the signing server moved out.
- POS calls `POST /api/license/activate-online` → license server validates product key, checks seat count, signs and returns a machine-bound JWT-like token
- Offline flow: admin generates key from dashboard, gives to customer manually
- `lib/licensing/machine.ts` — Windows hardware fingerprint (registry MachineGuid + WMI serials) used as machine ID in license payloads

### Electron Wrapper

`main.js` is the Electron main process. It spawns the Next.js server as a child process, opens the browser window pointed at `http://localhost:3000`, and exposes the printer bridge via `preload.js`. `printer-sdk.js` and `epson-sdk.js` are Windows-only native bridges using `koffi` FFI.

### E2E Tests

Playwright tests run on port 3100 against a separate `verdix_test` database. `tests/e2e/setup/global-setup.ts` creates and seeds this DB before any test runs. Tests are sequential (workers: 1) to avoid concurrent DB mutations. Run `npm run test:e2e:db` to reset the test DB without re-running tests.

---

## Important Constraints

- **Windows-only desktop features** — Printer bridge, hardware fingerprinting, Electron packaging. Web browser builds skip these gracefully.
- **MySQL only** — No abstraction layer. All queries are raw SQL.
- **No parallel E2E tests** — The test DB is shared across the test suite; always `workers: 1`.
- **`CLOUD_DB_*` is optional** — If unset, cloud sync is silently skipped. Never throw or crash when cloud is unreachable.
- **BIR SI numbers are legally significant** — The sequential numbering in `sales_invoice_number` must never have gaps or duplicates.
- **License server is a separate repo and process** — It lives at `../verdix-license-server`, has its own DB (`verdix_license`), its own auth, and runs independently of the Next.js app. Start it from that repo with `npm run server`.
