import assert from 'node:assert/strict';
import { parseQuantity, stepQuantity } from '../../app/(app)/inventory/bulk-adjustment/constants';

// The bulk adjustment Quantity field would not accept a decimal: typing "1.5"
// produced 1. The field held a NUMBER and re-parsed it with parseInt on every
// keystroke, so the moment the "." was typed it was parsed away and written
// back into the input -- the decimal point could never survive long enough for
// the "5" to be typed after it.
//
// The field now holds the raw typed string and parses only when the value is
// actually used. parseQuantity is that parse, and this pins its contract.

// The bug itself, documented so a future edit that reintroduces parseInt has
// something to fail against.
assert.equal(parseInt('1.5'), 1, 'parseInt truncates at the decimal point (the bug)');

// Fractional quantities are real: stock is DECIMAL(15,4) and products are sold
// by weight (1.5 kg), so these must survive the round trip intact.
assert.equal(parseQuantity('1.5'), 1.5, 'a decimal quantity keeps its fraction');
assert.equal(parseQuantity('0.25'), 0.25, 'a quantity below 1 is valid');
assert.equal(parseQuantity('12'), 12, 'a whole number is unchanged');
assert.equal(parseQuantity('2.0001'), 2.0001, 'four decimal places are kept (DECIMAL(15,4))');

// Partially-typed input is the state the field is in mid-keystroke. It must
// come back as 0 (a line contributing nothing) rather than NaN, which would
// spread through the stock-impact preview and the batch cost total.
assert.equal(parseQuantity('1.'), 1, 'a trailing decimal point is mid-typing, not invalid');
assert.equal(parseQuantity(''), 0, 'a cleared field contributes nothing');
assert.equal(parseQuantity('   '), 0, 'whitespace contributes nothing');
assert.equal(parseQuantity(undefined), 0, 'an unset quantity contributes nothing');
assert.equal(parseQuantity('abc'), 0, 'garbage is 0, never NaN');
assert.equal(parseQuantity('-'), 0, 'a lone minus sign is 0, never NaN');

// Direction comes from the batch type (add/remove/transfer), never from the
// sign of what was typed, so a negative can never sneak in and invert a line.
assert.equal(parseQuantity('-5'), 0, 'a negative quantity is rejected, not negated');
assert.equal(parseQuantity('0'), 0, 'an explicit zero moves no stock');

// The +/- buttons must not resurrect the integer-only behaviour: stepping from
// a fractional value has to preserve the fraction.
assert.equal(stepQuantity('1.5', 1), '2.5', 'stepping up keeps the fraction');
assert.equal(stepQuantity('1.5', -1), '0.5', 'stepping down keeps the fraction');
assert.equal(stepQuantity('2', 1), '3', 'stepping a whole number stays whole');

// Stepping down must never produce a zero or negative line via the buttons.
assert.ok(parseQuantity(stepQuantity('0.5', -1)) > 0, 'stepping below zero floors above 0');
assert.ok(parseQuantity(stepQuantity('1', -1)) > 0, 'stepping down from 1 floors above 0');

// Stepping from a blank field starts a usable line rather than staying empty.
assert.equal(stepQuantity('', 1), '1', 'stepping up from blank yields 1');

console.log('✓ bulk-adjustment-decimal-quantity tests passed');
