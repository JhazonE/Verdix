import assert from 'node:assert/strict';
import { ReceiptGenerator } from '../../lib/receipt-generator';
import { ZReadingGenerator } from '../../lib/z-reading-generator';

// Z-reading must print a distinct Beg./End. OR # range alongside the
// existing Beg./End. SI # range (and their VOID/RETURN counterparts), never
// combining the goods (si_number) and services (bir_or_number) BIR
// numbering series into one MIN/MAX. Both the ESC/POS path
// (generateZReadingReceipt) and the browser/reprint path
// (ZReadingGenerator.generate) must agree.
//
// bir_or_number (see getNextBirOrNumber() in lib/mysql.ts) is stored with an
// "OR-" prefix baked into the value itself (e.g. "OR-000045"), unlike
// si_number which is a bare zero-padded digit string — so real OR-range
// values arrive already prefixed, and the empty/no-range default must also
// carry the prefix ('OR-000000') to stay distinguishable in its own right,
// per the brief.

const decode = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1');

const zData: any = {
  reportDate: new Date('2026-08-11T18:00:00'),
  netSales: 1000,
  previousReading: 0,
  vatSales: 892.86,
  vatAmount: 107.14,
  vatExempt: 0,
  zeroRated: 0,
  grossSales: 1000,
  discounts: 0,
  returns: 0,
  voidAmount: 0,
  vatAdjustment: 0,
  paymentMethods: [{ name: 'CASH', amount: 1000 }],
  startingCash: 0,
  minSaleId: '000100',
  maxSaleId: '000105',
  minSaleOrId: 'OR-000010',
  maxSaleOrId: 'OR-000012',
  minVoidId: '000200',
  maxVoidId: '000201',
  minVoidOrId: 'OR-000020',
  maxVoidOrId: 'OR-000021',
  minReturnId: '000300',
  maxReturnId: '000301',
  minReturnOrId: 'OR-000030',
  maxReturnOrId: 'OR-000031',
  discountSummary: [],
};

// ─── ESC/POS path: lib/receipt-generator.ts generateZReadingReceipt() ────
const receiptGen = new ReceiptGenerator();
const printed = decode(receiptGen.generateZReadingReceipt(zData, null));

assert.ok(printed.includes('Beg. SI #:') && printed.includes('100'), 'SI sale range still prints (unchanged)');
assert.ok(printed.includes('End. SI #:') && printed.includes('105'), 'SI sale range still prints (unchanged)');
assert.ok(printed.includes('Beg. OR #:') && printed.includes('OR-000010'), 'OR sale range prints alongside SI range, prefix intact');
assert.ok(printed.includes('End. OR #:') && printed.includes('OR-000012'), 'OR sale range prints alongside SI range, prefix intact');
assert.ok(printed.includes('Beg. VOID OR #:') && printed.includes('OR-000020'), 'VOID OR range prints, prefix intact');
assert.ok(printed.includes('End. VOID OR #:') && printed.includes('OR-000021'), 'VOID OR range prints, prefix intact');
assert.ok(printed.includes('Beg. RETURN OR #:') && printed.includes('OR-000030'), 'RETURN OR range prints, prefix intact');
assert.ok(printed.includes('End. RETURN OR #:') && printed.includes('OR-000031'), 'RETURN OR range prints, prefix intact');

// SI and OR ranges must never be blended into a single figure: the sale
// range's SI values and OR values must be distinctly present, not merged.
// (ESC/POS path strips leading zeros from bare-digit SI via stripLead(), so
// '000100' -> '100'; stripLead() is a no-op on the already-prefixed OR value
// since it doesn't start with '0'.)
assert.ok(printed.includes('100'), 'SI min sale id present (leading zeros stripped by ESC/POS path)');
assert.ok(printed.includes('OR-000010'), 'OR min sale id present verbatim, distinct from SI');

// ─── Browser/reprint path: lib/z-reading-generator.ts ZReadingGenerator ──
const browserGen = new ZReadingGenerator();
const browserPrinted = decode(browserGen.generate(zData, null));

assert.ok(browserPrinted.includes('Beg. SI #:') && browserPrinted.includes('000100'), 'browser path: SI range prints');
assert.ok(browserPrinted.includes('End. SI #:') && browserPrinted.includes('000105'), 'browser path: SI range prints');
assert.ok(browserPrinted.includes('Beg. OR #:') && browserPrinted.includes('OR-000010'), 'browser path: OR range prints, prefix intact');
assert.ok(browserPrinted.includes('End. OR #:') && browserPrinted.includes('OR-000012'), 'browser path: OR range prints, prefix intact');
assert.ok(browserPrinted.includes('Beg. VOID OR #:') && browserPrinted.includes('OR-000020'), 'browser path: VOID OR range prints, prefix intact');
assert.ok(browserPrinted.includes('End. VOID OR #:') && browserPrinted.includes('OR-000021'), 'browser path: VOID OR range prints, prefix intact');
assert.ok(browserPrinted.includes('Beg. RETURN OR #:') && browserPrinted.includes('OR-000030'), 'browser path: RETURN OR range prints, prefix intact');
assert.ok(browserPrinted.includes('End. RETURN OR #:') && browserPrinted.includes('OR-000031'), 'browser path: RETURN OR range prints, prefix intact');

// ─── Wording parity between the two print paths ─────────────────────────
for (const label of ['Beg. OR #:', 'End. OR #:', 'Beg. VOID OR #:', 'End. VOID OR #:', 'Beg. RETURN OR #:', 'End. RETURN OR #:']) {
  assert.ok(printed.includes(label), `ESC/POS path uses label "${label}"`);
  assert.ok(browserPrinted.includes(label), `browser path uses matching label "${label}"`);
}

// ─── defaults: missing OR fields fall back to the OR-specific empty marker,
// not the bare '000000' the SI side uses — no crash, and the empty OR range
// stays visually distinguishable (by label AND by its own 'OR-' marker) from
// an empty SI range. ─────────────────────────────────────────────────────
const { minSaleOrId, maxSaleOrId, minVoidOrId, maxVoidOrId, minReturnOrId, maxReturnOrId, ...withoutOr } = zData;

const noOrPrinted = decode(receiptGen.generateZReadingReceipt(withoutOr, null));
assert.ok(noOrPrinted.includes('Beg. OR #:'), 'OR label still prints even when OR fields are absent');
assert.ok(noOrPrinted.includes('OR-000000'), 'ESC/POS path defaults absent OR fields to OR-000000, not bare 000000');

const noOrBrowserPrinted = decode(browserGen.generate(withoutOr, null));
assert.ok(noOrBrowserPrinted.includes('Beg. OR #:'), 'browser path: OR label still prints even when OR fields are absent');
assert.ok(noOrBrowserPrinted.includes('OR-000000'), 'browser path defaults absent OR fields to OR-000000, not bare 000000');

console.log('✓ z-reading-or-range');
