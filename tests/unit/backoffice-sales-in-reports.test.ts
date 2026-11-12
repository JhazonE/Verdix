import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { backofficeInvoiceSql, NON_SALE_STATUSES } from '../../lib/backoffice-sales';

// Back-office sales invoices (Sales > Invoices) write sales_invoices only: no
// pos_transactions / sales_transactions row. Sales by Date and the Sales
// Transactions list read pos_transactions, so they never saw them; By Product
// had an invoice leg but filtered `status = 'Paid'` (a back-office invoice is
// created 'Pending') and told POS mirrors apart by `notes NOT LIKE '%POS Sale%'`.
//
// Asserted on source text (no DB in the unit suite), same approach as
// sales-by-date-excludes-voids.test.ts.

const read = (rel: string) =>
  fs.readFileSync(path.join(__dirname, '../..', rel), 'utf-8').replace(/\r\n/g, '\n');
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(\/\/|--).*$/gm, '');

// 1. The predicate itself: Backoffice only, Pending counts, voids do not.
const sql = backofficeInvoiceSql('x');
assert.ok(sql.includes("x.transaction_source = 'Backoffice'"), 'must select by transaction_source');
assert.ok(!/'Pending'|'Paid'/.test(sql), 'must not restrict to a payment status');
for (const s of ['Void', 'Voided', 'Cancelled', 'Returned']) {
  assert.ok(NON_SALE_STATUSES.includes(s as any), `${s} must be a non-sale status`);
  assert.ok(sql.includes(`'${s}'`), `${s} must be excluded in SQL`);
}

// 2. Every report that reads invoices uses it, not the old Paid/notes hack.
for (const rel of [
  'app/api/sales/by-date/route.ts',
  'app/api/sales/transactions/route.ts',
  'app/api/sales/by-product/route.ts',
  'app/api/sales/product-transactions/route.ts',
  'app/api/sales/by-product/attributes/route.ts',
  'app/api/reports/fiscal-year/route.ts',
  'app/api/reports/stats/route.ts',
  'app/api/sales/batch-analysis/route.ts',
]) {
  const src = stripComments(read(rel));
  assert.ok(src.includes('backofficeInvoiceSql('), `${rel} must use backofficeInvoiceSql`);
  assert.ok(!/POS Sale/.test(src), `${rel} must not identify POS mirrors by notes text`);
}

// 3. A till-only filter must exclude back-office invoices, not ignore them.
const tx = stripComments(read('app/api/sales/transactions/route.ts'));
assert.ok(
  /includeBackoffice\s*=[\s\S]*terminalId[\s\S]*cashier[\s\S]*'Returned'/.test(tx),
  'terminal / cashier / Returned filters must switch the back-office source off'
);
// The two id columns must not be coalesced: they can differ in collation.
assert.ok(!/COALESCE\(\s*pos_id/.test(tx), 'do not COALESCE pos_id and bo_id');

console.log('✓ backoffice-sales-in-reports');
