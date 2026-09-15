import assert from 'node:assert/strict';
import { calculateEffectivePriceForUnit } from '../../lib/pricing';

/**
 * A selling unit with its own price-level rows, plus the fallback rule: no
 * row for the active level -> the unit's OWN price, never another unit's.
 */

const wholesaleLevel = 'wholesale-level';
const retailLevel = 'retail-level';

// --- a unit WITH a Wholesale override uses it ---
{
  const caseUnit = {
    price: 1591.5,
    priceLevels: [{ levelId: wholesaleLevel, price: 1400, minQuantity: 0 }],
  };
  const price = calculateEffectivePriceForUnit(caseUnit, 1, wholesaleLevel, retailLevel);
  assert.equal(price, 1400, 'a unit with a matching level override uses it');
}

// --- a unit WITHOUT a Wholesale override falls back to ITS OWN price ---
{
  const pieceUnit = { price: 27.05, priceLevels: [] };
  const price = calculateEffectivePriceForUnit(pieceUnit, 1, wholesaleLevel, retailLevel);
  assert.equal(price, 27.05, 'no override falls back to the unit\'s own price');
}

// --- CRUCIAL: a unit's missing override must NOT pull another unit's price ---
// This is the property the whole feature exists to guarantee — a Case's
// missing Wholesale price must never resolve to the Piece's Wholesale price,
// scaled or otherwise. The function only ever sees ONE unit's data, so it is
// structurally incapable of reaching across units; this test documents that
// as an explicit contract, not an accident of the signature.
{
  const caseUnitNoOverride = { price: 1591.5, priceLevels: [] };
  const pieceWholesale = 22; // a different unit's price — must never appear
  const price = calculateEffectivePriceForUnit(caseUnitNoOverride, 1, wholesaleLevel, retailLevel);
  assert.notEqual(price, pieceWholesale, 'never resolves to another unit\'s price');
  assert.equal(price, 1591.5, 'falls back to its own price exactly');
}

// --- tiered minimum-quantity overrides still work, per unit ---
{
  const bulkUnit = {
    price: 100,
    priceLevels: [{ levelId: retailLevel, price: 90, minQuantity: 10 }],
  };
  assert.equal(
    calculateEffectivePriceForUnit(bulkUnit, 5, retailLevel, retailLevel),
    100,
    'below the tier minimum, the tier price does not apply',
  );
  assert.equal(
    calculateEffectivePriceForUnit(bulkUnit, 10, retailLevel, retailLevel),
    90,
    'at the tier minimum, the tier price applies',
  );
}

console.log('✅ pricing tests passed');
