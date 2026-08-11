import assert from 'node:assert/strict';
import { ReceiptGenerator } from '../../lib/receipt-generator';
import { ZReadingGenerator } from '../../lib/z-reading-generator';

// Z-reading must print a distinct Beg./End. OR # range alongside the
// existing Beg./End. SI # range (and their VOID/RETURN counterparts), never
// combining the goods (si_number) and services (bir_or_number) BIR
// numbering series into one MIN/MAX. Both the ESC/POS path
// (generateZReadingReceipt) and the browser/reprint path
// (ZReadingGenerator.generate) must agree.

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
  minSaleOrId: '000010',
  maxSaleOrId: '000012',
  minVoidId: '000200',
  maxVoidId: '000201',
  minVoidOrId: '000020',
  maxVoidOrId: '000021',
  minReturnId: '000300',
  maxReturnId: '000301',
  minReturnOrId: '000030',
  maxReturnOrId: '000031',
  discountSummary: [],
};

// ─── ESC/POS path: lib/receipt-generator.ts generateZReadingReceipt() ────
const receiptGen = new ReceiptGenerator();
const printed = decode(receiptGen.generateZReadingReceipt(zData, null));

assert.ok(printed.includes('Beg. SI #:') && printed.includes('100'), 'SI sale range still prints (unchanged)');
assert.ok(printed.includes('End. SI #:') && printed.includes('105'), 'SI sale range still prints (unchanged)');
assert.ok(printed.includes('Beg. OR #:') && printed.includes('10'), 'OR sale range prints alongside SI range');
assert.ok(printed.includes('End. OR #:') && printed.includes('12'), 'OR sale range prints alongside SI range');
assert.ok(printed.includes('Beg. VOID OR #:') && printed.includes('End. VOID OR #:'), 'VOID OR range prints');
assert.ok(printed.includes('Beg. RETURN OR #:') && printed.includes('End. RETURN OR #:'), 'RETURN OR range prints');

// SI and OR ranges must never be blended into a single figure: the sale
// range's SI values and OR values must be distinctly present, not merged.
// (ESC/POS path strips leading zeros via stripLead(), so '000100' -> '100'.)
assert.ok(printed.includes('100'), 'SI min sale id present (leading zeros stripped by ESC/POS path)');
assert.ok(printed.includes('10'), 'OR min sale id present, distinct from SI');

// ─── Browser/reprint path: lib/z-reading-generator.ts ZReadingGenerator ──
const browserGen = new ZReadingGenerator();
const browserPrinted = decode(browserGen.generate(zData, null));

assert.ok(browserPrinted.includes('Beg. SI #:') && browserPrinted.includes('000100'), 'browser path: SI range prints');
assert.ok(browserPrinted.includes('End. SI #:') && browserPrinted.includes('000105'), 'browser path: SI range prints');
assert.ok(browserPrinted.includes('Beg. OR #:') && browserPrinted.includes('000010'), 'browser path: OR range prints');
assert.ok(browserPrinted.includes('End. OR #:') && browserPrinted.includes('000012'), 'browser path: OR range prints');
assert.ok(browserPrinted.includes('Beg. VOID OR #:') && browserPrinted.includes('000020'), 'browser path: VOID OR range prints');
assert.ok(browserPrinted.includes('End. VOID OR #:') && browserPrinted.includes('000021'), 'browser path: VOID OR range prints');
assert.ok(browserPrinted.includes('Beg. RETURN OR #:') && browserPrinted.includes('000030'), 'browser path: RETURN OR range prints');
assert.ok(browserPrinted.includes('End. RETURN OR #:') && browserPrinted.includes('000031'), 'browser path: RETURN OR range prints');

// ─── Wording parity between the two print paths ─────────────────────────
for (const label of ['Beg. OR #:', 'End. OR #:', 'Beg. VOID OR #:', 'End. VOID OR #:', 'Beg. RETURN OR #:', 'End. RETURN OR #:']) {
  assert.ok(printed.includes(label), `ESC/POS path uses label "${label}"`);
  assert.ok(browserPrinted.includes(label), `browser path uses matching label "${label}"`);
}

// ─── defaults: missing OR fields fall back safely, no crash ─────────────
const { minSaleOrId, maxSaleOrId, minVoidOrId, maxVoidOrId, minReturnOrId, maxReturnOrId, ...withoutOr } = zData;
const noOrPrinted = decode(receiptGen.generateZReadingReceipt(withoutOr, null));
assert.ok(noOrPrinted.includes('Beg. OR #:'), 'OR label still prints even when OR fields are absent');
const noOrBrowserPrinted = decode(browserGen.generate(withoutOr, null));
assert.ok(noOrBrowserPrinted.includes('Beg. OR #:') && noOrBrowserPrinted.includes('000000'), 'browser path defaults absent OR fields to 000000');

console.log('✓ z-reading-or-range');
