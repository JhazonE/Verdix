import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { profitOf, marginPct } from '../../lib/profit';

// Every report must define profit the same way: sales − cost. Before this, the
// same ten sales read ₱1,764.69 / ₱3,814.69 / ₱4,332.00 / ₱4,497.00 depending
// on the report, because Sales Transactions and Sales by Date also subtracted
// VAT, and Sales by Date costed goods at today's products.cost instead of the
// cost_at_sale snapshot.
//
// Route source is asserted as text (the unit suite has no database), using
// plain substring checks rather than block regexes.

const read = (p: string) => fs.readFileSync(path.join(__dirname, '../../', p), 'utf8');

// --- the definition itself ---
assert.equal(profitOf(1000, 600), 400);
assert.equal(profitOf(100, 130), -30, 'a loss stays negative');
assert.equal(marginPct(1000, 600), 40);
assert.equal(marginPct(0, 0), 0, 'no sales is a 0 margin, not NaN');

// --- no report subtracts VAT from profit ---
const transactions = read('app/api/sales/transactions/route.ts');
assert.ok(!transactions.includes('aggRevenue - aggCost - aggVatAmount'),
  'transactions totals must not subtract VAT from profit');
assert.ok(!transactions.includes('totalAmount - calculatedCost - taxAmount'),
  'transactions rows must not subtract VAT from profit');
assert.ok(transactions.includes('profitOf('), 'transactions must use profitOf');

const byDate = read('app/api/sales/by-date/route.ts');
assert.ok(!byDate.includes('totalRevenue - totalCost - totalTax'),
  'by-date must not subtract VAT from profit');
assert.ok(byDate.includes('profitOf('), 'by-date must use profitOf');

// --- by-date costs a filed sale at its snapshot, not today's products.cost ---
assert.ok(byDate.includes("unitCostExpr('si', 'p', { hasCostAtSale: true })"),
  'by-date must prefer sale_items.cost_at_sale');

// --- the rest agree on the same function ---
for (const f of [
  'app/api/sales/by-product/route.ts',
  'app/api/reports/fiscal-year/route.ts',
  'app/api/sales/voids-report/route.ts',
  'app/api/sales/product-transactions/route.ts',
  'app/api/sales/batch-analysis/route.ts',
]) {
  assert.ok(read(f).includes('profitOf('), `${f} must use profitOf`);
}

// --- net of returns, on the day returned ---
assert.ok(
  transactions.includes("pt.transaction_type IN ('sale', 'return')"),
  'transactions totals must include return rows so profit is net of returns',
);
assert.ok(
  byDate.includes("pt.transaction_type IN ('sale', 'return')"),
  'by-date must include return rows so profit is net of returns',
);
// Credit (Charge) sales are real sales; checkout marks them payment_status
// 'pending', so a 'completed'-only filter silently dropped them.
assert.ok(!byDate.includes("pt.payment_status = 'completed'"),
  'by-date must not drop credit sales (payment_status pending)');
for (const f of [
  'app/api/sales/by-product/route.ts',
  'app/api/sales/product-transactions/route.ts',
  'app/api/reports/fiscal-year/route.ts',
]) {
  assert.ok(read(f).includes('lineDateExpr('), `${f} must date returns by return date`);
}
assert.ok(read('lib/pos/process-return-leg.ts').includes('cost_at_sale'),
  'a return must carry the original line\'s cost_at_sale, not today\'s products.cost');

// --- Cost vs Retail: potential profit = retail − cost, cost is stock × cost ---
// It used to value cost from the remaining inventory_batches when any existed
// and from stock × cost otherwise, so two products on the same screen were
// costed on different bases and the total differed from stock × cost.
const costVsRetail = read('app/api/reports/cost-vs-retail/route.ts');
assert.ok(!costVsRetail.includes('inventory_batches'),
  'cost-vs-retail must value cost as stock × cost, not from batches');
assert.ok(costVsRetail.includes('profitOf('), 'cost-vs-retail must use profitOf');

console.log('✓ profit-definition: profit = sales − cost in every report');
