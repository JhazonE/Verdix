import {
  formatSignedUnitBreakdown,
  formatUnitBreakdown,
  type QuantityUnit,
} from '@/lib/unit-quantity';

/**
 * The selling units to show a count line in, or undefined when the product has
 * only its base unit — those lines keep the plain number they always had.
 */
export function multiUnits(item: { selling_units?: QuantityUnit[] }): QuantityUnit[] | undefined {
  const units = item.selling_units;
  return units && units.length > 1 ? units : undefined;
}

/** A base-unit quantity as "5 Case + 2 Piece", or the plain figure for single-unit products. */
export function fmtQty(item: { selling_units?: QuantityUnit[] }, baseQty: number): string {
  const units = multiUnits(item);
  return units ? formatUnitBreakdown(baseQty, units) : String(baseQty);
}

/** A base-unit variance as "+1 Case", "-3 Piece", or the plain signed figure. */
export function fmtVariance(item: { selling_units?: QuantityUnit[] }, variance: number): string {
  const units = multiUnits(item);
  if (units) return formatSignedUnitBreakdown(variance, units);
  return variance > 0 ? `+${variance}` : String(variance);
}
