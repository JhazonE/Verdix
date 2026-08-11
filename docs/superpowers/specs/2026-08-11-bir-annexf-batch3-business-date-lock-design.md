# BIR Annex F Compliance — Batch 3, Item 1: Same-Business-Date Restriction After Z-Reading

Date: 2026-08-11
Status: Approved
Related: BIR RMO 24-2023 Annex F audit, checklist item #29 ("Will the Sales Machines/Software allow sales transaction reflecting the same sales operation date upon generation of the Z-Reading/EOD Report? Note: Once the Z-Reading/EOD Report is generated, the subsequent transactions should reflect the succeeding sales operation day's date...") — MISSING.

## Context

Today, "business date" has no meaning independent of the calendar date returned by the DB server (`CURDATE()`/`NOW()`). Nothing in checkout (`app/api/pos/checkout/route.ts`) checks whether a Z-reading has already been generated for the current business day, so a sale immediately after a Z-reading simply posts under the same date as the just-closed report — the exact gap this checklist item flags.

### Z-reading is per-terminal, not per-store

Confirmed by reading `app/api/sales/z-reading/route.ts`: each terminal maintains its own independent chain of Z-readings (`WHERE terminal_id = ? ORDER BY report_date DESC LIMIT 1` bounds each new report's window). Terminal A running a Z-reading has zero effect on Terminal B today. Per business confirmation, this batch keeps that per-terminal scope — locking is per-terminal, not store-wide.

### Z-reading currently auto-fires on every shift-end (this changes)

`handleConfirmEndShift` in `use-pos.ts:855-918` currently POSTs to `/api/sales/z-reading` automatically every time a shift ends — with the result silently swallowed in a bare `try {} catch {}` and a toast that always claims success regardless of outcome. With multiple shifts per business day (the confirmed real-world pattern — e.g. morning + afternoon cashier), this means `z_counter` increments once per shift, not once per day, which is incompatible with "Z-reading marks the close of a business day."

**This batch removes the automatic Z-reading POST from shift-end.** X-reading's automatic POST at shift-end is unaffected — X-reading has no reset semantics and firing it per shift is correct and already matches the BIR checklist's own distinction between X-reading (shift/mid-day) and Z-reading (EOD).

### The POS footer already has Z-READING and OVERALL buttons; X-READING does not

`PosFooterActions.tsx` already renders standalone "Z-READING" (`Ctrl+0`) and "OVERALL" (`Ctrl+8`) buttons, reachable any time during an active shift — confirmed these call `setIsZReadingOpen(true)` / `handleOpenOverallReading` directly, independent of End Shift. **X-reading has no standalone footer button today** — `XReadingDialog` is only ever shown automatically right after a shift ends (`PosDialogs.tsx:227-234`, driven by `pos.showEndShiftReport`).

## Goals

1. Generating a Z-reading for a terminal locks that terminal's business date — no further sale can post on that terminal until the lock is cleared.
2. The lock clears automatically when a new shift starts on that terminal (the natural "a new business day of work has begun" signal).
3. Cashiers get clear, upfront warning before triggering an irreversible-for-the-day action (Z-reading), not a surprise block afterward.
4. X-reading becomes a first-class, on-demand POS action (its own footer button), matching Z-reading and Overall Reading's existing accessibility, and decoupled from End Shift's automatic behavior.
5. End Shift / Cash Count stops silently generating Z-readings; it keeps generating X-readings (unchanged).

## Non-goals

- No store-wide/cross-terminal locking. Terminal A's Z-reading never affects Terminal B. (Confirmed acceptable for this single-store, multi-terminal deployment.)
- No change to X-reading's existing "per shift, no reset" semantics or its automatic generation at shift-end.
- No change to Overall Reading's behavior or access pattern.
- No enforcement of "one Z-reading per calendar day" as a hard cap — the BIR wording (checklist item #29) only requires that the *next* sale after any Z-reading rolls to the next business day, not that Z-reading itself is rate-limited. A terminal that is manually unlocked (new shift started) and then Z-read again the "same calendar day" is not itself a violation; each Z-reading still correctly closes out whatever period it covers.
- No explicit "Start New Business Day" button — unlocking is implicit via shift-start, per business decision.

## Design

### 1. Schema: lock state on `pos_terminals`

New migration (numbered after the current highest — check `scripts/migrations/` at implementation time, following the idempotent `information_schema.COLUMNS` check pattern already used in `061_add_bir_compliance_columns.ts` and later migrations in this series):

```sql
ALTER TABLE pos_terminals ADD COLUMN business_date_locked_at TIMESTAMP NULL DEFAULT NULL;
```

Semantics: `NULL` = terminal is open for sales (unlocked). Non-null = the terminal is locked as of that timestamp (set the moment a Z-reading was generated); checkout must reject new sales on this terminal until it's cleared back to `NULL`.

(A boolean flag would also work, but storing the lock timestamp costs nothing extra and is useful for surfacing "locked since HH:MM" in any future UI/diagnostics, so the design uses a timestamp rather than a plain boolean.)

### 2. Z-reading generation sets the lock

**`app/api/sales/z-reading/route.ts`**, in the POST handler (the commit/generate path — not the GET preview path, which must remain read-only and side-effect-free): immediately after the new `z_readings` row is successfully inserted and within the same transaction/connection as that insert (so a rolled-back Z-reading never leaves a stray lock), add:

```sql
UPDATE pos_terminals SET business_date_locked_at = NOW() WHERE id = ?
```

using the same `terminalId` the Z-reading was generated for.

### 3. Checkout enforces the lock

**`app/api/pos/checkout/route.ts`**: add a new early validation, in the same style as the existing basic checks (items present, userId present, charge-customer check, mixed-cart-type check — all currently return `{success:false, error}` at 400 before any transaction/counter work begins). This new check needs `terminalId` (already available in the request body) and must run before any counter (`getNextSINumber`/`getNextBirOrNumber`) is touched:

```ts
if (terminalId) {
  const [terminalRows]: any = await query(
    'SELECT business_date_locked_at FROM pos_terminals WHERE id = ?',
    [terminalId]
  );
  if (terminalRows?.[0]?.business_date_locked_at) {
    return NextResponse.json(
      { success: false, error: 'This terminal\'s business day is closed (Z-Reading already generated). Start a new shift to begin the next business day.' },
      { status: 400 }
    );
  }
}
```

(Exact placement/wording to be finalized in the implementation plan; the principle is: same guard style as the existing mixed-cart-type check, positioned alongside it.)

### 4. Client-side surfacing of the block

The existing pattern in `use-tender.ts` (lines ~279-283, ~360-377) already catches a non-OK checkout response and shows a `useToast()` destructive-variant toast, with a special-cased title for at least one other blocking condition ("Stock Alert" for "Batch stock exhausted"). This batch adds an equivalent special case — detect the business-date-locked error (e.g. by a distinguishing substring, matching the existing pattern) and show a toast titled something like "Business Day Closed" with the server's message. No new modal is introduced for this — toast is the established precedent for blocked-checkout scenarios in this codebase.

### 5. Shift-start clears the lock

**`app/api/pos/shifts/route.ts`**, POST handler (shift start): after the new shift row is successfully inserted, in the same transaction, clear the lock for that terminal:

```sql
UPDATE pos_terminals SET business_date_locked_at = NULL WHERE id = ?
```

using the shift's `terminalId`. This is server-side (not client-side in `handleStartShift`) so it's authoritative and can't be skipped by a stale or modified client.

### 6. Remove automatic Z-reading from End Shift

**`use-pos.ts`'s `handleConfirmEndShift`** (currently lines 855-918): delete the `try { ... await fetch(getApiUrl('/sales/z-reading'), { method: 'POST', ... }) ... } catch {}` block (the second of the two silent-fail POSTs, currently following the X-reading POST). The X-reading POST block immediately before it is unchanged. `setPendingZReading(true)` and the corresponding auto-open-Z-reading-dialog `useEffect` (`use-pos.ts:1089-1095`) are also removed, since Z-reading no longer auto-fires at shift-end — the post-shift-end flow becomes: shift ends → X-Reading dialog shown → when closed, Overall-Reading dialog auto-opens (unchanged) — Z-reading is no longer part of this chain at all.

The end-of-function toast ("Shift closed and readings generated successfully") is reworded to not imply a Z-reading happened (e.g. "Shift closed and X-Reading saved.").

### 7. Add a standalone X-READING footer button

**`PosFooterActions.tsx`**: add a new action tile alongside the existing "Z-READING" and "OVERALL" entries, following the exact same `{ icon, label, shortcut, action, tint, cashierOnly }` shape used by every other entry in `allActions`. Needs:
- A new icon (any unused `lucide-react` icon distinct from `BookOpen`/`Files` already used by Z-Reading/Overall).
- A shortcut key (the existing scheme runs `Ctrl+1` through `Ctrl+8` plus `Ctrl+0` and `Ctrl+P` — pick an unused combination, e.g. `Ctrl+9`).
- An `action` that opens `XReadingDialog` directly (currently only ever opened via `pos.showEndShiftReport`/`setShowEndShiftReport` per `PosDialogs.tsx:227-234`) — this requires either reusing that same state (setting `showEndShiftReport = true` on demand, which also implies `autoShow={true}` behavior already baked into that dialog) or adding a new, separate boolean state so the on-demand path doesn't collide with the post-shift-end path. Prefer a new dedicated state (e.g. `isXReadingOpen`/`setIsXReadingOpen`) to avoid coupling on-demand X-reading to shift-end-specific behavior (`shiftId={pos.lastEndedShiftId}` context that doesn't apply when pulling an X-reading mid-shift) — finalize this exact wiring in the implementation plan after reading `XReadingDialog`'s current props contract in full.

### 8. Z-READING button gets a warning gate

**New component**, modeled directly on `app/(app)/pos/shutdown-confirmation/ShutdownConfirmationDialog.tsx` (a small `AlertDialog` wrapper taking `open`/`onOpenChange`/`onConfirm` props — copy this exact shape):

```tsx
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
```

**`PosFooterActions.tsx`**: the existing "Z-READING" button's `action` (currently `() => setIsZReadingOpen(true)`) changes to open this new warning dialog instead; only on confirm does it proceed to `setIsZReadingOpen(true)` (the existing `ZReadingDialog` flow, unchanged beyond this new gate in front of it).

## Testing

- Unit: a terminal with `business_date_locked_at` set rejects checkout with the expected error message and 400 status; a terminal with it `NULL` checks out normally (mirrors the existing `mixed-cart-validation.test.ts` pattern — a small pure/isolated test of the guard logic plus an integration-style check against the real route, given a prior batch's final review found that isolated/mirrored-logic tests alone did not catch a real route-level defect).
- Manual: generate a Z-reading on Terminal A — confirm an immediate sale attempt on Terminal A is blocked with the toast; confirm Terminal B (not Z-read) can still sell normally.
- Manual: start a new shift on the now-locked Terminal A — confirm the lock clears and a sale now succeeds.
- Manual: end a shift (Cash Count) — confirm only an X-reading is generated (check `x_readings`/report output), confirm `z_counter` on that terminal does NOT increment, confirm the Z-Reading dialog does not auto-open.
- Manual: click the new X-READING footer button mid-shift (not after shift-end) — confirm it opens/generates an X-reading correctly without requiring a shift to end first.
- Manual: click the Z-READING footer button — confirm the new warning dialog appears before the existing Z-reading flow, and Cancel genuinely aborts (no Z-reading generated, no lock set).
