import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openInvoiceBalance } from '../../lib/customer-balance';

// The rule the transactions API applies to a POS sale's sales_invoices mirror.
assert.equal(openInvoiceBalance({ status: 'Partially Paid', total: 45, amount_paid: 30 }), 15);
assert.equal(openInvoiceBalance({ status: 'Pending', total: 15, amount_paid: null }), 15);
assert.equal(openInvoiceBalance({ status: 'Paid', total: 15, amount_paid: 15 }), 0);
assert.equal(openInvoiceBalance({ status: 'Voided', total: 15, amount_paid: 0 }), 0, 'a voided charge owes nothing');

const read = (p: string) => readFileSync(p, 'utf8');
const api = read('app/api/sales/transactions/route.ts');
// POS rows used to be hard-coded as fully paid, so a charge sale showed Balance 0.
assert.ok(!/const balance = 0;/.test(api), 'a POS sale balance must not be hard-coded to 0');
assert.ok(api.includes('openInvoiceBalance(m)'), 'per-row balance comes from the sales_invoices mirror');
assert.ok(/pos_owed\.reference = st\.reference AND pt\.transaction_type = 'sale'/.test(api),
  'the totals join the mirror on the SALE row only (a return shares the reference)');
assert.ok(/customerBalance: aggPosOwed \+/.test(api), 'Customer Balance card includes POS charges');

// `amountPaid || total` turned an unpaid charge (paid 0) back into fully paid.
for (const f of [
  'app/(app)/sales/sales-transactions/SalesTable.tsx',
  'app/(app)/sales/sales-transactions/use-sales-page.tsx',
  'app/(app)/sales/details/DetailsTable.tsx',
  'app/(app)/reports/sales/by-customer/page.tsx',
]) {
  assert.ok(!/amountPaid \|\| \w+\.total/.test(read(f)), `${f}: amountPaid 0 must not fall back to total`);
}

console.log('✓ pos-charge-balance');
