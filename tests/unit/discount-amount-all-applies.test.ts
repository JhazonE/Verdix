import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { amountToPercentages } from '../../app/(app)/pos/discount/use-discount';

// "dili mugana ang discount na fix amount sa all items" — picking Fixed
// Amount with the All Items scope applied nothing at all.
//
// Root cause: the previous commit made a TYPE change clear the value box, to
// stop "50" meaning ₱50 under one type and 50% under the other. But clearing
// fires on the ordinary workflow too — the cashier types the figure and THEN
// picks the type/scope, or simply does not notice the box emptied. handleApply
// then reads an empty string, `parseFloat('') || 0` is 0, and a 0% discount is
// applied to every line. Nothing is blocked and the sheet closes, so it looks
// exactly like the button doing nothing.
//
// Fix: do not clear. Both types now have a well-defined meaning in both
// scopes (a cart-wide fixed amount is spread pro rata), so the figure is
// simply applied under whichever unit is shown at Apply time. The dialog
// shows the unit next to the input, and a zero/empty value is refused rather
// than silently applied.

const dialog = fs
  .readFileSync(path.join(__dirname, '../..', 'app/(app)/pos/discount/DiscountDialog.tsx'), 'utf-8')
  .replace(/\r\n/g, '\n');
const hook = fs
  .readFileSync(path.join(__dirname, '../..', 'app/(app)/pos/discount/use-discount.ts'), 'utf-8')
  .replace(/\r\n/g, '\n');

// ─── a typed figure survives picking the type ────────────────────────────
assert.ok(
  !/val !== previous[\s\S]{0,400}setValue\(''\)/.test(dialog),
  'switching discount type no longer wipes a figure the cashier already ' +
    'typed — that blanked the value and applied a 0% discount',
);

// ─── and survives switching scope ────────────────────────────────────────
assert.ok(
  !/setScope\('all'\);\s*setDiscountType\('percent'\)/.test(dialog),
  'switching to All Items does not reset the type behind the cashier',
);

// ─── an empty or zero value is refused, not applied as 0% ────────────────
assert.ok(
  /valueInvalid/.test(hook),
  'the hook exposes a validity flag for the typed amount',
);
assert.ok(
  /valueInvalid/.test(dialog),
  'the dialog uses it to block Apply rather than closing on a no-op',
);

// ─── the spread still does the right thing for a cart-wide amount ────────
const cart = [
  { lineId: 'a', price: 61.85, quantity: 1 },
  { lineId: 'b', price: 100, quantity: 2 },
  { lineId: 'c', price: 38.15, quantity: 1 },
] as any;
const cartTotal = cart.reduce((a: number, i: any) => a + i.price * i.quantity, 0);

const pct = amountToPercentages(cart, 30);
const taken = cart.reduce((a: number, i: any) => a + (i.price * i.quantity * pct) / 100, 0);
assert.ok(
  Math.abs(taken - 30) < 1e-9,
  `₱30 across a ₱${cartTotal.toFixed(2)} cart takes ₱30.00, took ₱${taken.toFixed(2)}`,
);

// ─── the no-op that was reported, reproduced and pinned ──────────────────
// An empty box must never reach the cart as a real discount.
assert.equal(
  amountToPercentages(cart, parseFloat('') || 0),
  0,
  'an empty value yields no discount (and must therefore be refused at the ' +
    'button, not applied)',
);

console.log('✓ discount-amount-all-applies');
