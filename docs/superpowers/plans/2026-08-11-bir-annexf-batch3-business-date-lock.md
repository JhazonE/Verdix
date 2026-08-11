# BIR Annex F Batch 3, Item 1: Business-Date Lock After Z-Reading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a Z-reading is generated for a terminal, block that terminal's checkout until a new shift starts on it (BIR Annex F checklist item #29: subsequent sales must reflect the next business day, not the same date as the closed Z-reading). Decouple Z-reading from End Shift's automatic firing (which today runs once per shift, incompatible with once-per-business-day semantics), add a standalone on-demand X-Reading button, and gate the Z-Reading button behind an explicit warning.

**Architecture:** A new nullable `business_date_locked_at` timestamp column on `pos_terminals` is the single source of truth for lock state. Z-reading generation sets it; shift-start clears it; checkout reads it as an early, pre-transaction validation. All UI changes follow existing component patterns already in this codebase (`ShutdownConfirmationDialog` for the warning dialog, `PosFooterActions`'s existing action-tile array for the new X-Reading button).

**Tech Stack:** TypeScript, MySQL via `mysql2/promise` (raw SQL, no ORM), Next.js API routes, React, plain Node `assert`-based unit tests run via `tsx tests/unit/run.ts`.

## Global Constraints

- Locking is per-terminal only — never store-wide. Terminal A's Z-reading must never affect Terminal B's ability to sell.
- No hard cap on "one Z-reading per calendar day" — a terminal that is unlocked (new shift started) and Z-read again later the same calendar day is not a violation. The only rule enforced is: no sale on a terminal between its most recent Z-reading and its next shift-start.
- X-reading's existing behavior (per-shift, no reset, still auto-fires at shift-end) is unchanged by this plan.
- Overall Reading's behavior is unchanged by this plan.
- No new "Start New Business Day" button — unlocking is implicit, triggered only by starting a new shift on the locked terminal.
- Any new validation/business-logic function must be extracted into an importable, directly-testable unit (mirroring `app/api/pos/checkout/mixed-cart-validation.ts`'s `validateSingleDocumentType` pattern) — never hand-copied/mirrored into a test as a local reimplementation. A prior batch shipped a test (`tests/unit/checkout-si-or-routing.test.ts`) that reimplemented route logic locally instead of importing it, and it did not catch a real bug in the actual route code. Do not repeat that mistake here.
- The `z-reading/route.ts` POST handler has no existing transactional wrapper (it uses the plain `query()` pool helper throughout, not `withTransaction`) — the new `pos_terminals` lock-set UPDATE added there is a separate, non-transactional `query()` call immediately after the `z_readings` INSERT, matching the file's existing style. Do not introduce `withTransaction` into this route as part of this plan — that would be a larger, riskier change than this feature requires.
- The `shifts/route.ts` POST handler DOES already use `withTransaction` — the new lock-clear UPDATE there MUST run on the same `connection` as the shift INSERT, inside the existing transaction callback.

---

## File Structure

- Create: `scripts/migrations/110_add_business_date_lock.ts` — new `pos_terminals.business_date_locked_at` column.
- Create: `app/api/pos/checkout/terminal-lock-check.ts` — small, pure/importable function (or thin query wrapper) that checkout calls to determine if a terminal is locked. Mirrors `mixed-cart-validation.ts`'s file structure.
- Modify: `app/api/pos/checkout/route.ts` — new early validation using the above.
- Modify: `app/api/sales/z-reading/route.ts` — set the lock after a successful Z-reading INSERT.
- Modify: `app/api/pos/shifts/route.ts` — clear the lock on shift start.
- Modify: `app/(app)/pos/tender/use-tender.ts` — special-case the new blocked-checkout error for a distinct toast title.
- Modify: `app/(app)/pos/pos-content/use-pos.ts` — remove auto Z-reading POST from `handleConfirmEndShift`; remove `pendingZReading` auto-open chain; add new state/handler for on-demand X-Reading and the Z-Reading warning gate.
- Modify: `app/(app)/pos/pos-content/PosFooterActions.tsx` — add X-READING button; change Z-READING button's action to open the warning dialog first.
- Modify: `app/(app)/pos/pos-content/PosDialogs.tsx` — wire the new X-Reading on-demand dialog instance and the new Z-Reading warning dialog.
- Create: `app/(app)/pos/z-reading-warning/ZReadingWarningDialog.tsx` and `app/(app)/pos/z-reading-warning/z-reading-warning-types.ts` — new warning dialog, modeled on `shutdown-confirmation/`.
- Test: `tests/unit/terminal-lock-check.test.ts` (new) — direct-import test of the lock-check logic.
- Test: `tests/unit/checkout-terminal-lock.test.ts` (new) — integration-style test exercising the real route's validation ordering, avoiding the `checkout-si-or-routing.test.ts` mirroring mistake.
- Modify: `tests/unit/run.ts` — register new test files.

---

### Task 1: `business_date_locked_at` column

**Files:**
- Create: `scripts/migrations/110_add_business_date_lock.ts`

**Interfaces:**
- Produces: `pos_terminals.business_date_locked_at TIMESTAMP NULL DEFAULT NULL` — a new column. `NULL` = unlocked (terminal open for sales). Non-null = locked as of that timestamp.

- [ ] **Step 1: Write the migration**

First check the highest existing migration number to confirm `110` is still correct at implementation time:

Run: `ls scripts/migrations/ | grep -E '^[0-9]' | sort -V | tail -3`

Then create `scripts/migrations/110_add_business_date_lock.ts`, modeled on `scripts/migrations/061_add_bir_compliance_columns.ts`'s idempotent per-column try/catch pattern:

```typescript
import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

/**
 * Add per-terminal business-date locking.
 *
 * BIR Annex F checklist item #29: once a Z-Reading/EOD report is generated,
 * subsequent sales must reflect the next business day, not the same date.
 * business_date_locked_at is set the moment a Z-reading is generated for a
 * terminal, and cleared the moment a new shift starts on that terminal —
 * checkout rejects any sale while it is non-null.
 *
 * Locking is per-terminal, not store-wide: this column lives on
 * pos_terminals, matching the existing per-terminal scope of z_counter,
 * reset_counter, and the Z-reading generation flow itself.
 */
export const migration: Migration = {
  name: '110_add_business_date_lock',
  timestamp: '2026-08-11_16-00-00',

  async up() {
    console.log('Running migration: 110_add_business_date_lock');
    try {
      await query(`ALTER TABLE pos_terminals ADD COLUMN business_date_locked_at TIMESTAMP NULL DEFAULT NULL`);
      console.log('✅ Added business_date_locked_at to pos_terminals');
    } catch (e: any) {
      if (e.code === 'ER_DUP_COLUMN_NAME' || e.errno === 1060) {
        console.log('⚠️ Column business_date_locked_at already exists in pos_terminals');
      } else {
        throw e;
      }
    }
  },

  async down() {
    console.log('Rolling back migration: 110_add_business_date_lock');
    await query(`ALTER TABLE pos_terminals DROP COLUMN business_date_locked_at`);
  }
};

registerMigration(migration);
```

Register it in `scripts/migrations/index.ts` alongside the other numbered migrations (check the exact current import/registration pattern in that file before editing — follow whatever convention `109_add_bir_or_number.ts` uses there).

- [ ] **Step 2: Run the migration**

Run: `npm run migrate`
Expected: `✅ Added business_date_locked_at to pos_terminals`.

Verify idempotency: run `npm run migrate` again — expected `⚠️ Column business_date_locked_at already exists in pos_terminals`.

- [ ] **Step 3: Commit**

```bash
git add scripts/migrations/110_add_business_date_lock.ts scripts/migrations/index.ts
git commit -m "feat(pos): add per-terminal business-date lock column

BIR Annex F checklist item #29 requires that subsequent sales after a
Z-Reading reflect the next business day, not the same date. This
column is the lock's source of truth: set on Z-reading generation,
cleared on shift start, checked at checkout.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Terminal-lock check function + checkout validation

**Files:**
- Create: `app/api/pos/checkout/terminal-lock-check.ts`
- Modify: `app/api/pos/checkout/route.ts:80-82` (insert new validation between the charge-customer check and the mixed-cart-type check)
- Test: `tests/unit/terminal-lock-check.test.ts` (new)
- Test: `tests/unit/checkout-terminal-lock.test.ts` (new)
- Modify: `tests/unit/run.ts`

**Interfaces:**
- Consumes: `business_date_locked_at` column from Task 1.
- Produces: `isTerminalLocked(lockedAt: unknown): boolean` — exported from `app/api/pos/checkout/terminal-lock-check.ts`, a pure function taking whatever the DB returns for `business_date_locked_at` (a `Date`, `null`, or similar) and returning `true` if the terminal should be blocked. Later steps in this task consume this directly.

- [ ] **Step 1: Write the failing test for the pure check function**

Create `tests/unit/terminal-lock-check.test.ts`:

```typescript
import assert from 'node:assert/strict';
import { isTerminalLocked } from '../../app/api/pos/checkout/terminal-lock-check';

// A terminal is locked whenever business_date_locked_at is non-null —
// regardless of exact type (Date object, ISO string, etc. depending on
// how mysql2 deserializes a TIMESTAMP column) — and unlocked when it's
// null/undefined.

assert.equal(isTerminalLocked(null), false, 'null (unlocked) is not locked');
assert.equal(isTerminalLocked(undefined), false, 'undefined (no row / no data) is not locked');
assert.equal(isTerminalLocked(new Date('2026-08-11T10:00:00Z')), true, 'a Date value is locked');
assert.equal(isTerminalLocked('2026-08-11 10:00:00'), true, 'a string timestamp value is locked');

console.log('✓ terminal-lock-check');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/unit/terminal-lock-check.test.ts`
Expected: FAIL — module `app/api/pos/checkout/terminal-lock-check` doesn't exist yet.

- [ ] **Step 3: Write the check function**

Create `app/api/pos/checkout/terminal-lock-check.ts`:

```typescript
/**
 * True if a terminal's business_date_locked_at value means checkout must
 * be rejected. Locked = a Z-reading was generated for this terminal and no
 * new shift has started on it since (BIR Annex F checklist item #29: the
 * next sale after a Z-reading must fall on the next business day, not the
 * same one).
 */
export function isTerminalLocked(lockedAt: unknown): boolean {
  return lockedAt !== null && lockedAt !== undefined;
}

export const TERMINAL_LOCKED_MESSAGE =
  "This terminal's business day is closed (Z-Reading already generated). Start a new shift to begin the next business day.";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/unit/terminal-lock-check.test.ts`
Expected: PASS, prints `✓ terminal-lock-check`.

- [ ] **Step 5: Wire the check into checkout**

In `app/api/pos/checkout/route.ts`, add the import alongside the existing `mixed-cart-validation` import (currently line 9):

```typescript
import { isTerminalLocked, TERMINAL_LOCKED_MESSAGE } from './terminal-lock-check';
```

Insert a new validation block immediately after the charge-customer check (currently lines 78-80) and before the mixed-cart-type-determination comment block (currently starting at line 82):

```typescript
    if (paymentMethod?.toUpperCase() === 'CHARGE' && (!customer || customer.id === 'walk-in')) {
      return NextResponse.json({ success: false, error: 'Customer is required for Charge to Account' }, { status: 400 });
    }

    if (terminalId) {
      const [terminalRows]: any = await query(
        'SELECT business_date_locked_at FROM pos_terminals WHERE id = ?',
        [terminalId]
      );
      if (isTerminalLocked(terminalRows?.[0]?.business_date_locked_at)) {
        return NextResponse.json({ success: false, error: TERMINAL_LOCKED_MESSAGE }, { status: 400 });
      }
    }

    // Determine this cart's single BIR document type (goods vs services) by
```

(The last line above is the existing comment that currently starts at line 82 — this shows the new block's exact insertion point relative to unchanged surrounding code. `query` is already imported in this file at line 6.)

This check runs before the mixed-cart-type check and before any counter/transaction work, matching the constraint that a rejected checkout must never burn an SI/OR number.

- [ ] **Step 6: Write the integration-style test that exercises real route logic**

This is the test that must NOT repeat `checkout-si-or-routing.test.ts`'s mistake of mirroring logic locally. Since `route.ts`'s `POST` handler can't be easily unit-invoked outside a running Next.js server (it needs a real `NextRequest`), write a test that imports and directly exercises `isTerminalLocked` (the real, shared function checkout actually calls) against representative DB-shaped values, AND add a code-level assertion that the route file actually imports and calls it — this keeps the test honest about exercising the real logic rather than a local copy.

Create `tests/unit/checkout-terminal-lock.test.ts`:

```typescript
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { isTerminalLocked, TERMINAL_LOCKED_MESSAGE } from '../../app/api/pos/checkout/terminal-lock-check';

// Same underlying function checkout/route.ts calls — no local reimplementation
// of the locking logic (a prior batch's checkout-si-or-routing.test.ts
// mirrored route logic locally and missed a real bug in the route itself;
// this test avoids that by (a) using the real exported function everywhere,
// and (b) asserting the route file genuinely imports and calls it, so a
// future edit that silently drops the wiring in route.ts fails this test).

assert.equal(isTerminalLocked(null), false, 'unlocked terminal passes');
assert.equal(isTerminalLocked(new Date()), true, 'locked terminal is rejected');

const routeSource = fs.readFileSync(
  path.join(__dirname, '../../app/api/pos/checkout/route.ts'),
  'utf-8'
);
assert.ok(
  routeSource.includes("from './terminal-lock-check'"),
  'checkout route.ts imports terminal-lock-check.ts',
);
assert.ok(
  routeSource.includes('isTerminalLocked('),
  'checkout route.ts actually calls isTerminalLocked(...), not just imports it',
);
assert.ok(
  routeSource.includes('business_date_locked_at'),
  'checkout route.ts queries the business_date_locked_at column',
);
assert.ok(
  routeSource.includes(TERMINAL_LOCKED_MESSAGE) || routeSource.includes('TERMINAL_LOCKED_MESSAGE'),
  'checkout route.ts surfaces the shared lock message (verbatim or via the exported constant)',
);

console.log('✓ checkout-terminal-lock');
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx tsx tests/unit/checkout-terminal-lock.test.ts`
Expected: PASS, prints `✓ checkout-terminal-lock`.

- [ ] **Step 8: Register both tests and run the full suite**

In `tests/unit/run.ts`, add:
```ts
import './terminal-lock-check.test';
import './checkout-terminal-lock.test';
```

Run: `npm run test:unit`
Expected: All tests pass, no regressions.

Run: `npm run typecheck`
Expected: No new errors in `app/api/pos/checkout/route.ts` or `app/api/pos/checkout/terminal-lock-check.ts`.

- [ ] **Step 9: Manual verification against the live dev DB**

If you have DB access in this environment: manually set `UPDATE pos_terminals SET business_date_locked_at = NOW() WHERE id = '<a real terminal id>'` (via a scratch script, not committed), attempt a checkout against that terminal via a direct API call or through the running app, confirm it's rejected with the expected message and 400 status, then clear it back (`SET business_date_locked_at = NULL`) and confirm checkout succeeds again. Document what you did and observed in your task report even if you can't do a full live check — describe what you verified by code trace instead.

- [ ] **Step 10: Commit**

```bash
git add app/api/pos/checkout/terminal-lock-check.ts app/api/pos/checkout/route.ts tests/unit/terminal-lock-check.test.ts tests/unit/checkout-terminal-lock.test.ts tests/unit/run.ts
git commit -m "feat(checkout): reject sales on a terminal locked by Z-reading

BIR Annex F checklist item #29: after a Z-reading, the next sale on
that terminal must fall on the next business day, not the same one.
Checked before any counter/transaction work so a rejected sale never
burns an SI or OR number. isTerminalLocked is a shared, directly
importable function — not mirrored logic — and this task's test
asserts the route genuinely calls it, not just that a local copy of
the same logic works.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Z-reading sets the lock

**Files:**
- Modify: `app/api/sales/z-reading/route.ts:703` (insert after the `z_readings` INSERT)

**Interfaces:**
- Consumes: `business_date_locked_at` column from Task 1.
- Produces: after this task, every successful Z-reading POST leaves the target terminal's `pos_terminals.business_date_locked_at` set to a non-null timestamp.

- [ ] **Step 1: Read the current exact code before editing**

Read `app/api/sales/z-reading/route.ts` around lines 679-709 to confirm the INSERT statement and the comment immediately after it (documented in this plan's research as ending at line 703, followed by a comment at lines 705-707 about `z_counter` — re-verify these exact line numbers before editing, since this file may have shifted since this plan was written).

- [ ] **Step 2: Add the lock-set UPDATE immediately after the INSERT**

Insert this immediately after the `await query(insertSql, [...]);` call (immediately before the `// NOTE: z_counter is already incremented...` comment):

```typescript
        await query(insertSql, [
            readingNumber, endDate, terminalId, cashierName, rawNetSales + parseFloat(salesResult?.total_discounts || 0) + parseFloat(returnsResult?.total_returns || 0) + voidAmount,
            parseFloat(returnsResult?.total_returns || 0), parseFloat(salesResult?.total_discounts || 0), finalNetSales, vatAmount,
            JSON.stringify(paymentMethods), parseInt(salesResult?.transaction_count || 0), startingCash, cashSales, cashInDrawer,
            salesResult?.min_sale_id || '000000', salesResult?.max_sale_id || '000000', voidSeqResult?.min_void_id || '000000', voidSeqResult?.max_void_id || '000000',
            returnSeqResult?.min_return_id || '000000', returnSeqResult?.max_return_id || '000000', (termResult?.z_counter || 0), termResult?.reset_counter || 0,
            previousReading, runningTotal, vatableSales, vatExemptSales, zeroRatedSales, nonVatSales,
            JSON.stringify(discountSummary), JSON.stringify(salesAdjustment), vatAdjustmentAmount, voidAmount,
            actualCash, cashVariance,
            salesResult?.min_sale_or_id || 'OR-000000', salesResult?.max_sale_or_id || 'OR-000000',
            voidSeqResult?.min_void_or_id || 'OR-000000', voidSeqResult?.max_void_or_id || 'OR-000000',
            returnSeqResult?.min_return_or_id || 'OR-000000', returnSeqResult?.max_return_or_id || 'OR-000000'
        ]);

        // BIR Annex F checklist item #29: a Z-reading closes out this
        // terminal's business day. No further sale can post here until a
        // new shift starts (see app/api/pos/shifts/route.ts POST, which
        // clears this). Not run inside a transaction with the INSERT above
        // — this route has no transactional wrapper today (see terminal-lock
        // design doc) — a plain follow-up query() call matches this file's
        // existing non-transactional style throughout.
        await query('UPDATE pos_terminals SET business_date_locked_at = NOW() WHERE id = ?', [terminalId]);

        // NOTE: z_counter is already incremented atomically by getNextZReadingNumber()
```

(The last line shown is the existing comment that follows — this establishes exact placement relative to unchanged code.)

- [ ] **Step 3: Manual/code-trace verification**

Run: `npm run typecheck`
Expected: No new errors in `app/api/sales/z-reading/route.ts`.

If you have DB access: generate a real Z-reading for a test terminal (via the API, not a script) and confirm `pos_terminals.business_date_locked_at` for that terminal is now non-null. If a full live check isn't practical, trace the code path and document your reasoning clearly in the report.

- [ ] **Step 4: Commit**

```bash
git add app/api/sales/z-reading/route.ts
git commit -m "feat(z-reading): lock the terminal's business date on generation

Sets pos_terminals.business_date_locked_at immediately after the
z_readings row is inserted, so checkout (Task 2) rejects further
sales on this terminal until a new shift clears the lock (Task 4).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Shift-start clears the lock

**Files:**
- Modify: `app/api/pos/shifts/route.ts:152-193` (POST handler)

**Interfaces:**
- Consumes: `business_date_locked_at` column from Task 1.
- Produces: after this task, every successful shift-start clears `business_date_locked_at` back to `NULL` for that terminal, on the same DB transaction as the shift row insert.

- [ ] **Step 1: Read the current exact code before editing**

Read `app/api/pos/shifts/route.ts` lines 152-193 to confirm the current structure matches this plan's research (INSERT at lines 172-177, inside `withTransaction` starting at line 168) — re-verify exact line numbers before editing.

- [ ] **Step 2: Add the lock-clear UPDATE on the same connection, inside the transaction**

Change the current handler body from:

```typescript
    const shiftId = `SHIFT-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;

    return await withTransaction(async (connection) => {
      // Check if user already has an active shift? Optional but good practice.
      // For now, let's just create.

      await connection.query(
        `INSERT INTO shifts (
            id, user_id, terminal_id, starting_cash, start_time, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, NOW(), 'active', NOW(), NOW())`,
        [shiftId, userId, terminalId || 'Counter 1', startingCash]
      );

      return NextResponse.json({
        success: true,
        data: { shiftId },
        message: 'Shift started successfully'
      });
    });
```

to:

```typescript
    const shiftId = `SHIFT-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    const resolvedTerminalId = terminalId || 'Counter 1';

    return await withTransaction(async (connection) => {
      // Check if user already has an active shift? Optional but good practice.
      // For now, let's just create.

      await connection.query(
        `INSERT INTO shifts (
            id, user_id, terminal_id, starting_cash, start_time, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, NOW(), 'active', NOW(), NOW())`,
        [shiftId, userId, resolvedTerminalId, startingCash]
      );

      // BIR Annex F checklist item #29: starting a new shift on this
      // terminal is the signal that a new business day of work has begun,
      // so clear any lock a prior Z-reading left in place (see
      // app/api/sales/z-reading/route.ts POST, which sets this).
      await connection.query(
        'UPDATE pos_terminals SET business_date_locked_at = NULL WHERE id = ?',
        [resolvedTerminalId]
      );

      return NextResponse.json({
        success: true,
        data: { shiftId },
        message: 'Shift started successfully'
      });
    });
```

(Note: this also fixes a latent inconsistency — the original code used the inline `terminalId || 'Counter 1'` expression directly in the INSERT's parameter array without storing it, which this task now captures once in `resolvedTerminalId` so the INSERT and the new UPDATE are guaranteed to target the identical terminal id.)

- [ ] **Step 3: Verify**

Run: `npm run typecheck`
Expected: No new errors in `app/api/pos/shifts/route.ts`.

Run: `npm run test:unit`
Expected: All tests pass, no regressions.

If you have DB access: start a shift on a terminal you previously locked in Task 3's manual test, confirm `business_date_locked_at` is now `NULL` and checkout succeeds again on that terminal.

- [ ] **Step 4: Commit**

```bash
git add app/api/pos/shifts/route.ts
git commit -m "feat(shifts): clear the terminal's business-date lock on shift start

Starting a new shift is the signal that a new business day has begun
— clears pos_terminals.business_date_locked_at (set by Z-reading,
Task 3) on the same transaction as the shift row insert, so a stale
partial state can never exist between the two writes.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Client-side toast for the blocked-checkout error

**Files:**
- Modify: `app/(app)/pos/tender/use-tender.ts` (the existing error-catch block around lines 279-283/360-377 — read current exact lines before editing)

**Interfaces:**
- Consumes: `TERMINAL_LOCKED_MESSAGE` constant from Task 2 (`app/api/pos/checkout/terminal-lock-check.ts`) — import it directly rather than hardcoding the string a second time, so the client-side match string can never drift from the server's actual message.

- [ ] **Step 1: Read the current exact error-handling code**

Read `app/(app)/pos/tender/use-tender.ts` in full around where checkout's non-OK response is caught and turned into a toast (previously reported near lines 279-283 for the throw, and 360-377 for the catch/toast, including the existing special case for `error.message.includes('Batch stock exhausted')` → "Stock Alert" title). Confirm current exact line numbers before editing.

- [ ] **Step 2: Add the special case**

Import the shared message constant at the top of the file:

```typescript
import { TERMINAL_LOCKED_MESSAGE } from '@/app/api/pos/checkout/terminal-lock-check';
```

In the catch block where `error.message.includes('Batch stock exhausted')` is currently checked, add a sibling check before or after it (matching the existing conditional structure exactly — read the current code first to match its exact if/else-if shape):

```typescript
if (error.message.includes(TERMINAL_LOCKED_MESSAGE)) {
  toast({ title: 'Business Day Closed', description: error.message, variant: 'destructive' });
} else if (error.message.includes('Batch stock exhausted')) {
  // ...existing Stock Alert handling, unchanged...
} else {
  // ...existing generic error toast, unchanged...
}
```

(Adjust to match the file's actual current branching structure — this shows the principle, not necessarily the exact final code shape.)

- [ ] **Step 3: Verify**

Run: `npm run typecheck`
Expected: No new errors in `use-tender.ts`.

Manual: trigger a checkout against a locked terminal (per Task 2/3's manual verification setup) through the actual POS UI and confirm the toast reads "Business Day Closed" with the server's message, not a generic error toast.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/pos/tender/use-tender.ts"
git commit -m "feat(pos): show a dedicated toast when checkout is blocked by a business-date lock

Mirrors the existing Stock Alert special-case pattern. Imports the
server's exact message constant rather than hardcoding a second copy,
so the two can never drift apart.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Remove automatic Z-reading from End Shift

**Files:**
- Modify: `app/(app)/pos/pos-content/use-pos.ts:855-918` (`handleConfirmEndShift`), `:1089-1095` (auto-open `useEffect` chain), `:20` (`pendingZReading` state — remove if no longer used anywhere else; confirm before removing)

**Interfaces:**
- Consumes: nothing new.
- Produces: `handleConfirmEndShift` no longer calls `POST /api/sales/z-reading`. The `pendingZReading` state and its auto-open `useEffect` are removed (or, if `pendingZReading` turns out to be referenced elsewhere in this file beyond what this plan's research found, leave the state declaration but confirm nothing still sets it to `true`).

- [ ] **Step 1: Read the current exact code before editing**

Read `app/(app)/pos/pos-content/use-pos.ts` around lines 855-918 (`handleConfirmEndShift`) and 1088-1095 (the useEffect chain) to confirm current exact line numbers, and grep the whole file for `pendingZReading` to confirm every reference before removing any of them.

- [ ] **Step 2: Remove the Z-reading POST block from `handleConfirmEndShift`**

Change (removing the `setPendingZReading(true)` call and the entire second `try {...} catch {}` block that POSTs to `/sales/z-reading`):

```typescript
        setShowEndShiftReport(true);
        setPendingOverallReading(true);
        setPendingZReading(true);

        try {
          const xReadingRes = await fetch(getApiUrl(`/sales/x-reading?shiftId=${currentShiftId}&limit=1`));
          if (!xReadingRes.ok) throw new Error(`HTTP ${xReadingRes.status}`);
          const xReadingResult = await xReadingRes.json();
          if (xReadingResult.success && xReadingResult.data.length > 0) {
            const xData = xReadingResult.data[0];
            const timestampSuffix = new Date().toISOString().replace(/\D/g, '').slice(-6);
            const readingNo = `X-${(xData.id || currentShiftId).substring(0, 10).toUpperCase()}-${timestampSuffix}`;
            await fetch(getApiUrl('/sales/x-reading'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ readingNumber: readingNo, reportDate: xData.reportDate, shiftStart: xData.shiftStart, shiftEnd: xData.shiftEnd, terminalId: xData.terminalId, cashierName: xData.cashierName, cashierId: xData.cashierId, grossSales: xData.grossSales, returns: xData.returns, discounts: xData.discounts, netSales: xData.netSales, vatAmount: xData.vatAmount, paymentMethods: xData.paymentMethods, transactionCount: xData.transactionCount, startingCash: xData.startingCash, cashSales: xData.cashSales, cashInDrawer: xData.cashInDrawer, shiftStatus: 'completed' }),
            });
          }
        } catch {}

        try {
          const zRes = await fetch(getApiUrl('/sales/z-reading'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ terminalId: selectedTerminalId, cashierName: currentUser?.displayName || 'Admin' }),
          });
          if (!zRes.ok) throw new Error(`HTTP ${zRes.status}`);
          const zResult = await zRes.json();
          if (zResult.success && zResult.data?.length > 0) {
            setLastSavedZReading({ ...zResult.data[0], reportDate: new Date(zResult.data[0].reportDate) });
          }
        } catch {}

        toast({ title: 'Shift Ended', description: 'Shift closed and readings generated successfully.' });
```

to:

```typescript
        setShowEndShiftReport(true);
        setPendingOverallReading(true);

        try {
          const xReadingRes = await fetch(getApiUrl(`/sales/x-reading?shiftId=${currentShiftId}&limit=1`));
          if (!xReadingRes.ok) throw new Error(`HTTP ${xReadingRes.status}`);
          const xReadingResult = await xReadingRes.json();
          if (xReadingResult.success && xReadingResult.data.length > 0) {
            const xData = xReadingResult.data[0];
            const timestampSuffix = new Date().toISOString().replace(/\D/g, '').slice(-6);
            const readingNo = `X-${(xData.id || currentShiftId).substring(0, 10).toUpperCase()}-${timestampSuffix}`;
            await fetch(getApiUrl('/sales/x-reading'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ readingNumber: readingNo, reportDate: xData.reportDate, shiftStart: xData.shiftStart, shiftEnd: xData.shiftEnd, terminalId: xData.terminalId, cashierName: xData.cashierName, cashierId: xData.cashierId, grossSales: xData.grossSales, returns: xData.returns, discounts: xData.discounts, netSales: xData.netSales, vatAmount: xData.vatAmount, paymentMethods: xData.paymentMethods, transactionCount: xData.transactionCount, startingCash: xData.startingCash, cashSales: xData.cashSales, cashInDrawer: xData.cashInDrawer, shiftStatus: 'completed' }),
            });
          }
        } catch {}

        toast({ title: 'Shift Ended', description: 'Shift closed and X-Reading saved.' });
```

- [ ] **Step 3: Remove the `pendingZReading` auto-open `useEffect`**

Change:

```typescript
  // Chain: X-Reading -> Z-Reading -> Overall Reading after shift end
  useEffect(() => {
    if (!showEndShiftReport && pendingZReading) setIsZReadingOpen(true);
  }, [showEndShiftReport, pendingZReading]);

  useEffect(() => {
    if (!isZReadingOpen && !showEndShiftReport && pendingOverallReading) setIsOverallReadingOpen(true);
  }, [isZReadingOpen, showEndShiftReport, pendingOverallReading]);
```

to:

```typescript
  // Chain: X-Reading -> Overall Reading after shift end. Z-Reading is no
  // longer part of this chain — it's a standalone, warning-gated cashier
  // action (see the Z-READING footer button), decoupled from shift-end
  // since it now closes the terminal's whole business day, not one shift.
  useEffect(() => {
    if (!showEndShiftReport && pendingOverallReading) setIsOverallReadingOpen(true);
  }, [showEndShiftReport, pendingOverallReading]);
```

- [ ] **Step 4: Remove the now-unused `pendingZReading` state**

Grep the full file for `pendingZReading` after the above edits — if no references remain (expected, since Steps 2-3 removed both the setter call and the only reader), remove its declaration (currently line 20: `const [pendingZReading, setPendingZReading] = useState(false);`) and remove it from the function's exported return object if listed there. If any other reference is found that this plan's research did not account for, stop and report it rather than removing the state — note it in your task report.

- [ ] **Step 5: Verify**

Run: `npm run typecheck`
Expected: No new errors in `use-pos.ts` (in particular, no "unused variable" issues left behind, and no "cannot find name pendingZReading" errors in any file that imported it — check `PosDialogs.tsx`, which per this plan's research reads `pos.setPendingZReading` at line 211's `onOpenChange` handler for `ZReadingDialog` — that specific line needs its own update in Task 8, not this task, but be aware it exists so you don't leave a dangling reference broken by this task alone. If Task 8 hasn't run yet when you do this task, either coordinate the two edits together or leave a clear note for Task 8's implementer about the dependency.)

Run: `npm run test:unit`
Expected: All tests pass, no regressions.

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/pos/pos-content/use-pos.ts"
git commit -m "fix(pos): stop auto-generating a Z-reading on every shift end

Z-reading previously fired (silently, errors swallowed) on every
single shift-end, incrementing z_counter once per shift rather than
once per business day. With multiple shifts per day this violated
the once-per-business-day semantics BIR Annex F checklist item #29
depends on. Z-reading becomes a standalone, explicit cashier action
(Task 7); X-reading's per-shift auto-generation is unchanged.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Standalone on-demand X-Reading button

**Files:**
- Modify: `app/(app)/pos/pos-content/use-pos.ts` (new state + handler for on-demand X-Reading)
- Modify: `app/(app)/pos/pos-content/PosFooterActions.tsx` (new X-READING button)
- Modify: `app/(app)/pos/pos-content/PosDialogs.tsx` (new `XReadingDialog` instance, or reused with new state)

**Interfaces:**
- Consumes: `XReadingDialogProps` (unchanged — `isOpen`, `onOpenChange`, `shiftId?`, `autoShow?`, `terminalName?`, `printMode`) from `app/(app)/pos/x-reading-report/x-reading-report-types.ts`. No changes to this type are needed — confirmed by prior research that `shiftId`/`terminalName`/`autoShow`/`printMode` are already sufficient to drive `useXReadingReport` for an on-demand, mid-shift read.
- Produces: a new `isXReadingOpen`/`setIsXReadingOpen` boolean state in `use-pos.ts`, exported from the hook's return object, consumed by a new footer button and a new `XReadingDialog` render in `PosDialogs.tsx`.

- [ ] **Step 1: Add new state in `use-pos.ts`**

Near the existing `isOverallReadingOpen` state declaration (per this plan's research, around line 22), add:

```typescript
  const [isXReadingOpen, setIsXReadingOpen] = useState(false);
```

- [ ] **Step 2: Add a handler**

Near `handleOpenOverallReading` (per this plan's research, around lines 1078-1081), add a sibling handler. Unlike Overall Reading, there's no existing auth-gate setting mentioned for X-reading in this plan's research — open it directly unless you find an equivalent settings flag while implementing (check `businessSettings` for anything X-reading-specific before assuming there is none):

```typescript
  const handleOpenXReading = () => {
    setIsXReadingOpen(true);
  };
```

- [ ] **Step 3: Export the new state/handler from the hook's return object**

Find where `handleOpenOverallReading` and `isOverallReadingOpen`/`setIsOverallReadingOpen` are included in `use-pos.ts`'s final returned object (per this plan's research, the return block is around lines 1195-1227) and add `isXReadingOpen`, `setIsXReadingOpen`, `handleOpenXReading` alongside them.

- [ ] **Step 4: Add the X-READING footer button**

In `PosFooterActions.tsx`, add a new prop to the `Props` type and destructured parameters:

```typescript
type Props = {
  handleOpenEndShift: () => void;
  handleOpenCashTransfer: () => void;
  setIsCustomerSelectOpen: (v: boolean) => void;
  handleOpenLoyalty: () => void;
  setIsRecentSalesOpen: (v: boolean) => void;
  setIsVoidSalesOpen: (v: boolean) => void;
  setIsReturnSalesOpen: (v: boolean) => void;
  handleOpenOverallReading: () => void;
  handleOpenXReading: () => void;
  setIsZReadingOpen: (v: boolean) => void;
  setIsPriceInquiryOpen: (v: boolean) => void;
  isFrontliner?: boolean;
};

export function PosFooterActions({
  handleOpenEndShift, handleOpenCashTransfer, setIsCustomerSelectOpen, handleOpenLoyalty,
  setIsRecentSalesOpen, setIsVoidSalesOpen, setIsReturnSalesOpen, handleOpenOverallReading,
  handleOpenXReading, setIsZReadingOpen, setIsPriceInquiryOpen, isFrontliner,
}: Props) {
```

Add a new entry to `allActions`, using an icon not already used by the other entries (`Printer`, `CashTransferIcon`, `User`, `Clock`, `Ban`, `Undo`, `Files`, `BookOpen`, `Search` are taken — e.g. `Receipt` or `FileText` from `lucide-react` would be distinct), and shortcut `Ctrl+9` (unused per the existing `Ctrl+1` through `Ctrl+8`, `Ctrl+0`, `Ctrl+P` scheme):

```typescript
  const allActions = [
    { icon: Printer, label: 'Cash count', shortcut: 'Ctrl+1', action: handleOpenEndShift, tint: 'text-emerald-600', cashierOnly: true },
    { icon: CashTransferIcon, label: 'Cash transfer', shortcut: 'Ctrl+2', action: handleOpenCashTransfer, tint: 'text-emerald-600', cashierOnly: true },
    { icon: User, label: 'Customer', shortcut: 'Ctrl+3', action: () => setIsCustomerSelectOpen(true), tint: 'text-sky-600', cashierOnly: false },
    { icon: User, label: 'Loyalty', shortcut: 'Ctrl+4', action: handleOpenLoyalty, tint: 'text-sky-600', cashierOnly: true },
    { icon: Clock, label: 'Recent Sales', shortcut: 'Ctrl+5', action: () => setIsRecentSalesOpen(true), tint: 'text-amber-600', cashierOnly: true },
    { icon: Ban, label: 'Post Void', shortcut: 'Ctrl+6', action: () => setIsVoidSalesOpen(true), tint: 'text-rose-600', cashierOnly: true },
    { icon: Undo, label: 'Merch Credit', shortcut: 'Ctrl+7', action: () => setIsReturnSalesOpen(true), tint: 'text-amber-600', cashierOnly: true },
    { icon: Files, label: 'OVERALL', shortcut: 'Ctrl+8', action: handleOpenOverallReading, tint: 'text-purple-600', cashierOnly: true },
    { icon: Receipt, label: 'X-READING', shortcut: 'Ctrl+9', action: handleOpenXReading, tint: 'text-purple-600', cashierOnly: true },
    { icon: BookOpen, label: 'Z-READING', shortcut: 'Ctrl+0', action: () => setIsZReadingOpen(true), tint: 'text-purple-600', cashierOnly: true },
    { icon: Search, label: 'Price Inquiry', shortcut: 'Ctrl+P', action: () => setIsPriceInquiryOpen(true), tint: 'text-fuchsia-600', cashierOnly: false },
  ];
```

(Task 8 changes the `Z-READING` entry's `action` further — this task only adds the new `X-READING` entry.)

Add `Receipt` to the `lucide-react` import at the top of the file (currently `import { Printer, User, Clock, Ban, Undo, Files, BookOpen, Search, Banknote, ArrowRight } from 'lucide-react';`).

Also add the grid layout accommodation — `footerActions` currently renders in `grid-cols-10` for non-frontliner users (line 53); with one more cashier-only action, confirm whether this should become `grid-cols-11` or wrap, and check `isFrontliner` filtering still excludes this new `cashierOnly: true` action correctly for frontliner users (it will, automatically, via the existing `.filter(a => !a.cashierOnly)` logic — no change needed there).

- [ ] **Step 5: Wire the new footer prop and a new `XReadingDialog` instance in `PosDialogs.tsx`**

Wherever `PosFooterActions` is rendered (find this — it's the parent component using the `Props` type from Step 4), pass the new `handleOpenXReading={pos.handleOpenXReading}` prop alongside the existing ones.

In `PosDialogs.tsx`, add a new, separate `XReadingDialog` instance for on-demand use, distinct from the existing post-shift-end instance (currently lines 227-234, driven by `pos.showEndShiftReport`) — do not repurpose that existing instance, since its `shiftId={pos.lastEndedShiftId}` is null pre-shift-end (confirmed by this plan's research):

```tsx
      <XReadingDialog
        isOpen={pos.isXReadingOpen}
        onOpenChange={pos.setIsXReadingOpen}
        shiftId={pos.currentShiftId ?? undefined}
        terminalName={pos.currentTerminalName}
        printMode={pos.businessSettings?.printMode || 'browser'}
      />
```

(`autoShow` is omitted/left `false` here — per this plan's research, `autoShow` defaults to `false` in `XReadingDialog`'s own props, appropriate for an on-demand open where the user explicitly clicked a button, versus the post-shift-end instance which needs `autoShow={true}` to fetch immediately without further user action.)

- [ ] **Step 6: Verify**

Run: `npm run typecheck`
Expected: No new errors.

Manual: click the new X-READING footer button mid-shift (not right after ending a shift) — confirm it opens and correctly shows the current shift's X-reading data, without requiring the shift to end first.

- [ ] **Step 7: Commit**

```bash
git add "app/(app)/pos/pos-content/use-pos.ts" "app/(app)/pos/pos-content/PosFooterActions.tsx" "app/(app)/pos/pos-content/PosDialogs.tsx"
git commit -m "feat(pos): add standalone on-demand X-Reading button

X-Reading previously had no POS-screen entry point of its own — it
only appeared automatically right after a shift ended. Matches the
existing accessibility of the Z-READING and OVERALL footer buttons.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Z-Reading warning dialog

**Files:**
- Create: `app/(app)/pos/z-reading-warning/z-reading-warning-types.ts`
- Create: `app/(app)/pos/z-reading-warning/ZReadingWarningDialog.tsx`
- Modify: `app/(app)/pos/pos-content/use-pos.ts` (new state + handler for the warning gate)
- Modify: `app/(app)/pos/pos-content/PosFooterActions.tsx:44` (Z-READING button's `action` now opens the warning first)
- Modify: `app/(app)/pos/pos-content/PosDialogs.tsx:209-217` (fix the dangling `setPendingZReading` reference from Task 6, and add the new warning dialog instance)

**Interfaces:**
- Produces: `ZReadingWarningDialogProps = { open: boolean; onOpenChange: (open: boolean) => void; onConfirm: () => void; }` — identical shape to `ShutdownConfirmationDialogProps`.

- [ ] **Step 1: Create the types file**

Create `app/(app)/pos/z-reading-warning/z-reading-warning-types.ts`, copying `app/(app)/pos/shutdown-confirmation/shutdown-confirmation-types.ts`'s exact shape:

```typescript
export interface ZReadingWarningDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}
```

- [ ] **Step 2: Create the dialog component**

Create `app/(app)/pos/z-reading-warning/ZReadingWarningDialog.tsx`, copying `ShutdownConfirmationDialog.tsx`'s exact structure:

```tsx
'use client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { ZReadingWarningDialogProps } from './z-reading-warning-types';

export function ZReadingWarningDialog({
  open,
  onOpenChange,
  onConfirm,
}: ZReadingWarningDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Generate Z-Reading?</AlertDialogTitle>
          <AlertDialogDescription>
            This will close out the current business day for this terminal. No further sales can be made here until a new shift is started. Continue?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Continue</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

- [ ] **Step 3: Add gate state and handler in `use-pos.ts`**

Add a new state (near `isZReadingOpen`'s declaration — locate it, since prior research didn't capture its exact line, only that it's referenced):

```typescript
  const [isZReadingWarningOpen, setIsZReadingWarningOpen] = useState(false);
```

Add a handler that opens the warning instead of the dialog directly, and a confirm-handler that proceeds to the real dialog:

```typescript
  const handleOpenZReadingWarning = () => {
    setIsZReadingWarningOpen(true);
  };

  const handleConfirmZReadingWarning = () => {
    setIsZReadingWarningOpen(false);
    setIsZReadingOpen(true);
  };
```

Export `isZReadingWarningOpen`, `setIsZReadingWarningOpen`, `handleOpenZReadingWarning`, `handleConfirmZReadingWarning` from the hook's returned object, alongside the existing `isZReadingOpen`/`setIsZReadingOpen`.

- [ ] **Step 4: Fix the dangling `pendingZReading` reference from Task 6**

In `PosDialogs.tsx`, the existing `ZReadingDialog` instance (currently lines 209-217) has an `onOpenChange` handler that calls `pos.setPendingZReading(false)`:

```tsx
      <ZReadingDialog
        isOpen={pos.isZReadingOpen}
        onOpenChange={(open) => { pos.setIsZReadingOpen(open); if (!open) pos.setPendingZReading(false); }}
        printMode={pos.businessSettings?.printMode || 'browser'}
        terminalId={pos.selectedTerminalId}
        terminalName={pos.currentTerminalName}
        autoShow={pos.pendingZReading}
        initialData={pos.lastSavedZReading}
      />
```

Since Task 6 removed `pendingZReading`/`setPendingZReading` entirely, update this to:

```tsx
      <ZReadingDialog
        isOpen={pos.isZReadingOpen}
        onOpenChange={pos.setIsZReadingOpen}
        printMode={pos.businessSettings?.printMode || 'browser'}
        terminalId={pos.selectedTerminalId}
        terminalName={pos.currentTerminalName}
        autoShow={false}
        initialData={pos.lastSavedZReading}
      />
```

(`autoShow` becomes a hardcoded `false` since Z-reading is no longer ever auto-triggered by the shift-end chain — it's always a deliberate, warning-gated click now.)

- [ ] **Step 5: Add the new warning dialog instance in `PosDialogs.tsx`**

Add near the `ZReadingDialog` instance:

```tsx
      <ZReadingWarningDialog
        open={pos.isZReadingWarningOpen}
        onOpenChange={pos.setIsZReadingWarningOpen}
        onConfirm={pos.handleConfirmZReadingWarning}
      />
```

Add the import at the top of `PosDialogs.tsx`:

```typescript
import { ZReadingWarningDialog } from '../z-reading-warning/ZReadingWarningDialog';
```

(Adjust the relative import path to match this file's actual location relative to the new `z-reading-warning/` directory.)

- [ ] **Step 6: Change the Z-READING footer button's action**

In `PosFooterActions.tsx`, change the Z-READING entry (currently `action: () => setIsZReadingOpen(true)`) to open the warning instead:

```typescript
    { icon: BookOpen, label: 'Z-READING', shortcut: 'Ctrl+0', action: handleOpenZReadingWarning, tint: 'text-purple-600', cashierOnly: true },
```

This requires adding `handleOpenZReadingWarning: () => void;` to the `Props` type and destructured parameters (alongside `handleOpenXReading` added in Task 7), and removing the now-unused `setIsZReadingOpen` prop if nothing else in this file still needs it (check before removing — it may still be needed if any other action in this file references it; per this plan's research, it was only ever used by the Z-READING entry, so it should be safe to drop, but verify).

Update wherever `PosFooterActions` is rendered to pass `handleOpenZReadingWarning={pos.handleOpenZReadingWarning}`.

- [ ] **Step 7: Verify**

Run: `npm run typecheck`
Expected: No new errors across all touched files.

Run: `npm run test:unit`
Expected: All tests pass, no regressions.

Manual: click the Z-READING footer button — confirm the new warning dialog appears first. Click Cancel — confirm no Z-reading is generated and the warning closes. Click Z-READING again, click Continue — confirm the existing `ZReadingDialog` flow now opens exactly as it did before this task (just gated behind one extra click).

- [ ] **Step 8: Commit**

```bash
git add "app/(app)/pos/z-reading-warning/z-reading-warning-types.ts" "app/(app)/pos/z-reading-warning/ZReadingWarningDialog.tsx" "app/(app)/pos/pos-content/use-pos.ts" "app/(app)/pos/pos-content/PosFooterActions.tsx" "app/(app)/pos/pos-content/PosDialogs.tsx"
git commit -m "feat(pos): warn before generating a Z-reading

Z-reading now closes out the terminal's whole business day (Tasks
3-4), not just one shift, so it needs an explicit, informed
confirmation before firing — modeled on the existing shutdown
confirmation dialog. Also fixes a dangling setPendingZReading
reference left by Task 6's removal of that state.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Final Verification

- [ ] **Step 1: Run the full unit test suite**

Run: `npm run test:unit`
Expected: All tests pass, including every new test file from this plan (Task 2).

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: No new errors introduced by this plan's changes (pre-existing red baseline elsewhere is not this plan's concern).

- [ ] **Step 3: Run the migration on a fresh/test database**

Run: `npm run migrate` against a clean test DB to confirm `110_add_business_date_lock.ts` applies cleanly from zero.

- [ ] **Step 4: End-to-end manual smoke test**

1. Start a shift on Terminal A. Ring up a normal sale — confirm it succeeds.
2. Click Z-READING on Terminal A. Confirm the warning dialog appears. Click Continue. Confirm a Z-reading generates successfully.
3. Attempt another sale on Terminal A — confirm it's rejected with the "Business Day Closed" toast, and the sale never reaches the counters (no SI/OR number burned — check `transaction_references` before/after if you have DB access).
4. On Terminal B (a different terminal, never Z-read), confirm a sale still succeeds normally — the lock must not have leaked across terminals.
5. Start a new shift on Terminal A. Confirm the lock clears (checkout succeeds again on Terminal A).
6. During an active shift (not right after ending one), click the new X-READING footer button — confirm it opens and shows current shift data without requiring the shift to end.
7. End a shift (Cash Count) — confirm only an X-reading is generated automatically (check `x_readings`), confirm `z_counter` for that terminal does NOT increment, confirm the Z-Reading dialog does not auto-open, and confirm the Overall-Reading dialog still auto-opens after the X-reading dialog closes (unchanged chain).
8. Run a full business day with 2+ shifts on the same terminal (per the confirmed real-world pattern) — confirm each shift-end produces its own X-reading, confirm Z-reading is only ever generated when a cashier/admin deliberately clicks Z-READING (once, at the end of the last shift for that day) — not automatically per shift.
