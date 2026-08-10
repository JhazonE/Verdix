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
