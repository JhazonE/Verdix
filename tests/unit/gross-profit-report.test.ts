import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildGrossProfitReport,
  markupPct,
  monthRange,
  parseMonth,
} from '../../lib/gross-profit-report';

// Sales, COGS & Gross Profit Monitoring: one row per day of a month.

const close = (a: number, b: number, msg: string) =>
  assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} !== ${b}`);

// --- month parsing / range -------------------------------------------------
assert.deepEqual(parseMonth('2026-11'), { year: 2026, month: 11 });
for (const bad of ['2026-13', '2026-00', '2026-1', 'nov', '', null, undefined]) {
  assert.equal(parseMonth(bad as any), null, `${String(bad)} must be rejected`);
}
assert.deepEqual(monthRange(2026, 2), { startStr: '2026-02-01', endStr: '2026-02-28', daysInMonth: 28 });
assert.deepEqual(monthRange(2028, 2).daysInMonth, 29, 'leap year February');
assert.equal(monthRange(2026, 12).endStr, '2026-12-31');

// --- markup is on COST, margin is on SALES ---------------------------------
assert.equal(markupPct(150, 100), 50);
assert.equal(markupPct(0, 0), 0, 'no cost → 0, not Infinity/NaN');
assert.equal(markupPct(50, 0), 0, 'free stock has no markup to report');

// --- the worked example from the client's paper sheet (11/01/2026) ---------
const sheet = buildGrossProfitReport(
  2026,
  11,
  new Map([['2026-11-01', { revenue: 1233886.69, cost: 1150230.11, transactions: 1 }]])
);
const nov1 = sheet.days[0];
close(nov1.grossProfit, 83656.58, 'gross profit');
assert.equal(nov1.marginPct.toFixed(2), '6.78', 'margin % matches the sheet');
assert.equal(nov1.markupPct.toFixed(2), '7.27', 'markup on cost % matches the sheet');

// --- whole month, zero days, totals and averages ---------------------------
const r = buildGrossProfitReport(
  2026,
  11,
  new Map([
    ['2026-11-02', { revenue: 1000, cost: 800, transactions: 3 }],
    ['2026-11-05', { revenue: 3000, cost: 2000, transactions: 5 }],
    // A day holding only a return: negative sales and cost. It still counts as
    // a selling day — the store was open and money moved.
    ['2026-11-09', { revenue: -100, cost: -60, transactions: 0 }],
  ])
);
assert.equal(r.month, '2026-11');
assert.equal(r.days.length, 30, 'every day of the month is listed');
assert.equal(r.days[0].date, '2026-11-01');
assert.equal(r.days[29].date, '2026-11-30');
assert.equal(r.days[0].sales, 0, 'a day with no sales is a zero row');
assert.equal(r.days[0].marginPct, 0, 'zero day margin is 0, not NaN');
assert.equal(r.sellingDays, 3);
close(r.totals.sales, 3900, 'total sales');
close(r.totals.cost, 2740, 'total cost');
close(r.totals.grossProfit, 1160, 'total gross profit');
assert.equal(r.totals.transactions, 8);
// Ratios of the totals, not an average of the daily ratios.
close(r.totals.marginPct, (1160 / 3900) * 100, 'month margin from totals');
close(r.totals.markupPct, (1160 / 2740) * 100, 'month markup from totals');
close(r.averagePerDay.sales, 1300, 'average sales per selling day');
close(r.averagePerDay.grossProfit, 1160 / 3, 'average gross profit per selling day');

const empty = buildGrossProfitReport(2026, 2, new Map());
assert.equal(empty.days.length, 28);
assert.equal(empty.sellingDays, 0);
assert.equal(empty.averagePerDay.sales, 0, 'no sales → average 0, not NaN');

// --- both reports read one implementation ----------------------------------
// The daily report and Fiscal Year's monthly breakdown must come from the same
// helper, or a month here would stop equalling that month there.
const read = (rel: string) => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf-8');
assert.ok(read('app/api/reports/gross-profit/route.ts').includes('salesCostByPeriod('));
assert.ok(read('app/api/reports/fiscal-year/route.ts').includes('salesCostByPeriod('));
const helper = read('lib/sales-cost-by-period.ts');
for (const needle of ['posSaleSql(', 'backofficeInvoiceSql(', 'lineDateExpr(', 'lineCostExpr(', 'saleItemRevenueSql(', 'si.quantity < 0']) {
  assert.ok(helper.includes(needle), `sales-cost-by-period must use ${needle}`);
}

console.log('✓ gross-profit-report: daily sales/COGS/gross profit, margin vs markup, per-selling-day averages');
