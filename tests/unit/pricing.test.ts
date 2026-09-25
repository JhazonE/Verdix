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
    priceLevels: [{ levelId: wholesaleLevel, price: 1400 }],
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

// --- tiered/quantity-break pricing has been removed: a price-level row for
// a level that is neither the active nor the default level must never apply,
// no matter how high the quantity is. Under the old tiered logic, a row
// carrying a minQuantity > 1 would win once quantity crossed that threshold
// even for an unrelated level — that behavior must be gone. ---
{
  const bulkUnit = {
    price: 100,
    priceLevels: [{ levelId: 'some-other-level', price: 90, minQuantity: 10 } as any],
  };
  assert.equal(
    calculateEffectivePriceForUnit(bulkUnit, 50, retailLevel, retailLevel),
    100,
    'a row for an unmatched level never applies, no matter the quantity or any leftover minQuantity data',
  );
}

// --- the other side of the same removal: a row for the ACTIVE level with
// leftover minQuantity data now applies unconditionally, even at quantity 1
// (below its old tier threshold). This is the exact behavior change the
// migration's data audit warns about for real min_quantity > 1 rows. ---
{
  const bulkUnitActiveLevel = {
    price: 100,
    priceLevels: [{ levelId: wholesaleLevel, price: 90, minQuantity: 12 } as any],
  };
  assert.equal(
    calculateEffectivePriceForUnit(bulkUnitActiveLevel, 1, wholesaleLevel, retailLevel),
    90,
    'an active-level row now applies from quantity 1, even with leftover minQuantity > 1',
  );
}

console.log('✅ pricing tests passed');
