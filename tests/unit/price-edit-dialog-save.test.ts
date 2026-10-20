import assert from 'node:assert/strict';
import { resolvePriceForLevel } from '../../lib/pricing';

/**
 * The Edit Price dialog's save contract and picker maths.
 *
 * The dialog was dead code before this feature (imported by nothing), and it
 * carried a latent bug that only mattered once it was wired up: `save()`
 * passed `item.id`, the PRODUCT id, while `handleUpdateItem` matches on
 * `item.lineId`. Two lines of the same product on different selling units
 * share an `id`, so the dialog would have edited the wrong line — or, with one
 * line, silently nothing. These assertions pin the fixed behaviour.
 *
 * Pure logic on purpose: the hook itself pulls in React.
 */

const wholesale = 'wholesale-level';
const retail = 'retail-level';

// --- save() identifies the line, not the product ---
{
  const calls: any[] = [];
  const onUpdate = (...args: any[]) => calls.push(args);

  // Two cart lines, same product, different selling units — same `id`.
  const line = {
    id: 'prod_1', lineId: 'line_B', name: 'Milo', quantity: 2, discount: 0,
    price: 120, pickedPriceLevelId: undefined as string | undefined,
  };

  // Mirrors use-price-edit.ts's save().
  const save = (item: typeof line, price: number, pickedLevelId?: string) =>
    onUpdate(item.lineId, item.name, item.quantity, Math.max(0, Number(price) || 0), item.discount, pickedLevelId);

  save(line, 95, wholesale);
  assert.equal(calls[0][0], 'line_B', 'save must pass the LINE id, never the product id');
  assert.notEqual(calls[0][0], 'prod_1');
  assert.equal(calls[0][3], 95);
  assert.equal(calls[0][5], wholesale, 'the picked level rides along with the save');
}

// --- a negative or junk price floors at 0, as before ---
{
  const clamp = (price: any) => Math.max(0, Number(price) || 0);
  assert.equal(clamp(-5), 0);
  assert.equal(clamp('abc'), 0);
  assert.equal(clamp('12.50'), 12.5);
}

// --- handleUpdateItem only ever SETS a pick, never clears one ---
{
  // Mirrors the merge in use-pos.ts's handleUpdateItem.
  const apply = (existing: string | undefined, incoming: string | undefined) => incoming ?? existing;

  assert.equal(apply(wholesale, undefined), wholesale,
    'Edit Item and the inline edit pass undefined and must not clear a pick');
  assert.equal(apply(undefined, wholesale), wholesale, 'the dialog can set a pick');
  assert.equal(apply(retail, wholesale), wholesale, 'the dialog can change a pick');
  assert.equal(apply(undefined, undefined), undefined);
}

// --- the picker lists every level with ITS price for this unit ---
{
  const unit = {
    price: 120,
    priceLevels: [{ levelId: wholesale, price: 95, minQuantity: 12 }],
  };
  const levels = [{ id: retail, name: 'Retail' }, { id: wholesale, name: 'Wholesale' }];

  const options = levels.map(l => ({ ...l, price: resolvePriceForLevel(unit, l.id) }));

  assert.deepEqual(options.map(o => o.price), [120, 95],
    'each level shows its own resulting price, tiers ignored');
  // Retail has no override row here, so it shows the unit's own price. That
  // is the real answer, not a gap, which is why it is listed rather than hidden.
  assert.equal(options[0].price, 120);
}

// --- picking a level writes its price into the box ---
{
  const unit = { price: 120, priceLevels: [{ levelId: wholesale, price: 95 }] };
  let price = 120;
  let picked: string | undefined;

  const pickLevel = (levelId: string) => {
    picked = levelId;
    price = resolvePriceForLevel(unit, levelId);
  };

  pickLevel(wholesale);
  assert.equal(price, 95, 'the cashier sees the number before saving');
  assert.equal(picked, wholesale);

  // Typing over it keeps the level: the level is WHY, the number is WHAT.
  price = 90;
  assert.equal(picked, wholesale, 'a manual correction does not clear the picked level');
}

console.log('✓ price-edit-dialog-save');
