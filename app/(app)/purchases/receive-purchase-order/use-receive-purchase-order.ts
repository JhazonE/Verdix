'use client';

import { useState, useEffect } from 'react';
import { type BadItemInput, type ReceivePurchaseOrderDialogProps, lineKey } from './receive-purchase-order-types';

export function useReceivePurchaseOrder({
  order,
  open,
  onOpenChange,
  onConfirm,
  requireConfirmation,
}: ReceivePurchaseOrderDialogProps) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [badItems, setBadItems] = useState<Record<string, BadItemInput>>({});
  const [expiryDates, setExpiryDates] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [allocationStrategy, setAllocationStrategy] = useState<'equal' | 'proportional'>('equal');

  useEffect(() => {
    if (!open || !order) return;

    setQuantities(
      order.items.reduce((acc, item) => {
        acc[lineKey(item)] = item.quantity;
        return acc;
      }, {} as Record<string, number>),
    );

    setBadItems(
      order.items.reduce((acc, item) => {
        acc[lineKey(item)] = { quantity: 0, reason: 'Damaged', description: '' };
        return acc;
      }, {} as Record<string, BadItemInput>),
    );

    setExpiryDates(
      order.items.reduce((acc, item) => {
        acc[lineKey(item)] = '';
        return acc;
      }, {} as Record<string, string>),
    );
  }, [open, order]);

  // ---- field handlers ------------------------------------------------------
  // All keyed by lineKey(item) (PO line id, falling back to productId), not
  // productId alone — two lines for the same product (Piece + Case) must not
  // collide in this state.

  const handleQuantityChange = (key: string, value: string) => {
    const num = parseFloat(value);
    setQuantities((prev) => ({ ...prev, [key]: isNaN(num) ? 0 : num }));
  };

  const handleExpiryDateChange = (key: string, value: string) => {
    setExpiryDates((prev) => ({ ...prev, [key]: value }));
  };

  const handleBadQtyChange = (key: string, value: string) => {
    const num = parseFloat(value);
    setBadItems((prev) => ({
      ...prev,
      [key]: { ...prev[key], quantity: isNaN(num) ? 0 : num },
    }));
  };

  const handleBadReasonChange = (key: string, value: string) => {
    setBadItems((prev) => ({ ...prev, [key]: { ...prev[key], reason: value } }));
  };

  const handleBadDescriptionChange = (key: string, value: string) => {
    setBadItems((prev) => ({ ...prev, [key]: { ...prev[key], description: value } }));
  };

  // ---- submit --------------------------------------------------------------

  const handleConfirm = async () => {
    if (requireConfirmation && !isConfirmOpen) {
      setIsConfirmOpen(true);
      return;
    }

    setIsSubmitting(true);
    try {
      // Keyed by lineKey(item), then resolved back to the line's own productId
      // and unit fields — this is what lets two lines for the same product
      // (Piece + Case) be received as two independent quantities instead of
      // one overwriting the other in `quantities`.
      const receivedItems = order.items.map((item) => {
        const key = lineKey(item);
        return {
          productId: item.productId,
          quantity: quantities[key],
          expirationDate: expiryDates[key] || undefined,
          sellingUnitId: item.sellingUnitId,
          sellingUnitName: item.sellingUnitName,
          sellingUnitFactor: item.sellingUnitFactor,
        };
      });

      const reportedBadItems = order.items
        .filter((item) => (badItems[lineKey(item)]?.quantity || 0) > 0)
        .map((item) => {
          const key = lineKey(item);
          const data = badItems[key];
          return {
            productId: item.productId,
            productName: item.productName || 'Unknown Product',
            quantity: data.quantity,
            cost: item.cost || 0,
            reason: data.reason,
            description: data.description,
            sellingUnitFactor: item.sellingUnitFactor,
          };
        });

      await onConfirm(
        receivedItems,
        reportedBadItems.length > 0 ? reportedBadItems : undefined,
        allocationStrategy,
      );
      onOpenChange(false);
      setIsConfirmOpen(false);
    } catch (error) {
      console.error('Failed to confirm receipt:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const hasBadItems = Object.values(badItems).some((item) => item.quantity > 0);

  return {
    quantities,
    badItems,
    expiryDates,
    isSubmitting,
    isConfirmOpen, setIsConfirmOpen,
    allocationStrategy, setAllocationStrategy,
    hasBadItems,

    handleQuantityChange,
    handleExpiryDateChange,
    handleBadQtyChange,
    handleBadReasonChange,
    handleBadDescriptionChange,
    handleConfirm,
  };
}

export type ReceivePurchaseOrderController = ReturnType<typeof useReceivePurchaseOrder>;
