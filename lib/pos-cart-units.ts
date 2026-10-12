/**
 * Pure, client-safe helpers for resolving which selling unit a POS cart
 * line uses. No imports from `lib/mysql` or any server-only module — this
 * file is imported directly by 'use client' code (`use-pos.ts`), unlike
 * `lib/selling-units.ts`, which touches the DB pool at module scope and
 * must never be imported client-side.
 */

export type CartSellingUnit = {
  id?: string;
  name: string;
  factor: number;
  barcode?: string;
  cost?: number;
  price: number;
  isBase?: boolean;
  priceLevels?: { levelId: string; price: number }[];
};

type CartProduct = {
  price?: number;
  sellingUnits?: CartSellingUnit[];
};

/**
 * A product's base unit (factor 1). Falls back to the product's own plain
 * price only if a product is somehow missing its base entry — every
 * product created after the selling-units migration has one.
 */
export function baseSellingUnitOf(product: CartProduct): CartSellingUnit {
  return (
    product.sellingUnits?.find((u) => u.isBase) ?? {
      name: '',
      factor: 1,
      price: product.price ?? 0,
      priceLevels: [],
    }
  );
}

/**
 * Resolves which selling unit a scanned/typed code, or a plain
 * suggestion/F9-dialog pick (no code), should add to the cart.
 *
 * `code` is the raw scanned/typed string. When it matches a NON-base
 * unit's own barcode, that unit wins. Every other case — no code, an
 * empty code, a match against the product's own top-level barcode, a
 * name/SKU match, or no match at all — resolves to the base unit, which
 * is exactly today's behavior for everything except a non-base barcode.
 */
export function resolveSellingUnitForAdd(product: CartProduct, code?: string): CartSellingUnit {
  const units = product.sellingUnits || [];
  if (code) {
    const trimmed = code.trim().toLowerCase();
    if (trimmed) {
      const byBarcode = units.find(
        (u) => !u.isBase && (u.barcode || '').toLowerCase() === trimmed
      );
      if (byBarcode) return byBarcode;
    }
  }
  return baseSellingUnitOf(product);
}

/**
 * After a quantity edit, promotes a line to the largest selling unit whose
 * factor the line's base-unit total reaches exactly (12 Piece -> 1 Dozen,
 * 2 Pack(x6) -> 1 Dozen). Only exact multiples promote: 13 Piece stays 13
 * Piece rather than becoming a fractional 1.0833 Dozen. Returns the original
 * unit and quantity when nothing larger fits.
 */
export function promoteToLargestUnit(
  quantity: number,
  currentUnit: CartSellingUnit,
  units: CartSellingUnit[] | undefined
): { unit: CartSellingUnit; quantity: number } {
  const unchanged = { unit: currentUnit, quantity };
  if (!units || units.length < 2) return unchanged;
  const EPSILON = 1e-9;
  const totalBase = Number((quantity * currentUnit.factor).toFixed(4));
  if (!Number.isFinite(totalBase) || totalBase <= 0) return unchanged;

  // A non-base line that no longer holds a whole number of its unit (1 Pack
  // minus one piece) drops back to the base unit and counts in pieces.
  if (currentUnit.factor !== 1 && Math.abs(quantity - Math.round(quantity)) > EPSILON) {
    const base = units.find((u) => u.isBase) ?? units.find((u) => u.factor === 1);
    if (base) return promoteToLargestUnit(totalBase, base, units);
  }

  const best = units
    .filter((u) => Number.isFinite(u.factor) && u.factor > currentUnit.factor)
    .sort((a, b) => b.factor - a.factor)
    .find((u) => {
      const ratio = totalBase / u.factor;
      return ratio >= 1 - EPSILON && Math.abs(ratio - Math.round(ratio)) < EPSILON;
    });
  if (!best) return unchanged;
  return { unit: best, quantity: Math.round(totalBase / best.factor) };
}

/**
 * Finds the existing cart line for this exact (product, selling unit)
 * pair, if any. Two lines for the same product but different units are
 * intentionally distinct — a Pack scan must never bump a Piece line's
 * quantity, and vice versa.
 */
export function findCartLineForUnit<T extends { id: string; selectedSellingUnit?: CartSellingUnit }>(
  items: T[],
  productId: string,
  unitId: string | undefined
): T | undefined {
  return items.find((item) => item.id === productId && item.selectedSellingUnit?.id === unitId);
}
