# Membership Fees in the User Manual — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Document the membership fee feature in the Verdix POS user manual — setup, cashier collection, shift cash handling, and the report — across four content edits, three new screens, and two new capture sequences.

**Architecture:** The manual is generated from structured data, not hand-written prose. `scripts/manual/content.ts` holds every chapter as typed `Block` objects; `scripts/manual/screens.ts` registers each screenshot; `scripts/manual/capture.ts` drives Playwright to shoot them. Unit tests enforce that every figure slug resolves to a registered screen and vice versa, so content and screens must change together or the suite fails. Screenshots are deferred: the build renders a shaded placeholder for uncaptured figures rather than aborting.

**Tech Stack:** TypeScript (no framework — plain typed data modules), Node's built-in `assert` for unit tests, Playwright for capture, `docx` for the Word build.

## Global Constraints

- **Every quoted UI label must match the component verbatim.** This is a standing rule stated in the `content.ts` file header. Exact labels needed by this plan are given inline in each task; do not paraphrase them.
- **No real customer or store data in figures.** `capture.ts:157` and `:233` state this. Use seeded fixtures only.
- **Do not fix the POS X-reading `membershipCash` gap.** It is a known code inconsistency, explicitly out of scope (see spec § "Known code inconsistency"). Prose must describe only what is true today.
- **Membership is not a sale and not loyalty.** Both distinctions must survive into the final prose; they are the reason this documentation exists.
- **Slug/figure symmetry is enforced.** Adding a `SCREENS` entry without a referencing figure block, or a figure block without a `SCREENS` entry, fails `npm run test:unit`. Task 1 and Task 2 must land in the same commit for this reason.

---

### Task 1: Chapter 6 membership section + its screen registration

The core of the work: a new "Membership fees" section carrying the full activate/renew flow, plus the two `SCREENS` entries the section's figures depend on. Content and screens ship together because the unit tests check both directions of the slug relationship.

**Files:**
- Modify: `scripts/manual/content.ts` (insert after the "Loyalty points" section, which ends at line 659)
- Modify: `scripts/manual/screens.ts` (add to the Ch.6 group near line 66, and the Ch.8 group near line 75)
- Test: `tests/unit/manual-content.test.ts` (existing — runs unchanged, must keep passing)

**Interfaces:**
- Consumes: the `Block` union and `Section` type from `content.ts:14-21`; the `Screen` type from `screens.ts:4-24`.
- Produces: figure slugs `pos-membership-payment` and `reports-membership`, consumed by Task 3's capture sequences and Task 2's Chapter 8 figure block.

- [ ] **Step 1: Run the unit tests to confirm a clean baseline**

Run: `npm run test:unit`
Expected: PASS. If it already fails, stop and report — this plan assumes a green start.

- [ ] **Step 2: Register the two new screens**

In `scripts/manual/screens.ts`, add to the Ch.6 Customers group (immediately after the `customer-loyalty` entry, line 66):

```typescript
  { slug: 'pos-membership-payment', route: '/pos', title: 'Membership payment', auth: 'pos', setup: 'posMembershipDialog' },
```

Note this sits in the Ch.6 group but uses `auth: 'pos'` and a `POS_SETUPS` sequence — the POS-driven screens at the bottom of the file are grouped by chapter of *use*, and this one is referenced from Chapter 6. Add a trailing comment so the placement does not look accidental:

```typescript
  // Referenced from Ch.6 (Customers) but captured through the POS, since the
  // membership dialog opens from the POS Customer panel rather than a back-
  // office page.
```

Then add to the Ch.8 Reports group (after `reports-low-stock`, line 75):

```typescript
  { slug: 'reports-membership', route: '/reports/membership', title: 'Membership report', auth: 'admin' },
```

- [ ] **Step 3: Run the unit tests to verify they now fail**

Run: `npm run test:unit`
Expected: FAIL with `screens have no figure block referencing them: pos-membership-payment, reports-membership` — the reverse-direction assertion at `manual-content.test.ts:25`. This confirms the test actually guards the relationship.

- [ ] **Step 4: Add the Chapter 6 "Membership fees" section**

In `scripts/manual/content.ts`, insert this section immediately after the "Loyalty points" section's closing `},` (line 659), before the `],` that closes Chapter 6's `sections` array:

