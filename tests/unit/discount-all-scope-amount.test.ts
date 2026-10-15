import assert from 'node:assert/strict';
import { amountToPercentages } from '../../app/(app)/pos/discount/use-discount';

// Two defects in the discount dialog around the Fixed Amount (₱) type.
//
// 1. SCOPE SWITCH CARRIED THE VALUE OVER, REINTERPRETED.
//    "Fixed Amount" is only offered while the scope is "Selected", and
//    clicking "All Items" flips the type to 'percent'. But the typed VALUE
//    was left untouched. So: type ₱50 as a fixed amount, click All Items,
//    Apply → 50 is now read as 50 PERCENT off every line. On a ₱2,000 cart
//    that is ₱1,000 given away instead of ₱50. Silent, and it looks
//    deliberate on the receipt.
//
// 2. A FIXED AMOUNT SPREAD OVER A WHOLE CART IS AMBIGUOUS ANYWAY.
//    `handleApply` derives ONE percentage from the SELECTED item and
//    `handleApplyDiscount('ALL', pct)` stamps that same percentage on every
//    line. ₱5 off a ₱61.85 line is 8.08%, so every other line also loses
//    8.08% — not ₱5, and not ₱5 split across the cart.
//
// The fix: a cart-wide fixed amount is spread PRO RATA across the lines by
// value, so the cart total drops by exactly the amount entered, and each
// line's own percentage is whatever its share works out to. The scope switch
// now clears the value instead of silently changing its meaning.

const PCT_PRECISION = 1e-9;

// ─── the spread, mirrored from use-discount.ts ───────────────────────────
type Line = { lineId: string; price: number; quantity: number };

// The real resolver, not a copy of it: a flat pro-rata spread gives every
// line the same percentage, so one number covers the cart.
const spread = (lines: Line[], amount: number): Record<string, number> => {
  const pct = amountToPercentages(lines as any, amount);
  if (pct <= 0) return {};
  return Object.fromEntries(lines.map((l) => [l.lineId, pct]));
};

const cart: Line[] = [
  { lineId: 'a', price: 61.85, quantity: 1 }, // 61.85
  { lineId: 'b', price: 100, quantity: 2 },   // 200.00
  { lineId: 'c', price: 38.15, quantity: 1 }, // 38.15
];
const cartTotal = cart.reduce((a, l) => a + l.price * l.quantity, 0); // 300.00
assert.equal(Number(cartTotal.toFixed(2)), 300, 'test cart totals ₱300.00');

// ─── a cart-wide ₱30 takes exactly ₱30 off the cart ──────────────────────
const pcts = spread(cart, 30);
const taken = cart.reduce((a, l) => a + (l.price * l.quantity * pcts[l.lineId]) / 100, 0);
assert.ok(
  Math.abs(taken - 30) < PCT_PRECISION,
  `a ₱30 cart-wide discount takes ₱30.00 off the cart, took ${taken}`,
);

// ...and each line gives up its share in proportion to its value, which for a
// flat pro-rata spread is the same percentage on every line.
assert.ok(
  Math.abs(pcts['a'] - 10) < PCT_PRECISION &&
    Math.abs(pcts['b'] - 10) < PCT_PRECISION &&
    Math.abs(pcts['c'] - 10) < PCT_PRECISION,
  '₱30 off a ₱300 cart is 10% on every line',
);

// ─── the old behaviour is what this must NOT do ──────────────────────────
// Deriving the percentage from the SELECTED line (₱5 off the ₱61.85 line =
// 8.084%) and stamping it on all three took ₱24.25, not ₱5.
const legacyPct = (5 / 61.85) * 100;
const legacyTaken = cart.reduce((a, l) => a + (l.price * l.quantity * legacyPct) / 100, 0);
assert.ok(
  Math.abs(legacyTaken - 5) > 1,
  'the old selected-item-derived percentage did NOT take the entered amount ' +
    `off the cart (it took ${legacyTaken.toFixed(2)} for an entered ₱5)`,
);
const fixedTaken = cart.reduce(
  (a, l) => a + (l.price * l.quantity * spread(cart, 5)[l.lineId]) / 100,
  0,
);
assert.ok(
  Math.abs(fixedTaken - 5) < PCT_PRECISION,
  'the spread takes exactly the ₱5 entered',
);

// ─── an amount larger than the cart cannot make the total negative ───────
const over = spread(cart, 10_000);
const overTaken = cart.reduce((a, l) => a + (l.price * l.quantity * over[l.lineId]) / 100, 0);
assert.ok(
  Math.abs(overTaken - cartTotal) < PCT_PRECISION,
  'an amount above the cart total is capped at 100% of the cart, never more',
);
Object.values(over).forEach((p) =>
  assert.ok(p <= 100 + PCT_PRECISION, 'no line is discounted beyond 100%'),
);

// ─── an empty / zero-value cart divides by nothing ───────────────────────
assert.deepEqual(spread([], 50), {}, 'an empty cart yields no discounts');
assert.deepEqual(
  spread([{ lineId: 'z', price: 0, quantity: 3 }], 50),
  {},
  'a cart worth ₱0 yields no discounts rather than dividing by zero',
);

// ─── and the source enforces both halves of the fix ──────────────────────
import fs from 'node:fs';
import path from 'node:path';

const src = fs
  .readFileSync(
    path.join(__dirname, '../..', 'app/(app)/pos/discount/use-discount.ts'),
    'utf-8',
  )
  .replace(/\r\n/g, '\n');

assert.ok(
  /amountToPercentages/.test(src),
  'use-discount exposes the pro-rata spread used for a cart-wide fixed amount',
);

const dialog = fs
  .readFileSync(
    path.join(__dirname, '../..', 'app/(app)/pos/discount/DiscountDialog.tsx'),
    'utf-8',
  )
  .replace(/\r\n/g, '\n');

// The scope button must no longer force the type to 'percent' while leaving
// the typed figure in place — that is what turned ₱50 into 50% off everything.
assert.ok(
  !/setScope\('all'\);\s*setDiscountType\('percent'\)/.test(dialog),
  'switching to All Items no longer silently reinterprets the typed value ' +
    'as a percentage (₱50 became 50% off every line)',
);

// Fixed Amount is offered in both scopes now that a cart-wide one is spread.
assert.ok(
  !/scope === 'selected' && \(\s*<SelectItem value="amount"/.test(dialog),
  'the Fixed Amount option is no longer hidden from the All Items scope',
);

// NOTE: an earlier version of this fix CLEARED the value on a type change to
// stop "50" meaning two different things. That broke the ordinary workflow
// (type the figure, then pick the type) by leaving an empty box that applied
// a 0% discount, which is what "dili mugana" reported. The figure is kept
// now; a zero/empty value is refused at the button instead. See
// discount-amount-all-applies.test.ts.
assert.ok(
  /valueInvalid/.test(dialog),
  'a zero or empty value is refused at the Apply button rather than being ' +
    'applied as a 0% discount',
);

console.log('✓ discount-all-scope-amount');
