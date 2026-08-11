import assert from 'node:assert/strict';

// Mirrors the routing logic added to checkout/route.ts: exactly one of
// siNumber/birOrNumber is non-null for a real sale, both are null for
// training mode, and the choice matches isServiceSale.
function resolveNumbers(isTrainingMode: boolean, isServiceSale: boolean) {
  const siNumber = (isTrainingMode || isServiceSale) ? null : 'SI-WOULD-BE-CALLED';
  const birOrNumber = (isTrainingMode || !isServiceSale) ? null : 'OR-WOULD-BE-CALLED';
  return { siNumber, birOrNumber };
}

assert.deepEqual(
  resolveNumbers(false, false),
  { siNumber: 'SI-WOULD-BE-CALLED', birOrNumber: null },
  'goods, not training: SI assigned, OR null',
);
assert.deepEqual(
  resolveNumbers(false, true),
  { siNumber: null, birOrNumber: 'OR-WOULD-BE-CALLED' },
  'services, not training: OR assigned, SI null',
);
assert.deepEqual(
  resolveNumbers(true, false),
  { siNumber: null, birOrNumber: null },
  'goods, training: neither assigned',
);
assert.deepEqual(
  resolveNumbers(true, true),
  { siNumber: null, birOrNumber: null },
  'services, training: neither assigned',
);

console.log('✓ checkout-si-or-routing');
