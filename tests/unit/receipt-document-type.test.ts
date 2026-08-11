import assert from 'node:assert/strict';
import { ReceiptGenerator } from '../../lib/receipt-generator';

// Goods sales print as a Sales Invoice (existing si_number, no cash/charge
// distinction in the title per this batch's design); services sales print
// as an Official Receipt using the new birOrNumber field.

const decode = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1');

const baseSale = {
  items: [{ name: 'Rice', price: 100, quantity: 1, discount: 0, taxType: 'VAT' } as any],
  customer: null,
  totalDue: 100,
  change: 0,
  paymentMethod: 'CASH',
};

const gen = new ReceiptGenerator();

// ─── goods sale: SALES INVOICE, SI NO. ───────────────────────────────────
const goodsSale = decode(gen.generateReceipt({ ...baseSale, siNumber: '000123' }, null));
assert.ok(goodsSale.includes('SALES INVOICE'), 'goods sale title is SALES INVOICE');
assert.ok(!goodsSale.includes('OFFICIAL RECEIPT'), 'goods sale is not titled OFFICIAL RECEIPT');
assert.ok(goodsSale.includes('SI NO.: 000123'), 'goods sale prints SI NO. with the si_number');
assert.ok(!goodsSale.includes('OR NO.'), 'goods sale does not print an OR NO. line');

// ─── goods sale, CHARGE payment: still SALES INVOICE (no cash/charge split) ──
const chargeSale = decode(gen.generateReceipt({ ...baseSale, paymentMethod: 'CHARGE', siNumber: '000124' }, null));
assert.ok(chargeSale.includes('SALES INVOICE'), 'charge payment does not change the SALES INVOICE title');
assert.ok(!chargeSale.includes('CHARGE INVOICE'), 'old CHARGE INVOICE title no longer appears');

// ─── services sale: OFFICIAL RECEIPT, OR NO. ─────────────────────────────
const servicesSale = decode(gen.generateReceipt({ ...baseSale, birOrNumber: 'OR-000045' }, null));
assert.ok(servicesSale.includes('OFFICIAL RECEIPT'), 'services sale title is OFFICIAL RECEIPT');
assert.ok(!servicesSale.includes('SALES INVOICE'), 'services sale is not titled SALES INVOICE');
assert.ok(servicesSale.includes('OR NO.: OR-000045'), 'services sale prints OR NO. with the bir_or_number');
assert.ok(!servicesSale.includes('SI NO.'), 'services sale does not print a SI NO. line');

console.log('✓ receipt-document-type');
