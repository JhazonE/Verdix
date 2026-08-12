import assert from 'node:assert/strict';
import { buildHourlySalesPayload } from '../../lib/integrations/sta-lucia/hourly-payload';
import type { HourlySalesTotals } from '../../lib/integrations/sta-lucia/types';

const base: HourlySalesTotals = {
  hourStart: '2026-08-12 13:00:00',
  grossSales: 25000,
  discounts: 2500,
  vatSales: 18000,
  vatAmount: 2160,
  vatExempt: 2000,
  nonVat: 5000,
  cashSales: 10000,
  paymentMethods: [
    { name: 'CASH', amount: 10000 },
    { name: 'GCash', amount: 15000 },
  ],
};

const p = buildHourlySalesPayload(base);

// --- full field mapping ---
assert.equal(p.gross_sales, 25000, 'gross_sales maps straight through');
assert.equal(p.vat_sales, 18000, 'vat_sales from vatSales');
assert.equal(p.vat_amount, 2160, 'vat_amount from vatAmount');
assert.equal(p.vat_exempt_sales, 2000, 'vat_exempt_sales from vatExempt');
assert.equal(p.non_vat_sales, 5000, 'non_vat_sales from nonVat');
assert.equal(p.other_taxes, 0, 'other_taxes is always 0');
assert.equal(p.sale_type, true, 'sale_type is always true for hourly submissions');

// --- net_sales = gross - discounts (hourly has no separate returns/void bucket) ---
assert.equal(p.net_sales, 22500, 'net_sales is gross minus discounts');

// --- credit/debit split, same convention as EOD: debit = cash, credit = non-cash ---
assert.equal(p.debit, 10000, 'debit is cash tender');
assert.equal(p.credit, 15000, 'credit is the sum of every non-CASH tender');

// --- date formatting ---
assert.equal(p.date_time, '2026-08-12 13:00:00', 'date_time uses yyyy-MM-dd HH:mm:ss');
assert.equal(
  buildHourlySalesPayload({ ...base, hourStart: new Date(2026, 7, 12, 9, 0, 0) }).date_time,
  '2026-08-12 09:00:00',
  'Date objects format with zero-padding',
);

// --- total_discounts is a percentage STRING ---
assert.equal(p.total_discounts, '10%', '2500/25000 = 10%');

// --- divide-by-zero guard: a quiet hour with zero sales ---
const empty = buildHourlySalesPayload({
  ...base,
  grossSales: 0, discounts: 0, vatSales: 0, vatAmount: 0,
  vatExempt: 0, nonVat: 0, cashSales: 0, paymentMethods: [],
});
assert.equal(empty.total_discounts, '0%', 'zero gross sales must not produce NaN%');
assert.equal(empty.net_sales, 0, 'zero gross and discounts nets to zero');
assert.equal(empty.credit, 0, 'no tender means zero credit');
assert.equal(empty.debit, 0, 'no tender means zero debit');

// --- rounding: floating point tender must not leak into the payload ---
assert.equal(
  buildHourlySalesPayload({
    ...base,
    paymentMethods: [{ name: 'GCash', amount: 0.1 }, { name: 'Card', amount: 0.2 }],
  }).credit,
  0.3,
  'credit is rounded to 2dp, not 0.30000000000000004',
);

console.log('sta-lucia-hourly-payload: all assertions passed');
