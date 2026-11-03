import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Cash DEPOSITS were aggregated, typed, persisted and sent to every renderer
// — and then displayed by none of them. The pickup half of the same
// cash_transfers fix got a WITHDRAWAL line and a "Less Withdrawal:" line on
// both readings; the deposit half got neither, on either reading.
//
// That is worse than it sounds, because a deposit is not cosmetic: both
// reports' expected-cash figure already adds it
//     cashInDrawer = startingCash + cashSales + ... + cashDeposit - cashPickup
// so a deposit silently RAISES the expected cash the cashier is measured
// against, with no line on the report saying where that money came from. A
// cashier handed a ₱5,000 float mid-shift sees their expected cash jump by
// ₱5,000 and nothing on the X-reading accounting for it — which reads as the
// report being broken, the exact complaint that surfaced this.
//
// Both figures must appear wherever the other does: a DEPOSIT line beside
// WITHDRAWAL (X-reading has that block; Z-reading has no WITHDRAWAL block, only
// the summary), and an "Add Deposit:" line beside "Less Withdrawal:" in the
// TRANSACTION SUMMARY of both, so the summary's arithmetic is readable:
//     Opening Fund + Add Deposit - Less Withdrawal
//
// Asserts on source text because these are JSX/encoder call sites, not pure
// functions, and the unit suite has no DB or renderer. Same approach as
// x-reading-cash-transfers.test.ts and z-reading-cash-transfers.test.ts.

const read = (rel: string) =>
  fs.readFileSync(path.join(__dirname, '../..', rel), 'utf-8');

const xPreview = read('app/(app)/sales/x-reading/x-reading-preview.tsx');
const xGenerator = read('lib/x-reading-generator.ts');
const zPreview = read('app/(app)/sales/z-reading/z-reading-preview.tsx');
const zGenerator = read('lib/z-reading-generator.ts');
const xRoute = read('app/api/sales/x-reading/route.ts');
const zRoute = read('app/api/sales/z-reading/route.ts');
const types = read('lib/types.ts');

// Comments in these files name the old broken behaviour to explain why it was
// wrong; matching that prose would pass on code that still has the bug. Strip
// comments first. CRLF files, so normalise before the `$`-anchored strip or the
// trailing \r defeats it. Block/JSX comments span lines, so they go first.
const stripComments = (src: string) =>
  src
    .replace(/\r\n/g, '\n')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '') // JSX {/* ... */}
    .replace(/\/\*[\s\S]*?\*\//g, '') // /* ... */
    .split('\n')
    .map((line) => line.replace(/--.*$/, '').replace(/\/\/.*$/, ''))
    .join('\n');

const renderers = {
  'X-reading preview': stripComments(xPreview),
  'X-reading printed report': stripComments(xGenerator),
  'Z-reading preview': stripComments(zPreview),
  'Z-reading printed report': stripComments(zGenerator),
};

// ─── the premise: the value really is available to every renderer ────────
// If a route stopped sending it, these display assertions would be asking a
// renderer to print a field that is always undefined.
assert.ok(
  /cashDeposit:\s*cashDeposit/.test(stripComments(xRoute)),
  'the X-reading route sends cashDeposit to its renderers',
);
assert.ok(
  /cashDeposit:\s*safeParseFloat\(cashDeposit\)/.test(stripComments(zRoute)) &&
    /cashDeposit:\s*safeParseFloat\(row\.cash_deposit\)/.test(stripComments(zRoute)),
  'the Z-reading route sends cashDeposit from both its live and filed-row paths',
);
assert.ok(
  /cashDeposit\??:\s*number/.test(types),
  'the shared types declare cashDeposit',
);

// ─── every renderer that shows a pickup must also show a deposit ─────────
for (const [name, src] of Object.entries(renderers)) {
  // Guard against a vacuous pass: if a renderer stopped showing the pickup
  // at all, "deposit appears too" would be trivially satisfiable by removing
  // both, which is not the fix.
  assert.ok(
    /cashPickup/.test(src),
    `${name} still renders cashPickup (the figure deposits must appear beside)`,
  );
  assert.ok(
    /cashDeposit/.test(src),
    `${name} renders cashDeposit — it was computed, typed, persisted and sent, ` +
      'then displayed nowhere, while silently raising the expected cash the ' +
      'cashier is measured against',
  );
}

// ─── the TRANSACTION SUMMARY arithmetic must be readable on both ─────────
// Opening Fund + Add Deposit - Less Withdrawal. The deposit line belongs
// beside the withdrawal line it offsets, not in a distant block.
for (const [name, src] of Object.entries(renderers)) {
  assert.ok(
    /Add Deposit/.test(src),
    `${name} labels the deposit "Add Deposit:" in the TRANSACTION SUMMARY, ` +
      'so Opening Fund + Add Deposit - Less Withdrawal reads as arithmetic',
  );
  // The two summary lines must be adjacent, so the reader can see the figure
  // that offsets the withdrawal without hunting for it.
  assert.ok(
    /Add Deposit[\s\S]{0,260}?Less Withdrawal/.test(src),
    `${name} places "Add Deposit:" immediately before "Less Withdrawal:"`,
  );
}

// ─── X-reading's standalone WITHDRAWAL block gets a DEPOSIT counterpart ──
// Only X-reading has this block above the summary (Z-reading never did), so
// this assertion is scoped to X-reading's two renderers.
for (const [name, src] of [
  ['X-reading preview', renderers['X-reading preview']],
  ['X-reading printed report', renderers['X-reading printed report']],
] as const) {
  assert.ok(
    /WITHDRAWAL/.test(src) && /DEPOSIT/.test(src),
    `${name} shows a DEPOSIT line beside its standalone WITHDRAWAL line`,
  );
}

console.log('✓ reading-cash-deposit-display');
