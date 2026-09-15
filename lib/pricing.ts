
import { Product, PriceLevel } from './types';

/**
 * Calculates the effective price for a product based on quantity and context.
 * 
 * Logic Priority:
 * 1. Tiered Overrides for the ACTIVE Level (Customer or Selected)
 * 2. Tiered Overrides for the DEFAULT Level
 * 3. Base Product Price
 * 
 * @param product The product object including its price levels
 * @param quantity The quantity being added/viewed
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
    const qty = Number(quantity) || 0;
    
    // Start with a list of valid price candidates
    const priceCandidates: number[] = [];

    // 1. Add the product's base price
    priceCandidates.push(Number(product.price));

    if (product.priceLevels && product.priceLevels.length > 0) {
        // 2. Add prices from price levels that match the current quantity
        product.priceLevels.forEach(pl => {
            const minQty = Number(pl.minQuantity) || 0;
            const price = Number(pl.price);

            // A candidate is valid if:
            // - It matches the exact active level OR is the default level
            // - OR it's a tiered override (minQuantity > 1) and we've met the quantity
            
            const isBasePriceLevel = pl.levelId === activeLevelId || pl.levelId === defaultLevelId;
            const isTierHit = minQty > 1 && qty >= minQty;
            const isDefaultTarget = pl.levelId === defaultLevelId && minQty <= 1;
            const isActiveTarget = activeLevelId && pl.levelId === activeLevelId && minQty <= 1;

            if (isTierHit || isDefaultTarget || isActiveTarget) {
                priceCandidates.push(price);
            }
        });
    }

    // Return the lowest price among all valid candidates
    // This ensures we pick the best tier hit, or the best level price available.
    return priceCandidates.length > 0 ? Math.min(...priceCandidates) : Number(product.price);
}

export type SellingUnitPriceLevel = { levelId: string; price: number; minQuantity?: number };
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
  const qty = Number(quantity) || 0;
  const priceCandidates: number[] = [Number(unit.price)];

  if (unit.priceLevels && unit.priceLevels.length > 0) {
    unit.priceLevels.forEach(pl => {
      const minQty = Number(pl.minQuantity) || 0;
      const price = Number(pl.price);

      const isTierHit = minQty > 1 && qty >= minQty;
      const isDefaultTarget = pl.levelId === defaultLevelId && minQty <= 1;
      const isActiveTarget = activeLevelId && pl.levelId === activeLevelId && minQty <= 1;

      if (isTierHit || isDefaultTarget || isActiveTarget) {
        priceCandidates.push(price);
      }
    });
  }

  return priceCandidates.length > 0 ? Math.min(...priceCandidates) : Number(unit.price);
}
