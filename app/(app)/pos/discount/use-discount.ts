'use client';

import { useState, useEffect } from 'react';
import type { SaleItem } from '../pos-content/pos-types';
import type { DiscountType, DiscountDetails } from './discount-types';

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

export function useDiscount({ isOpen, item, items, onApplyDiscount, onOpenChange }: Options) {
  const [discountType, setDiscountType] = useState<DiscountType>('percent');
  const [scope, setScope] = useState<'selected' | 'all'>('selected');
  const [value, setValue] = useState<string>('');
  const [idNumber, setIdNumber] = useState<string>('');
  const [holderName, setHolderName] = useState<string>('');

  const isStatutory = ['pwd', 'senior', 'naac', 'solo_parent'].includes(discountType);
  const statutoryInvalid = isStatutory && (!idNumber.trim() || !holderName.trim());

  useEffect(() => {
    if (isOpen) {
      setDiscountType('percent');
      setScope('selected');
      setValue(item?.discount ? item.discount.toString() : '');
      setIdNumber('');
      setHolderName('');
    }
  }, [isOpen, item]);

  const handleApply = () => {
    if (statutoryInvalid) return;

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
    isStatutory, statutoryInvalid,
    handleApply,
  };
}
