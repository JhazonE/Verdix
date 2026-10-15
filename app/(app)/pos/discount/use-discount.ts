'use client';

import { useState, useEffect } from 'react';
import type { SaleItem } from '../pos-content/pos-types';
import type { DiscountType, DiscountDetails } from './discount-types';
import { lineDiscountAmount } from '@/lib/discount-format';

type Options = {
  isOpen: boolean;
  item: SaleItem | null;
  items?: SaleItem[];
  onApplyDiscount: (itemId: string | 'ALL', discountPercentage: number, discountType?: string, discountDetails?: DiscountDetails) => void;
  onOpenChange: (isOpen: boolean) => void;
};

/**
 * A cart-wide FIXED AMOUNT, expressed as the percentage each line gives up.
 *
 * A discount is stored per line as a percentage (see lib/discount-format.ts),
 * so a peso amount aimed at the whole cart has to be spread over the lines.
 * It is spread PRO RATA by line value, which means every line gives up the
 * same percentage and the cart total drops by exactly the amount entered.
 *
 * Previously the dialog derived one percentage from the SELECTED line and
 * stamped it on all of them: ₱5 off a ₱61.85 line is 8.08%, so a ₱300 cart
 * lost ₱24.25 instead of ₱5.
 *
 * Returns 0 for an empty or worthless cart rather than dividing by zero, and
 * caps at 100% so an amount larger than the cart cannot make a total negative.
 */
export function amountToPercentages(items: SaleItem[], amount: number): number {
  const cartTotal = items.reduce((acc, i) => acc + i.price * i.quantity, 0);
  if (cartTotal <= 0 || amount <= 0) return 0;
  return Math.min(100, (Math.min(amount, cartTotal) / cartTotal) * 100);
}

/**
 * What the value box shows when the sheet is reopened on a line that already
 * carries a discount.
 *
 * A discount is stored as a percentage, and the division that produces one
 * rarely lands on a round number, so echoing `item.discount` back put a raw
 * float in front of the cashier (`0.07117944337675279`) instead of the figure
 * they declared. Worse, a discount entered as ₱5.00 came back as 8.084...
 * because the stored percentage is all that survives.
 *
 * So the figure is rebuilt in the terms it was ENTERED in: an 'amount'
 * discount back into pesos off this line, anything else trimmed to at most
 * two decimals. An undiscounted line opens empty rather than showing "0",
 * which `valueInvalid` would reject anyway.
 */
export function discountSeedValue(item: SaleItem | null | undefined): string {
  if (!item?.discount || item.discount <= 0) return '';
  if (item.discountType === 'amount') {
    return String(Number(lineDiscountAmount(item).toFixed(2)));
  }
  return String(Number(item.discount.toFixed(2)));
}

export function useDiscount({ isOpen, item, items, onApplyDiscount, onOpenChange }: Options) {
  const [discountType, setDiscountType] = useState<DiscountType>('percent');
  const [scope, setScope] = useState<'selected' | 'all'>('selected');
  const [value, setValue] = useState<string>('');
  const [idNumber, setIdNumber] = useState<string>('');
  const [holderName, setHolderName] = useState<string>('');

  const isStatutory = ['pwd', 'senior', 'naac', 'solo_parent'].includes(discountType);
  const statutoryInvalid = isStatutory && (!idNumber.trim() || !holderName.trim());

  // A blank or zero box used to apply a 0% discount and close the sheet, which
  // is indistinguishable from the button not working. Statutory types carry
  // their own fixed rate, so only the typed kinds are checked.
  const valueInvalid = !isStatutory && !((parseFloat(value) || 0) > 0);

  // Keyed on the LINE ID, not the item object. `selectedItem` in use-pos is a
  // useMemo over `items`, so it is a new object on every cart change — making
  // this effect re-run and reset the type and scope out from under a cashier
  // who was mid-way through filling the sheet in. use-pos already keys its own
  // selection effects on selectedItemId for exactly this reason.
  const lineId = item?.lineId;
  useEffect(() => {
    if (isOpen) {
      // Reopen showing the discount the line already carries, in the terms it
      // was entered in — otherwise a ₱5.00 discount came back as a percentage
      // box holding 8.084074373484237 and the cashier could not confirm or
      // adjust what they had declared.
      setDiscountType((item?.discount ? (item.discountType as DiscountType) : null) || 'percent');
      setScope('selected');
      setValue(discountSeedValue(item));
      setIdNumber(item?.discountIdNumber || '');
      setHolderName(item?.discountHolderName || '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, lineId]);

  const handleApply = () => {
    if (statutoryInvalid || valueInvalid) return;

    let percentage = 0;

    if (discountType === 'pwd' || discountType === 'senior' || discountType === 'naac') {
      percentage = 20;
    } else if (discountType === 'solo_parent') {
      percentage = 10;
    } else {
      const numValue = parseFloat(value) || 0;
      if (discountType === 'percent') {
        percentage = Math.min(100, Math.max(0, numValue));
      } else if (scope === 'all') {
        // A fixed amount aimed at the whole cart is spread across it, so the
        // cart total drops by exactly what was entered.
        percentage = amountToPercentages(items ?? [], numValue);
      } else if (item) {
        const totalItemPrice = item.price * item.quantity;
        if (totalItemPrice > 0) {
          percentage = Math.min(100, Math.max(0, (numValue / totalItemPrice) * 100));
        }
      }
    }

    const details: DiscountDetails | undefined = isStatutory
      ? { idNumber: idNumber.trim(), holderName: holderName.trim() }
      : undefined;

    if (scope === 'all') {
      onApplyDiscount('ALL', percentage, discountType, details);
    } else if (item) {
      // lineId, not id: `id` is the PRODUCT id and is shared by two cart lines
      // of the same product on different selling units, while handleApplyDiscount
      // targets the line by lineId. Passing id matched no line at all, so a
      // single-item discount was silently dropped.
      onApplyDiscount(item.lineId, percentage, discountType, details);
    }
    onOpenChange(false);
  };

  return {
    discountType, setDiscountType,
    scope, setScope,
    value, setValue,
    idNumber, setIdNumber,
    holderName, setHolderName,
    isStatutory, statutoryInvalid, valueInvalid,
    handleApply,
  };
}
