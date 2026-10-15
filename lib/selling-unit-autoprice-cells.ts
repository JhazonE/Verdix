/**
 * Ownership tracking for the cells `useSellingUnitAutoPricing` fills on the
 * Add/Edit Product "Selling Units" tab.
 *
 * The autopricer suggests a cost and a price for every selling unit and every
 * one of its price levels. It may only ever fill a cell nobody has taken over,
 * so a figure the user typed — or deliberately emptied — survives the next
 * cost change.
 *
 * Three states per cell:
 *
 * - **unseen** — no history. Fillable, and a missing row for it may be seeded.
 * - **auto** — holds the value this hook last wrote. Fillable again, so a cost
 *   change still flows through to a price the user never touched.
 * - **owned** — the user typed something, or emptied the cell. Never filled
 *   again while the same product stays open.
 *
 * Emptying is the case this module exists for. A blank price means "no
 * override", which removes the price-level ROW entirely, so without a memory
 * of the clear the autopricer re-reads it as **unseen** and puts the price
 * straight back — the cell could not be cleared at all.
 */
export interface AutoPriceCellTracker {
  /** May the autopricer write `key`, which currently holds `current`? */
  writable(key: string, current: unknown): boolean;
  /** Record that the autopricer itself wrote `value` into `key`. */
  recordAuto(key: string, value: number): void;
  /** Record that the user emptied `key`. It is theirs from now on. */
  recordCleared(key: string): void;
  /** Has `key` never been seen, so a missing row for it may be seeded? */
  shouldSeedMissingRow(key: string): boolean;
  /** Forget every cell — a different product is now loaded in the form. */
  reset(): void;
}

export function createAutoPriceCellTracker(): AutoPriceCellTracker {
  /** The value this hook last wrote, per cell. */
  let lastAuto: Record<string, number> = {};
  /** Cells the user has taken over, by typing or by clearing. */
  let owned: Record<string, boolean> = {};
  /** Cells the user emptied. A subset of `owned`, kept apart because a
   *  cleared cell also suppresses row SEEDING, which typing does not. */
  let cleared: Record<string, boolean> = {};

  const take = (key: string) => {
    owned[key] = true;
  };

  return {
    writable(key, current) {
      if (owned[key]) return false;
      // `0` is a real price — "sell at cost" — so it is not treated as empty.
      // Only a genuinely absent value counts as a cell with nothing in it.
      const isEmpty = current == null || current === '';
      const ok = isEmpty || current === lastAuto[key];
      // A cell holding something that is neither empty nor our own value was
      // typed by the user; it is theirs from here on. Recording that (rather
      // than re-deciding each pass) stops a later cost change from handing the
      // cell back the moment the computed price happens to equal what they
      // typed.
      if (!ok) take(key);
      return ok;
    },

    recordAuto(key, value) {
      lastAuto[key] = value;
    },

    recordCleared(key) {
      take(key);
      cleared[key] = true;
    },

    shouldSeedMissingRow(key) {
      // A row missing because the user cleared it must stay missing. A row
      // missing because the level was never filled in gets seeded so there is
      // a cell to suggest into.
      return !cleared[key] && !owned[key];
    },

    reset() {
      lastAuto = {};
      owned = {};
      cleared = {};
    },
  };
}
