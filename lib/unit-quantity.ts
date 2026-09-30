// Pure helpers for showing and entering stock in a product's selling units.
// `products.stock` is always base units; these only translate at the edges.
// Kept free of DB imports so client components and unit tests can use them.

export type QuantityUnit = {
  id?: string;
  name: string;
  factor: number;
  isBase?: boolean;
};

export type UnitEntry<U extends QuantityUnit = QuantityUnit> = {
  unit: U;
  quantity: number;
};

// Guards against float noise (e.g. 0.1 * 3) leaking into a whole-unit split.
const EPSILON = 1e-9;

/**
 * Break a base-unit figure into selling units, largest first. Zero entries are
 * omitted. Any fractional remainder stays on the base unit. Negative stock is
 * not split — it is reported on the base unit as-is, since "-1 Case + 6 Piece"
 * would obscure the fact that stock has gone below zero.
 */
export function splitIntoUnits<U extends QuantityUnit>(baseQty: number, units: U[]): UnitEntry<U>[] {
  if (!Number.isFinite(baseQty) || baseQty === 0 || units.length === 0) return [];

  const base = units.find((u) => u.isBase) ?? units.find((u) => u.factor === 1) ?? units[0];
  if (baseQty < 0) return [{ unit: base, quantity: baseQty }];

  const sorted = [...units]
    .filter((u) => Number.isFinite(u.factor) && u.factor > 0)
    .sort((a, b) => b.factor - a.factor);

  const entries: UnitEntry<U>[] = [];
  let remaining = baseQty;
  for (const unit of sorted) {
    if (unit === base) continue;
    const whole = Math.floor(remaining / unit.factor + EPSILON);
    if (whole > 0) {
      entries.push({ unit, quantity: whole });
      remaining -= whole * unit.factor;
    }
  }
  if (remaining > EPSILON) {
    entries.push({ unit: base, quantity: Number(remaining.toFixed(4)) });
  }
  return entries;
}

/** "5 Case + 2 Pack + 3 Piece". A product with no selling units shows a plain figure. */
export function formatUnitBreakdown(
  baseQty: number,
  units?: QuantityUnit[],
  fallbackLabel?: string,
): string {
  if (!units || units.length === 0) {
    return fallbackLabel ? `${baseQty} ${fallbackLabel}` : String(baseQty);
  }
  const entries = splitIntoUnits(baseQty, units);
  if (entries.length === 0) {
    const base = units.find((u) => u.isBase) ?? units[0];
    return `0 ${base.name}`;
  }
  return entries.map((e) => `${e.quantity} ${e.unit.name}`).join(' + ');
}

/**
 * Variance-style breakdown: "+1 Case + 2 Piece", "-3 Piece", "-(1 Case + 6 Piece)".
 * The sign applies to the whole quantity, so a multi-part shortfall is wrapped
 * rather than left reading like "-1 Case + 6 Piece".
 */
export function formatSignedUnitBreakdown(baseQty: number, units?: QuantityUnit[]): string {
  if (!baseQty) return '0';
  if (!units || units.length === 0) return baseQty > 0 ? `+${baseQty}` : String(baseQty);
  const body = formatUnitBreakdown(Math.abs(baseQty), units);
  if (baseQty > 0) return `+${body}`;
  return body.includes(' + ') ? `-(${body})` : `-${body}`;
}

/** Base-unit total of quantities entered per selling unit. Throws on a bad factor. */
export function sumToBase(entries: UnitEntry[]): number {
  let total = 0;
  for (const { unit, quantity } of entries) {
    if (!Number.isFinite(unit.factor) || unit.factor <= 0) {
      throw new Error(`Invalid selling unit factor: ${unit.factor}`);
    }
    total += quantity * unit.factor;
  }
  return total;
}

export type RepackOutcome = {
  /** Base units taken out of the pack being opened/merged. */
  baseUsed: number;
  /** Target-unit quantity the conversion predicts. */
  expectedProduced: number;
  /** Target-unit quantity actually obtained (defaults to expected). */
  actualProduced: number;
  /** Base units lost between what went in and what came out. */
  shortfallBase: number;
};

/**
 * Repackaging inside one product. Stock is a single base-unit figure, so
 * converting Case -> Piece changes nothing by itself; the only stock effect is
 * a shortfall when fewer target units come out than the factors predict.
 * More output than input is rejected: that would create stock from nothing,
 * and the right tool for a genuine surplus is a stock adjustment.
 */
export function repackOutcome(input: {
  quantity: number;
  fromFactor: number;
  toFactor: number;
  actualProduced?: number | null;
}): RepackOutcome {
  const { quantity, fromFactor, toFactor } = input;
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Quantity must be greater than zero');
  for (const f of [fromFactor, toFactor]) {
    if (!Number.isFinite(f) || f <= 0) throw new Error(`Invalid selling unit factor: ${f}`);
  }

  const baseUsed = quantity * fromFactor;
  const expectedProduced = baseUsed / toFactor;
  const actualProduced =
    input.actualProduced === undefined || input.actualProduced === null
      ? expectedProduced
      : input.actualProduced;

  if (!Number.isFinite(actualProduced) || actualProduced < 0) {
    throw new Error('Actual quantity obtained cannot be negative');
  }
  if (actualProduced > expectedProduced + EPSILON) {
    throw new Error('Actual quantity obtained cannot exceed what the conversion allows');
  }

  const shortfallBase = Number(((expectedProduced - actualProduced) * toFactor).toFixed(4));
  return { baseUsed, expectedProduced, actualProduced, shortfallBase: shortfallBase > EPSILON ? shortfallBase : 0 };
}
