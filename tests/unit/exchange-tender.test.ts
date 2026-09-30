import assert from 'node:assert/strict';
import { isExchangeBalanceTender, EXCHANGE_CREDIT_TENDER } from '../../lib/pos/exchange-tender';

// Cash and card are the only tenders allowed to settle an exchange balance.
for (const ok of ['Cash', 'CASH', ' cash ', 'Credit Card', 'Debit Card', 'CREDIT_CARD', 'Card']) {
  assert.equal(isExchangeBalanceTender(ok), true, `${ok} is cash/card`);
}
// Stored value, account charges and non-card electronic tenders are not.
for (const bad of ['POINTS', 'CHARGE', 'GIFT_CHECK', 'Gift Card', 'GCash', 'Bank Transfer', 'Check', 'PayPal', 'MULTIPLE', '', null, undefined]) {
  assert.equal(isExchangeBalanceTender(bad as any), false, `${String(bad)} is not cash/card`);
}
// The exchange-credit tender must never be read as cash by the reconcilers,
// which match cash with `.toUpperCase() === 'CASH'`.
assert.notEqual(EXCHANGE_CREDIT_TENDER.toUpperCase(), 'CASH');
assert.equal(isExchangeBalanceTender(EXCHANGE_CREDIT_TENDER), false);

console.log('✓ exchange-tender');
