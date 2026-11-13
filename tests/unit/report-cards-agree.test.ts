import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { expandBatchLine } from '../../lib/batch-analysis-rows';
import { readingTotals } from '../../lib/reading-totals';

// The summary cards on the sales reports (Revenue, Cost, Profit, Qty) showed
// different figures for the same period. Three causes, each asserted here:
//
//  1. Batch Profit counted VOIDED sales and ignored RETURNS (a return line has
//     no batch_source, and the query required one). On the live DB that put it
//     PHP 310.00 above every other report for 2026-11 (a 145 void + a 165
//     return).
//  2. Sales by Date summed its cards from the CURRENT PAGE of days only.
//  3. Sales Analysis fetched /api/sales/by-date without a limit, so its cards
//     covered only the 10 most recent days of the range.

const read = (rel: string) =>
  fs.readFileSync(path.join(__dirname, '../..', rel), 'utf-8').replace(/\r\n/g, '\n');
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(\/\/|--).*$/gm, '');

// --- 1. Batch Profit -------------------------------------------------------

// A return line: no batch splits, quantity -1, priced 165, costed 115.
const ret = expandBatchLine({
  qtySold: -1, sellingPrice: 165, sellingUnitFactor: null,
  batchSource: null, fallbackUnitCost: 115,
});
assert.equal(ret.length, 1, 'a return line must produce a row, not vanish');
assert.equal(ret[0].qtySold, -1);
assert.equal(ret[0].lineRevenue, -165, 'a return reduces revenue');
assert.equal(ret[0].lineCost, -115, 'a return reduces cost');
assert.equal(ret[0].batchType, 'return');

// A case of 12 (factor 12) sold at 1200 with no batch record: base-unit qty
// and a per-base-unit price/cost, so revenue is still 1200, not 14,400.
const unbatched = expandBatchLine({
  qtySold: 1, sellingPrice: 1200, sellingUnitFactor: 12,
  batchSource: null, fallbackUnitCost: 960,
});
assert.equal(unbatched[0].qtySold, 12);
assert.equal(unbatched[0].lineRevenue, 1200);
assert.equal(unbatched[0].lineCost, 960);

// A batched sale keeps its per-batch split exactly as before.
const batched = expandBatchLine({
  qtySold: 2, sellingPrice: 145, sellingUnitFactor: 1,
  batchSource: JSON.stringify([{ batchId: 'b1', qty: 1, unitCost: 90 }, { batchId: 'b2', qty: 1, unitCost: 95 }]),
  fallbackUnitCost: 999,
});
assert.equal(batched.length, 2);
assert.equal(batched[0].lineRevenue + batched[1].lineRevenue, 290);
assert.equal(batched[0].lineCost + batched[1].lineCost, 185, 'batch cost wins over the fallback');

const batch = stripComments(read('app/api/sales/batch-analysis/route.ts'));
assert.ok(batch.includes('posSaleSql('), 'batch analysis must exclude voided/training sales');
assert.ok(batch.includes('lineDateExpr('), 'a return must be dated by when it was returned');
assert.ok(!/batch_source IS NOT NULL/.test(batch), 'lines without batch_source (returns, legacy) must not be dropped');

// --- 2. Sales by Date cards ------------------------------------------------

const byDate = stripComments(read('app/api/sales/by-date/route.ts'));
assert.ok(/data: formattedData,\s*totals\b/.test(byDate), 'by-date must return range-wide totals');
const byDateUtils = stripComments(read('app/(app)/sales/by-date/use-by-date-utils.ts'));
assert.ok(
  !/summaryTotals\s*=\s*useMemo\([\s\S]{0,80}salesData\.reduce/.test(byDateUtils),
  'Sales by Date cards must not be summed from the current page'
);

// --- 3. Sales Analysis cards -----------------------------------------------

const analysis = stripComments(read('app/(app)/sales/analysis/use-analysis-queries.ts'));
assert.ok(/by-date[\s\S]*limit|limit[\s\S]*by-date/.test(analysis), 'analysis must request every bucket, not the default 10');

// --- 4. Product reports fetch the whole range --------------------------------

for (const rel of ['app/(app)/reports/sales/top-sales/page.tsx', 'app/(app)/reports/sales/top-volume/page.tsx']) {
  assert.ok(!/'limit',\s*'1000'\)/.test(read(rel)), `${rel} must not cap at 1000 products`);
}

