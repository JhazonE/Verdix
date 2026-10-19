# Price Inquiry Kiosk — Design

**Date:** 2026-10-19
**Status:** Approved (brainstorm complete, ready to plan)

## Intent and Why

A self-service price checker to be placed on a shelf or near the store
entrance. The customer scans a product barcode themselves to see its price,
without having to find a staff member. **No attendant watches this terminal.**

Verdix POS already has a Price Inquiry dialog
(`app/(app)/pos/price-inquiry/PriceInquiryDialog.tsx`, Ctrl+P) but it is a
cashier tool: it lives inside the POS checkout screen, behind a cashier's
logged-in session, and its price display is sized for someone standing at the
counter. This work gives price inquiry its own account type and its own
screen, so a terminal can be dedicated to it.

## Goals

- A dedicated user type whose accounts can reach nothing but price inquiry.
- A fullscreen screen readable from a distance, driven entirely by a barcode
  scanner with no mouse or keyboard interaction required.
- A name-search fallback so a torn or unreadable barcode is not a dead end.
- Automatic return to an idle state so the screen is always ready for the
  next customer.

## Non-goals

- Adding to a cart, checkout, or any sale-affecting action.
- Showing stock quantity, cost, margin, or supplier.
- Editing prices.
- Any reports or back-office access.
- An attended "staff price checker" variant (a different product; not this).

## Anti-goals

Things that would make this a failure even if it technically works:

- **Price disagreeing with the POS.** If the kiosk quotes a price the register
  will not honour, the kiosk is worse than no kiosk. It must resolve price
  through the same code path POS uses.
- **A customer reaching anything else.** Typing a URL, hitting Escape, or
  closing a dialog must never land the customer in inventory, reports, or a
  cart.
- **A screen stuck on the previous customer's product.** A stale price on
  display is a wrong price.

## Decisions Made

### User type and permission

A row in `user_types` named `Price Inquiry`, holding exactly one permission,
`price_inquiry`, which is new to
`app/(app)/user-management/permissions.ts`. Added by a new migration (140),
following the pattern in `scripts/migrations/070_create_user_types_tables.ts`.

User types are DB-driven, but routing in this codebase is hardcoded against
the type *name* — so the name `Price Inquiry` is load-bearing and must match
between the migration and the routing checks.

### Routing

- `app/login/page.tsx` (~line 96): a `Price Inquiry` login routes to
  `/price-check`, alongside the existing `Cashier`/`Employee` → `/pos` branch.
- `app/(app)/use-app-layout.ts` (~line 79): a hard redirect back to
  `/price-check` for this user type, mirroring the existing
  `Cashier` → `/pos` redirect. This is what makes a typed URL harmless.
- `hasPermission` in the same file grants this type `price_inquiry` only.

### The screen — Layout B (chosen over two alternatives)

Route: `/price-check`.

- Fullscreen; dark background; very large type, readable at a distance.
- No sidebar, no header, no nav, **no logout button**.
- A search input pinned at the top, held focused at all times (refocused
  after every interaction) so a barcode scanner — which types then sends
  Enter — works with no clicks.
- An exact barcode match goes straight to the price. A typed name shows a
  short result list to pick from.
- The price renders very large in the centre, with the product name and the
  unit name.
- After 10 seconds idle, the screen returns to its idle prompt
  ("I-scan ang barcode" / "Scan a barcode").

Two layouts were rejected: scan-only (no fallback for an unreadable barcode)
and list+detail (reuses the existing dialog shape, but the price renders too
small for a customer standing in front of a kiosk).

### Price shown

`calculateEffectivePrice` from `lib/pricing.ts`, at the **default price
level** (Retail) — there is no cashier to select a level. Quantity is always
1, so no quantity tier applies. The **base selling unit's** price is what is
shown, since that is what an ordinary customer buys.

This matters for correctness: resolving price any other way risks quoting a
figure the register will not honour (see anti-goals).

### Data layer

