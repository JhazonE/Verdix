/**
 * The amount owed by (positive) or credited to (negative) the customer when
 * swapping returnItem for newItem. Rounded to the nearest centavo so
 * floating-point drift (e.g. 0.1 + 0.2) never surfaces as a fake non-zero
 * balance that blocks what should be an even exchange.
 */
export function calculateExchangeBalance(
  returnItem: { quantity: number; price: number },
  newItem: { quantity: number; price: number }
): number {
  const returnTotal = returnItem.quantity * returnItem.price;
  const newTotal = newItem.quantity * newItem.price;
  // `+ 0` normalizes a `-0` result (e.g. from rounding a tiny negative
  // float-drift remainder) to `0` — `assert.equal` in node:assert/strict
  // and any UI code doing `balance === 0` would otherwise treat -0 and 0
  // as different values for what is semantically an even exchange.
  return Math.round((newTotal - returnTotal) * 100) / 100 + 0;
}
