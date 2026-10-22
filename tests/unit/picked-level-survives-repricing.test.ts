import assert from 'node:assert/strict';
import { calculateEffectivePriceForUnit, resolvePriceForLevel } from '../../lib/pricing';

/**
 * Constraint 1 of the price level picker design: a picked level must survive
 * every path that re-prices a cart line.
 *
 * `use-pos.ts` funnels all of those through one helper, `priceLineFor`, so
 * that a partial fix is impossible. This test reproduces that helper exactly
 * and drives it the way each call site does. If the hook ever stops routing a
 * site through the helper, that is a wrong-price bug at the till and this file
 * is the thing that should have caught it — so the reproduction below must be
 * kept in step with the real one.
 *
 * It is a pure-logic test on purpose: use-pos.ts cannot be imported here (it
 * pulls in React, the toast system and lib/mysql's cron side effects).
 */

const retail = 'retail-level';
const wholesale = 'wholesale-level';

// The helper, mirroring use-pos.ts's priceLineFor.
const priceLineFor = (
  unit: { price: number; priceLevels?: { levelId: string; price: number; minQuantity?: number }[] },
  quantity: number,
  pickedPriceLevelId: string | undefined,
  activeLevelId: string,
) => pickedPriceLevelId
  ? resolvePriceForLevel(unit, pickedPriceLevelId)
  : calculateEffectivePriceForUnit(unit, quantity, activeLevelId, retail);

// A unit whose Wholesale row is TIERED at 12. Under the ordinary rules it
// does not fire below 12, which makes it a sharp probe: if a picked level is
// ever lost, the price visibly springs back to 120.
const unit = { price: 120, priceLevels: [{ levelId: wholesale, price: 95, minQuantity: 12 }] };

// --- baseline: no pick, the tier rules stand ---
{
  assert.equal(priceLineFor(unit, 1, undefined, retail), 120,
    'no pick, below the tier -> shelf price');
  assert.equal(priceLineFor(unit, 12, undefined, retail), 95,
    'no pick, at the tier -> the automatic break still fires');
}

// --- the pick itself ---
{
  assert.equal(priceLineFor(unit, 1, wholesale, retail), 95,
    'a picked level applies at quantity 1, below the tier');
}

// --- SITE 1: the cart-wide level changes (use-pos.ts level-change effect) ---
{
  // The effect recomputes every line, then keeps the result only if a price
  // actually moved. A picked line must resolve to the SAME number, so it is
  // left alone no matter where the cart-wide level goes.
  const before = priceLineFor(unit, 1, wholesale, retail);
  const after = priceLineFor(unit, 1, wholesale, 'some-other-level');
  assert.equal(after, before, 'a picked line does not follow the cart-wide level');
  assert.equal(after, 95);
}

// --- SITE 2: the quantity changes (updateQuantity) — the headline case ---
{
  for (const qty of [1, 2, 5, 11, 12, 50]) {
    assert.equal(priceLineFor(unit, qty, wholesale, retail), 95,
      `a picked level holds at quantity ${qty} — it must not snap back`);
  }
}

// --- SITE 3: the item is re-scanned (handleAddItem existing-line branch) ---
{
  // The bump passes the EXISTING line's pick, so the price holds.
  let line = { quantity: 1, pickedPriceLevelId: wholesale as string | undefined, price: 95 };
  for (let i = 0; i < 3; i++) {
    const newQty = line.quantity + 1;
    line = { ...line, quantity: newQty, price: priceLineFor(unit, newQty, line.pickedPriceLevelId, retail) };
  }
  assert.equal(line.quantity, 4);
  assert.equal(line.price, 95, 'three re-scans do not undo the pick');
}

// --- SITE 4: a new line carries no pick and follows the cart ---
{
  assert.equal(priceLineFor(unit, 1, undefined, retail), 120,
    'a fresh line is unaffected by another line having a pick');
}

// --- SITE 5: two lines merge on unit promotion (updateQuantity merge branch) ---
{
  // The promoted line's pick wins; the sibling's applies only if it has none.
  const promotedPick = (target?: string, sibling?: string) => target ?? sibling;
  assert.equal(promotedPick(wholesale, undefined), wholesale, 'the acted-on line keeps its pick');
  assert.equal(promotedPick(undefined, wholesale), wholesale, "the sibling's pick is not dropped");
  assert.equal(promotedPick(undefined, undefined), undefined, 'neither picked -> follow the cart');
  assert.equal(priceLineFor(unit, 13, promotedPick(wholesale, undefined), retail), 95);
}

// --- the serialization doors: localStorage, hold/restore, queue claim/recall ---
{
  // All four spread the whole item through JSON or an object spread, so a
  // scalar field survives. Prove the round trip keeps both the pick and the
  // price it implies.
  const line = { lineId: 'l1', quantity: 3, price: 95, pickedPriceLevelId: wholesale };
  const restored = JSON.parse(JSON.stringify({ items: [line] })).items[0];
  assert.equal(restored.pickedPriceLevelId, wholesale, 'the pick survives JSON');

  // withLineIds only backfills a missing lineId; it must not drop the pick.
  const withLineIds = (list: any[]) =>
    (list || []).map(item => (item.lineId ? item : { ...item, lineId: 'generated' }));
  assert.equal(withLineIds([restored])[0].pickedPriceLevelId, wholesale);
  const noLineId = { quantity: 3, price: 95, pickedPriceLevelId: wholesale };
  assert.equal(withLineIds([noLineId])[0].pickedPriceLevelId, wholesale,
    'backfilling a lineId preserves the pick');

  // A restored line is NOT re-priced against the new cart-wide level.
  assert.equal(priceLineFor(unit, restored.quantity, restored.pickedPriceLevelId, 'another-level'), 95);
}

// --- a cart held BEFORE this feature shipped has no field at all ---
{
  const old = JSON.parse(JSON.stringify({ lineId: 'l1', quantity: 1, price: 120 }));
  assert.equal(old.pickedPriceLevelId, undefined);
  assert.equal(priceLineFor(unit, 1, old.pickedPriceLevelId, retail), 120,
    'undefined means follow the cart, which is the correct reading for an old cart');
}

// --- a pick naming a level that has since been deleted ---
{
  assert.equal(priceLineFor(unit, 1, 'since-deleted', retail), 120,
    'a stale pick degrades to the shelf price, never to 0');
}

console.log('✓ picked-level-survives-repricing');
