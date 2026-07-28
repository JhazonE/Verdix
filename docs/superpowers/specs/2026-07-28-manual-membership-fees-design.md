# Membership Fees in the User Manual — Design

**Date:** 2026-07-28
**Status:** Approved, ready for planning

## Problem

The membership fee feature shipped across July 2026 (specs `2026-07-13-pos-membership-payment`,
`2026-07-14-membership-phase2`, `2026-07-15-*`) but never reached the user manual.

The manual currently mentions membership exactly once — a single row in the Chapter 8 report
index at `scripts/manual/content.ts:796`:

```
['Membership', '/reports/membership', 'Membership fee collections and loyalty program activity.'],
```

That row is also inaccurate: the membership report contains no loyalty program activity. It
reports activations, renewals, amounts, payment method, cashier, and validity — nothing about
points.

No chapter explains how to configure the fee, how a cashier collects it, or where the money
shows up at end of shift. Loyalty points *are* documented (Chapter 6, `customer-loyalty`
figure), which makes the omission worse: a reader can reasonably conclude loyalty is the whole
story and that membership is just a report.

## What the feature actually does

Verified against the components, not from memory:

| Piece | Location | Behavior |
|---|---|---|
| Setup | Settings → POS Setup → **General** tab | `MembershipCard.tsx` — Membership Fee (₱, min 0) and Membership Duration (months, min 1, max 120, default 12) |
| Collection | POS → **Customer** button → customer's Membership card → "Activate Membership" / "Renew Membership" | `MembershipPaymentDialog.tsx` — opened from `CustomerAccountDialog.tsx:214-220` |
| Shift cash | End Shift dialog | `EndShiftDialog.tsx:110-113` — "Membership Fees (cash)" line, included in expected cash |
| Printed reading | X-reading slip | `lib/x-reading-generator.ts:195-198` — "Membership (cash):" plus `Na / Nr` activation/renewal counts |
| Report | Reports → Membership | `app/(app)/reports/membership/page.tsx` — Activations / Renewals / Total Collected / Cash-vs-Card tiles, detail table, PDF export |

Key behaviors the manual must convey:

- **Activation vs renewal is automatic.** The dialog looks up the selected customer's existing
  loyalty card. No card → activation, and an RFID Card Code becomes required
  (`MembershipPaymentDialog.tsx:60-65`). Existing card → renewal, which extends the expiry.
- **Validity is computed at payment time** as today plus the configured duration
  (`MembershipPaymentDialog.tsx:54`), not from the old expiry date.
- **A zero fee blocks collection.** When `fee <= 0` the dialog shows "Membership fee is not
  configured. Set it in POS Setup → General." and Confirm Payment stays disabled.
- **Membership is not a sale.** It writes to `membership_payments`, never to
  `sales_transactions`, so it has no SI number and never appears in sales reports. Related:
  the `pos-transactions.sale_id` FK constraint is why these live in their own table.
- **Membership is not loyalty.** The loyalty card earns and redeems points; the membership fee
  activates or renews that card for a period. The manual documents loyalty already, and the POS
  bottom row has its own separate "Loyalty" button — these are easy to conflate.

## Known code inconsistency (documented, not fixed)