```typescript
      {
        heading: 'Membership fees',
        blocks: [
          {
            kind: 'para',
            text: 'A membership fee is what the customer pays to activate a new loyalty card, or to renew one that has run out. It is separate from the points described in the previous section: points are earned and redeemed on purchases, while the membership fee is what keeps the card itself valid for a set number of months. The fee amount and how long a membership lasts are both configured in Settings — see Chapter 9, POS setup.',
          },
          {
            kind: 'para',
            text: 'Cashiers collect membership fees at the counter, through the customer panel rather than the cart. A membership payment is never rung up as a cart item.',
          },
          {
            kind: 'steps',
            items: [
              'At the POS, click "Customer" along the bottom row of buttons.',
              'Select the customer. The Membership panel on the right shows their current status — "Active", "Expired", or "No Card" — along with the RFID code and expiry date when a card already exists.',
              'Click "Activate Membership" if the customer has no card yet, or "Renew Membership" if they already have one.',
              'For a new activation, scan or type the card number into "RFID Card Code". This is required — the payment cannot be confirmed without it. "Point Setting" is optional and can be left blank.',
              'Check the fee and the "Valid Until" date shown in the dialog. The validity is counted from today, not from the old expiry date.',
              'Choose "Cash" or "Card". For cash, enter the "Amount Tendered" and the change is worked out for you.',
              'Click "Confirm Payment". A membership receipt prints automatically.',
            ],
          },
          { kind: 'figure', slug: 'pos-membership-payment' },
          {
            kind: 'note',
            variant: 'warning',
            text: 'A membership fee is not a sale. It is not rung up through the cart, it has no sales invoice (SI) number, and it will not appear in any of the sales reports. To see membership money collected, use Reports → Membership. The cash from membership fees is still real cash in your drawer, so it is counted as part of your expected cash when you end your shift.',
          },
          {
            kind: 'note',
            variant: 'tip',
            text: 'If the dialog shows the fee as ₱0.00 and will not let you confirm, the membership fee has not been set up yet. An admin needs to set it in Settings → POS Setup → General before any membership can be sold.',
          },
        ],
      },
```

- [ ] **Step 5: Add the Chapter 8 report figure**

The `reports-membership` screen still has no figure block. In the Chapter 8 "Full report index" section, add a figure block after the `table` block's closing `},` (line 799), so the index table is followed by the membership screenshot:

```typescript
          { kind: 'figure', slug: 'reports-membership' },
```

- [ ] **Step 6: Run the unit tests to verify they pass**

Run: `npm run test:unit`
Expected: PASS. Both directions of the slug check are now satisfied.

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: PASS, no errors in `scripts/manual/`.

- [ ] **Step 8: Commit**

```bash
git add scripts/manual/content.ts scripts/manual/screens.ts
git commit -m "$(cat <<'EOF'
docs(manual): document membership fees in the customers chapter

Adds the full activate/renew flow to Chapter 6, next to loyalty points so
the two cannot be confused: points ride on purchases, the fee keeps the
card itself valid.

Two warnings carry the parts that surprise people. A membership fee is not
a sale -- no SI number, absent from every sales report -- but the cash is
still real cash in the drawer at end of shift. And a fee left at zero
silently blocks collection until an admin sets it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Chapters 2, 8 and 9 — cash handling, report index fix, and setup

The supporting edits. Chapter 2 tells the cashier where the money shows up, Chapter 9 tells the admin how to configure it, and the Chapter 8 index row gets corrected. No new screens except `settings-membership`, whose capture sequence arrives in Task 3.

**Files:**
- Modify: `scripts/manual/content.ts` (Ch.2 "Ending your shift" ~line 236; Ch.2 "X-Reading and Z-Reading" ~line 259; Ch.8 index row line 796; Ch.9 "POS setup" ~line 843)
- Modify: `scripts/manual/screens.ts` (Ch.9 group, near line 79)
- Test: `tests/unit/manual-content.test.ts` (existing — runs unchanged)

**Interfaces:**
- Consumes: figure slug `settings-membership`, registered here and consumed by Task 3's `posSetupGeneralTab` sequence.
- Produces: nothing later tasks depend on beyond that slug.

- [ ] **Step 1: Add the End Shift paragraph**

In the Chapter 2 "Ending your shift" section, insert this `para` block after the existing `steps` block (which closes at line 235) and before the `note`:

```typescript
          {
            kind: 'para',
            text: 'If you collected any membership fees in cash during your shift, they appear on their own line, "Membership Fees (cash)", above the "Expected Transfer" total. That money is part of what the drawer should hold, so it is already included in the expected amount you count against.',
          },
```

- [ ] **Step 2: Add the reading paragraph**

In the Chapter 2 "X-Reading and Z-Reading" section, insert this `para` block after the two figure blocks (`pos-z-reading` closes at line 259) and before the closing `note`:

```typescript
          {
            kind: 'para',
            text: 'When membership fees were collected in cash during the shift, the printed reading slip carries a "Membership (cash)" line with the number of activations and renewals beneath it. Note that this line is on the printed slip — the on-screen report does not show it, so print the reading if you need membership figures for your records.',
          },
