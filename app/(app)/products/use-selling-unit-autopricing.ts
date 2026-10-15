import { useCallback, useEffect, useRef } from 'react';
import type { UseFormReturn } from 'react-hook-form';

import { calculateSuggestedPrice } from '@/lib/purchase-utils';
import { createAutoPriceCellTracker } from '@/lib/selling-unit-autoprice-cells';

/**
 * Auto-fills the Selling Units tab from the base cost:
 *
 * - every price-level row of the base unit, from the base cost;
 * - every extra unit's cost (base cost × its factor) and then every one of
 *   that unit's own price-level rows, from the unit's cost.
 *
 * It only ever fills a cell that is blank/0 or that it wrote itself last time
 * (tracked per cell), so a price the user typed is never overwritten, and once
 * a cell holds a value this hook did not write it is locked to the user for as
 * long as `resetKey` holds — including every price already on a product when
 * the Edit dialog opens it. Levels whose calculation base is "retail" need a
 * markup to mean anything, so they are skipped while `markup` is null;
 * cost-based levels do not.
 */
export function useSellingUnitAutoPricing({
  form,
  enabled = true,
  priceLevels,
  baseLevelRows,
  unitKeys,
  markup,
  resetKey,
}: {
  form: UseFormReturn<any>;
  enabled?: boolean;
  priceLevels: any[];
  /** The top-level `priceLevels` field-array rows (id→levelId), for index lookup. */
  baseLevelRows: { levelId?: string }[];
  /** Stable key (field id) per extra selling unit, in form order. */
  unitKeys: string[];
  markup: number | null;
  /**
   * Identifies the product currently loaded in the form. The Edit dialog is
   * reused across products, so without this the cells this hook remembers
   * writing for product A stay in the cell tracker and let it overwrite a
   * hand-typed price on product B that happens to equal one of them. Changing
   * it clears that memory, which also means every price already on a freshly
   * opened product reads as the user's and is left alone.
   */
  resetKey?: string | number;
}) {
  // Which cells this hook owns, which the user has taken over, and which the
  // user deliberately EMPTIED — see lib/selling-unit-autoprice-cells.ts. The
  // cleared case is why this is not just a "last written value" map: blanking a
  // price removes its row, and a removed row is otherwise indistinguishable
  // from a level that was never filled in, so the price came straight back and
  // a price level could not be cleared at all.
  const cellsRef = useRef<ReturnType<typeof createAutoPriceCellTracker>>();
  if (!cellsRef.current) cellsRef.current = createAutoPriceCellTracker();
  const cells = cellsRef.current;
  const lastResetKey = useRef(resetKey);
  if (lastResetKey.current !== resetKey) {
    lastResetKey.current = resetKey;
    cells.reset();
  }

  const baseCost = Number(form.watch('cost')) || 0;
  const units: any[] = form.watch('sellingUnits') || [];

  // Primitive signature so the effect re-runs only when an input changes, not
  // on the re-render triggered by its own writes.
  const signature = JSON.stringify([
    baseCost,
    markup,
    baseLevelRows.map(r => r.levelId),
    unitKeys,
    units.map(u => [u?.factor, u?.cost]),
    units.map(u => (u?.priceLevels || []).map((p: any) => [p?.levelId, p?.price])),
  ]);

  useEffect(() => {
    if (!enabled || !priceLevels?.length) return;

    const defaultLevel = priceLevels.find((l: any) => l.isDefault) || priceLevels[0];

    // retailRef: the unit's own default-level price, used as the "retail" base
    // when no markup resolved (so Wholesale etc. still follow Retail).
    const priceFor = (cost: number, level: any, retailRef?: number): number | null => {
      if (!(cost > 0)) return null;
      const base = level.calculationBase || 'retail';
      if (base !== 'cost' && markup === null) {
        if (level.id === defaultLevel?.id || !(Number(retailRef) > 0)) return null;
        return parseFloat(calculateSuggestedPrice(Number(retailRef), 0, 0, { ...level, calculationBase: 'retail' }).toFixed(2));
      }
      // The default level carries no adjustment of its own: its price is
      // simply cost + markup, which calculateSuggestedPrice returns when the
      // level's value is 0.
      return parseFloat(calculateSuggestedPrice(cost, markup ?? 0, 0, level).toFixed(2));
    };

    // May overwrite a cell only if it is empty or still holds our own value,
    // and never one the user typed into or emptied. The tracker remembers both
    // for as long as `resetKey` holds, so a cost change cannot hand a cell back
    // the moment the newly computed price happens to equal what they typed.
    const writable = (key: string, current: unknown) => cells.writable(key, current);

    // --- Base unit price levels ---
    // A level the user never touched has no row at all; add the missing ones
    // so there is a cell to fill.
    const current: any[] = form.getValues('priceLevels') || [];
    const missing = priceLevels.filter(
      (l: any) =>
        !current.some(r => r?.levelId === l.id) &&
        // A row missing because the USER cleared that price stays missing — a
        // blank price means "no override" and removes the row, so re-seeding
        // every absent level here is what made a cleared cell refill itself.
        cells.shouldSeedMissingRow(`base:${l.id}`),
    );
    if (baseCost > 0 && missing.length) {
      form.setValue('priceLevels', [...current, ...missing.map((l: any) => ({ levelId: l.id, price: 0 }))], { shouldDirty: true });
      // The 0 just written is this hook's own placeholder, not a price anyone
      // chose, so claim it — otherwise the pass that re-runs below reads it as
      // a deliberate "sell at cost" and leaves the new row stuck at 0.
      missing.forEach((l: any) => cells.recordAuto(`base:${l.id}`, 0));
      return; // re-runs via the signature once the rows exist
    }
    const baseRows: any[] = current;
    const baseRetail = Number(baseRows.find(r => r?.levelId === defaultLevel?.id)?.price) || 0;
    // Default level first so the others can follow it.
    [...priceLevels].sort((a: any, b: any) => (a.id === defaultLevel?.id ? -1 : b.id === defaultLevel?.id ? 1 : 0)).forEach((level: any) => {
      const idx = baseLevelRows.findIndex(r => r.levelId === level.id);
      if (idx === -1) return;
      const retailNow = Number(form.getValues(`priceLevels.${baseLevelRows.findIndex(r => r.levelId === defaultLevel?.id)}.price`)) || baseRetail;
      const price = priceFor(baseCost, level, retailNow);
      if (price === null) return;
      const key = `base:${level.id}`;
      const path = `priceLevels.${idx}.price`;
      if (!writable(key, form.getValues(path))) return;
      if (form.getValues(path) !== price) form.setValue(path, price, { shouldDirty: true });
      cells.recordAuto(key, price);
    });

    // --- Extra selling units ---
    units.forEach((unit, i) => {
      const uKey = unitKeys[i];
      if (!uKey) return;

      // Unit cost = base cost × factor, until the user types their own.
      const factor = Number(unit?.factor) || 0;
      let unitCost = Number(unit?.cost) || 0;
      if (baseCost > 0 && factor > 0) {
        const auto = Math.round(baseCost * factor * 100) / 100;
        const costKey = `cost:${uKey}`;
        if (writable(costKey, unit?.cost)) {
          if (unit?.cost !== auto) form.setValue(`sellingUnits.${i}.cost`, auto, { shouldDirty: true });
          cells.recordAuto(costKey, auto);
          unitCost = auto;
        }
      }

      const rows: { levelId: string; price?: number }[] = [...(unit?.priceLevels || [])];
      let changed = false;
      const unitRetail = Number(rows.find(r => r.levelId === defaultLevel?.id)?.price) || 0;
      [...priceLevels].sort((a: any, b: any) => (a.id === defaultLevel?.id ? -1 : b.id === defaultLevel?.id ? 1 : 0)).forEach((level: any) => {
        const ref = Number(rows.find(r => r.levelId === defaultLevel?.id)?.price) || unitRetail;
        const price = priceFor(unitCost, level, ref);
        if (price === null) return;
        const key = `unit:${uKey}:${level.id}`;
        const idx = rows.findIndex(r => r.levelId === level.id);
        if (idx === -1) {
          // Only seed a level that has never been filled in. A level whose row
          // is absent because the user CLEARED its price must stay absent,
          // otherwise the clear is undone on the very next pass.
          if (!cells.shouldSeedMissingRow(key)) return;
          rows.push({ levelId: level.id, price });
          cells.recordAuto(key, price);
          changed = true;
        } else if (writable(key, rows[idx].price) && rows[idx].price !== price) {
          rows[idx] = { ...rows[idx], price };
          cells.recordAuto(key, price);
          changed = true;
        }
      });
      if (changed) form.setValue(`sellingUnits.${i}.priceLevels`, rows, { shouldDirty: true });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, enabled, priceLevels]);

  return {
    /**
     * Tell the autopricer the user emptied a price-level cell, so it stops
     * suggesting into it. The form only ever records the ABSENCE of a price
     * (a blank price means "no override" and removes the row), which on its
     * own is indistinguishable from a level that was never filled in — this is
     * how the hook learns which of the two it is looking at.
     *
     * `unitKey` is the selling unit's field id, or null for the base unit.
     */
    notifyPriceCleared: useCallback((unitKey: string | null, levelId: string) => {
      cells.recordCleared(unitKey ? `unit:${unitKey}:${levelId}` : `base:${levelId}`);
    }, [cells]),
  };
}
