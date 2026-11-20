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

// --- QUANTITY TIERS (restored by migration 134) ---
// A price-level row may carry a minQuantity threshold. There are two ways a
// row becomes a price candidate:
//
//   1. its level is the ACTIVE or DEFAULT level (the long-standing rule), or
//   2. it carries a tier and the quantity has reached it — WHATEVER level it
//      sits on. This is what makes a bulk break automatic: a walk-in customer
//      on Retail who buys 12 gets the Wholesale 12+ price without the cashier
//      switching price level.
//
// Among the rows that qualify, the cheapest wins. A row on an unrelated level
// with NO tier still never applies — untiered overrides stay scoped to the
// active and default levels, so this does not leak every level's price to
// everyone.

// An UNTIERED row on an unrelated level never applies, however high the qty.
{
  const bulkUnit = {
    price: 100,
    priceLevels: [{ levelId: 'some-other-level', price: 90 }],
  };
  assert.equal(
    calculateEffectivePriceForUnit(bulkUnit, 50, retailLevel, retailLevel),
    100,
    'an untiered row on an unmatched level never applies, no matter the quantity',
  );
}

// THE HEADLINE CASE: a tier on a NON-active level fires once the quantity
// reaches it, even though the cart is on Retail.
{
  const unit = {
    price: 105,
    priceLevels: [
      { levelId: wholesaleLevel, price: 102, minQuantity: 12 },
      { levelId: retailLevel, price: 105, minQuantity: 0 },
    ],
  };
  assert.equal(
    calculateEffectivePriceForUnit(unit, 11, retailLevel, retailLevel),
    105,
    'below the tier, a Retail cart pays the Retail price',
  );
  assert.equal(
    calculateEffectivePriceForUnit(unit, 12, retailLevel, retailLevel),
    102,
    'at the tier, a Retail cart automatically gets the tiered Wholesale price',
  );
  assert.equal(
    calculateEffectivePriceForUnit(unit, 50, retailLevel, retailLevel),
    102,
    'above the tier it still applies',
  );
}

// BELOW the threshold, on a cart NOT on that level, the tiered row is skipped
// -> the unit's own price.
{
  const unit = {
    price: 250,
    priceLevels: [{ levelId: wholesaleLevel, price: 200, minQuantity: 12 }],
  };
  assert.equal(
    calculateEffectivePriceForUnit(unit, 11, retailLevel, retailLevel),
    250,
    'below the tier threshold the row is skipped and the unit price stands',
  );
}

// A customer whose OWN level is Wholesale gets the Wholesale price from
// quantity 1, even when that row carries a tier. The tier exists to let
// OTHER carts (walk-in on Retail) reach the price by volume; it must not
// lock the price away from the customers the level was declared for.
{
  const unit = {
    price: 150,
    priceLevels: [{ levelId: wholesaleLevel, price: 130, minQuantity: 12 }],
  };
  assert.equal(
    calculateEffectivePriceForUnit(unit, 1, wholesaleLevel, retailLevel),
    130,
    'a Wholesale customer pays the Wholesale price below its tier',
  );
  assert.equal(
    calculateEffectivePriceForUnit(unit, 1, retailLevel, retailLevel),
    150,
    'a Retail/walk-in cart still has to reach the tier',
  );
}

// The rule is for a NON-default active level only. On the default level a
// tiered row is a volume break for everyone and must still wait for its
// threshold — otherwise every walk-in would get it at quantity 1.
{
  const unit = {
    price: 240,
    priceLevels: [{ levelId: retailLevel, price: 230, minQuantity: 6 }],
  };
  assert.equal(
    calculateEffectivePriceForUnit(unit, 1, retailLevel, retailLevel),
    240,
    'a default-level tier is not unlocked just because default is active',
  );
}

// AT the threshold the tier applies (>=, not >).
{
  const unit = {
    price: 250,
    priceLevels: [{ levelId: wholesaleLevel, price: 200, minQuantity: 12 }],
  };
  assert.equal(
    calculateEffectivePriceForUnit(unit, 12, wholesaleLevel, retailLevel),
    200,
    'at exactly the tier threshold the tiered price applies',
  );
}

// minQuantity 0 (or absent) means NO threshold: it is an ordinary override,
// so it stays scoped to the active/default level.
{
  const zeroTier = {
    price: 250,
    priceLevels: [{ levelId: wholesaleLevel, price: 200, minQuantity: 0 }],
  };
  assert.equal(
    calculateEffectivePriceForUnit(zeroTier, 1, wholesaleLevel, retailLevel),
    200,
    'minQuantity 0 on the ACTIVE level applies from quantity 1',
  );
  assert.equal(
    calculateEffectivePriceForUnit(zeroTier, 99, retailLevel, retailLevel),
    250,
    'minQuantity 0 on an INACTIVE level never applies, however high the qty',
  );

  const noTier = {
    price: 250,
    priceLevels: [{ levelId: wholesaleLevel, price: 200 }],
  };
  assert.equal(
    calculateEffectivePriceForUnit(noTier, 1, wholesaleLevel, retailLevel),
    200,
    'an absent minQuantity behaves as no threshold',
  );
}

