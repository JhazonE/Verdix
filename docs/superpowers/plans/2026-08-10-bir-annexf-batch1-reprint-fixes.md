# BIR Annex F Batch 1: Reprint Watermarks & Z-Reading Discount Bug Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make reprinted sale receipts and reprinted Z-Reading reports show a "REPRINT" watermark with a reprint timestamp (BIR Annex F checklist items #12 and #15), across BOTH the ESC/POS thermal-printer path AND the browser (`react-to-print`) path, and fix a bug where the Z-Reading receipt printed at shift-finalize time shows hardcoded `0.00` for SC/PWD/NAAC/Solo Parent discounts and the void amount instead of the real, already-computed values.

**Architecture:** Four independent, additive changes. Tasks 1-3 live inside the existing ESC/POS receipt-generation layer. Task 4 mirrors that same watermark into the parallel browser-print React component tree, discovered as a gap during the final whole-branch review of Tasks 1-3: `printMode` defaults to `'browser'` when unset in settings (`app/(app)/pos/pos-content/PosDialogs.tsx`), so the ESC/POS-only fix left every reprint unwatermarked on any terminal using that default. No API or schema changes anywhere in this plan — every value needed (`discountSummary`, `voidAmount`, `data.id`, `isReprint`) is already present in the data these functions/components receive; this is purely output-layer wiring using each file's own established idiom (`enc.raw()`/`enc.bold()`/`enc.line()` for ESC/POS, JSX + inline styles for the React components).

**Tech Stack:** TypeScript, `@point-of-sale/receipt-printer-encoder` (ESC/POS byte encoding), `date-fns` for formatting, plain Node `assert`-based unit tests run via `tsx tests/unit/run.ts`.

## Global Constraints