Membership cash appears in the **printed** X-reading slip
([x-reading-generator.ts:195-198](../../../lib/x-reading-generator.ts#L195-L198)) and in the
back-office preview
([sales/x-reading/x-reading-preview.tsx:241](<../../../app/(app)/sales/x-reading/x-reading-preview.tsx#L241>)),
but **not** in the on-screen POS X-reading view — `app/(app)/pos/x-reading/x-reading-types.ts`
has no `membershipCash` field, so `XReadingReportView.tsx` cannot render it.

The `pos-x-reading` figure screenshots that POS view. The manual will therefore describe the
membership line as appearing on the **printed slip** and in the **End Shift dialog**, which is
true, and will not claim it appears on the POS X-reading screen, which is false.

**This spec does not fix the inconsistency.** It is a code defect outside the scope of a
documentation task. Worth filing separately.

## Design

Four edits to `scripts/manual/content.ts`, three new entries in `scripts/manual/screens.ts`,
one new capture sequence in `scripts/manual/capture.ts`.

### 1. Chapter 6 (Customers) — new section "Membership fees"

Placed immediately after the existing "Loyalty points" section, so the two sit adjacent and the
distinction between them is unmissable. This section carries the full flow.

Blocks, in order:

1. **para** — What a membership fee is and how it differs from loyalty points: the loyalty card
   earns points on purchases; the membership fee activates or renews that card for a fixed
   period set in POS Setup. Cross-reference the preceding Loyalty points section.
2. **steps** — The collection flow:
   - At the POS, click "Customer" along the bottom row.
   - Select the customer. The Membership panel shows their current status: Active, Expired, or
     No Card, with the RFID code and expiry date when a card exists.
   - Click "Activate Membership" (no card yet) or "Renew Membership" (card exists).
   - For an activation, scan or type the RFID Card Code. A point setting may be entered
     optionally.
   - Confirm the fee and the "Valid Until" date shown in the dialog.
   - Choose Cash or Card. For cash, enter Amount Tendered; change is calculated.
   - Click "Confirm Payment". A membership receipt prints.
3. **note (warning)** — Membership fees are not sales. They carry no invoice number and do not
   appear in any sales report; view them under Reports → Membership. The cash collected *is*
   still part of expected cash at end of shift.
4. **figure** — `pos-membership-payment`

### 2. Chapter 2 (Cashier / POS) — two short additions

- **"Ending your shift"** — add a para: when membership fees were collected in cash during the
  shift, the End Shift dialog shows a separate "Membership Fees (cash)" line, and that amount is
  included in the expected cash total the drawer is counted against.
- **"X-Reading and Z-Reading"** — add a para: the printed reading slip includes a
  "Membership (cash)" line with the activation and renewal counts for the shift. State plainly
  that this line appears on the printed slip rather than the on-screen report.

### 3. Chapter 9 (Settings & Users) — extend "POS setup"

The existing section already lists the tabs. Add:

- **steps** — Go to Settings → POS Setup → General tab. Set Membership Fee (₱) — the amount
  charged to activate or renew a card. Set Membership Duration (months) — a paid membership runs
  from the payment date to that many months later; default 12. Click "Save Settings".
- **note (tip)** — Leaving the fee at ₱0 prevents cashiers from collecting it; the payment
  dialog blocks confirmation and points back to this tab.
- **figure** — `settings-membership`

### 4. Chapter 8 (Reports) — fix the index row and add a figure

- Correct the index row description to describe what the report holds: membership activations
  and renewals with amount, payment method, cashier, and validity. Drop the false "loyalty
  program activity" clause.
- Add a **figure** block for `reports-membership` so the row has a corresponding screen. The
  chapter's "Two commonly used reports" section stays as-is — membership does not displace
  either of them.

### 5. `screens.ts` — three new entries

| slug | route | auth | setup |
|---|---|---|---|
| `settings-membership` | `/settings/pos-setup` | admin | `posSetupGeneralTab` (new) |
| `reports-membership` | `/reports/membership` | admin | — |
| `pos-membership-payment` | `/pos` | pos | `posMembershipDialog` (new) |

`settings-membership` shares a route with the existing `settings-pos-setup` screen. That is
fine — slugs are unique, routes need not be — but the General tab is not the default tab
(`page.tsx:20` opens on `business`), so this screen needs a setup sequence to click into
General, or it will shoot the wrong tab. Treat it the same way as the POS screens: a named
sequence in the non-POS `SETUPS` map, which runs against the already-navigated route.

### 6. `capture.ts` — new sequences

- **`posMembershipDialog`** (in `POS_SETUPS`) — build on `posShiftStarted`, click "Customer",
  select `SO Test Customer` (`SO_CUSTOMER` in `tests/e2e/fixtures/test-data.ts`, seeded by
  `prepare-test-db.ts:304`), then click "Activate Membership" and wait for the "Membership
  Payment" dialog heading.

  That fixture has no `customer_loyalty` row, so the dialog opens in its **activation** state
  with the RFID Card Code field visible — the more informative of the two variants, and the one
  the Chapter 6 steps describe in most detail. Its name is an obvious placeholder, satisfying
  the manual's standing rule against real customer data in figures (`capture.ts:157`, `:233`).

  The screen's route is `/pos`, so `captureScreen` runs it through the `POS_SETUPS` branch with
  no post-sequence navigation (`capture.ts:190`) — the dialog stays open for the shot.

- **`posSetupGeneralTab`** (in `SETUPS`) — click the General tab and wait for the Membership
  card heading. This runs against the already-navigated `/settings/pos-setup` route
  (`capture.ts:206-211`), which is why it belongs in `SETUPS` rather than `POS_SETUPS`. Needed
  because the page opens on the Business tab by default (`pos-setup/page.tsx:20`); without it
  the shot would show the wrong tab.

Both follow the existing convention: compose from an earlier sequence where one applies, and
wait on a user-visible selector rather than a timeout.

## Screenshots: prose first, capture later

Write `content.ts`, `screens.ts`, and `capture.ts` now, offline, with no database. The build
renders a shaded `[SCREENSHOT MISSING: slug]` placeholder for each uncaptured figure and does
not abort — documented behavior in `docs/manual/README.md`.

Capture the three PNGs in a later pass, once MySQL, a seeded `verdix_test`, and a dev server on
port 3100 are available:

```
npm run test:e2e:db
npx next dev -p 3100          # separate terminal, test DB env
npm run manual:capture -- settings-membership pos-membership-payment reports-membership
npm run manual:build
```

Targeted capture by slug avoids the ~25-minute full run.

## Verification

- `npm run test:unit` — `tests/unit/manual-*.test.ts` check the slug/screen relationship in both
  directions: every figure slug must exist in `SCREENS`, and every `SCREENS` entry must be
  referenced by at least one figure block. Adding a screen without a figure, or a figure without
  a screen, fails the suite.
- `npm run typecheck` — `content.ts` and `screens.ts` are typed; a malformed block fails here.
- `npm run manual:build` — must complete and write the DOCX, with placeholders logged for the
  three uncaptured figures and no other missing images.
- Every quoted UI label in the new prose must match the component it describes. The file header
  of `content.ts` states this as a standing rule for the manual; labels used here were read from
  `MembershipCard.tsx`, `MembershipPaymentDialog.tsx`, `CustomerAccountDialog.tsx`,
  `EndShiftDialog.tsx`, and `reports/membership/page.tsx`.

## Out of scope

- Fixing the POS X-reading view's missing `membershipCash` field.
- Capturing the PNGs (deferred to a later pass, by explicit decision).
- Any change to the membership feature itself.
- Restructuring or renumbering existing chapters.
