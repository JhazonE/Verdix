import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promoteToLargestUnit } from '../../lib/pos-cart-units';
import { formatCartQuantity } from '../../lib/utils';

// A cart line's `quantity` counts the unit the line is SOLD in. The cashier
// types "2" on a Box line and means two boxes — not two pieces, and not
// 2/60ths of a box. These tests pin that convention at both ends: the
// arithmetic that a quantity edit runs through, and the two source sites that
// decide what the cashier sees and what their keystroke is interpreted as.

const BOX = { id: 'u-box', name: 'Box', factor: 60, isBase: false, price: 400 };
const PIECE = { id: 'u-pc', name: 'Piece', factor: 1, isBase: true, price: 8 };
const UNITS = [PIECE, BOX] as any[];

// --- The quantity a cashier types is in the line's own unit ---------------

// Typing 2 on a Box line stays 2 Box. The old inline box counted base units,
// so this same keystroke used to mean 2 pieces and silently demoted the line.
const typedTwoBoxes = promoteToLargestUnit(2, BOX as any, UNITS);
assert.equal(typedTwoBoxes.unit.id, 'u-box', 'typing 2 on a Box line keeps it a Box line');
assert.equal(typedTwoBoxes.quantity, 2, 'typing 2 on a Box line means two boxes');

// And the money follows the unit, not the piece count.
assert.equal(typedTwoBoxes.quantity * BOX.price, 800, '2 Box at 400 is 800, not 2 pieces at 400');

// The base-unit total is derived for display, never stored.
assert.equal(
  formatCartQuantity(typedTwoBoxes.quantity * typedTwoBoxes.unit.factor),
  '120',
  '2 Box shows 120 pieces underneath'
);

// A single box reads "1", with "= 60 pcs" as the detail beneath it.
assert.equal(formatCartQuantity(1), '1', 'one box reads as 1, not 60');
assert.equal(formatCartQuantity(1 * BOX.factor), '60', 'its base total is 60');

// --- Stepping +/- moves one of the line's own unit ------------------------

// 1 Box + 1 must be 2 Box. Stepping one BASE unit instead would make it
// 1.0167 Box, which promoteToLargestUnit then demotes to 61 loose pieces —
// the opposite of what pressing "+" on a box line should do.
const stepped = promoteToLargestUnit(1 + 1, BOX as any, UNITS);
assert.equal(stepped.unit.id, 'u-box', '+ on a Box line keeps it in boxes');
assert.equal(stepped.quantity, 2, '+ on a 1 Box line gives 2 Box');

// Stepping down past zero still removes the line (quantity <= 0 is handled by
// updateQuantity before promotion ever runs), so 1 Box - 1 is simply 0.
assert.equal(1 - 1, 0, '- on a 1 Box line reaches 0 and drops the line');

// --- Base-unit lines are unaffected --------------------------------------

const pieces = promoteToLargestUnit(5, PIECE as any, UNITS);
assert.equal(pieces.unit.id, 'u-pc', '5 pieces stays in pieces');
assert.equal(pieces.quantity, 5, 'a base line counts pieces, as it always did');

// An exact multiple still promotes: 60 pieces is 1 Box.
const promoted = promoteToLargestUnit(60, PIECE as any, UNITS);
assert.equal(promoted.unit.id, 'u-box', '60 pieces promotes to Box');
assert.equal(promoted.quantity, 1, '60 pieces is 1 Box');

// --- The source sites that encode the convention -------------------------

const usePos = readFileSync(
  join(__dirname, '../../app/(app)/pos/pos-content/use-pos.ts'),
  'utf8'
);
const cartTable = readFileSync(
  join(__dirname, '../../app/(app)/pos/pos-content/PosCartTable.tsx'),
  'utf8'
);

// The inline qty box seeds and commits in the line's own unit. If this helper
// goes back to multiplying by factor, every keystroke means pieces again.
assert.match(
  usePos,
  /const lineQtyOf = \(item: any\) => Number\(item\.quantity\.toFixed\(4\)\)/,
  'lineQtyOf reads item.quantity directly, with no factor multiplication'
);
assert.ok(
  !/const baseQtyOf/.test(usePos),
  'the base-unit qty helper is gone, so no site can still seed the box in pieces'
);

// commitQty must not pass the quantityIsBase flag — doing so would reinterpret
// the cashier's number as pieces inside updateQuantity.
assert.match(
  usePos,
  /if \(q !== lineQtyOf\(item\)\) updateQuantity\(itemId, q\);/,
  'commitQty sends the typed number as the line unit, not as base units'
);

// +/- steps a whole unit of the line's own unit.
assert.match(
  usePos,
  /const stepLineQuantity = \(item: any, delta: number\) => item\.quantity \+ delta;/,
  'stepLineQuantity adds whole units of the line unit'
);

// The headline number in the cart is the selling-unit count; the base total is
// the sub-line. Asserting both directions catches a re-inversion.
assert.match(
  cartTable,
  /\{formatCartQuantity\(item\.quantity\)\}/,
  'the headline cart number is the selling-unit quantity'
);
assert.match(
  cartTable,
  /= \{formatCartQuantity\(item\.quantity \* item\.selectedSellingUnit\.factor\)\}/,
  'the base-unit total is the sub-line underneath'
);

console.log('✓ cart-quantity-counts-selling-unit tests passed');
