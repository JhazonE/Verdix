import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number | string) {
  const value = typeof amount === 'string' ? parseFloat(amount) : amount;
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
  }).format(value || 0);
}

/**
 * Safely converts any value to a number.
 * Returns 0 if the value is null, undefined, NaN, or non-numeric.
 */
export function toSafeNumber(value: any): number {
  if (value === null || value === undefined) return 0;
  const num = typeof value === 'string' ? parseFloat(value) : Number(value);
  return isNaN(num) ? 0 : num;
}
/**
 * Formats a quantity for display, stripping trailing zeros for decimals.
 * Example: 8.000 -> "8", 8.500 -> "8.5", 8.1234 -> "8.1234"
 *
 * Never rounds. Quantities are stored as DECIMAL(15,4) and a product sold by
 * weight genuinely holds a fraction, so rounding would misreport real data:
 * selling 1.5 kg takes stock from 12 to 10.5, and showing that as 11 tells the
 * user their stock is wrong when the database is correct.
 *
 * The `unit` parameter is accepted for compatibility with the many call sites
 * that pass one, and is ignored. The old behaviour rounded UNLESS the caller
 * remembered to pass "kilogram"/"kg", which made correctness depend on an
 * easily forgotten argument. A caller that genuinely wants a whole number
 * should round at the call site, where that intent is visible.
 */
export function formatQuantity(value: any, unit?: string): string {
  const num = toSafeNumber(value);
  return String(Number(num.toFixed(4)));
}

/**
 * Formats a stock quantity for display in inventory tables.
 *
 * Never rounds, for the same reason as `formatQuantity`: `products.stock` is
 * DECIMAL(15,4) and a fraction in it is real data, not an artifact of unit
 * conversion. The old Math.ceil here was the bug behind "POS tendered 1.5 but
 * the product page still shows a whole number" -- the sale had deducted
 * correctly and only the display was rounding 10.5 up to 11.
 *
 * It also rounded the wrong way for a shortfall: Math.ceil(-2.5) is -2, which
 * understates oversold stock.
 *
 * The `unit` parameter is accepted and ignored; see `formatQuantity`.
 */
export function formatStockQuantity(value: any, unit?: string): string {
  const num = toSafeNumber(value);
  return String(Number(num.toFixed(4)));
}

/**
 * A quantity a cashier typed on a POS/invoice line. An alias of
 * `formatQuantity`: a line sold by weight or length ("10.5 Kilogram") must
 * read back exactly what was entered, since that figure is what the line
 * total and the printed receipt are computed from.
 *
 * Kept as a distinct name because it says at the call site that this value is
 * a cashier's entry rather than a stock figure, and so a future change to
 * stock display cannot silently start rounding filed sale lines.
 */
export const formatCartQuantity = formatQuantity;
