import assert from 'node:assert/strict';
import { computeTrueVariance } from '../../lib/stock-count-baseline';

// The bug this whole change exists to fix: 100 on hand at snapshot, POS sells 10,
// counter finds the correct 90. Naive `counted - snapshot` yields -10 and deducts
// the sale a second time. With the movement window accounted for, variance is 0.
{
  const r = computeTrueVariance({
    snapshotQuantity: 100,
    countedQuantity: 90,
    liveStock: 90,
    netMovementToCount: -10,
    netMovementToNow: -10,
  });
  assert.equal(r.variance, 0, 'sale during count is not variance');
  assert.equal(r.baseline, 90, 'baseline shifted by the sale');
  assert.equal(r.usedFallback, false);
}

// A genuine shortage on top of a sale must still be caught, and must be exactly
// the shortage — not the shortage plus the sale.
{
  const r = computeTrueVariance({
    snapshotQuantity: 100,
    countedQuantity: 87,
    liveStock: 90,
    netMovementToCount: -10,
    netMovementToNow: -10,
  });
  assert.equal(r.variance, -3, 'only the real shortage applies');
}

// No movements at all — the original behaviour, which was correct.
{
  const r = computeTrueVariance({
    snapshotQuantity: 50,
    countedQuantity: 45,
    liveStock: 50,
    netMovementToCount: 0,
    netMovementToNow: 0,
  });
  assert.equal(r.variance, -5, 'plain variance still applies');
  assert.equal(r.baseline, 50);
}

// Receiving stock mid-count is the mirror case and used to over-add.
{
  const r = computeTrueVariance({
    snapshotQuantity: 20,
    countedQuantity: 50,
    liveStock: 50,
    netMovementToCount: 30,
    netMovementToNow: 30,
  });
  assert.equal(r.variance, 0, 'purchase during count is not variance');
}

// Movements landing AFTER the line was counted are already in live stock. They
// must shift neither the baseline nor the variance — the delta is applied to
// live stock, so it stays correct without them.
{
  const r = computeTrueVariance({
    snapshotQuantity: 100,
    countedQuantity: 90,
    liveStock: 85,
    netMovementToCount: -10,
    netMovementToNow: -15,
  });
  assert.equal(r.variance, 0, 'post-count sale is not variance');
  assert.equal(r.baseline, 90, 'baseline anchored at count time, not now');
}

// Safety net: if the movement log cannot explain the gap between snapshot and
// live stock, some write bypassed recordStockMovement. Trusting the baseline
// would corrupt stock, so fall back to live stock (today's effective behaviour).
{
  const r = computeTrueVariance({
    snapshotQuantity: 100,
    countedQuantity: 90,
    liveStock: 60,          // 40 short
    netMovementToCount: -10, // log only explains 10
    netMovementToNow: -10,
  });
  assert.equal(r.usedFallback, true, 'incomplete log detected');
  assert.equal(r.baseline, 60, 'falls back to live stock');
  assert.equal(r.variance, 30, 'variance measured against live stock');
}

// Fractional quantities must survive: repacked goods sync in fractional root
// units, which is why the columns became DECIMAL.
{
  const r = computeTrueVariance({
    snapshotQuantity: 10.5,
    countedQuantity: 8.25,
    liveStock: 10.5,
    netMovementToCount: 0,
    netMovementToNow: 0,
  });
  assert.equal(r.variance, -2.25, 'fractional variance preserved');
}

// Floating-point noise must not register as a variance and write a pointless
// adjustment movement.
{
  const r = computeTrueVariance({
    snapshotQuantity: 0.1 + 0.2, // 0.30000000000000004
    countedQuantity: 0.3,
    liveStock: 0.1 + 0.2,
    netMovementToCount: 0,
    netMovementToNow: 0,
  });
  assert.equal(r.variance, 0, 'sub-epsilon difference is not a variance');
  assert.equal(r.usedFallback, false, 'sub-epsilon drift is not a log gap');
}

console.log('stock-count-baseline: all assertions passed');
