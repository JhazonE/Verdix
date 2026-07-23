import assert from 'node:assert/strict';
import { isService, PRODUCT_TYPES } from '../../lib/product-type';

assert.equal(isService({ type: 'service' }), true, 'service product');
assert.equal(isService({ type: 'standard' }), false, 'standard product');

// A missing or unknown type must read as standard. This direction matters:
// a SELECT that forgets the column must never silently disable stock
// deduction on a real product.
assert.equal(isService({}), false, 'undefined type falls back to standard');
assert.equal(isService({ type: null }), false, 'null type falls back to standard');
assert.equal(isService({ type: 'bundle' }), false, 'unknown type falls back to standard');

assert.deepEqual([...PRODUCT_TYPES], ['standard', 'service'], 'both types exposed');

console.log('product-type: all assertions passed');
