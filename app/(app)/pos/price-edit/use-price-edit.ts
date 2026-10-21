'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { resolvePriceForLevel } from '@/lib/pricing';
import { baseSellingUnitOf } from '@/lib/pos-cart-units';
import type { SaleItem } from '../pos-content/pos-types';
import type { PriceEditLevel } from './price-edit-types';

type Options = {
  isOpen: boolean;
  item: SaleItem | null;
  onOpenChange: (isOpen: boolean) => void;
  onUpdate: (
    itemId: string,
    newName: string,
    newQuantity: number,
    newPrice: number,
    newDiscount: number,
    pickedPriceLevelId?: string,
  ) => void;
  priceLevels: PriceEditLevel[];
  showPriceLevelPicker: boolean;
};

export function usePriceEdit({
  isOpen,
  item,
  onOpenChange,
  onUpdate,
  priceLevels,
  showPriceLevelPicker,
}: Options) {
  const [price, setPrice] = useState(item?.price || 0);
  const [pickedLevelId, setPickedLevelId] = useState<string | undefined>(undefined);
  /**
   * Which level the arrow keys are sitting on. -1 means the cashier has not
   * moved the cursor yet, so nothing is outlined and the dialog looks exactly
   * as it did before the keyboard path existed.
   */
  const [cursorIndex, setCursorIndex] = useState(-1);

  useEffect(() => {
    if (isOpen && item) {
      setPrice(item.price);
      // Reopening shows the pick the line already carries, so the dialog
      // reflects the cart rather than starting blank every time.
      setPickedLevelId(item.pickedPriceLevelId);
      setCursorIndex(-1);
    }
  }, [isOpen, item]);

  /**
   * The unit this line is priced against. A service line has no selling units
   * at all, which is why the picker is hidden for one: there are no level rows
   * to choose between.
   */
  const pricingUnit = useMemo(
    () => (item ? item.selectedSellingUnit ?? baseSellingUnitOf(item) : null),
    [item],
  );

  /**
   * Each level with the price it would produce for THIS unit, so the cashier
   * can compare before committing. A level with no override row for the unit
   * resolves to the unit's own price — that is the real answer, not a gap, so
   * it is shown rather than hidden.
   */
  const levelOptions = useMemo(() => {
    if (!pricingUnit) return [];
    return priceLevels.map(level => ({
      id: level.id,
      name: level.name,
      price: resolvePriceForLevel(pricingUnit, level.id),
    }));
  }, [priceLevels, pricingUnit]);

  // A service line has no units to price against, and an empty level list
  // leaves nothing to pick — either way the picker is not rendered.
  // Coerced to a real boolean. The setting originates as a TINYINT(1), so a
  // caller can hand us the number 0 — and `0 && ...` is `0`, which JSX dutifully
  // renders as a stray "0" next to the price box instead of hiding the picker.
  const canPickLevel = !!showPriceLevelPicker && !!pricingUnit && levelOptions.length > 0;

  /**
   * Picking a level writes its price into the box so the cashier sees the
   * number before saving. Typing over it afterwards is allowed and KEEPS the
   * level: the level is why the line is priced as it is, the number is what
   * it costs, and a manual correction does not change the why.
   */
  const pickLevel = useCallback((levelId: string) => {
    const option = levelOptions.find(o => o.id === levelId);
    setPickedLevelId(levelId);
    if (option) setPrice(option.price);
    // Clicking a level moves the keyboard cursor onto it too, so a mouse pick
    // followed by an arrow key carries on from where the cashier just was.
    setCursorIndex(levelOptions.findIndex(o => o.id === levelId));
  }, [levelOptions]);

  /**
   * Left/Right walk the levels and pick as they go, so the price box tracks the
   * cursor and the cashier reads the number without a second keystroke.
   *
   * Up/Down are deliberately NOT used: the price box is a number input and
   * those already nudge the amount, which is worth more than a second axis
   * across a two-column grid.
   *
   * Starting point when nothing is picked yet is the level the line already
   * carries, so the first press continues from the current state rather than
   * jumping to the front of the list.
   */
  const moveCursor = useCallback((delta: number) => {
    if (levelOptions.length === 0) return;
    const current = cursorIndex >= 0
      ? cursorIndex
      : levelOptions.findIndex(o => o.id === pickedLevelId);
    // Wraps, so a two-level store flips between them with one key held down.
    const next = current < 0
      ? (delta > 0 ? 0 : levelOptions.length - 1)
      : (current + delta + levelOptions.length) % levelOptions.length;
    setCursorIndex(next);
    const option = levelOptions[next];
    setPickedLevelId(option.id);
    setPrice(option.price);
  }, [levelOptions, cursorIndex, pickedLevelId]);

  const save = useCallback(() => {
    if (item) {
      const validPrice = Math.max(0, Number(price) || 0);
      // item.lineId, NOT item.id: handleUpdateItem matches on the line id, and
      // item.id is the product id shared by every line of that product.
      onUpdate(item.lineId, item.name, item.quantity, validPrice, item.discount, pickedLevelId);
      onOpenChange(false);
    }
  }, [item, price, pickedLevelId, onUpdate, onOpenChange]);

  return {
    price,
    setPrice,
    save,
    pickedLevelId,
    pickLevel,
    levelOptions,
    canPickLevel,
    cursorIndex,
    moveCursor,
  };
}