```

This wording is deliberate. Do not change it to say the on-screen report shows membership — it does not. See the spec's "Known code inconsistency" section.

- [ ] **Step 3: Correct the Chapter 8 report index row**

Replace line 796 exactly:

```typescript
              ['Membership', '/reports/membership', 'Membership fee collections and loyalty program activity.'],
```

with:

```typescript
              ['Membership', '/reports/membership', 'Membership activations and renewals, with amount, payment method, cashier, and how long each membership runs.'],
```

The old text was wrong — the report contains no loyalty points data.

- [ ] **Step 4: Register the settings screen**

In `scripts/manual/screens.ts`, add to the Ch.9 group immediately after the `settings-pos-setup` entry (line 79):

```typescript
  { slug: 'settings-membership', route: '/settings/pos-setup', title: 'Membership fee setup', auth: 'admin', setup: 'posSetupGeneralTab' },
```

The shared route with `settings-pos-setup` is intentional and allowed — slugs are the unique key, not routes. The setup sequence exists because this page opens on the Business tab by default.

- [ ] **Step 5: Run the unit tests to verify they fail**

Run: `npm run test:unit`
Expected: FAIL with `screens have no figure block referencing them: settings-membership`.

- [ ] **Step 6: Extend the Chapter 9 POS setup section**

In the Chapter 9 "POS setup" section, replace the single figure block at line 843:

```typescript
          { kind: 'figure', slug: 'settings-pos-setup' },
```

with that figure followed by the membership subsection:

```typescript
          { kind: 'figure', slug: 'settings-pos-setup' },
          {
            kind: 'para',
            text: 'The General tab also holds the Membership settings, which control what customers pay for a loyalty card and how long that card stays valid. Cashiers cannot collect a membership fee until these are set.',
          },
          {
            kind: 'steps',
            items: [
              'Go to Settings → POS Setup and open the "General" tab.',
              'Set "Membership Fee (₱)" — the amount charged to activate or renew a customer\'s loyalty card.',
              'Set "Membership Duration (months)" — how long a paid membership lasts, counted from the day it is paid. The default is 12 months.',
              'Click "Save Settings" at the top of the page.',
            ],
          },
          { kind: 'figure', slug: 'settings-membership' },
          {
            kind: 'note',
            variant: 'tip',
            text: 'Leaving the membership fee at ₱0.00 stops cashiers from selling memberships altogether — the payment dialog at the POS refuses to confirm and points back to this tab. Set a real amount before the store starts offering memberships.',
          },
```

- [ ] **Step 7: Run the unit tests to verify they pass**

Run: `npm run test:unit`
Expected: PASS.

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add scripts/manual/content.ts scripts/manual/screens.ts
git commit -m "$(cat <<'EOF'
docs(manual): cover membership setup, shift cash, and fix the report index

Chapter 9 gains the two General-tab settings, including the trap where a
fee left at zero silently blocks every cashier. Chapter 2 explains where
the money surfaces: its own line in End Shift, and a line on the printed
reading slip.

The reading paragraph deliberately says "printed slip" -- the on-screen POS
X-reading has no membershipCash field, so claiming otherwise would send
readers looking for a line that is not there.

Also corrects the Chapter 8 index row, which credited the membership report
with "loyalty program activity" it has never contained.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Capture sequences for the three new screens

Playwright sequences so the screenshots can be shot later. Both are written now, while the reasoning is fresh, even though capture is deferred — a sequence referencing a stale selector is far cheaper to fix now than months from now.

**Files:**
- Modify: `scripts/manual/capture.ts` (`POS_SETUPS` map ends line 91; `SETUPS` map lines 99-104)
- Test: `tests/unit/manual-screens.test.ts` (existing — verify it still passes)

**Interfaces:**
- Consumes: `POS_SETUPS.posShiftStarted` (`capture.ts:42`); the `SO_CUSTOMER` fixture `{ id: 'cust-so-test', name: 'SO Test Customer' }` from `tests/e2e/fixtures/test-data.ts:345`, seeded by `prepare-test-db.ts:304`.
- Produces: `posMembershipDialog` and `posSetupGeneralTab`, referenced by the `setup` fields added in Tasks 1 and 2.

- [ ] **Step 1: Add the POS membership sequence**

In `scripts/manual/capture.ts`, add to the `POS_SETUPS` map, after `posWithCompletedSale` (which closes at line 90) and before the map's closing `};`:

```typescript
  /**
   * Open the membership payment dialog from the POS customer panel.
   *
   * Uses SO_CUSTOMER, which is seeded with no customer_loyalty row, so the
   * dialog opens in its activation state with the RFID Card Code field
   * visible — the variant the Ch.6 steps describe in most detail. A customer
   * that already had a card would render the shorter renewal panel instead.
   */
  async posMembershipDialog(page) {
    await POS_SETUPS.posShiftStarted(page);

    await page.getByRole('button', { name: /^customer$/i }).click();

    // The dialog's customer picker is a Radix Select (role=combobox), anchored
    // by its "Select Customer" placeholder — there is also an RFID text input
    // above it, so an unqualified role lookup would be ambiguous.
    await page.getByRole('combobox').filter({ hasText: /select customer/i }).click();
    await page.getByRole('option', { name: 'SO Test Customer' }).click();

    await page.getByRole('button', { name: /activate membership/i }).click();
    await page.getByRole('heading', { name: /membership payment/i }).waitFor({ timeout: 10_000 });
  },
