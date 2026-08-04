'use client';

import React, { useMemo, useCallback } from 'react';
import { format } from 'date-fns';
import type { SaleItem } from '../pos-content/pos-types';
import { mapVatStatusToTaxType } from '../pos-content/pos-types';
import { resolveEffectiveTaxType } from '@/lib/tax-utils';
import type { SystemSettings } from '@/lib/types';

type Options = {
  items: SaleItem[];
  totalDue: number;
  saleDetails: {
    transactionDate?: Date;
    terminalMin?: string;
    terminalSerialNumber?: string;
    taxBreakdown?: {
      vatableSales: number;
      vatAmount: number;
      vatExemptSales: number;
      zeroRatedSales: number;
      nonVatSales: number;
    };
  };
  settings?: SystemSettings | null;
};

export function useReceipt({ items, totalDue, saleDetails, settings }: Options) {
  const subTotal = useMemo(
    () => items.reduce((acc, item) => acc + item.price * item.quantity, 0),
    [items]
  );

  const totalDiscount = useMemo(
    () => items.reduce((acc, item) => acc + (item.price * item.quantity * (item.discount || 0)) / 100, 0),
    [items]
  );

  const computedTax = useMemo(() => {
    const vatableGross = items.reduce((acc, item) => {
      const netItemTotal = item.price * item.quantity * (1 - (item.discount || 0) / 100);
      const baseTaxType = item.taxType || mapVatStatusToTaxType(item.vatStatus);
      const taxType = resolveEffectiveTaxType(baseTaxType, item.discountType, item.discount);
      return taxType === 'VAT' ? acc + netItemTotal : acc;
    }, 0);

    const vatableSales = vatableGross / 1.12;
    const vatAmount = vatableGross - vatableSales;

    const vatExemptSales = items.reduce((acc, item) => {
      const netItemTotal = item.price * item.quantity * (1 - (item.discount || 0) / 100);
      const baseTaxType = item.taxType || mapVatStatusToTaxType(item.vatStatus);
      const taxType = resolveEffectiveTaxType(baseTaxType, item.discountType, item.discount);
      return taxType === 'VAT_EXEMPT' ? acc + netItemTotal : acc;
    }, 0);

    return { vatableSales, vatAmount, vatExemptSales };
  }, [items]);

  const vatAmount = computedTax.vatAmount;

  const formatCurrency = useCallback((amount: number) =>
    amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    []
  );

  const currentDate = useMemo(
    () => saleDetails.transactionDate ? new Date(saleDetails.transactionDate) : new Date(),
    [saleDetails.transactionDate]
  );

  const statutoryLabels: Record<string, string> = {
    senior: 'SENIOR CITIZEN',
    pwd: 'PWD',
    naac: 'NAAC',
    solo_parent: 'SOLO PARENT',
  };

  const discountHolderItem = useMemo(
    () => items.find(item => item.discountIdNumber || item.discountHolderName),
    [items]
  );

  const discountHolderName = discountHolderItem?.discountHolderName;
  const discountIdNumber = discountHolderItem?.discountIdNumber;
  const discountTypeLabel = discountHolderItem?.discountType ? statutoryLabels[discountHolderItem.discountType] : undefined;

  const paperWidth = settings?.paperSize === '80mm' ? 'w-[80mm]' : 'w-[58mm]';

  return {
    subTotal,
    totalDiscount,
    computedTax,
    vatAmount,
    formatCurrency,
    currentDate,
    discountHolderName,
    discountIdNumber,
    discountTypeLabel,
    paperWidth,
  };
}
