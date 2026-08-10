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
