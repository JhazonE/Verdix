import assert from 'node:assert/strict';
import { buildSalesPayload } from '../../lib/integrations/sta-lucia/payload';
import type { ZReadingLike } from '../../lib/integrations/sta-lucia/types';

const base: ZReadingLike = {
  id: 'Z-000001',
  reportDate: '2026-07-31 18:30:00',
  grossSales: 1700,
  netSales: 1530,
  discounts: 170,
  vatSales: 900,
  vatAmount: 108,
  vatExempt: 100,
  nonVat: 200,
  transactionCount: 42,
  cashSales: 200,
  paymentMethods: [
    { name: 'CASH', amount: 200 },
    { name: 'GCash', amount: 800 },
    { name: 'Credit Card', amount: 530 },
  ],
};

// --- full field mapping ---
const p = buildSalesPayload(base);
assert.equal(p.gross_sales, 1700, 'gross_sales maps straight through');
assert.equal(p.net_sales, 1530, 'net_sales maps straight through');
assert.equal(p.vat_sales, 900, 'vat_sales from vatSales');
assert.equal(p.vat_amount, 108, 'vat_amount from vatAmount');
assert.equal(p.vat_exempt_sales, 100, 'vat_exempt_sales from vatExempt');
assert.equal(p.non_vat_sales, 200, 'non_vat_sales from nonVat');
assert.equal(p.number_of_transactions, 42, 'transaction count maps');
assert.equal(p.other_taxes, 0, 'other_taxes is always 0 — Verdix models no tax beyond VAT');

// --- credit/debit split: credit = non-cash tender, debit = cash tender ---
assert.equal(p.debit, 200, 'debit is cash tender');
assert.equal(p.credit, 1330, 'credit is the sum of every non-CASH tender (800 + 530)');

// --- date formatting ---
assert.equal(p.date_time, '2026-07-31 18:30:00', 'date_time uses yyyy-MM-dd HH:mm:ss');
assert.equal(
  buildSalesPayload({ ...base, reportDate: new Date(2026, 0, 5, 9, 7, 3) }).date_time,
  '2026-01-05 09:07:03',
  'Date objects format with zero-padding',
);

// --- total_discounts is a percentage STRING ---
assert.equal(p.total_discounts, '10%', '170/1700 = 10%, trailing zeros trimmed');
assert.equal(
  buildSalesPayload({ ...base, discounts: 212.5 }).total_discounts,
  '12.5%',
  'fractional percentages keep one decimal',
);
assert.equal(
  buildSalesPayload({ ...base, discounts: 100 }).total_discounts,
  '5.88%',
  'percentages round to 2 decimal places',
);

// --- divide-by-zero guard: a Z-reading with no sales at all ---
const empty = buildSalesPayload({
  ...base,
  grossSales: 0, netSales: 0, discounts: 0, vatSales: 0, vatAmount: 0,
  vatExempt: 0, nonVat: 0, transactionCount: 0, cashSales: 0, paymentMethods: [],
});
assert.equal(empty.total_discounts, '0%', 'zero gross sales must not produce NaN%');
assert.equal(empty.credit, 0, 'no tender means zero credit');
assert.equal(empty.debit, 0, 'no tender means zero debit');

// --- tender edge cases ---
assert.equal(
  buildSalesPayload({ ...base, cashSales: 0, paymentMethods: [{ name: 'GCash', amount: 1530 }] }).credit,
  1530,
  'all non-cash goes to credit',
);
assert.equal(
  buildSalesPayload({ ...base, paymentMethods: [{ name: 'cash', amount: 200 }] }).credit,
  0,
  'CASH match is case-insensitive, so lowercase cash is not counted as credit',
);
assert.equal(
  buildSalesPayload({ ...base, paymentMethods: [{ name: 'CASH', amount: 200 }] }).credit,
  0,
  'a cash-only reading has zero credit',
);

// --- rounding: floating point tender must not leak into the payload ---
assert.equal(
  buildSalesPayload({
    ...base,
    paymentMethods: [{ name: 'GCash', amount: 0.1 }, { name: 'Card', amount: 0.2 }],
  }).credit,
  0.3,
  'credit is rounded to 2dp, not 0.30000000000000004',
);

console.log('sta-lucia-payload: all assertions passed');
