import assert from 'node:assert/strict';
import { splitIntoUnits, formatUnitBreakdown, formatSignedUnitBreakdown, sumToBase, repackOutcome } from '../../lib/unit-quantity';

const piece = { id: 'p', name: 'Piece', factor: 1, isBase: true };
const pack = { id: 'k', name: 'Pack', factor: 6, isBase: false };
const cse = { id: 'c', name: 'Case', factor: 24, isBase: false };
const units = [piece, cse, pack]; // deliberately unordered

// splitIntoUnits: largest first, remainder cascades down
assert.deepEqual(
  splitIntoUnits(132, units).map((e) => [e.unit.name, e.quantity]),
  [['Case', 5], ['Pack', 2]],
  '132 = 5 Case + 2 Pack (zero entries omitted)'
);
assert.deepEqual(
  splitIntoUnits(135, units).map((e) => [e.unit.name, e.quantity]),
  [['Case', 5], ['Pack', 2], ['Piece', 3]],
  '135 = 5 Case + 2 Pack + 3 Piece'
);
assert.deepEqual(splitIntoUnits(0, units), [], 'zero stock has no entries');
assert.deepEqual(
  splitIntoUnits(2.5, [piece]).map((e) => [e.unit.name, e.quantity]),
  [['Piece', 2.5]],
  'single-unit product keeps its fractional figure'
);
assert.deepEqual(
  splitIntoUnits(30.5, units).map((e) => [e.unit.name, e.quantity]),
  [['Case', 1], ['Pack', 1], ['Piece', 0.5]],
  'fractional remainder stays on the base unit'
);
assert.deepEqual(
  splitIntoUnits(-3, units).map((e) => [e.unit.name, e.quantity]),
  [['Piece', -3]],
  'negative stock is shown on the base unit, not split'
);

// formatUnitBreakdown
assert.equal(formatUnitBreakdown(135, units), '5 Case + 2 Pack + 3 Piece');
assert.equal(formatUnitBreakdown(0, units), '0 Piece', 'zero shows base unit');
assert.equal(formatUnitBreakdown(7, [piece]), '7 Piece');
assert.equal(formatUnitBreakdown(7, []), '7', 'no units: bare number');
assert.equal(formatUnitBreakdown(7, undefined, 'pcs'), '7 pcs', 'no units: fallback label');

// formatSignedUnitBreakdown
assert.equal(formatSignedUnitBreakdown(30, units), '+1 Case + 1 Pack');
assert.equal(formatSignedUnitBreakdown(-3, units), '-3 Piece');
assert.equal(formatSignedUnitBreakdown(-30, units), '-(1 Case + 1 Pack)');
assert.equal(formatSignedUnitBreakdown(-24, units), '-1 Case');
assert.equal(formatSignedUnitBreakdown(0, units), '0');
assert.equal(formatSignedUnitBreakdown(-5), '-5', 'no units: plain signed number');

// sumToBase
assert.equal(sumToBase([{ unit: cse, quantity: 2 }, { unit: piece, quantity: 5 }]), 53);
assert.equal(sumToBase([]), 0);
assert.throws(() => sumToBase([{ unit: { ...cse, factor: 0 }, quantity: 1 }]), /factor/i);

// repackOutcome
assert.deepEqual(
  repackOutcome({ quantity: 2, fromFactor: 24, toFactor: 1 }),
  { baseUsed: 48, expectedProduced: 48, actualProduced: 48, shortfallBase: 0 },
  '2 Case -> 48 Piece, no loss'
);
assert.deepEqual(
  repackOutcome({ quantity: 2, fromFactor: 24, toFactor: 1, actualProduced: 46 }),
  { baseUsed: 48, expectedProduced: 48, actualProduced: 46, shortfallBase: 2 },
  'shortfall is the missing base units'
);
assert.deepEqual(
  repackOutcome({ quantity: 60, fromFactor: 1, toFactor: 24 }),
  { baseUsed: 60, expectedProduced: 2.5, actualProduced: 2.5, shortfallBase: 0 },
  'merge upward can be fractional'
);
assert.equal(
  repackOutcome({ quantity: 1, fromFactor: 6, toFactor: 24, actualProduced: 0.2 }).shortfallBase,
  1.2,
  'shortfall converts through the target factor'
);
assert.throws(() => repackOutcome({ quantity: 1, fromFactor: 24, toFactor: 1, actualProduced: 25 }), /exceed/i);
assert.throws(() => repackOutcome({ quantity: 0, fromFactor: 24, toFactor: 1 }), /greater than zero/i);
assert.throws(() => repackOutcome({ quantity: 1, fromFactor: 0, toFactor: 1 }), /factor/i);
assert.throws(() => repackOutcome({ quantity: 1, fromFactor: 24, toFactor: 1, actualProduced: -1 }), /negative/i);

// MySQL DECIMALs arrive as strings
assert.equal(formatUnitBreakdown('135.0000' as any, units), '5 Case + 2 Pack + 3 Piece', 'numeric strings are coerced');
assert.equal(formatSignedUnitBreakdown('-30.0000' as any, units), '-(1 Case + 1 Pack)');

console.log('unit-quantity tests passed');
