
import { Product, PriceLevel } from './types';

/**
 * Calculates the effective price for a product based on the active price
 * level.
 *
 * Logic Priority:
 * 1. Override for the ACTIVE Level (Customer or Selected)
 * 2. Override for the DEFAULT Level
 * 3. Base Product Price
 *
 * @param product The product object including its price levels
 * @param quantity Unused — kept for call-site compatibility (see note below)
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
            const price = Number(pl.price);
            const isDefaultTarget = pl.levelId === defaultLevelId;
            const isActiveTarget = activeLevelId && pl.levelId === activeLevelId;

            if (isDefaultTarget || isActiveTarget) {
                priceCandidates.push(price);
            }
        });
    }

    // Return the lowest price among all valid candidates.
    return priceCandidates.length > 0 ? Math.min(...priceCandidates) : Number(product.price);
}

export type SellingUnitPriceLevel = { levelId: string; price: number };
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
      const price = Number(pl.price);
      const isDefaultTarget = pl.levelId === defaultLevelId;
      const isActiveTarget = activeLevelId && pl.levelId === activeLevelId;

      if (isDefaultTarget || isActiveTarget) {
        priceCandidates.push(price);
      }
    });
  }

  return priceCandidates.length > 0 ? Math.min(...priceCandidates) : Number(unit.price);
}
