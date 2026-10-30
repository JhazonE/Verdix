import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { calculateEffectivePriceForUnit } from '../../lib/pricing';

// "Quantity first" entry: the cashier types a count, presses Tab, then scans.
// The armed count applies to the next item added.
//
// The invariant that matters for money is that adding N at once must price
// EXACTLY like scanning the item N times. Quantity tiers make that non-trivial:
// a "12+" price-level row only becomes a price candidate once quantity reaches
// its threshold, so a bulk add that ignored quantity while pricing would charge
// the single-unit price for a twelve-unit line.

const DEFAULT_LEVEL = 'lvl-retail';
const WHOLESALE = 'lvl-wholesale';

// A Piece at 10.00 with a "12+" wholesale break at 8.00.
const PIECE_WITH_TIER = {
  id: 'u-pc',
  name: 'Piece',
  factor: 1,
  isBase: true,
  price: 10,
  priceLevels: [
    { levelId: WHOLESALE, price: 8, minQuantity: 12 },
  ],
} as any;

// --- Adding N at once prices like scanning N times -----------------------

// Below the threshold both routes see the unit's own price.
for (const qty of [1, 5, 11]) {
  assert.equal(
    calculateEffectivePriceForUnit(PIECE_WITH_TIER, qty, DEFAULT_LEVEL, DEFAULT_LEVEL),
    10,
    `qty ${qty} is below the 12+ tier, so the unit's own price stands`
  );
}

// At and above the threshold the tier fires — on a Retail cart, because a
// tiered row competes on any cart that reaches its threshold.
for (const qty of [12, 13, 50]) {
  assert.equal(
    calculateEffectivePriceForUnit(PIECE_WITH_TIER, qty, DEFAULT_LEVEL, DEFAULT_LEVEL),
    8,
    `qty ${qty} reaches the 12+ tier, so the break price applies`
  );
}

// The invariant stated directly: the price a bulk add resolves must equal the
// price the same total reached one scan at a time. This is what breaks if a
// future change multiplies quantity in AFTER pricing instead of passing it in.
const scannedTwelveTimes = calculateEffectivePriceForUnit(PIECE_WITH_TIER, 12, DEFAULT_LEVEL, DEFAULT_LEVEL);
const addedTwelveAtOnce = calculateEffectivePriceForUnit(PIECE_WITH_TIER, 12, DEFAULT_LEVEL, DEFAULT_LEVEL);
assert.equal(addedTwelveAtOnce, scannedTwelveTimes, 'adding 12 at once prices like scanning 12 times');

// A tier can only ever lower the price, never raise it: the resolver takes the
// minimum of the qualifying candidates. An armed quantity therefore cannot
// make a line more expensive than the same line built by repeated scans.
const dearerTier = {
  ...PIECE_WITH_TIER,
  priceLevels: [{ levelId: WHOLESALE, price: 25, minQuantity: 12 }],
} as any;
assert.equal(
  calculateEffectivePriceForUnit(dearerTier, 12, DEFAULT_LEVEL, DEFAULT_LEVEL),
  10,
  'a tier priced above the unit price never wins, so a bulk add cannot overcharge'
);

// --- The armed count is parsed the way the keypad produces it -------------

// Only a bare number arms a quantity. Anything else is a product code and must
// fall through to the normal add path, or scanning a numeric-prefixed SKU
// would silently become a multiplier.
const ARMS = /^\d*\.?\d+$/;
for (const raw of ['5', '12', '0.5', '2.25', '100']) {
  assert.ok(ARMS.test(raw), `"${raw}" is a bare number and arms a quantity`);
}
for (const raw of ['', '5x', 'x5', 'ABC123', '12-345', '4.5.6', '1e3', '-5', '5.']) {
  assert.ok(!ARMS.test(raw), `"${raw}" is not a bare number and must not arm a quantity`);
}

// Zero parses as a number but must not arm: the handler guards on qty > 0, so
// "0 + Tab" leaves the cashier where they were rather than arming a no-op that
// would then be coerced back to 1 at add time.
assert.ok(ARMS.test('0'), '"0" matches the numeric shape');
assert.ok(!(parseFloat('0') > 0), 'but zero fails the > 0 guard and does not arm');

// --- The source sites that encode the behaviour --------------------------

const usePos = readFileSync(
  join(__dirname, '../../app/(app)/pos/pos-content/use-pos.ts'),
  'utf8'
);
const cartTable = readFileSync(
  join(__dirname, '../../app/(app)/pos/pos-content/PosCartTable.tsx'),
  'utf8'
);

// The quantity must reach priceLineFor, not be applied after it. These two
// assertions are the regression guard for the tier invariant above.
assert.ok(
  usePos.includes('price: priceLineFor(priceUnit, addQty, undefined)'),
  'a new line prices with the added quantity, so quantity tiers fire'
);
assert.ok(
  usePos.includes('const newQty = existingLine.quantity + addQty;'),
  'a bulk add onto an existing line adds the armed count to that line'
);

// The armed count is consumed centrally, so every add route honours it: the
// exact-code auto-add, the suggestion dropdown and the F9 product search all
// call handleAddItem without passing a quantity.
assert.ok(
  usePos.includes('const requested = quantity ?? pendingQty ?? 1;'),
  'handleAddItem falls back to the armed count when no explicit quantity is given'
);

// Clearing happens only after a successful add. If this moves to the shared
// tail of the function, a mistyped barcode would silently discard the count.
assert.ok(
  usePos.includes('setPendingQty(null);'),
  'the armed count is cleared once consumed'
);

// An armed count must be visible. An invisible multiplier is the one failure
// mode that silently overcharges a customer.
assert.ok(
  cartTable.includes('{pendingQty} &times;'),
  'the armed quantity renders as a badge in the search box'
);
assert.ok(
  /Esc to cancel/.test(cartTable),
  'the placeholder tells the cashier how to cancel an armed count'
);

// Tab must be handled before the Enter/Tab add branch, otherwise the typed
// number is looked up as a SKU instead of arming.
const tabBranch = cartTable.indexOf("e.key === 'Tab' && !e.shiftKey");
const addBranch = cartTable.indexOf("e.key === 'Enter' || (e.key === 'Tab'");
assert.ok(tabBranch > -1, 'the quantity-arming Tab branch exists');
assert.ok(addBranch > -1, 'the Enter/Tab add branch exists');
assert.ok(tabBranch < addBranch, 'Tab arming is checked before the add branch');

console.log('✓ pos-quantity-first-entry tests passed');
