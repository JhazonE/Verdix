/**
 * Applies a price level's adjustment to a resolved base price.
 *
 * - 'percentage' (or an unset/legacy adjustmentType, for rows written before
 *   this field existed): basePrice * (1 + value / 100).
 * - 'fixed': basePrice + value (value is a positive peso amount).
 *
 * Both adjustment types are positive-only by house rule — this function
 * does not enforce that itself (callers validate on save); it just applies
 * whatever value it's given.
 */
export function applyPriceLevelAdjustment(
  adjustmentType: 'percentage' | 'fixed' | undefined,
  value: number | undefined,
  basePrice: number,
): number {
  const v = Number(value) || 0;
  if (adjustmentType === 'fixed') {
    return basePrice + v;
  }
  return basePrice * (1 + v / 100);
}
