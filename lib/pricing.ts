
import { Product, PriceLevel } from './types';

/**
 * Decides whether one price-level row competes on price, given the active
 * level and the quantity being bought.
 *
 * There are two independent ways in:
 *
 * 1. The row's level is the ACTIVE or the DEFAULT level. This is the
 *    long-standing rule and covers every ordinary override.
 * 2. The row carries a quantity tier the buyer has reached — on ANY level.
 *    This is what makes a bulk break automatic: a walk-in customer on Retail
 *    who buys 12 gets the Wholesale "12+" price without the cashier
 *    switching price level, which is the whole point of a quantity break.
 *
 * A tier applies from its threshold UP (>=, so "12+" applies at exactly 12);
 * below it the row simply does not compete, which is what makes the unit's
 * own price the natural fallback with no separate below-threshold branch.
 *
 * An UNTIERED row on some third level still never applies — otherwise every
 * level's price would leak to every customer. Only a deliberate tier opts a
 * row into being visible outside its own level. And because the caller takes
 * the MINIMUM of the qualifying candidates, a qualifying tier can only ever
 * lower the price, never raise it.
 *
 * 3. The row's level is the ACTIVE level and that level is NOT the default:
 *    it competes from quantity 1, tier or no tier. A customer declared as
 *    Wholesale pays the Wholesale price — the tier is how OTHER carts reach
 *    that price by volume, not a gate on the customers the level was set for.
 *    The default level is excluded on purpose: it is active for every walk-in,
 *    so unlocking its tiers there would hand the volume break to everyone at
 *    quantity 1.
 */
function qualifies(
    pl: { levelId: string; minQuantity?: number | null },
    quantity: number,
    activeLevelId: string | undefined,
    defaultLevelId: string,
): boolean {
    const threshold = Number(pl.minQuantity ?? 0);
    const hasTier = Number.isFinite(threshold) && threshold > 0;

    if (!!activeLevelId && activeLevelId !== defaultLevelId && pl.levelId === activeLevelId) {
        return true;
    }

    if (hasTier) return Number(quantity) >= threshold;

    return pl.levelId === defaultLevelId || (!!activeLevelId && pl.levelId === activeLevelId);
}

/**
 * The resolution both calculateEffectivePrice and calculateEffectivePriceForUnit
 * share.
 *
 * When the ACTIVE level is not the default (a customer declared on PEDDLER,
 * Credit, Wholesale…) and this unit HAS a row for it, that row's price is the
 * starting price — replacing the unit's own (retail) price and the default
 * level's row. This is what lets a level priced ABOVE retail apply: under a
 * plain min-of-everything, retail always undercut it, so a dearer level could
 * never take effect for the customers assigned to it.
 *
 * Volume breaks are still honoured on top: any TIERED row on another level
 * that the quantity has reached competes, and the cheapest wins. So the only
 * thing a dearer level loses is being undercut by the plain shelf price.
 *
 * Without such a row, behaviour is exactly the long-standing min-of-candidates
 * rule over the unit price and every qualifying row.
 */
function resolveEffectivePrice(
  basePrice: number,
  priceLevels: { levelId: string; price: number; minQuantity?: number | null }[] | undefined,
  quantity: number,
  activeLevelId: string | undefined,
  defaultLevelId: string,
): number {
  const levels = priceLevels ?? [];

  const activeRow = activeLevelId && activeLevelId !== defaultLevelId
    ? levels.find(pl => pl.levelId === activeLevelId && Number.isFinite(Number(pl.price)))
    : undefined;

  if (activeRow) {
    const candidates = [Number(activeRow.price)];
    for (const pl of levels) {
      if (pl === activeRow) continue;
      const threshold = Number(pl.minQuantity ?? 0);
      // The default level's row at a threshold of 1 is just the shelf price
      // (a stale min_quantity = 1 on it once priced a PEDDLING customer at
      // retail). It is dropped here like the untiered one; only a genuine
      // default-level volume break ("12+") still competes.
      if (pl.levelId === defaultLevelId && threshold <= 1) continue;
      if (Number.isFinite(threshold) && threshold > 0 && Number(quantity) >= threshold) {
        candidates.push(Number(pl.price));
      }
    }
    return Math.min(...candidates);
  }

  const candidates = [Number(basePrice)];
  for (const pl of levels) {
    if (qualifies(pl, quantity, activeLevelId, defaultLevelId)) candidates.push(Number(pl.price));
  }
  return Math.min(...candidates);
}

