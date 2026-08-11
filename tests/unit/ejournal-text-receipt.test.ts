import assert from 'node:assert/strict';
import {
  renderSalesReceiptText,
  renderVoidSlipText,
  renderCreditSlipText,
  renderReadingText,
} from '../../lib/ejournal/text-receipt';
import type { EJSettings } from '../../lib/ejournal/types';

const settings: EJSettings = {
  businessName: 'My Store',
  tin: '123-456',
  minNumber: 'MIN99',
  serialNumber: 'SN77',
  paperSize: '58mm',
};

const sale = {
  siNumber: 2,
  birOrNumber: null,
  cashierName: 'Ana',
  customerName: 'Walk-in',
  dateTime: '2026-07-21T10:00:00.000Z',
  paymentMethod: 'CASH',
  items: [{ name: 'TEST', quantity: 1, price: 100 }],
  total: 100,
  vatAmount: 10.71,
};

const salesTxt = renderSalesReceiptText(sale, settings);
assert.ok(salesTxt.includes('My Store'), 'sales receipt shows business name');
assert.ok(salesTxt.includes('SALES INVOICE'), 'goods sale (no birOrNumber) is titled SALES INVOICE');
assert.ok(!salesTxt.includes('OFFICIAL RECEIPT'), 'goods sale is not titled OFFICIAL RECEIPT');
assert.ok(salesTxt.includes('SI NO.: 000002'), 'sales receipt shows formatted SI');
assert.ok(!salesTxt.includes('OR NO.'), 'goods sale does not print an OR NO. line');
assert.ok(salesTxt.includes('TEST'), 'sales receipt shows item');
assert.ok(salesTxt.includes('100.00'), 'sales receipt shows amount');

// ─── services sale (birOrNumber set): OFFICIAL RECEIPT, OR NO. ───────────
const servicesSale = { ...sale, siNumber: null, birOrNumber: 'OR-000045' };
const servicesTxt = renderSalesReceiptText(servicesSale, settings);
assert.ok(servicesTxt.includes('OFFICIAL RECEIPT'), 'services sale (birOrNumber set) is titled OFFICIAL RECEIPT');
assert.ok(!servicesTxt.includes('SALES INVOICE'), 'services sale is not titled SALES INVOICE');
assert.ok(servicesTxt.includes('OR NO.: OR-000045'), 'services sale prints OR NO. with the birOrNumber value');
assert.ok(!servicesTxt.includes('SI NO.'), 'services sale does not print a SI NO. line');

const voidTxt = renderVoidSlipText({ ...sale, voidReason: 'wrong item' }, settings);
assert.ok(voidTxt.includes('VOID SLIP'), 'void slip title');
assert.ok(voidTxt.includes('wrong item'), 'void slip shows reason');
assert.ok(voidTxt.includes('SI NO.: 000002'), 'void slip shows SI');

const creditTxt = renderCreditSlipText(
  { creditSiNumber: 5, originalSiNumber: 2, dateTime: sale.dateTime, items: sale.items, total: 100 },
  settings,
);
assert.ok(creditTxt.includes('MERCHANDISE CREDIT'), 'credit slip title');
assert.ok(creditTxt.includes('SI NO.: 000005'), 'credit slip shows its SI');
assert.ok(creditTxt.includes('000002'), 'credit slip shows original SI');

const readingTxt = renderReadingText(
  { readingNumber: 1, type: 'Z', reportDate: '2026-07-21', grossSales: 100, returns: 0, discounts: 0, netSales: 100, vatAmount: 10.71, transactionCount: 1 },
  settings,
);
assert.ok(readingTxt.includes('Z-READING'), 'reading shows type');
assert.ok(readingTxt.includes('100.00'), 'reading shows gross');
