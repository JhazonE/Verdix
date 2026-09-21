import type { Product } from '@/lib/types';

export type ProductUnitRow = {
  key: string;
  product: Product;
  unit?: Product['sellingUnits'] extends (infer U)[] | undefined ? U : never;
};

/**
 * A product with more than one selling unit (e.g. a Pack alongside its base
 * Piece) explodes into one row per unit, so a picker can offer exactly which
 * one to add rather than always defaulting to the base unit. Services carry
 * no sellingUnits and a single-unit product's own units array has just the
 * base entry, so both collapse to a single row as before.
 */
export function explodeToUnitRows(products: Product[]): ProductUnitRow[] {
  const rows: ProductUnitRow[] = [];
  for (const product of products) {
    const units = product.type === 'service' ? [] : (product.sellingUnits || []);
    if (units.length > 1) {
      for (const unit of units) rows.push({ key: `${product.id}:${unit.id}`, product, unit });
    } else {
      rows.push({ key: product.id, product, unit: units[0] });
    }
  }
  return rows;
}
