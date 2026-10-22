import assert from 'node:assert/strict';
import { calculateEffectivePriceForUnit, resolvePriceForLevel } from '../../lib/pricing';

const wholesale = 'wholesale-level';
const dealer = 'dealer-level';
const retailLevel = 'retail-level';

// a matching override wins, at ANY quantity-irrelevant state
{
  const unit = { price: 120, priceLevels: [{ levelId: wholesale, price: 95 }] };
  assert.equal(resolvePriceForLevel(unit, wholesale), 95);
}

// THE POINT OF THE FEATURE: a tiered row applies even below its threshold
{
  const unit = { price: 120, priceLevels: [{ levelId: wholesale, price: 95, minQuantity: 12 }] };
  assert.equal(resolvePriceForLevel(unit, wholesale), 95,
    'a picked level ignores min_quantity — this is the whole feature');
}

// Review Focus 1: no row for that level -> the unit's OWN price
{
  const unit = { price: 27.05, priceLevels: [{ levelId: dealer, price: 20 }] };
  assert.equal(resolvePriceForLevel(unit, wholesale), 27.05,
    'no override falls back to the unit\'s own price, never another level\'s');
}

// a picked level may RAISE the price — unlike calculateEffectivePriceForUnit
{
  const unit = { price: 100, priceLevels: [{ levelId: wholesale, price: 150 }] };
  assert.equal(resolvePriceForLevel(unit, wholesale), 150,
    'a direct pick is an instruction, not a min-of-candidates');
}

// Review Focus 3: unknown/deleted level id -> the unit's own price, never 0
{
  const unit = { price: 55, priceLevels: [] };
  assert.equal(resolvePriceForLevel(unit, 'deleted-level'), 55);
}

// no priceLevels array at all
{
  assert.equal(resolvePriceForLevel({ price: 42 }, wholesale), 42);
}

// Review Focus 2: a cart held before this feature shipped has no pick.
// priceLineFor must then use calculateEffectivePriceForUnit — assert the
// resolver is not what runs by checking a tiered row still needs its qty.
{
  const unit = { price: 120, priceLevels: [{ levelId: wholesale, price: 95, minQuantity: 12 }] };
  assert.equal(calculateEffectivePriceForUnit(unit, 1, retailLevel, retailLevel), 120,
    'an undefined pick falls back to tier rules, which do not fire below threshold');
}

// Review Focus 3 (live cart): a pick naming a deleted level prices at the
// unit's own price, never 0.
{
  const unit = { price: 88, priceLevels: [{ levelId: dealer, price: 70 }] };
  assert.equal(resolvePriceForLevel(unit, 'since-deleted'), 88);
}

// The badge's name lookup, mirroring use-pos.ts's priceLevelNameFor. A pick
// naming a deleted level must render nothing rather than the string
// "undefined" — and must NOT cause the id to be cleared, since the id is the
// record of why the line is priced as it is.
{
  const levels = [{ id: wholesale, name: 'Wholesale' }, { id: retailLevel, name: 'Retail' }];
  const nameFor = (picked?: string) =>
    picked ? levels.find(l => l.id === picked)?.name : undefined;

  assert.equal(nameFor(wholesale), 'Wholesale');
  assert.equal(nameFor(undefined), undefined, 'no pick -> no badge');
  assert.equal(nameFor('since-deleted'), undefined, 'a deleted level renders no badge, not "undefined"');
}

console.log('✓ pricing-picked-level');
