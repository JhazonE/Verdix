# BIR Annex F Compliance — Batch 1: Reprint Watermarks & Z-Reading Discount Bug

Date: 2026-08-10
Status: Approved
Related: BIR RMO 24-2023 Annex F "Functional and Technical Evaluation Checklist" audit (items #12, #15, and a bug found in #14's implementation)

## Context

An audit of Verdix POS against the BIR Annex F accreditation checklist found three related gaps, all inside the receipt-printing layer:

1. **Item #12** — Reprinted sale receipts must show the word "REPRINT" and the date/time of reprinting on the face of the document. `isReprint` is already threaded through the sale-receipt code (`lib/receipt-generator.ts`), but it currently has exactly one effect: suppressing the cash-drawer kick (`saleOpensDrawer()`). No visual/textual watermark exists.
2. **Item #15** — Same requirement, but for reprinted Z-Reading/EOD reports.
3. **A correctness bug inside item #14** (X/Z-Reading reports) — the Z-Reading receipt printed from the "Print & Finalize Shift" flow hardcodes its SC/PWD/NAAC/Solo Parent discount summary and its VOID adjustment amount to `'0.00'`, even though the underlying API already computes and sends the correct values. The printed paper report understates statutory discount breakdowns, which is exactly the data a BIR examiner would check.

### Key discovery: two independent Z-Reading print paths

There are two separate generators that both render a Z-Reading receipt, and they are not kept in sync:

- **`generateZReadingReceipt()`** in `lib/receipt-generator.ts:543` — used only by `app/(app)/pos/z-reading/ZReadingReportView.tsx:59`, wired to the "Print Z-Reading & Finalize Shift" button. This is a one-shot commit-and-print — it always finalizes a *new* Z-reading and is never used to reprint a past one. **This is where the hardcoded-zero bug lives.**
- **`ZReadingGenerator.generate()`** in `lib/z-reading-generator.ts:31` — used only by `app/(app)/pos/z-reading-report/ZReadingDialog.tsx:90-92`. This dialog is the actual reprint path: when it's handed a historical reading (`data.id !== 'PREVIEW'`), it prints without recommitting to the database. **This generator already buckets `discountSummary` correctly** (`z-reading-generator.ts:117-138`) and already has real void amount (`data.salesAdjustment?.void.amount`) — it is the reference implementation for the discount-bucketing fix, and it is the correct location for the REPRINT watermark, since it's the only Z-reading path that is ever actually a reprint.

## Goals

1. Add a REPRINT watermark (bold "*** REPRINT ***" line + reprint timestamp) to sale receipts when `isReprint` is true.
2. Add the same watermark treatment to `ZReadingGenerator.generate()`, driven by whether the Z-reading being printed is historical (`data.id !== 'PREVIEW'`) rather than a fresh finalize.
3. Fix `generateZReadingReceipt()`'s DISCOUNT SUMMARY and VOID lines to consume real data instead of hardcoded zeros, using the same bucketing logic already proven in `ZReadingGenerator`.

## Non-goals

- No database schema changes. Reprint timestamp is render-time only (`new Date()` at the moment of reprinting), not persisted — a full reprint audit trail is separate, already-tracked work (activity/audit log gap).
- No fix to the `generateZReadingReceipt()` VAT ADJUSTMENT section (SC TRANS / PWD TRANS / REG.Disc TRANS / ZERO-RATED TRANS / VAT on Return) — these placeholders stay `'0.00'`. No per-transaction VAT-impact aggregation exists yet to feed them correctly; wiring fake-but-nonzero numbers would be worse than an honest zero. Flagged as a follow-up.
- No consolidation of the two Z-reading generators into one. They stay separate; each gets fixed at its own call site.
- `generateZReadingReceipt()` itself does not gain a reprint watermark — it has no reprint concept and no reprint entry point today, so adding one there would be dead code.

## Design

### 1. Sale receipt REPRINT watermark

File: `lib/receipt-generator.ts`, inside `generateReceipt()`.

Insertion point: immediately after the bold `SI NO.:` line (current line ~183) and before the dashed separator (current line ~189) — the natural "banner" slot already used for the CASH/CHARGE INVOICE title.

```
if (sale.isReprint) {
    enc.raw([0x1b, 0x61, 0x31]); // Native Center
    enc.bold(true).line('*** REPRINT ***').bold(false);
    enc.line(`Reprinted: ${format(new Date(), 'PP p')}`);
    enc.raw([0x1b, 0x61, 0x30]); // Native Left
}
```

Uses the existing `format` import (date-fns) and the same ESC/POS center/left raw-command idiom already used for the title block a few lines above. No new call-site wiring needed — `isReprint` is already passed correctly from both places that matter:
- `app/(app)/pos/tender/TenderDialog.tsx:139-155` — `handlePrintReceipt(dataToPrint?, isReprint = false)`, explicit reprint calls pass `true`.
- `app/(app)/pos/recent-sales/use-recent-sales.ts:193` — always `isReprint: true` (this is the recent-sales reprint button).

### 2. Z-Reading REPRINT watermark

Files: `lib/z-reading-generator.ts` (generator), `app/(app)/pos/z-reading-report/ZReadingDialog.tsx` (call site).

`ZReadingGenerator.generate()` gains an `isReprint?: boolean` second concern — pass it as part of the existing `data`/`settings` call, or as an explicit third argument; implementer's choice, but keep the public signature additive (existing callers unaffected by default `false`).

`ZReadingDialog.tsx:91` changes from:
```ts
const bytes = generator.generate({ ...data, terminalName } as any, businessSettings);
```
to pass whether this is a historical (already-finalized) reading:
```ts
const isReprint = data.id !== 'PREVIEW';
const bytes = generator.generate({ ...data, terminalName } as any, businessSettings, isReprint);
```

Insertion point inside `generate()`: right after the TITLE section (current line ~68, after `enc.raw([0x1b, 0x61, 0x30])` following `Z-READING REPORT`), same watermark pattern as the sale receipt:

```
if (isReprint) {
    enc.align('center');
    enc.bold(true).line('*** REPRINT ***').bold(false);
    enc.line(`Reprinted: ${format(new Date(), 'PP p')}`);
    enc.align('left');
}
```

### 3. Fix hardcoded zeros in `generateZReadingReceipt()`

File: `lib/receipt-generator.ts`, inside `generateZReadingReceipt()`.

**DISCOUNT SUMMARY** (currently lines 654-658) — replace the four hardcoded `'0.00'` rows with the same bucketing logic already working in `z-reading-generator.ts:117-132`:

```ts
const ds = data.discountSummary || [];
let scAmt = 0, pwdAmt = 0, naacAmt = 0, soloAmt = 0, otherAmt = 0;
ds.forEach((d: any) => {
    const type = d.type?.toLowerCase();
    if (type === 'senior') scAmt += d.amount;
    else if (type === 'pwd') pwdAmt += d.amount;
    else if (type === 'naac') naacAmt += d.amount;
    else if (type === 'solo_parent') soloAmt += d.amount;
    else otherAmt += d.amount;
});

enc.line(row('SC Disc. :',          fmt(scAmt)));
enc.line(row('PWD Disc. :',         fmt(pwdAmt)));
enc.line(row('NAAC Disc. :',        fmt(naacAmt)));
enc.line(row('Solo Parent Disc. :', fmt(soloAmt)));
enc.line(row('Other Disc. :',       fmt(otherAmt)));
```

`data.discountSummary` is already present in the payload passed from `ZReadingReportView.tsx:59` (sourced from `app/api/sales/z-reading/route.ts:378-383`, shape `Array<{type, amount, count, itemCount}>`) — no API change needed, purely a consumption fix.

**SALES ADJUSTMENT → VOID** (currently line 664) — replace hardcoded `'0.00'` with the already-populated field:
```ts
enc.line(row('VOID :', fmt(data.voidAmount || 0)));
```
`data.voidAmount` is already sent by the API (`route.ts:376, 691`), just previously unused here.

**Left unchanged:** VAT ADJUSTMENT section (lines 670-676) stays hardcoded per the non-goals above.

## Testing

- Manual: trigger a sale receipt reprint from Recent Sales — confirm "*** REPRINT ***" and timestamp appear, drawer does not kick.
- Manual: finalize a Z-reading (fresh, `data.id === 'PREVIEW'`) — confirm no REPRINT watermark, and confirm DISCOUNT SUMMARY / VOID lines now show real amounts when a shift includes SC/PWD/NAAC/Solo Parent discounts and a voided sale.
- Manual: reopen a historical Z-reading and print it via `ZReadingDialog` — confirm REPRINT watermark now appears.
- Existing unit tests (`tests/unit/receipt-si-number.test.ts`, `tests/unit/drawer-kick.test.ts`) must continue passing; `drawer-kick.test.ts:97` already exercises `isReprint: true` for drawer suppression and should be unaffected by the new watermark logic (different code path).