- No database schema changes — reprint timestamp is render-time only (`new Date()` at the moment of printing), not persisted.
- Do not touch the Z-Reading VAT ADJUSTMENT section (SC TRANS / PWD TRANS / REG.Disc TRANS / ZERO-RATED TRANS / VAT on Return) — leave hardcoded `'0.00'` as-is; no real per-transaction VAT-impact aggregation exists yet to feed it correctly.
- Do not consolidate `generateZReadingReceipt` (`lib/receipt-generator.ts`) and `ZReadingGenerator.generate()` (`lib/z-reading-generator.ts`) into one function — they stay separate; each gets fixed independently at its own call site.
- Do not add a reprint watermark to `generateZReadingReceipt()` — it has no reprint entry point (it's only ever called from the one-shot "Print & Finalize Shift" flow), so a watermark there would be unreachable dead code.
- Every new/changed line of receipt text must use the existing `enc.raw([0x1b, 0x61, 0x31])` (native center) / `enc.raw([0x1b, 0x61, 0x30])` (native left) and `enc.bold(true)...bold(false)` idiom already used in both files — do not introduce a different centering/bolding mechanism. (This constraint binds Tasks 1-3 only, which are ESC/POS. Task 4 is JSX/React and follows its own files' existing style idiom — see Task 4.)
- Task 4's watermark wording must match Tasks 1-2's exactly: bold `*** REPRINT ***` line, then a `Reprinted: <date>` line using `format(new Date(), 'PP p')` — verbatim consistent phrasing across all four watermark sites (2 ESC/POS, 2 React), since the final review of Tasks 1-3 specifically checked for and required this cross-implementation consistency.

---

## File Structure

- Modify: `lib/receipt-generator.ts` — add REPRINT watermark to `generateReceipt()`; fix hardcoded discount/void zeros in `generateZReadingReceipt()`.
- Modify: `lib/z-reading-generator.ts` — add `isReprint` parameter and REPRINT watermark to `ZReadingGenerator.generate()`.
- Modify: `app/(app)/pos/z-reading-report/ZReadingDialog.tsx` — pass `isReprint` when calling `generator.generate(...)`.
- Create: `tests/unit/reprint-watermark.test.ts` — covers both watermark behaviors (sale receipt + Z-reading).
- Create: `tests/unit/z-reading-discount-summary.test.ts` — covers the hardcoded-zero bug fix.
- Modify: `tests/unit/run.ts` — register the two new test files, plus Task 4's new test file.
- Modify: `app/(app)/pos/receipt/receipt-types.ts` — add `isReprint?: boolean` to `ReceiptViewProps.saleDetails`, alongside the existing `isTrainingMode?: boolean`.
- Modify: `app/(app)/pos/receipt/ReceiptView.tsx` — render the REPRINT watermark when `saleDetails.isReprint` is true.
- Modify: `app/(app)/pos/recent-sales/use-recent-sales.ts` — pass `isReprint: true` into the `saleDetails`-shaped object handed to `ReceiptPrintView` in the browser-print branch (this is always a reprint context, same as its existing ESC/POS branch already does).
- Modify: `app/(app)/pos/tender/TenderDialog.tsx` — thread `isReprint` from `handlePrintReceipt`'s parameter into the hidden `ReceiptView` used for browser printing, via component state.
- Modify: `app/(app)/sales/z-reading/z-reading-preview.tsx` — render the REPRINT watermark when `data.id !== 'PREVIEW'` (no new prop needed; `data.id` is already passed in).
- Create: `tests/unit/reprint-watermark-browser.test.ts` — covers all three browser-path watermark behaviors using React server-side rendering to string (`react-dom/server`'s `renderToStaticMarkup`), matching the byte/string-decode-and-search pattern already used for the ESC/POS tests.

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

### Task 4: Browser-print REPRINT watermark (sale receipt + Z-reading)

**Context:** The final whole-branch review of Tasks 1-3 found that `printMode` defaults to `'browser'` whenever it's unset in settings (`app/(app)/pos/pos-content/PosDialogs.tsx` passes `pos.businessSettings?.printMode || 'browser'` to every POS dialog). On that default, neither sale receipts nor Z-readings print through the ESC/POS generators fixed in Tasks 1-2 — they render through a separate React component tree (`ReceiptView` / `ZReadingPreview`) via `react-to-print` or a hidden-iframe `printReactComponent` helper, and that tree has no REPRINT concept at all today. This task closes that gap by mirroring the same watermark into both React components.

**Files:**
- Modify: `app/(app)/pos/receipt/receipt-types.ts` (add one field to `ReceiptViewProps.saleDetails`)
- Modify: `app/(app)/pos/receipt/ReceiptView.tsx:44-49` (render watermark)
- Modify: `app/(app)/pos/recent-sales/ReceiptPrintView.tsx` (accept and forward `isReprint`)
- Modify: `app/(app)/pos/recent-sales/use-recent-sales.ts:160-181` (pass `isReprint: true` — this branch is always a reprint)
- Modify: `app/(app)/pos/tender/TenderDialog.tsx` (thread `isReprint` from `handlePrintReceipt`'s existing parameter into the hidden `ReceiptView`, via new component state)
- Modify: `app/(app)/sales/z-reading/z-reading-preview.tsx:167-169` (render watermark, derived from `data.id`, no new prop)
- Test: `tests/unit/reprint-watermark-browser.test.ts` (new file)
- Modify: `tests/unit/run.ts`

**Interfaces:**
- Consumes: `saleDetails.isTrainingMode?: boolean` — the existing precedent field on `ReceiptViewProps.saleDetails` (`app/(app)/pos/receipt/receipt-types.ts:28`) that this task's new `isReprint` field mirrors exactly (same optional-boolean shape, same object). Also consumes `ZReadingData.id: string` (`lib/types.ts:544`), already passed into `ZReadingPreviewProps.data` today — no new prop needed for the Z-reading side.
- Produces: `ReceiptViewProps.saleDetails.isReprint?: boolean` and `ReceiptPrintViewProps.isReprint?: boolean` — new optional fields, additive, so any caller that omits them keeps working exactly as before (watermark simply doesn't render).

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/reprint-watermark-browser.test.ts`:

```ts
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReceiptView } from '../../app/(app)/pos/receipt/ReceiptView';
import { ZReadingPreview } from '../../app/(app)/sales/z-reading/z-reading-preview';
import type { ZReadingData } from '../../lib/types';

// The browser (react-to-print) rendering path must show the same REPRINT
// watermark as the ESC/POS path (Tasks 1-2), since `printMode` defaults to
// 'browser' when unset in settings and every reprint must satisfy BIR Annex
// F checklist items #12 and #15 regardless of which print path is active.

const baseSaleDetails = {
  items: [{ name: 'Rice', price: 100, quantity: 1, discount: 0, taxType: 'VAT' } as any],
  customer: null,
  totalDue: 100,
  change: 0,
  paymentMethod: 'CASH',
};

// ─── ReceiptView (sale receipt) ──────────────────────────────────────────
const originalHtml = renderToStaticMarkup(
  React.createElement(ReceiptView, { saleDetails: baseSaleDetails, settings: null }),
);
assert.ok(!originalHtml.includes('REPRINT'), 'original browser-printed receipt has no REPRINT watermark');

const reprintHtml = renderToStaticMarkup(
  React.createElement(ReceiptView, {
    saleDetails: { ...baseSaleDetails, isReprint: true },
    settings: null,
  }),
);
assert.ok(reprintHtml.includes('REPRINT'), 'reprinted browser receipt shows REPRINT watermark');
assert.ok(reprintHtml.includes('Reprinted:'), 'reprinted browser receipt shows a reprint timestamp label');

console.log('✓ reprint-watermark-browser (ReceiptView)');

// ─── ZReadingPreview (Z-reading) ─────────────────────────────────────────
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

const freshZHtml = renderToStaticMarkup(
  React.createElement(ZReadingPreview, { data: baseZData, printerFormat: '58mm', businessSettings: null }),
);
assert.ok(!freshZHtml.includes('REPRINT'), 'fresh Z-reading preview (id=PREVIEW) has no REPRINT watermark');

const reprintZHtml = renderToStaticMarkup(
  React.createElement(ZReadingPreview, {
    data: { ...baseZData, id: 'z-2026-08-09-001' },
    printerFormat: '58mm',
    businessSettings: null,
  }),
);
assert.ok(reprintZHtml.includes('REPRINT'), 'historical Z-reading preview (id!=PREVIEW) shows REPRINT watermark');
assert.ok(reprintZHtml.includes('Reprinted:'), 'historical Z-reading preview shows a reprint timestamp label');

console.log('✓ reprint-watermark-browser (ZReadingPreview)');
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx tests/unit/reprint-watermark-browser.test.ts`
Expected: FAIL — neither component currently renders "REPRINT" under any input.

- [ ] **Step 3: Add `isReprint` to the sale-receipt type and component**

In `app/(app)/pos/receipt/receipt-types.ts`, add one field to the `saleDetails` object, next to the existing `isTrainingMode?: boolean` (line 28):

```ts
    isTrainingMode?: boolean;
    isReprint?: boolean;
```

In `app/(app)/pos/receipt/ReceiptView.tsx`, the sale-header block currently reads (lines 41-49):

```tsx
            <div className="mb-2 border-b border-dashed border-black pb-2">
                <div className="font-bold text-center border-y border-black py-1 mb-1 uppercase">
                    {paymentMethod?.toUpperCase() === 'CHARGE' ? 'CHARGE INVOICE' : 'CASH INVOICE'}
                </div>
                <div className="font-bold">SI NO.: {formatSINumber(saleDetails.siNumber || saleDetails.orderNumber)}</div>
                <div>Cust: {customer?.name || 'Walk-in'}</div>
                <div>Cashier: {saleDetails.cashierName || 'Admin'}</div>
                {saleDetails.terminalName && <div>Terminal: {saleDetails.terminalName}</div>}
            </div>
```

Insert a watermark block between the `SI NO.` line and the `Cust:` line, matching the ESC/POS insertion point from Task 1 (after SI NO., before Cust):

```tsx
            <div className="mb-2 border-b border-dashed border-black pb-2">
                <div className="font-bold text-center border-y border-black py-1 mb-1 uppercase">
                    {paymentMethod?.toUpperCase() === 'CHARGE' ? 'CHARGE INVOICE' : 'CASH INVOICE'}
                </div>
                <div className="font-bold">SI NO.: {formatSINumber(saleDetails.siNumber || saleDetails.orderNumber)}</div>
                {saleDetails.isReprint && (
                    <div className="text-center">
                        <div className="font-bold">*** REPRINT ***</div>
                        <div>Reprinted: {format(new Date(), 'PP p')}</div>
                    </div>
                )}
                <div>Cust: {customer?.name || 'Walk-in'}</div>
                <div>Cashier: {saleDetails.cashierName || 'Admin'}</div>
                {saleDetails.terminalName && <div>Terminal: {saleDetails.terminalName}</div>}
            </div>
```

`format` from `date-fns` is already imported at the top of this file (`app/(app)/pos/receipt/ReceiptView.tsx:4`) — no new import needed.

- [ ] **Step 4: Thread `isReprint` through `ReceiptPrintView` (Recent Sales reprint path)**

In `app/(app)/pos/recent-sales/ReceiptPrintView.tsx`, add an `isReprint` prop and forward it into the mapped `saleDetails`:

```tsx
interface ReceiptPrintViewProps {
  sale: Sale;
  onBack: () => void;
  onPrint: () => void;
  settings?: SystemSettings | null;
  isReprint?: boolean;
}

export function ReceiptPrintView({
  sale,
  onBack,
  onPrint,
  settings,
  isReprint
}: ReceiptPrintViewProps) {
  const saleDetails = { ...mapSaleToReceiptDetails(sale), isReprint };

  return (
    <div className="flex flex-col h-full">
      <div className="flex justify-between items-center mb-4 non-printable">
        <Button variant="outline" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to List
        </Button>
        <Button onClick={onPrint}>
          <Printer className="mr-2 h-4 w-4" />
          Print Receipt
        </Button>
      </div>

      <div className="printable-area bg-white p-4 shadow-sm mx-auto">
        <ReceiptView saleDetails={saleDetails} settings={settings} />
      </div>
    </div>
  );
}
```

In `app/(app)/pos/recent-sales/use-recent-sales.ts`, the `handlePrintReceiptAction` browser branch (lines 160-181) currently reads:

```ts
  const handlePrintReceiptAction = useCallback(async (sale: Sale) => {
    if (printMode === 'browser') {
      try {
        const { printReactComponent } = await import('@/app/lib/print-utils');
        const React = await import('react');
        const { ReceiptPrintView } = await import('./ReceiptPrintView');
        printReactComponent(
          React.createElement(ReceiptPrintView, {
            sale,
            onBack: () => {},
            onPrint: () => {},
            settings: posSettings
          }),
          '80mm'
        );
        return;
      } catch (e) {
        console.error('Browser print error:', e);
        window.print();
        return;
      }
    }
```

Change the `React.createElement` call to add `isReprint: true` — this branch is the Recent Sales reprint action, always a reprint context, exactly mirroring the ESC/POS branch a few lines below it (line 193) which already sets `isReprint: true`:

```ts
        printReactComponent(
          React.createElement(ReceiptPrintView, {
            sale,
            onBack: () => {},
            onPrint: () => {},
            settings: posSettings,
            isReprint: true
          }),
          '80mm'
        );
```

- [ ] **Step 5: Thread `isReprint` through `TenderDialog`'s hidden browser-print `ReceiptView`**

`TenderDialog.tsx`'s `handlePrintReceipt` already accepts an `isReprint` parameter (`const handlePrintReceipt = async (dataToPrint?: any, isReprint = false) => { ... }`), but in the `printMode === 'browser'` branch it just calls `handlePrint()` (the `useReactToPrint` hook instance, which takes no arguments) and returns — the flag never reaches the hidden `ReceiptView` at line 700 that `handlePrint()` actually prints, because that `ReceiptView` is rendered independently, always from `completedSale` with no reprint awareness.

Add a small piece of component state to carry the flag across that gap. Near the top of the component, alongside its other `useState` calls, add:

```ts
    const [isReprintPrint, setIsReprintPrint] = useState(false);
```

Change `handlePrintReceipt` (currently):

```ts
    const handlePrintReceipt = async (dataToPrint?: any, isReprint = false) => {
        const details = dataToPrint || completedSale;
        if (!details) return;

        if (printMode === 'browser') {
            handlePrint();
            return;
        }

        if (!isConnected) {
            const connected = await connect();
            if (!connected) return;
        }

        try {
            const generator = new ReceiptGenerator();
            const bytes = generator.generateReceipt({ ...details, isReprint }, settings);
            await print(bytes);
        } catch (e) {
            console.error("Printing error", e);
        }
    };
```

to:

```ts
    const handlePrintReceipt = async (dataToPrint?: any, isReprint = false) => {
        const details = dataToPrint || completedSale;
        if (!details) return;

        if (printMode === 'browser') {
            setIsReprintPrint(isReprint);
            handlePrint();
            return;
        }

        if (!isConnected) {
            const connected = await connect();
            if (!connected) return;
        }

        try {
            const generator = new ReceiptGenerator();
            const bytes = generator.generateReceipt({ ...details, isReprint }, settings);
            await print(bytes);
        } catch (e) {
            console.error("Printing error", e);
        }
    };
```

Then change the hidden `ReceiptView` (currently `app/(app)/pos/tender/TenderDialog.tsx:700`):

```tsx
                    {completedSale && <ReceiptView ref={receiptRef} saleDetails={completedSale} settings={settings} />}
```

to read the new state:

```tsx
                    {completedSale && <ReceiptView ref={receiptRef} saleDetails={{ ...completedSale, isReprint: isReprintPrint }} settings={settings} />}
```

This matches the existing call pattern at `handleConfirmPrint` (`TenderDialog.tsx:190,197`): the first `handlePrintReceipt(completedSale)` call (original, `isReprint` defaults to `false`) resets the flag to `false` before printing; the optional second-copy call `handlePrintReceipt(completedSale, true)` (when `settings?.printTwoReceipts` is on) sets it to `true` for that duplicate. This is consistent with how the ESC/POS branch already treats a "duplicate copy" as a reprint.

- [ ] **Step 6: Add the watermark to `ZReadingPreview`**

In `app/(app)/sales/z-reading/z-reading-preview.tsx`, no new prop is needed — `data.id` is already passed in and is exactly the signal used in Task 2's `ZReadingDialog.tsx` (`data.id !== 'PREVIEW'`). The title section currently reads (lines 167-169):

```tsx
      <div style={styles.sectionTitle}>
        <div>Z-READING REPORT</div>
      </div>
```

Insert the watermark immediately after, before the date section (line 171):

```tsx
      <div style={styles.sectionTitle}>
        <div>Z-READING REPORT</div>
      </div>

      {data.id !== 'PREVIEW' && (
        <div style={{ textAlign: 'center' as const }}>
          <div style={{ fontWeight: 'bold' }}>*** REPRINT ***</div>
          <div>Reprinted: {format(new Date(), 'PP p')}</div>
        </div>
      )}
```

`format` from `date-fns` is already imported at the top of this file — confirm the import exists (grep for `from 'date-fns'` near the top of `z-reading-preview.tsx`) before adding the watermark; if for some reason it's a different import, use the existing bound name instead of adding a duplicate import.

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx tsx tests/unit/reprint-watermark-browser.test.ts`
Expected: PASS, prints both `✓ reprint-watermark-browser (ReceiptView)` and `✓ reprint-watermark-browser (ZReadingPreview)`

- [ ] **Step 8: Register the test in the suite runner**

In `tests/unit/run.ts`, add after the `import './z-reading-discount-summary.test';` line added in Task 3:

```ts
import './reprint-watermark-browser.test';
```

- [ ] **Step 9: Run the full unit suite and typecheck**

Run: `npm run test:unit`
Expected: All tests pass, including all tests from Tasks 1-3.

Run: `npm run typecheck`
Expected: No new errors. In particular, confirm `ReceiptPrintViewProps.isReprint` and `ReceiptViewProps.saleDetails.isReprint` are both optional so no existing caller (e.g. `ReceiptActionView`, the print-prompt preview at `TenderDialog.tsx:354`, both of which render `ReceiptView`/pass no `isReprint`) breaks.

- [ ] **Step 10: Commit**

```bash
git add "app/(app)/pos/receipt/receipt-types.ts" "app/(app)/pos/receipt/ReceiptView.tsx" "app/(app)/pos/recent-sales/ReceiptPrintView.tsx" "app/(app)/pos/recent-sales/use-recent-sales.ts" "app/(app)/pos/tender/TenderDialog.tsx" "app/(app)/sales/z-reading/z-reading-preview.tsx" tests/unit/reprint-watermark-browser.test.ts tests/unit/run.ts
git commit -m "feat(receipts): print REPRINT watermark on browser-printed reprints

Tasks 1-2 added a REPRINT watermark to the ESC/POS thermal-printer
receipt and Z-reading paths, but printMode defaults to 'browser' when
unset in settings (PosDialogs.tsx), and that path renders through a
separate React component tree (ReceiptView, ZReadingPreview via
react-to-print/printReactComponent) that had no REPRINT concept at
all. Found during the final whole-branch review of Tasks 1-3; mirrors
the same watermark wording into both components so BIR Annex F
checklist items #12 and #15 are satisfied regardless of print mode.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Final Verification

- [ ] **Step 1: Run the full unit test suite one more time**

Run: `npm run test:unit`
Expected: All tests pass, including the four new/modified test files from this plan.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: No new errors introduced by this plan's changes.

- [ ] **Step 3: Manual smoke test (per spec's Testing section, extended to cover both print modes)**

Since this touches printed receipt output, do a manual pass if a printer or the browser-print preview is available. Repeat steps 1-4 once with `printMode` set to `'native'`/`'escpos'` (exercises Tasks 1-3) and once with `printMode` set to `'browser'` or left unset (exercises Task 4):
1. Ring up a sale, tender cash, print the receipt — confirm no "REPRINT" text appears and (in ESC/POS mode) the drawer still kicks.
2. Reprint that sale from Recent Sales — confirm "*** REPRINT ***" and a "Reprinted: <date/time>" line appear near the top, and (in ESC/POS mode) the drawer does NOT kick again.
3. Run a shift with at least one Senior Citizen/PWD discount and one voided sale, then finalize the Z-reading — confirm the printed DISCOUNT SUMMARY shows the real SC/PWD amounts (not 0.00) and the VOID line shows the real void total. (This is ESC/POS-only, Task 3; no browser-mode equivalent needed since `generateZReadingReceipt()` has no browser counterpart.)
4. Reopen that same finalized Z-reading from history and print it again via `ZReadingDialog` — confirm "*** REPRINT ***" now appears (it didn't on the finalize-time print in step 3).
