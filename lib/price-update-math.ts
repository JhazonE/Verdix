export type AdjustmentType = 'percentage' | 'fixed' | 'exact' | 'markup';

/**
 * Computes a bulk-price adjustment result, rounded to 2 decimals.
 *
 * - percentage/fixed/exact operate on `currentValue`.
 * - markup derives price from `cost` (matches app/(app)/products/add-product/use-add-product-form.ts:364:
 *   price = cost * (1 + markup / 100)) and ignores `currentValue`.
 */
export function applyAdjustment(
  adjustmentType: AdjustmentType,
  currentValue: number,
  value: number,
  cost?: number,
): number {
  let result: number;
  switch (adjustmentType) {
    case 'percentage':
      result = currentValue * (1 + value / 100);
      break;
    case 'fixed':
      result = currentValue + value;
      break;
    case 'exact':
      result = value;
      break;
    case 'markup':
      if (cost == null) throw new Error('cost is required for markup adjustment');
      result = cost * (1 + value / 100);
      break;
    default:
      throw new Error(`Unknown adjustment type: ${adjustmentType}`);
  }
  return Math.round(result * 100) / 100;
}

/**
 * Whether a numeric value is safe to persist as a price or cost: finite and
 * non-negative. Rejects NaN (e.g. a non-numeric Excel cell, or a markup
 * computation over a corrupt/NaN product cost) and negative numbers alike —
 * any comparison against NaN is false, so `Number.isFinite` must be checked
 * explicitly rather than relying on `value >= 0` alone.
 */
export function isValidPriceValue(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}
