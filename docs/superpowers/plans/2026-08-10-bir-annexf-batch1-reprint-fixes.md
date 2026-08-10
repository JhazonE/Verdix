# BIR Annex F Batch 1: Reprint Watermarks & Z-Reading Discount Bug Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make reprinted sale receipts and reprinted Z-Reading reports show a "REPRINT" watermark with a reprint timestamp (BIR Annex F checklist items #12 and #15), and fix a bug where the Z-Reading receipt printed at shift-finalize time shows hardcoded `0.00` for SC/PWD/NAAC/Solo Parent discounts and the void amount instead of the real, already-computed values.

**Architecture:** Three independent, additive changes inside the existing ESC/POS receipt-generation layer. No API or schema changes — every value needed (`discountSummary`, `voidAmount`, `data.id`) is already present in the data these functions receive; this is purely output-layer wiring using the same `enc.raw()`/`enc.bold()`/`enc.line()` idiom already used throughout both files.

**Tech Stack:** TypeScript, `@point-of-sale/receipt-printer-encoder` (ESC/POS byte encoding), `date-fns` for formatting, plain Node `assert`-based unit tests run via `tsx tests/unit/run.ts`.

## Global Constraints

- No database schema changes — reprint timestamp is render-time only (`new Date()` at the moment of printing), not persisted.
- Do not touch the Z-Reading VAT ADJUSTMENT section (SC TRANS / PWD TRANS / REG.Disc TRANS / ZERO-RATED TRANS / VAT on Return) — leave hardcoded `'0.00'` as-is; no real per-transaction VAT-impact aggregation exists yet to feed it correctly.
- Do not consolidate `generateZReadingReceipt` (`lib/receipt-generator.ts`) and `ZReadingGenerator.generate()` (`lib/z-reading-generator.ts`) into one function — they stay separate; each gets fixed independently at its own call site.
- Do not add a reprint watermark to `generateZReadingReceipt()` — it has no reprint entry point (it's only ever called from the one-shot "Print & Finalize Shift" flow), so a watermark there would be unreachable dead code.
- Every new/changed line of receipt text must use the existing `enc.raw([0x1b, 0x61, 0x31])` (native center) / `enc.raw([0x1b, 0x61, 0x30])` (native left) and `enc.bold(true)...bold(false)` idiom already used in both files — do not introduce a different centering/bolding mechanism.

---

## File Structure

- Modify: `lib/receipt-generator.ts` — add REPRINT watermark to `generateReceipt()`; fix hardcoded discount/void zeros in `generateZReadingReceipt()`.
- Modify: `lib/z-reading-generator.ts` — add `isReprint` parameter and REPRINT watermark to `ZReadingGenerator.generate()`.
- Modify: `app/(app)/pos/z-reading-report/ZReadingDialog.tsx` — pass `isReprint` when calling `generator.generate(...)`.
- Create: `tests/unit/reprint-watermark.test.ts` — covers both watermark behaviors (sale receipt + Z-reading).
- Create: `tests/unit/z-reading-discount-summary.test.ts` — covers the hardcoded-zero bug fix.
- Modify: `tests/unit/run.ts` — register the two new test files.

---

### Task 1: Sale receipt REPRINT watermark

**Files:**
- Modify: `lib/receipt-generator.ts:183` (insert after this line, before line 184)
- Test: `tests/unit/reprint-watermark.test.ts` (new file, sale-receipt portion)
- Modify: `tests/unit/run.ts`

**Interfaces:**
- Consumes: `sale.isReprint?: boolean` — already exists on the `generateReceipt()` parameter type (`lib/receipt-generator.ts:82`), already passed by both real call sites (`app/(app)/pos/tender/TenderDialog.tsx:155`, `app/(app)/pos/recent-sales/use-recent-sales.ts:193`). No caller changes needed.
- Produces: no new exports. Existing `ReceiptGenerator.generateReceipt()` signature and return type (`Uint8Array`) are unchanged.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/reprint-watermark.test.ts`:

```ts
import assert from 'node:assert/strict';
import { ReceiptGenerator } from '../../lib/receipt-generator';

// The printed receipt must show "REPRINT" and a reprint timestamp on the
// face of the document when isReprint is true (BIR Annex F checklist item
// #12: "Is the date and time when the reprinting was done reflected on the
// face of the reprinted invoice/receipt?"). An original print must show
// neither.

const decode = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1');

const baseSale = {
  items: [{ name: 'Rice', price: 100, quantity: 1, discount: 0, taxType: 'VAT' } as any],
  customer: null,
  totalDue: 100,
  change: 0,
  paymentMethod: 'CASH',
};

const gen = new ReceiptGenerator();

// ─── original print: no watermark ────────────────────────────────────────
const original = decode(gen.generateReceipt({ ...baseSale }, null));
assert.ok(!original.includes('REPRINT'), 'original print does not say REPRINT');

// ─── reprint: watermark + timestamp present ──────────────────────────────
const reprinted = decode(gen.generateReceipt({ ...baseSale, isReprint: true }, null));
assert.ok(reprinted.includes('REPRINT'), 'reprint shows the REPRINT watermark');
assert.ok(reprinted.includes('Reprinted:'), 'reprint shows a reprint timestamp label');

// ─── watermark appears before the item table, not buried in the footer ──
const watermarkAt = reprinted.indexOf('REPRINT');
const itemTableAt = reprinted.indexOf('Rice');
assert.ok(
  watermarkAt !== -1 && itemTableAt !== -1 && watermarkAt < itemTableAt,
  'REPRINT watermark appears before the item table, near the top of the receipt',
);

console.log('✓ reprint-watermark (sale receipt)');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/unit/reprint-watermark.test.ts`
Expected: FAIL — `AssertionError` on `reprinted.includes('REPRINT')` (currently false, since no watermark logic exists yet).

- [ ] **Step 3: Write minimal implementation**

In `lib/receipt-generator.ts`, after line 183 (`enc.bold(true).line(\`SI NO.: ${formattedSiNo}\`).bold(false);`) and before line 184 (`enc.line(\`Cust: ${customer?.name || 'Walk-in'}\`);`), insert:

```ts
        if (sale.isReprint) {
            enc.raw([0x1b, 0x61, 0x31]); // Native Center
            enc.bold(true).line('*** REPRINT ***').bold(false);
            enc.line(`Reprinted: ${format(new Date(), 'PP p')}`);
            enc.raw([0x1b, 0x61, 0x30]); // Native Left
        }
```

`format` is already imported at the top of the file (`lib/receipt-generator.ts:2`, `import { format, addYears } from 'date-fns';`) — no new import needed.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/unit/reprint-watermark.test.ts`
Expected: PASS, prints `✓ reprint-watermark (sale receipt)`

- [ ] **Step 5: Register the test in the suite runner**

In `tests/unit/run.ts`, add after the existing `import './receipt-si-number.test';` line (line 15):

```ts
import './reprint-watermark.test';
```

- [ ] **Step 6: Run the full unit suite to confirm no regressions**

Run: `npm run test:unit`
Expected: All tests pass, including the existing `drawer-kick.test.ts` (the watermark insertion sits after the drawer-kick logic at the very top of `generateReceipt`, so it cannot affect kick-byte position — `drawer-kick.test.ts:78` asserts the kick lands within the first 8 bytes, which is unaffected by text added later in the stream) and `receipt-si-number.test.ts` (SI NO. line content itself is unchanged).

- [ ] **Step 7: Commit**

```bash
git add lib/receipt-generator.ts tests/unit/reprint-watermark.test.ts tests/unit/run.ts
git commit -m "feat(receipts): print REPRINT watermark and timestamp on reprinted sale receipts

BIR Annex F checklist item #12 requires reprinted invoices/receipts to
show the word REPRINT and the date/time of reprinting on the face of
the document. isReprint was already threaded through both reprint call
sites (TenderDialog, recent-sales) but only suppressed the drawer kick.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Z-Reading REPRINT watermark

**Files:**
- Modify: `lib/z-reading-generator.ts` (method signature + insertion after the TITLE section, ~line 68)
- Modify: `app/(app)/pos/z-reading-report/ZReadingDialog.tsx:91`
- Test: `tests/unit/reprint-watermark.test.ts` (append Z-reading portion)

**Interfaces:**
- Consumes: `ZReadingData.id: string` (already defined, `lib/types.ts:544`) — `'PREVIEW'` means a fresh, not-yet-committed reading; any other value means a historical, already-finalized reading being reprinted.
- Produces: `ZReadingGenerator.generate(data: ZReadingData, settings?: BusinessSettings | null, isReprint?: boolean): Uint8Array` — new optional third parameter, default `false`, so any other caller (none exist today besides `ZReadingDialog.tsx`) keeps working unchanged.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/reprint-watermark.test.ts` (before the final `console.log` line — move the sale-receipt `console.log` up if needed, or just add a second one; keep both):

```ts
import { ZReadingGenerator } from '../../lib/z-reading-generator';
import type { ZReadingData } from '../../lib/types';

// ─── Z-Reading REPRINT watermark ─────────────────────────────────────────
const baseZData: ZReadingData = {
  id: 'PREVIEW',
  date: '2026-08-10',
  reportDate: new Date('2026-08-10T18:00:00'),
  grossSales: 1000,
  returns: 0,
  discounts: 0,
  netSales: 1000,
  vatSales: 892.86,
  vatAmount: 107.14,
  vatExempt: 0,
  zeroRated: 0,
  nonVat: 0,
  paymentMethods: [{ name: 'CASH', amount: 1000 }],
  transactionCount: 1,
  startingCash: 0,
  cashSales: 1000,
  cashInDrawer: 1000,
};

const zGen = new ZReadingGenerator();

const freshZ = Buffer.from(zGen.generate(baseZData, null)).toString('latin1');
assert.ok(!freshZ.includes('REPRINT'), 'fresh Z-reading (id=PREVIEW) does not say REPRINT');

const reprintedZ = Buffer.from(
  zGen.generate({ ...baseZData, id: 'z-2026-08-09-001' }, null, true),
).toString('latin1');
assert.ok(reprintedZ.includes('REPRINT'), 'reprinted historical Z-reading shows REPRINT watermark');
assert.ok(reprintedZ.includes('Reprinted:'), 'reprinted Z-reading shows a reprint timestamp label');

console.log('✓ reprint-watermark (Z-reading)');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/unit/reprint-watermark.test.ts`
Expected: FAIL — `generate()` currently only takes 2 params and never emits "REPRINT".

- [ ] **Step 3: Write minimal implementation**

In `lib/z-reading-generator.ts`, change the method signature (currently `public generate(data: ZReadingData, settings?: BusinessSettings | null): Uint8Array {`) to:

```ts
    public generate(data: ZReadingData, settings?: BusinessSettings | null, isReprint?: boolean): Uint8Array {
```

Then, after the TITLE section — after the line `enc.raw([0x1b, 0x61, 0x30]); // Native Left` that immediately follows `enc.line('Z-READING REPORT');` (current lines 67-68) and before the `// ── DATE SECTION ──` comment (current line 70) — insert:

```ts

        // ── REPRINT WATERMARK ──────────────────────────────────────────────
        if (isReprint) {
            enc.align('center');
            enc.bold(true).line('*** REPRINT ***').bold(false);
            enc.line(`Reprinted: ${format(new Date(), 'PP p')}`);
            enc.align('left');
        }
```

`format` is already imported at the top of the file (`lib/z-reading-generator.ts:3`, `import { format, addYears } from 'date-fns';`) — no new import needed.

- [ ] **Step 4: Wire the call site**

In `app/(app)/pos/z-reading-report/ZReadingDialog.tsx`, inside `handlePrintAndFinalize` (around line 90-92), change:

```ts
        const generator = new ZReadingGenerator();
        const bytes = generator.generate({ ...data, terminalName } as any, businessSettings);
        await print(bytes);
```

to:

```ts
        const generator = new ZReadingGenerator();
        const isReprint = data.id !== 'PREVIEW';
        const bytes = generator.generate({ ...data, terminalName } as any, businessSettings, isReprint);
        await print(bytes);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx tests/unit/reprint-watermark.test.ts`
Expected: PASS, prints both `✓ reprint-watermark (sale receipt)` and `✓ reprint-watermark (Z-reading)`

- [ ] **Step 6: Run the full unit suite and typecheck**

Run: `npm run test:unit`
Expected: All tests pass.

Run: `npm run typecheck`
Expected: No new type errors (the `ZReadingDialog.tsx` call site still passes a valid `ZReadingData`-shaped object; the new third parameter is optional so untouched callers, if any exist elsewhere, remain valid).

- [ ] **Step 7: Commit**

```bash
git add lib/z-reading-generator.ts "app/(app)/pos/z-reading-report/ZReadingDialog.tsx" tests/unit/reprint-watermark.test.ts
git commit -m "feat(z-reading): print REPRINT watermark on reprinted Z-reading reports

BIR Annex F checklist item #15 requires a reprinted Z-Reading/EOD report
to show REPRINT on its face. ZReadingDialog's historical-view path
(data.id !== 'PREVIEW') is the only Z-reading flow that ever reprints
an already-finalized reading, so that's where the flag now originates.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Fix hardcoded zeros in `generateZReadingReceipt()`

**Files:**
- Modify: `lib/receipt-generator.ts:654-658` (DISCOUNT SUMMARY block), `lib/receipt-generator.ts:664` (VOID line)
- Test: `tests/unit/z-reading-discount-summary.test.ts` (new file)
- Modify: `tests/unit/run.ts`

**Interfaces:**
- Consumes: `data.discountSummary?: Array<{ type: string; amount: number; count: number; itemCount?: number }>` and `data.voidAmount?: number` — both already sent by `app/api/sales/z-reading/route.ts` (lines 376-383, 691) and already declared on `ZReadingData` (`lib/types.ts:578, 584`). `generateZReadingReceipt`'s `data` parameter is typed `any`, so no type change needed there.
- Produces: no new exports. `generateZReadingReceipt()` signature unchanged.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/z-reading-discount-summary.test.ts`:

```ts
import assert from 'node:assert/strict';
import { ReceiptGenerator } from '../../lib/receipt-generator';

// generateZReadingReceipt() (the "Print & Finalize Shift" path) must print
// the real SC/PWD/NAAC/Solo Parent discount breakdown and the real void
// amount instead of hardcoded 0.00 — the API already computes and sends
// this data (discountSummary, voidAmount) but the receipt was silently
// dropping it, so BIR-facing paper reports understated statutory discounts.

const decode = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1');

const gen = new ReceiptGenerator();

const zData = {
  reportDate: new Date('2026-08-10T18:00:00'),
  netSales: 1000,
  previousReading: 0,
  vatSales: 892.86,
  vatAmount: 107.14,
  vatExempt: 0,
  zeroRated: 0,
  grossSales: 1200,
  discounts: 200,
  returns: 0,
  voidAmount: 150.5,
  vatAdjustment: 0,
  paymentMethods: [{ name: 'CASH', amount: 1000 }],
  startingCash: 0,
  discountSummary: [
    { type: 'senior', amount: 80, count: 1, itemCount: 1 },
    { type: 'pwd', amount: 40, count: 1, itemCount: 1 },
    { type: 'naac', amount: 20, count: 1, itemCount: 1 },
    { type: 'solo_parent', amount: 10, count: 1, itemCount: 1 },
    { type: 'percent', amount: 50, count: 1, itemCount: 1 },
  ],
};

const printed = decode(gen.generateZReadingReceipt(zData, null));

assert.ok(printed.includes('SC Disc. :') && printed.includes('80.00'), 'SC discount shows real amount');
assert.ok(printed.includes('PWD Disc. :') && printed.includes('40.00'), 'PWD discount shows real amount');
assert.ok(printed.includes('NAAC Disc. :') && printed.includes('20.00'), 'NAAC discount shows real amount');
assert.ok(
  printed.includes('Solo Parent Disc. :') && printed.includes('10.00'),
  'Solo Parent discount shows real amount',
);
assert.ok(printed.includes('Other Disc. :') && printed.includes('50.00'), 'non-statutory discount bucketed as Other');
assert.ok(printed.includes('150.50'), 'VOID line shows the real void amount, not 0.00');

// ─── empty discountSummary: all buckets fall back to 0.00, not a crash ───
const noDiscounts = decode(
  gen.generateZReadingReceipt({ ...zData, discountSummary: [], voidAmount: 0 }, null),
);
assert.ok(noDiscounts.includes('SC Disc. :') , 'still prints the SC Disc. row with zero data');

console.log('✓ z-reading-discount-summary');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/unit/z-reading-discount-summary.test.ts`
Expected: FAIL — the SC/PWD/NAAC/Solo Parent and VOID lines currently always print `0.00` regardless of input, so `printed.includes('80.00')` etc. fail.

- [ ] **Step 3: Write minimal implementation**

In `lib/receipt-generator.ts`, replace the DISCOUNT SUMMARY block (currently lines 652-658):

```ts
        enc.line(dash);
        enc.align('center').bold(true).line('DISCOUNT SUMMARY').bold(false).align('left');
        enc.line(row('SC Disc. :',          '0.00'));
        enc.line(row('PWD Disc. :',         '0.00'));
        enc.line(row('NAAC Disc. :',        '0.00'));
        enc.line(row('Solo Parent Disc. :', '0.00'));
        enc.line(row('Other Disc. :',       fmt(data.discounts || 0)));
```

with:

```ts
        enc.line(dash);
        enc.align('center').bold(true).line('DISCOUNT SUMMARY').bold(false).align('left');
        const zDiscountSummary: Array<{ type: string; amount: number }> = data.discountSummary || [];
        let scDiscAmt = 0, pwdDiscAmt = 0, naacDiscAmt = 0, soloDiscAmt = 0, otherDiscAmt = 0;
        zDiscountSummary.forEach((d) => {
            const type = d.type?.toLowerCase();
            if (type === 'senior') scDiscAmt += d.amount;
            else if (type === 'pwd') pwdDiscAmt += d.amount;
            else if (type === 'naac') naacDiscAmt += d.amount;
            else if (type === 'solo_parent') soloDiscAmt += d.amount;
            else otherDiscAmt += d.amount;
        });
        enc.line(row('SC Disc. :',          fmt(scDiscAmt)));
        enc.line(row('PWD Disc. :',         fmt(pwdDiscAmt)));
        enc.line(row('NAAC Disc. :',        fmt(naacDiscAmt)));
        enc.line(row('Solo Parent Disc. :', fmt(soloDiscAmt)));
        enc.line(row('Other Disc. :',       fmt(otherDiscAmt)));
```

This mirrors the bucketing logic already proven correct in `lib/z-reading-generator.ts:117-138`, adapted to this file's local variable naming to avoid colliding with the outer `data.discounts` used elsewhere in the same function.

Then, in the SALES ADJUSTMENT block (currently lines 662-665), replace:

```ts
        enc.line(row('VOID :',   '0.00'));
```

with:

```ts
        enc.line(row('VOID :',   fmt(data.voidAmount || 0)));
```

(The `RETURN :` line directly below already correctly uses `fmt(data.returns || 0)` — leave it unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/unit/z-reading-discount-summary.test.ts`
Expected: PASS, prints `✓ z-reading-discount-summary`

- [ ] **Step 5: Register the test in the suite runner**

In `tests/unit/run.ts`, add after the `import './reprint-watermark.test';` line added in Task 1:

```ts
import './z-reading-discount-summary.test';
```

- [ ] **Step 6: Run the full unit suite to confirm no regressions**

Run: `npm run test:unit`
Expected: All tests pass, including `receipt-si-number.test.ts` and `drawer-kick.test.ts` (both exercise `generateReceipt`, not `generateZReadingReceipt`, so they're unaffected by this task's changes).

- [ ] **Step 7: Commit**

```bash
git add lib/receipt-generator.ts tests/unit/z-reading-discount-summary.test.ts tests/unit/run.ts
git commit -m "fix(z-reading): print real SC/PWD/NAAC/Solo Parent discounts and void amount

generateZReadingReceipt() (the Print & Finalize Shift path) hardcoded
its DISCOUNT SUMMARY and VOID lines to 0.00 even though the API already
computes and sends discountSummary and voidAmount. The printed paper
Z-reading was understating statutory discount breakdowns — exactly the
numbers a BIR examiner checks. Ports the bucketing logic already proven
correct in lib/z-reading-generator.ts's ZReadingGenerator.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Final Verification

- [ ] **Step 1: Run the full unit test suite one more time**

Run: `npm run test:unit`
Expected: All tests pass, including the three new/modified test files from this plan.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: No new errors introduced by this plan's changes.

- [ ] **Step 3: Manual smoke test (per spec's Testing section)**

Since this touches printed receipt output, do a manual pass if a printer or the browser-print preview is available:
1. Ring up a sale, tender cash, print the receipt — confirm no "REPRINT" text appears and the drawer still kicks.
2. Reprint that sale from Recent Sales — confirm "*** REPRINT ***" and a "Reprinted: <date/time>" line appear near the top, and the drawer does NOT kick again.
3. Run a shift with at least one Senior Citizen/PWD discount and one voided sale, then finalize the Z-reading — confirm the printed DISCOUNT SUMMARY shows the real SC/PWD amounts (not 0.00) and the VOID line shows the real void total.
4. Reopen that same finalized Z-reading from history and print it again via `ZReadingDialog` — confirm "*** REPRINT ***" now appears (it didn't on the finalize-time print in step 3).
