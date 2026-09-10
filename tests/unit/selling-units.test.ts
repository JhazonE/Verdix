import assert from 'node:assert/strict';
import { baseQuantity } from '../../lib/selling-units';

// A case of 60: selling 2 cases moves 120 base units.
assert.equal(baseQuantity(2, 60), 120, '2 cases of 60 = 120 base units');

// The base unit itself is factor 1 — quantity passes through.
assert.equal(baseQuantity(7, 1), 7, 'factor 1 is a pass-through');

// Fractional quantities are legal (0.5 kg of a kilo unit).
assert.equal(baseQuantity(0.5, 1), 0.5, 'fractional base quantity');
assert.equal(baseQuantity(1.5, 12), 18, '1.5 x 12 = 18');

// Zero quantity moves nothing — a void line, not an error.
assert.equal(baseQuantity(0, 60), 0, 'zero quantity moves zero stock');

// A returned line is negative and must stay negative.
assert.equal(baseQuantity(-1, 60), -60, 'a return of one case restores 60');

// DECIMAL(12,4) rounding: three thirds of a 10-unit pack must not drift.
assert.equal(baseQuantity(3, 0.3333), 0.9999, 'no silent rounding');

// A non-finite factor is a programming error, not a silent zero — it would
// otherwise deduct nothing and leave stock quietly wrong.
assert.throws(() => baseQuantity(1, NaN), /factor/i, 'NaN factor throws');
assert.throws(() => baseQuantity(1, 0), /factor/i, 'zero factor throws');
assert.throws(() => baseQuantity(1, -5), /factor/i, 'negative factor throws');

console.log('✅ selling-units tests passed');