// --- 5. Dashboard charts use the same definition of a sale -----------------
// They read sales_invoices whole, where the POS mirror of a sale is never
// voided or reduced by a return: Nov showed 8,415 by category vs 8,105.
for (const rel of ['app/api/sales/hourly/route.ts', 'app/api/sales/top-products/route.ts', 'app/api/sales/monthly-category/route.ts']) {
  const src = stripComments(read(rel));
  assert.ok(src.includes('posSaleSql('), `${rel} must scope POS sales with posSaleSql`);
  assert.ok(src.includes('backofficeInvoiceSql('), `${rel} must take only back-office rows from sales_invoices`);
  assert.ok(!/status\s*!=\s*'Voided'/.test(src), `${rel} must not use the old sales_invoices status filter`);
}

// --- 6. A return carries its original line's tax type ----------------------
// Without tax_type the column default 'VAT' applied, so returning a NON_VAT
// item booked negative VAT the sale never charged.
for (const rel of ['app/api/sales/returns/route.ts', 'app/api/sales/exchanges/route.ts']) {
  const src = stripComments(read(rel));
  for (const m of src.matchAll(/INSERT INTO pos_transaction_items \(([\s\S]*?)\)\s*VALUES/g)) {
    assert.ok(/tax_type/.test(m[1]), `${rel}: every pos_transaction_items insert must write tax_type`);
  }
}
assert.ok(/tax_type/.test(read('lib/pos/process-return-leg.ts')), 'return leg must read the original line tax_type');

// --- 7. Client-side counts skip return rows ---------------------------------
assert.ok(/transactionType !== 'return'/.test(read('app/(app)/reports/sales/summary/page.tsx')), 'Summary must not count a return as a transaction');
assert.ok(/transactionType !== 'return'/.test(read('app/(app)/reports/sales/by-customer/page.tsx')), 'By Customer must not count a return as a purchase');

// --- 8. Readings: a return is deducted from net, not added to gross ---------
// Nov 3 00:55 → now on the live DB: no sales, a 145 void, a 165 return.
// Old: gross 310, net 0. Right: gross 145 (the voided sale was rung up),
// net −165 (matches Sales by Date for Nov 4).
{
  const { gross, net } = readingTotals({ sales: 0, discounts: 0, voids: 145, returns: 165 });
  assert.equal(gross, 145);
  assert.equal(net, -165);
  // Nov 1–13 on COUNTER 1: sales 7,785, one 165 return, one 145 void.
  const nov = readingTotals({ sales: 7785, discounts: 0, voids: 145, returns: 165 });
  assert.equal(nov.net, 7620, 'net must match BIR Summary / Sales by Tax Type (7,620)');
  assert.equal(nov.gross, 7930);
}
for (const rel of ['app/api/sales/z-reading/route.ts', 'app/api/sales/overall-reading/route.ts', 'app/api/sales/x-reading/route.ts']) {
  assert.ok(read(rel).includes('readingTotals('), `${rel} must use lib/reading-totals.ts`);
}
{
  const z = stripComments(read('app/api/sales/z-reading/route.ts'));
  // Filing path used the old returns query: SUM(st.total) WHERE status='Returned'.
  assert.ok(!/SUM\(\s*st\.total\s*\)\s*as\s+total_returns/i.test(z), 'Z commit must not take returns from st.total');
  assert.ok(!/st\.status\s*=\s*'Returned'/.test(z), "Z must not find returns by status = 'Returned'");
  // A sale with a return has two pos_transactions rows; joining both doubled it.
  for (const m of z.matchAll(/JOIN pos_transactions pt ON st\.id = pt\.sale_id([^\n]*)/g)) {
    assert.ok(/transaction_type = 'sale'/.test(m[1]), 'Z sale joins must be restricted to the sale row');
  }
}

console.log('✓ report-cards-agree');