```

- [ ] **Step 2: Add the settings tab sequence**

Add to the `SETUPS` map (lines 99-104), after `activateOfflineTab`:

```typescript
  async posSetupGeneralTab(page) {
    await page.getByRole('tab', { name: /^general$/i }).click();
    // Anchor on the input id rather than the "Membership Fee (₱)" label text:
    // the peso sign is a non-ASCII literal in a matcher, and the id is stable.
    await page.locator('#membershipFee').waitFor({ state: 'visible', timeout: 10_000 });
  },
```

This belongs in `SETUPS`, not `POS_SETUPS`, because it runs against the already-navigated route rather than assuming `/pos` (see the comment at `capture.ts:93-98` and the branch at `:205-211`).

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Run the unit tests**

Run: `npm run test:unit`
Expected: PASS — all four `manual-*` test files.

- [ ] **Step 5: Commit**

```bash
git add scripts/manual/capture.ts
git commit -m "$(cat <<'EOF'
docs(manual): add capture sequences for the membership screens

posMembershipDialog picks SO Test Customer specifically: it has no loyalty
row seeded, so the dialog opens in its activation state with the RFID field
showing, which is the variant the manual walks through step by step.

posSetupGeneralTab exists because POS Setup opens on the Business tab --
without it the membership shot would silently capture the wrong tab.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Build the manual and verify the placeholders

Confirms the document assembles, that exactly the three expected figures are missing, and that nothing else regressed.

**Files:**
- Modify: `docs/manual/VerdixPOS-User-Manual.docx` (build output — regenerated, committed)

**Interfaces:**
- Consumes: everything from Tasks 1-3.
- Produces: the rebuilt DOCX.

- [ ] **Step 1: Build the manual**

Run: `npm run manual:build`
Expected: completes without error and writes `docs/manual/VerdixPOS-User-Manual.docx`.

- [ ] **Step 2: Check the missing-image report**

The build logs which images it could not find. Confirm the list is **exactly** these three:

```
settings-membership
pos-membership-payment
reports-membership
```

If any *other* slug is reported missing, a previously-captured PNG has gone astray — stop and investigate before committing. If *fewer* than three are reported, a figure block was not wired up; re-check Tasks 1 and 2.

- [ ] **Step 3: Full verification sweep**

Run: `npm run test:unit`
Expected: PASS.

Run: `npm run typecheck`
Expected: PASS.

Run: `npm run lint`
Expected: PASS, or no new findings under `scripts/manual/`.

- [ ] **Step 4: Commit**

```bash
git add docs/manual/VerdixPOS-User-Manual.docx
git commit -m "$(cat <<'EOF'
docs(manual): rebuild with the membership sections

Three figures render as placeholders until a capture pass runs against a
seeded test DB on port 3100. The prose stands on its own in the meantime.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Deferred: capturing the screenshots

Not part of this plan — it needs MySQL, a seeded `verdix_test`, and a dev server on port 3100. When that environment is available:

```bash
npm run test:e2e:db

# separate terminal:
DB_NAME='verdix_test' NEXT_PUBLIC_API_BASE_URL='http://localhost:3100/api' NEXT_DIST_DIR='.next-test' npx next dev -p 3100

# back in the repo:
npm run manual:capture -- settings-membership pos-membership-payment reports-membership
npm run manual:build
```

Targeted capture by slug avoids the ~25-minute full run. Expect the sequences in Task 3 to need selector adjustments on first real run — they were written against the components but never executed.

## Follow-up worth filing separately

The POS X-reading view cannot show membership cash: `app/(app)/pos/x-reading/x-reading-types.ts` has no `membershipCash` field, though the printed slip (`lib/x-reading-generator.ts:195-198`) and the back-office preview (`app/(app)/sales/x-reading/x-reading-preview.tsx:241`) both do. Out of scope here; the manual documents the current behavior truthfully.
