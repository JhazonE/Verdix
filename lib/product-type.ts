/**
 * Product type predicate.
 *
 * Services are products that sell without stock: no FIFO batches, no stock
 * movements, no family sync, never out of stock.
 *
 * Everything that branches on product type goes through this module so the
 * check lives in exactly one place.
 */

export type ProductType = 'standard' | 'service';

export const PRODUCT_TYPES: readonly ProductType[] = ['standard', 'service'] as const;

/**
 * True only for an explicit 'service' type.
 *
 * Defaults to false for null/undefined/unknown values. This direction matters:
 * a missing type must behave as a stocked product, so a bad read can never
 * cause stock to silently stop being deducted.
 */
export function isService(product: { type?: string | null }): boolean {
  return product?.type === 'service';
}
