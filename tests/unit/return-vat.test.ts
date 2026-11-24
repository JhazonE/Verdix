import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { vatOfLines } from '../../lib/tax-utils';

// 12/112 of a VAT-inclusive line; nothing for the other buckets.
assert.equal(vatOfLines([{ lineTotal: 112, taxType: 'VAT' }]), 12);
assert.equal(vatOfLines([{ lineTotal: 112, taxType: null }]), 12, 'no tax type reads as VAT');
for (const t of ['VAT_EXEMPT', 'ZERO_RATED', 'NON_VAT']) {
  assert.equal(vatOfLines([{ lineTotal: 112, taxType: t }]), 0, `${t} carries no VAT`);
}
// A return is negative and its VAT must be too, so SUM(tax_amount) nets out
// alongside SUM(total_amount).
assert.equal(vatOfLines([{ lineTotal: -112, taxType: 'VAT' }, { lineTotal: -50, taxType: 'VAT_EXEMPT' }]), -12);
assert.equal(vatOfLines([]), 0);

// Every writer of a return row, and the exchange's sale leg, sets tax_amount
// from its lines. They used to insert a literal 0 and leave it there.
const read = (p: string) => readFileSync(p, 'utf8');
const returns = read('app/api/sales/returns/route.ts');
assert.ok(/UPDATE pos_transactions SET tax_amount = \?/.test(returns) && returns.includes('vatOfLines('),
  'returns must set the return row tax_amount from its lines');
const exchanges = read('app/api/sales/exchanges/route.ts');
assert.equal((exchanges.match(/vatOfLines\(/g) || []).length, 2,
  'exchanges must compute VAT for both the return leg and the sale leg');
assert.ok(!/'sale', \?, \?, 0, 0,/.test(exchanges),
  'the exchange sale leg must not insert a literal 0 tax_amount');

// The Returns report must not present the customer as the approver.
const page = read('app/(app)/reports/sales/returns/page.tsx');
assert.ok(!/overrideBy:\s*tx\.customer/.test(page), 'Override By must not show the customer');

console.log('✓ return-vat');
