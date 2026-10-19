import type { Product } from './types';
import { calculateEffectivePrice } from './pricing';

/**
 * Price resolution for the self-service price-checker kiosk (`/price-check`).
 *
 * Deliberately NOT a client module: this repo's unit tests are plain `tsx`
 * scripts with no React runtime, so a `'use client'` file can only be tested
 * by reading its source as text. Keeping the pure function here lets the test
 * call it for real.
 *
 * Three things are fixed by the kiosk's situation, and all three matter:
 *
 * - **Default price level.** There is no cashier at an unattended terminal, so
 *   nobody can select a level. The kiosk always asks at the default.
 * - **Quantity 1.** The customer is holding one item. This also means a
 *   quantity tier ("12+") can never qualify, which is the point — a bulk price
 *   must not be advertised as the price of one, or the screen and the till
 *   disagree.
 * - **The base unit.** A Case has its own price, but what an ordinary customer
 *   carries to the register is the Piece.
 *
 * Price itself comes from `calculateEffectivePrice`, the same resolver POS
 * uses. A kiosk that quotes a figure the register will not honour is worse
 * than no kiosk at all, so this must never grow its own price arithmetic.
 */
export type KioskResult = {
  product: Product;
  price: number;
  unitName: string;
  barcode: string;
};

export function resolveKioskPrice(product: Product, defaultLevelId: string): KioskResult {
  // `sellingUnits` is optional: rows predating the selling-unit migration have
  // none, and must still render rather than crash on an undefined base unit.
  const baseUnit = product.sellingUnits?.find((su) => su.isBase);

  return {
    product,
    // activeLevelId === defaultLevelId: there is no level to switch to here.
    price: calculateEffectivePrice(product, 1, defaultLevelId, defaultLevelId),
    unitName: baseUnit?.name || product.unitOfMeasure || '',
    barcode: baseUnit?.barcode || product.barcode || '',
  };
}
