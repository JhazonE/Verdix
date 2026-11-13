import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { posSaleSql } from '../../lib/pos-sales';

// Fiscal Year and the dashboard Stats read sales_transactions and used to keep
// only `status = 'Paid'`. Checkout writes a Charge sale 'Pending' (or
// 'Partially Paid'), so those two reports dropped every credit sale that Sales
// by Date / Sales Transactions counted, and they kept training sales (written
// 'Paid' with is_training = 1). Stats also summed st.total without netting
// returns. Asserted on source text, as the rest of the unit suite does.

const read = (rel: string) =>
  fs.readFileSync(path.join(__dirname, '../..', rel), 'utf-8').replace(/\r\n/g, '\n');
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(\/\/|--).*$/gm, '');

// 1. The predicate: excludes non-sale statuses and training, no payment status.
const sql = posSaleSql('st');
assert.ok(!/= 'Paid'|= 'Pending'/.test(sql), 'must not restrict to a payment status');
for (const s of ['Void', 'Voided', 'Cancelled', 'Returned']) {
  assert.ok(sql.includes(`'${s}'`), `${s} must be excluded`);
}
assert.ok(sql.includes('COALESCE(st.is_training, 0) = 0'), 'training sales must be excluded');

// 2. Neither report filters sales_transactions by Paid any more.
for (const rel of ['app/api/reports/fiscal-year/route.ts', 'app/api/reports/stats/route.ts']) {
  const src = stripComments(read(rel));
  assert.ok(!/status\s*=\s*'Paid'/.test(src), `${rel} must not filter sales by status = 'Paid'`);
  assert.ok(src.includes('posSaleSql('), `${rel} must use posSaleSql`);
}

// 3. Stats revenue is net of returns (negative sale_items lines).
const stats = stripComments(read('app/api/reports/stats/route.ts'));
assert.ok(/si\.quantity < 0/.test(stats), 'stats must net returns out of revenue');
assert.ok(!stats.includes('toISOString().split'), 'month start must be a local date');

console.log('✓ pos-sale-predicate: Fiscal Year + Stats count Charge sales, drop training, net returns');
