import assert from 'node:assert/strict';
import { formatCartQuantity } from '../../lib/utils';

// A POS line sold by weight is the whole reason this helper exists: the cart
// used to render quantities through formatStockQuantity, whose Math.ceil turned
// a cashier's "10.5" kilograms into "11" the moment the input lost focus.
assert.equal(formatCartQuantity(10.5), '10.5', 'keeps a half unit');
assert.equal(formatCartQuantity(0.25), '0.25', 'keeps a quarter unit');
assert.equal(formatCartQuantity(2.125), '2.125', 'keeps three decimal places');

// Whole quantities, which are the overwhelming majority of lines, must still
// read as plain integers rather than "3.0000".
assert.equal(formatCartQuantity(3), '3', 'whole number has no decimal tail');
assert.equal(formatCartQuantity(12), '12', 'whole number has no decimal tail');

// MySQL DECIMAL columns arrive as strings, and a line restored from a held
// transaction carries them straight through.
assert.equal(formatCartQuantity('10.5000'), '10.5', 'coerces a decimal string');
assert.equal(formatCartQuantity('3.0000'), '3', 'coerces a whole decimal string');

// Float noise from factor arithmetic (0.1 * 3) must not surface as 0.30000000000000004.
assert.equal(formatCartQuantity(0.1 * 3), '0.3', 'trims float noise');

// Defensive: non-numeric input renders as 0 rather than "NaN".
assert.equal(formatCartQuantity(undefined), '0', 'undefined renders as 0');
assert.equal(formatCartQuantity(null), '0', 'null renders as 0');
assert.equal(formatCartQuantity('abc'), '0', 'garbage renders as 0');

console.log('✓ cart-quantity-format tests passed');