The data layer from `app/(app)/pos/price-inquiry/use-price-inquiry.ts`
(`useProducts` + `useLiveRefresh`) is reusable as-is. The UI is new, because
the existing one is a cashier-facing dialog.

### Logout

None. The kiosk is shut down by closing the Electron app. Chosen over a
hidden keyboard shortcut and a corner button with an admin prompt, both of
which add a way for a customer to get somewhere they should not be.

## Constraints

- Next.js 16 app router; the screen is a client page under `app/(app)/`.
- The Electron window is the deployment target (fullscreen).
- MySQL only, raw `mysql2` queries; no ORM.
- Price must resolve through `lib/pricing.ts`, not a local calculation.

## Known Limitation (accepted)

`GET /api/products` includes `cost` in its payload, and API routes in this
codebase enforce auth in the UI rather than server-side (a documented,
systemic issue, not introduced here). The kiosk screen displays no cost, but
someone who reached browser devtools on the kiosk could read it from the API
response. For an Electron fullscreen kiosk this is accepted; a separate
hardened read-only endpoint is explicitly **not** part of this work.

## Left to the Builder

- Component and file layout under `app/(app)/price-check/`, following the
  repo's existing folder-per-feature convention (`page.tsx`, a `use-*.ts`
  hook, a `*-types.ts`).
- Exact typography scale and spacing for distance readability.
- How the exact-barcode-match shortcut is detected against the search results.
- Whether the idle timer resets on keystroke, on result selection, or both.
- Test coverage approach, consistent with the repo's Playwright E2E setup.

## Calls Made by Claude (not chosen by the user)

- Permission id `price_inquiry`.
- Route `/price-check`.
- 10-second auto-clear.
- Base-unit price only.
- No hardened API endpoint (limitation documented instead).

## Verified 2026-10-19 (automated)

What was exercised by automated checks on this machine:

- **Price agreement with POS** — the spec's primary anti-goal. After the
  post-review fix, `resolveKioskPrice` calls `calculateEffectivePriceForUnit`
  on the scanned unit — the same function POS calls — so agreement is
  structural rather than a property of current data. Swept **all 15,994
  products** in the live DB at quantity 1 / default level: **0 mismatches**.
  Separately, all 3 products carrying a scannable non-base barcode agree on
  unit, price and displayed barcode (before the fix, one read ₱62 against
  POS's ₱690).
- **Idle clear under live traffic** — verified with a stub that churns an
  unrendered field between refetches, the condition under which the original
  timer never expired.
- **A real barcode end to end, no stubs** — `4800103343532` scanned into the
  kiosk against the live API returned "Chubby Funmix 40pcs" at ₱44.90,
  matching the DB, with no cost/stock text anywhere in the rendered body.
- **Routing and the pin** — a `Price Inquiry` session is redirected to
  `/price-check` from `/`, `/products` and `/settings`, and the screen renders
  with 0 sidebars and 0 logout controls.
- **Kiosk behaviour** — 6 e2e tests: idle prompt, exact-barcode scan, no
  stock/cost leak, unknown barcode shows not-found and keeps focus, a second
  scan replaces the first, and the 10-second idle clear.
- **Suites** — unit 87 pass markers / 0 failures; typecheck 0 non-generated
  errors.

### Still requires a human with the hardware

- Creating a `Price Inquiry` user through the User Management UI and
  confirming `Price Inquiry (Kiosk)` is its only checked permission.
- Logging in through the real login form (the e2e login form does not render
  in this environment — a pre-existing condition, see the plan's ledger), so
  the `app/login/page.tsx` redirect branch is covered only by inspection.
- `npm run electron-dev` fullscreen presentation on the terminal.
- A physical barcode scanner firing into the focused field with nothing
  clicked.
- `npm run test:e2e` as a whole suite: Next 16 permits one dev server per
  directory, so the Playwright webServer on :3100 cannot start while a dev
  server is running. The specs were verified against :3000 instead.