/**
 * Calculates the effective price for a product based on the active price
 * level and the quantity being bought.
 *
 * Candidates, cheapest of which wins:
 * 1. Untiered override for the ACTIVE Level (Customer or Selected)
 * 2. Untiered override for the DEFAULT Level
 * 3. Any TIERED override whose threshold this quantity has reached, on any
 *    level — so a bulk break fires automatically without switching level
 * 4. The Base Product Price, always
 *
 * See `qualifies` for why an untiered row stays scoped to its level while a
 * tiered one does not.
 *
 * @param product The product object including its price levels
 * @param quantity Quantity being bought — decides which quantity tiers apply
 * @param activeLevelId The currently active price level ID (from customer or manual selection)
 * @param defaultLevelId The system's default price level ID (usually 'retail-level')
 * @returns The calculated effective price
 */
export function calculateEffectivePrice(
    product: Product,
    quantity: number,
    activeLevelId?: string,
    defaultLevelId: string = 'retail-level'
): number {
    return resolveEffectivePrice(Number(product.price), product.priceLevels as any, quantity, activeLevelId, defaultLevelId);
}

export type SellingUnitPriceLevel = {
  levelId: string;
  price: number;
  /**
   * Quantity threshold this price applies from. 0 or absent means no
   * threshold. Stored per selling unit in
   * product_selling_unit_price_levels.min_quantity.
   *
   * Setting a tier also WIDENS the row's reach: a tiered row competes on any
   * cart that reaches the threshold, not only one on its own price level.
   * See `qualifies`.
   */
  minQuantity?: number;
};
export type PricedSellingUnit = { price: number; priceLevels?: SellingUnitPriceLevel[] };

/**
 * Same resolution rule as calculateEffectivePrice, applied to ONE selling
 * unit instead of a product: the unit's own price levels are checked first,
 * and a level with no override for this unit falls back to the unit's own
 * `price` — never another unit's price, never a computed multiple.
 *
 * This function structurally cannot see another unit's data (it only takes
 * one unit's price and price levels), which is what makes "never pulls
 * another unit's price" a guarantee rather than a convention.
 *
 * Quantity tiers apply per unit too: `quantity` is counted in THIS unit's
 * terms (3 Cases, not 180 pieces), so a tier set on a Case means "3 cases or
 * more", never "180 base units or more".
 */
export function calculateEffectivePriceForUnit(
  unit: PricedSellingUnit,
  quantity: number,
  activeLevelId?: string,
  defaultLevelId: string = 'retail-level'
): number {
  return resolveEffectivePrice(Number(unit.price), unit.priceLevels, quantity, activeLevelId, defaultLevelId);
}

/**
 * The price for ONE deliberately picked level on one selling unit, ignoring
 * quantity tiers entirely.
 *
 * This is the cashier picking "Wholesale" on a cart line. It is a different
 * question from the one `calculateEffectivePriceForUnit` answers, in two ways
 * that matter:
 *
 * **It does not consult `qualifies`, and must not.** A tiered row competes
 * only once its threshold is reached; here the cashier has named the level
 * outright, so the override applies at any quantity. Quantity tiers remain the
 * mechanism for *automatic* breaks — this is the mechanism for *deliberate*
 * ones, and consulting the tier is the bug this function exists to avoid.
 *
 * **It is not min-of-candidates.** `calculateEffectivePriceForUnit` takes the
 * MINIMUM of qualifying candidates, which is what guarantees an automatic tier
 * can only ever lower a price. A direct pick carries no such guarantee because
 * it is an explicit instruction: picking a level whose price is above the shelf
 * price RAISES the line, and that is correct. The caller is responsible for
 * showing the resulting price before it is committed.
 *
 * A level with no override row for this unit falls back to the unit's OWN
 * price — never another unit's price, never another level's, never a computed
 * multiple, and never 0. That covers a deleted or unknown level id too, so a
 * stale pick degrades to the shelf price rather than to free.
 */
export function resolvePriceForLevel(
  unit: PricedSellingUnit,
  levelId: string,
): number {
  const row = unit.priceLevels?.find(pl => pl.levelId === levelId);
  // A row whose price is not a usable number is treated as no row at all: the
  // shelf price is always a safer answer than NaN reaching a receipt.
  if (row) {
    const price = Number(row.price);
    if (Number.isFinite(price)) return price;
  }
  return Number(unit.price);
}
