import assert from 'node:assert/strict';
import { calculateExchangeBalance } from '../../lib/pos/exchange-balance';

assert.equal(
  calculateExchangeBalance({ quantity: 1, price: 20 }, { quantity: 1, price: 35 }),
  15,
  'upsell: newTotal - returnTotal is positive'
);
assert.equal(
  calculateExchangeBalance({ quantity: 1, price: 50 }, { quantity: 1, price: 30 }),
  -20,
  'downsell: newTotal - returnTotal is negative'
);
assert.equal(
  calculateExchangeBalance({ quantity: 2, price: 10 }, { quantity: 1, price: 20 }),
  0,
  'even exchange across different quantities/unit prices nets to zero'
);
// Floating-point guard: 0.1 + 0.2 style errors must not leak into the UI as
// a non-zero balance that blocks an otherwise-even exchange.
assert.equal(
  calculateExchangeBalance({ quantity: 3, price: 0.1 }, { quantity: 1, price: 0.3 }),
  0,
  'rounds to the nearest centavo so float drift does not produce a fake balance'
);

console.log('✓ exchange-balance');
