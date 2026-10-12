
import { Product, PriceLevel } from './types';

/**
 * Decides whether one price-level row competes on price, given the active
 * level and the quantity being bought.
 *
 * There are two independent ways in:
 *
 * 1. The row's level is the ACTIVE or the DEFAULT level. This is the
 *    long-standing rule and covers every ordinary override.
 * 2. The row carries a quantity tier the buyer has reached — on ANY level.
 *    This is what makes a bulk break automatic: a walk-in customer on Retail
 *    who buys 12 gets the Wholesale "12+" price without the cashier
 *    switching price level, which is the whole point of a quantity break.
 *
 * A tier applies from its threshold UP (>=, so "12+" applies at exactly 12);
 * below it the row simply does not compete, which is what makes the unit's
 * own price the natural fallback with no separate below-threshold branch.
 *
 * An UNTIERED row on some third level still never applies — otherwise every
 * level's price would leak to every customer. Only a deliberate tier opts a
 * row into being visible outside its own level. And because the caller takes
 * the MINIMUM of the qualifying candidates, a qualifying tier can only ever
 * lower the price, never raise it.
 */
function qualifies(
    pl: { levelId: string; minQuantity?: number | null },
    quantity: number,
    activeLevelId: string | undefined,
    defaultLevelId: string,
): boolean {
    const threshold = Number(pl.minQuantity ?? 0);
    const hasTier = Number.isFinite(threshold) && threshold > 0;

    if (hasTier) return Number(quantity) >= threshold;

    return pl.levelId === defaultLevelId || (!!activeLevelId && pl.levelId === activeLevelId);
}

/**
 * Calculates the effective price for a product based on the active price
 * level and the quantity being bought.
 *
 * Candidates, cheapest of which wins:
 * 1. Untiered override for the ACTIVE Level (Customer or Selected)
 * 2. Untiered override for the DEFAULT Level
 * 3. Any TIERED override whose threshold this quantity has reached, on any
 *    level — so a bulk break fires automatically without switching level
 * 4. The Base Product Price, always
 *
 * See `qualifies` for why an untiered row stays scoped to its level while a
 * tiered one does not.
 *
 * @param product The product object including its price levels
 * @param quantity Quantity being bought — decides which quantity tiers apply
 * @param activeLevelId The currently active price level ID (from customer or manual selection)
 * @param defaultLevelId The system's default price level ID (usually 'retail-level')
 * @returns The calculated effective price
 */
export function calculateEffectivePrice(
    product: Product,
    quantity: number,
    activeLevelId?: string,
    defaultLevelId: string = 'retail-level'
): number {
    // Start with a list of valid price candidates
    const priceCandidates: number[] = [];

    // 1. Add the product's base price
    priceCandidates.push(Number(product.price));

    if (product.priceLevels && product.priceLevels.length > 0) {
        // 2. Add the price from whichever level row matches the active level
        // or the default level.
        product.priceLevels.forEach(pl => {
            if (qualifies(pl, quantity, activeLevelId, defaultLevelId)) {
                priceCandidates.push(Number(pl.price));
            }
        });
    }

    // Return the lowest price among all valid candidates.
    return priceCandidates.length > 0 ? Math.min(...priceCandidates) : Number(product.price);
}

export type SellingUnitPriceLevel = {
  levelId: string;
  price: number;
  /**
   * Quantity threshold this price applies from. 0 or absent means no
   * threshold. Stored per selling unit in
   * product_selling_unit_price_levels.min_quantity.
   *
   * Setting a tier also WIDENS the row's reach: a tiered row competes on any
   * cart that reaches the threshold, not only one on its own price level.
   * See `qualifies`.
   */
  minQuantity?: number;
};
export type PricedSellingUnit = { price: number; priceLevels?: SellingUnitPriceLevel[] };

/**
 * Same resolution rule as calculateEffectivePrice, applied to ONE selling
 * unit instead of a product: the unit's own price levels are checked first,
 * and a level with no override for this unit falls back to the unit's own
 * `price` — never another unit's price, never a computed multiple.
 *
 * This function structurally cannot see another unit's data (it only takes
 * one unit's price and price levels), which is what makes "never pulls
 * another unit's price" a guarantee rather than a convention.
 *
 * Quantity tiers apply per unit too: `quantity` is counted in THIS unit's
 * terms (3 Cases, not 180 pieces), so a tier set on a Case means "3 cases or
 * more", never "180 base units or more".
 */
export function calculateEffectivePriceForUnit(
  unit: PricedSellingUnit,
  quantity: number,
  activeLevelId?: string,
  defaultLevelId: string = 'retail-level'
): number {
  const priceCandidates: number[] = [Number(unit.price)];

  if (unit.priceLevels && unit.priceLevels.length > 0) {
    unit.priceLevels.forEach(pl => {
      if (qualifies(pl, quantity, activeLevelId, defaultLevelId)) {
        priceCandidates.push(Number(pl.price));
      }
    });
  }

  return priceCandidates.length > 0 ? Math.min(...priceCandidates) : Number(unit.price);
}
