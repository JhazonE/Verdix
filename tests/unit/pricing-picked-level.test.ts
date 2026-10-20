import assert from 'node:assert/strict';
import { resolvePriceForLevel } from '../../lib/pricing';

const wholesale = 'wholesale-level';
const dealer = 'dealer-level';

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

console.log('✓ pricing-picked-level');
