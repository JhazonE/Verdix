import assert from 'node:assert/strict';
import { calculatePriceLevelPrice } from '../../app/(app)/products/add-product/use-add-product-form';

// Ported from app/(app)/products/__tests__/price-level-calculation.test.ts,
// which was written against `vitest` — a framework this project does not
// depend on — and was never registered in tests/unit/run.ts, so none of its
// assertions had ever executed (it only surfaced as a typecheck error for the
// missing module). The cases themselves cover real pricing behaviour, so they
// are kept and rewritten against node:assert like the rest of this suite.

// NOTE: these mock levels carry no `adjustmentType`. That is deliberate and
// still meaningful: applyPriceLevelAdjustment treats an unset type as
// 'percentage' for rows written before that column existed, so these cases
// pin the legacy fallback as well as the percentage maths.
const mockPriceLevels = [
  { id: 'level1', name: 'Wholesale', percentageAdjustment: 20, isDefault: false, calculationBase: 'retail' },
  { id: 'level2', name: 'Distributor', percentageAdjustment: -10, isDefault: false, calculationBase: 'cost' },
  { id: 'level3', name: 'Retail', percentageAdjustment: 0, isDefault: true, calculationBase: 'retail' },
];

// positive percentage adjustment, retail base: 100 * (1 + 20/100)
assert.equal(
  calculatePriceLevelPrice('level1', 'retail', mockPriceLevels, 100, 50),
  120,
  'positive percentage adjustment off the retail base',
);

// negative percentage adjustment, cost base: 50 * (1 + -10/100)
assert.equal(
  calculatePriceLevelPrice('level2', 'cost', mockPriceLevels, 100, 50),
  45,
  'negative percentage adjustment off the cost base',
);

// zero adjustment leaves the base untouched
assert.equal(
  calculatePriceLevelPrice('level3', 'retail', mockPriceLevels, 100, 50),
  100,
  'zero percentage adjustment returns the base price unchanged',
);

// An unresolvable level yields 0 rather than silently pricing off the base —
// 0 is what the form reads as "no price computed for this level".
assert.equal(
  calculatePriceLevelPrice('', 'retail', mockPriceLevels, 100, 50),
  0,
  'empty levelId returns 0',
);
assert.equal(
  calculatePriceLevelPrice('nonexistent', 'retail', mockPriceLevels, 100, 50),
  0,
  'unknown levelId returns 0',
);
assert.equal(
  calculatePriceLevelPrice('level1', 'retail', mockPriceLevels, undefined as any, 50),
  0,
  'undefined base price returns 0',
);

// fractional percentage: 200 * 1.155 = 231 (float, so compare with tolerance)
const fractional = calculatePriceLevelPrice(
  'frac',
  'retail',
  [{ id: 'frac', name: 'Fractional', percentageAdjustment: 15.5, isDefault: false, calculationBase: 'retail' }],
  200,
  100,
);
assert.ok(
  Math.abs(fractional - 231) < 1e-9,
  `fractional percentage adjustment: expected ~231, got ${fractional}`,
);

// calculationBase is the caller's choice, NOT the level's own
// `calculationBase` field — level1 is a 'retail' level but priced here off
// cost: 50 * (1 + 20/100).
assert.equal(
  calculatePriceLevelPrice('level1', 'cost', mockPriceLevels, 100, 50),
  60,
  'calculationBase argument selects cost over the retail base price',
);

// Fixed Amount levels post-date the original test. 'fixed' ADDS pesos to the
// base instead of scaling it: 100 + 25 = 125. The value 25 is chosen so the
// result differs from what a percentage reading would give (100 * 1.25 = 125
// would collide, so note the cost-base variant below pins the distinction).
assert.equal(
  calculatePriceLevelPrice(
    'fixedLevel',
    'retail',
    [{ id: 'fixedLevel', name: 'Fixed', adjustmentType: 'fixed', percentageAdjustment: 25, isDefault: false, calculationBase: 'retail' }],
    100,
    50,
  ),
  125,
  'fixed adjustment adds a peso amount to the base price',
);

// Same fixed level off a cost base of 50: 50 + 25 = 75. A percentage reading
// of the same row would give 50 * 1.25 = 62.5, so this case is what actually
// distinguishes 'fixed' from 'percentage'.
assert.equal(
  calculatePriceLevelPrice(
    'fixedLevel',
    'cost',
    [{ id: 'fixedLevel', name: 'Fixed', adjustmentType: 'fixed', percentageAdjustment: 25, isDefault: false, calculationBase: 'retail' }],
    100,
    50,
  ),
  75,
  'fixed adjustment adds pesos (not a percentage) off the cost base',
);

console.log('✓ price-level-calculation');
