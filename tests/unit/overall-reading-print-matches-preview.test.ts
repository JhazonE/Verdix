// The Overall Reading thermal print must carry the same sections as the POS
// preview (OverallReadingReceipt.tsx) and follow the paper size setting.
// It used to print only the header + terminal/cashier tables at a fixed 32 cols.
import assert from 'node:assert/strict';
import { OverallReadingGenerator } from '../../lib/overall-reading-generator';

const decode = (b: Uint8Array) => Buffer.from(b).toString('latin1');
const longestDash = (s: string) => Math.max(...(s.match(/-+/g) || ['']).map(m => m.length));

const data: any = {
  terminalId: 'T1', terminalName: 'Counter 1',
  startDate: '2026-11-16T08:00:00', endDate: '2026-11-16T20:00:00',
  grossSales: 1200, netSales: 1000, totalDiscounts: 50, transactionCount: 7,
  vatSales: 892.86, vatAmount: 107.14, vatExempt: 0, zeroRated: 0, nonVat: 0,
  voidAmount: 100, voidCount: 1, returnAmount: 50, returnCount: 1, vatAdjustment: 0,
  startingCash: 500, cashSales: 800, cashInDrawer: 1300, actualCash: 1300, variance: 0,
  paymentMethods: [{ name: 'Cash', amount: 800 }, { name: 'GCash', amount: 200 }],
  discountSummary: [], salesAdjustment: { void: { count: 1, amount: 100 }, return: { count: 1, amount: 50 } },
  terminals: [{ terminalId: 'T1', terminalName: 'Counter 1', netSales: 1000, transactionCount: 7 },
              { terminalId: 'T2', terminalName: 'Idle Till', netSales: 0, transactionCount: 0 }],
  cashiers: [{ cashierId: 'c1', cashierName: 'Ana', netSales: 1000, transactionCount: 7 }],
  businessSettings: { businessName: 'Test Store', address: 'Cebu', tin: '000-111-222-000', contactNumber: '' },
  terminalInfo: { min: 'MIN123', sn: 'SN456' },
};

const p58 = decode(new OverallReadingGenerator().generate(data));
const p80 = decode(new OverallReadingGenerator().generate(data, '80mm'));

for (const section of ['SUMMARY', 'GROSS SALES:', 'NET SALES:', 'TRANSACTIONS:', 'RETURNS (1):', 'VOIDS (1):', 'DISCOUNTS:',
  'PAYMENT METHODS', 'GCASH:', 'VAT BREAKDOWN', 'VATable Sales:', 'CASH SUMMARY', 'Expected in Drawer:',
  'TERMINAL BREAKDOWN', 'CASHIER BREAKDOWN', 'End of Overall Reading Report']) {
  assert.ok(p58.includes(section), `58mm print is missing "${section}"`);
  assert.ok(p80.includes(section), `80mm print is missing "${section}"`);
}

// Zero-activity terminals are hidden in the preview, so the print hides them too.
assert.ok(!p58.includes('IDLE TILL'), 'idle terminal should not print');

assert.equal(longestDash(p58), 32, '58mm should be 32 wide');
assert.equal(longestDash(p80), 48, '80mm should be 48 wide');

console.log('✓ overall-reading-print-matches-preview');
