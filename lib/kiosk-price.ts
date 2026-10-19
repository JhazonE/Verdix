import type { Product } from './types';
import { calculateEffectivePriceForUnit } from './pricing';

/**
 * Price resolution for the self-service price-checker kiosk (`/price-check`).
 *
 * Deliberately NOT a client module: this repo's unit tests are plain `tsx`
 * scripts with no React runtime, so a `'use client'` file can only be tested
 * by reading its source as text. Keeping the pure function here lets the test
 * call it for real.
 *
 * Two things are fixed by the kiosk's situation:
 *
 * - **Default price level.** There is no cashier at an unattended terminal, so
 *   nobody can select a level. The kiosk always asks at the default.
 * - **Quantity 1.** The customer is holding one item.
 *
 * The UNIT, however, is not fixed: it is whichever unit the scanned barcode
 * belongs to, falling back to the base unit when nothing was scanned or the
 * code is unknown. This mirrors POS's `resolveSellingUnitForAdd`
 * (`lib/pos-cart-units.ts`) — scanning a Case barcode must quote the Case
 * price, not the Piece price it is packed from.
 *
 * Price comes from `calculateEffectivePriceForUnit`, the SAME function POS
 * calls for a cart line. That makes agreement structural rather than a
 * coincidence of today's data: reading `products.price` instead would miss a
 * `min_quantity = 1` tier, which `qualifies` lets compete on any price level,
 * so POS would honour a discount the kiosk never showed. A kiosk that quotes a
 * figure the register will not honour is worse than no kiosk, so this must
 * never grow its own price arithmetic.
 */
export type KioskResult = {
  product: Product;
  price: number;
  unitName: string;
  barcode: string;
};

export function resolveKioskPrice(
  product: Product,
  defaultLevelId: string,
  scannedCode?: string,
): KioskResult {
  // `sellingUnits` is optional: rows predating the selling-unit migration have
  // none, and must still render rather than crash on an undefined base unit.
  const units = product.sellingUnits ?? [];
  const baseUnit = units.find((su) => su.isBase);

  // Same precedence as POS: an exact non-base barcode wins, otherwise base.
  const trimmed = (scannedCode ?? '').trim().toLowerCase();
  const scannedUnit = trimmed
    ? units.find((u) => !u.isBase && (u.barcode || '').toLowerCase() === trimmed)
    : undefined;

  const unit = scannedUnit ?? baseUnit;

  // activeLevelId === defaultLevelId: there is no level to switch to here.
  const price = unit
    ? calculateEffectivePriceForUnit(unit as any, 1, defaultLevelId, defaultLevelId)
    : Number(product.price);

  return {
    product,
    price,
    unitName: unit?.name || product.unitOfMeasure || '',
    // Echo the unit actually being quoted, so the screen can never show one
    // unit's barcode beside another unit's price.
    barcode: unit?.barcode || product.barcode || '',
  };
}
