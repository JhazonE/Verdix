import assert from 'node:assert/strict';
import { XReadingGenerator } from '../../lib/x-reading-generator';

// X-reading must print a distinct Beg./End. OR # range alongside the
// existing Beg./End. SI # range, never combining the goods (si_number) and
// services (bir_or_number) BIR numbering series into one MIN/MAX. Unlike
// Z-reading, X-reading (shift-scoped) only tracks a single sales range — void
// and refund are plain totals, not ranges — so there is no VOID/RETURN OR
// counterpart to test here.
//
// bir_or_number (see getNextBirOrNumber() in lib/mysql.ts) is stored with an
// "OR-" prefix baked into the value itself (e.g. "OR-000045"), unlike
// si_number which is a bare zero-padded digit string — so real OR-range
// values arrive already prefixed, and the empty/no-range default must also
// carry the prefix ('OR-000000') to stay distinguishable in its own right,
// per the brief.
//
// Note: the pre-existing X-reading print paths mislabeled the SI range as
// "Beg./End. OR #:" (they printed minSaleId/maxSaleId — the SI series — under
// an OR label). This task corrects that label to "Beg./End. SI #:" and adds
// the genuine OR range as new "Beg./End. OR #:" rows, mirroring Z-reading's
// established SI/OR row pair.

const decode = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1');

const xData: any = {
  reportDate: new Date('2026-08-11T18:00:00'),
  shiftStart: new Date('2026-08-11T08:00:00'),
  shiftEnd: new Date('2026-08-11T18:00:00'),
  cashierName: 'Jane Cashier',
  startingCash: 0,
  cashInDrawer: 1000,
  overShort: 0,
  paymentMethods: [{ name: 'CASH', amount: 1000 }],
  minSaleId: '000100',
  maxSaleId: '000105',
  minSaleOrId: 'OR-000010',
  maxSaleOrId: 'OR-000012',
  voidAmount: 0,
  refundAmount: 0,
};

// ─── ESC/POS path: lib/x-reading-generator.ts XReadingGenerator.generate ──
const gen = new XReadingGenerator();
const printed = decode(gen.generate(xData));

assert.ok(printed.includes('Beg. SI #:') && printed.includes('000100'), 'SI sale range prints under the corrected SI label');
assert.ok(printed.includes('End. SI #:') && printed.includes('000105'), 'SI sale range prints under the corrected SI label');
assert.ok(printed.includes('Beg. OR #:') && printed.includes('OR-000010'), 'OR sale range prints alongside SI range, prefix intact');
assert.ok(printed.includes('End. OR #:') && printed.includes('OR-000012'), 'OR sale range prints alongside SI range, prefix intact');

// SI and OR ranges must never be blended into a single figure: both values
// must be distinctly present, not merged into one line.
assert.ok(printed.includes('000100') && printed.includes('OR-000010'), 'SI and OR min values both present, distinct from each other');

// ─── defaults: missing OR fields fall back to the OR-specific empty marker,
// not the bare '000000' the SI side uses — no crash, and the empty OR range
// stays visually distinguishable (by label AND by its own 'OR-' marker) from
// an empty SI range. ─────────────────────────────────────────────────────
const { minSaleOrId, maxSaleOrId, ...withoutOr } = xData;

const noOrPrinted = decode(gen.generate(withoutOr));
assert.ok(noOrPrinted.includes('Beg. OR #:'), 'OR label still prints even when OR fields are absent');
assert.ok(noOrPrinted.includes('OR-000000'), 'defaults absent OR fields to OR-000000, not bare 000000');
assert.ok(noOrPrinted.includes('Beg. SI #:') && noOrPrinted.includes('000100'), 'SI range still prints unaffected when OR fields are absent');

console.log('✓ x-reading-or-range');
