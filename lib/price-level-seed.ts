/**
 * Products created without any price-level override row (the common case —
 * most products only ever get a base `price`, never an explicit
 * product_price_levels row) would otherwise show an empty Price Levels tab
 * with no way to see or edit the retail price there. If the product has no
 * existing rows, seeds one for the default level using its live price —
 * otherwise returns the existing rows untouched.
 */
export function seedDefaultPriceLevel(
  existingPriceLevels: { levelId: string; price: number; minQuantity?: number }[],
  priceLevelDefs: any[],
  currentPrice: number | string | null | undefined,
): { levelId: string; price: number; minQuantity?: number }[] {
  if (existingPriceLevels.length > 0) return existingPriceLevels;
  const defaultLevel = priceLevelDefs.find((l: any) => l.isDefault);
  const price = currentPrice == null ? NaN : Number(currentPrice);
  if (!defaultLevel || !Number.isFinite(price)) return existingPriceLevels;
  return [{ levelId: defaultLevel.id, price: parseFloat(price.toFixed(2)), minQuantity: 0 }];
}