// A tier on the DEFAULT level is honoured too, and below it the unit price wins.
{
  const unit = {
    price: 250,
    priceLevels: [{ levelId: retailLevel, price: 230, minQuantity: 6 }],
  };
  assert.equal(
    calculateEffectivePriceForUnit(unit, 5, retailLevel, retailLevel),
    250,
    'a default-level tier below its threshold falls back to the unit price',
  );
  assert.equal(
    calculateEffectivePriceForUnit(unit, 6, retailLevel, retailLevel),
    230,
    'a default-level tier applies once reached',
  );
}

// Several tiers across different levels: every tier the quantity has reached
// competes, and the cheapest wins.
{
  const unit = {
    price: 250,
    priceLevels: [
      { levelId: retailLevel, price: 240, minQuantity: 0 },
      { levelId: wholesaleLevel, price: 200, minQuantity: 12 },
      { levelId: 'bulk-level', price: 180, minQuantity: 60 },
    ],
  };
  assert.equal(
    calculateEffectivePriceForUnit(unit, 1, retailLevel, retailLevel),
    240,
    'below every tier, the untiered default-level row wins',
  );
  assert.equal(
    calculateEffectivePriceForUnit(unit, 12, retailLevel, retailLevel),
    200,
    'the 12+ tier wins once reached',
  );
  assert.equal(
    calculateEffectivePriceForUnit(unit, 60, retailLevel, retailLevel),
    180,
    'the deeper 60+ tier wins once reached',
  );
}

// A tier that is MORE expensive than the current price never raises it:
// Math.min means a qualifying tier can only ever lower what the customer pays.
{
  const unit = {
    price: 100,
    priceLevels: [{ levelId: 'some-other-level', price: 150, minQuantity: 10 }],
  };
  assert.equal(
    calculateEffectivePriceForUnit(unit, 20, retailLevel, retailLevel),
    100,
    'a qualifying tier priced above the unit price never raises the price',
  );
}

// --- A NON-default active level priced ABOVE retail still applies ---
// A customer declared on a dearer level (e.g. "Credit", "Delivery") pays
// that level's price. Previously the min-of-candidates rule let the unit's
// own retail price undercut it, so a dearer level could never apply.
{
  const creditLevel = 'credit-level';
  const unit = {
    price: 100,
    priceLevels: [
      { levelId: retailLevel, price: 100, minQuantity: 0 },
      { levelId: creditLevel, price: 110, minQuantity: 0 },
    ],
  };
  assert.equal(
    calculateEffectivePriceForUnit(unit, 1, creditLevel, retailLevel),
    110,
    'a customer on a dearer level pays that level\'s price, not retail',
  );
  assert.equal(
    calculateEffectivePriceForUnit(unit, 1, retailLevel, retailLevel),
    100,
    'a walk-in on retail is unaffected by the dearer level',
  );

  // A volume break on ANOTHER level the cart reaches may still lower it.
  const withBreak = {
    price: 100,
    priceLevels: [
      { levelId: creditLevel, price: 110, minQuantity: 0 },
      { levelId: wholesaleLevel, price: 90, minQuantity: 12 },
    ],
  };
  assert.equal(
    calculateEffectivePriceForUnit(withBreak, 11, creditLevel, retailLevel),
    110,
    'below another level\'s tier, the dearer active level stands',
  );
  assert.equal(
    calculateEffectivePriceForUnit(withBreak, 12, creditLevel, retailLevel),
    90,
    'a reached volume break still lowers the dearer level',
  );

  // No row for the active level -> unchanged fallback to the unit price.
  assert.equal(
    calculateEffectivePriceForUnit({ price: 100, priceLevels: [] }, 1, creditLevel, retailLevel),
    100,
    'an active level with no row for this unit falls back to the unit price',
  );

  // Regression (Coke Zero Sakto, 2026-11-20): the default-level row was stored
  // with min_quantity = 1. That is the shelf price, not a volume break, and
  // must not undercut a dearer active level just because every cart reaches 1.
  const retailTierAtOne = {
    price: 16,
    priceLevels: [
      { levelId: wholesaleLevel, price: 14, minQuantity: 0 },
      { levelId: creditLevel, price: 30, minQuantity: 0 },
      { levelId: retailLevel, price: 16, minQuantity: 1 },
    ],
  };
  assert.equal(
    calculateEffectivePriceForUnit(retailTierAtOne, 1, creditLevel, retailLevel),
    30,
    'a default-level row at min_quantity 1 does not undercut the active level',
  );
  // A REAL bulk break on the default level still lowers it once reached.
  const retailBulk = {
    price: 16,
    priceLevels: [
      { levelId: creditLevel, price: 30, minQuantity: 0 },
      { levelId: retailLevel, price: 12, minQuantity: 12 },
    ],
  };
  assert.equal(calculateEffectivePriceForUnit(retailBulk, 11, creditLevel, retailLevel), 30);
  assert.equal(calculateEffectivePriceForUnit(retailBulk, 12, creditLevel, retailLevel), 12,
    'a genuine "12+" default-level break still competes');
}

console.log('✅ pricing tests passed');
