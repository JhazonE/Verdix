import assert from 'node:assert/strict';
import { formatQuantity, formatStockQuantity } from '../../lib/utils';

// `products.stock` is DECIMAL(15,4) and genuinely holds fractions: selling 1.5 kg
// takes stock from 12 to 10.5, and stock_movements records -1.5000. Both display
// helpers nevertheless rounded (formatQuantity via Math.round, formatStockQuantity
// via Math.ceil) UNLESS the caller remembered to pass a unit name of "kilogram"
// or "kg". Most call sites did not, so a back-office page showed 10.5 kg as 11
// while the database was correct all along.
//
// A real stored figure must never be misreported, so rounding is now opt-in via
// an explicit argument rather than something a forgotten parameter triggers.

// The reported bug: a fractional stock reads back exactly, with no unit passed.
assert.equal(formatStockQuantity(10.5), '10.5', 'fractional stock is not ceiled');
assert.equal(formatQuantity(10.5), '10.5', 'fractional quantity is not rounded');
assert.equal(formatStockQuantity(9.0), '9', 'whole stock has no decimal tail');
assert.equal(formatQuantity(8.5), '8.5', 'matches the documented 8.500 -> "8.5"');

// A unit name must stay accepted: hundreds of call sites pass one, and passing
// it must not change a correct figure.
assert.equal(formatStockQuantity(10.5, 'Kilogram'), '10.5', 'unit arg still works');
assert.equal(formatStockQuantity(10.5, 'kg'), '10.5', 'kg abbreviation still works');
assert.equal(formatStockQuantity(3, 'Pieces'), '3', 'a discrete unit is unchanged');

// DECIMAL columns arrive as strings.
assert.equal(formatStockQuantity('10.5000'), '10.5', 'coerces a DECIMAL string');
assert.equal(formatStockQuantity('9.0000'), '9', 'whole DECIMAL string is plain');

// Float noise from factor arithmetic must not surface.
assert.equal(formatStockQuantity(0.1 * 3), '0.3', 'trims float noise');

// Negative stock is real (oversold) and must keep its sign and value. Math.ceil
// used to round -2.5 toward zero to -2, understating a shortfall.
assert.equal(formatStockQuantity(-2.5), '-2.5', 'negative stock is not ceiled');

// Defensive: these values flow into arithmetic, so bad input is 0, not NaN.
assert.equal(formatStockQuantity(null), '0', 'null renders as 0');
assert.equal(formatStockQuantity(undefined), '0', 'undefined renders as 0');
assert.equal(formatQuantity('abc'), '0', 'garbage renders as 0');

console.log('✓ stock-quantity-format tests passed');
