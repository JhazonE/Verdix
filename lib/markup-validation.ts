/**
 * Shared markup validation, used by both the child-units dialog (to disable
 * Save before a round trip) and updateChildMarkups (which must not trust the
 * client). Keeping one function stops the two rules from drifting apart.
 */

/** Highest accepted markup percentage. 1000% is far past any real retail margin. */
export const MARKUP_MAX = 1000;

/**
 * `null` is valid and means "inherit from the category/brand/supplier chain".
 * `0` is also valid and means "sell at cost" — it is NOT the same as null.
 * Negatives are rejected: selling below cost is done by typing a manual price.
 */
export function isValidMarkupValue(value: number | null): boolean {
  if (value === null) return true;
  return Number.isFinite(value) && value >= 0 && value <= MARKUP_MAX;
}
