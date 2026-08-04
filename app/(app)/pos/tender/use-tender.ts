'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import { getApiUrl } from '@/lib/api-config';
import type { SaleItem } from '../pos-content/pos-types';
import { mapVatStatusToTaxType as mapTax } from '../pos-content/pos-types';
import type { Customer, SystemSettings } from '@/lib/types';
import type { ViewType, Payment, CompletedSale } from './tender-types';

type Options = {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  paymentMethod: string;
  totalDue: number;
  items: SaleItem[];
  customer: Customer | null;
  currentUser: any;
  onSuccess: (paymentMethod: string, amount: number) => void;
  shiftId: string | null;
  terminalId: string;
  terminalMin?: string;
  terminalSerialNumber?: string;
  terminalPermitNo?: string;
  terminalAccreditationNo?: string;
  terminalPermitDateIssued?: string;
  terminalName?: string;
  isTrainingMode?: boolean;
  paymentMethods: { id: string; name: string; isReferenceRequired?: boolean; pointsAmount?: number; currencyEquivalent?: number }[];
  printMode: 'browser' | 'escpos' | 'usb' | 'native';
  settings?: SystemSettings | null;
  onTriggerCustomerSelection?: () => void;
  onCheckoutComplete?: (change: number, orNumber: string) => void;
};

export function useTender({
  isOpen,
  onOpenChange,
  paymentMethod,
  totalDue,
  items,
  customer,
  currentUser,
  onSuccess,
  shiftId,
  terminalId,
  terminalMin,
  terminalSerialNumber,
  terminalPermitNo,
  terminalAccreditationNo,
  terminalPermitDateIssued,
  terminalName,
  isTrainingMode,
  paymentMethods = [],
  printMode,
  settings,
  onTriggerCustomerSelection,
  onCheckoutComplete
}: Options) {
  const [selectedMethod, setSelectedMethod] = useState(paymentMethod);
  const [amountTendered, setAmountTendered] = useState('');
  const [referenceInput, setReferenceInput] = useState('');
  const [payments, setPayments] = useState<Payment[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  // Synchronous re-entry guard. isProcessing (state) updates a render later, so a
  // fast double-trigger (button click + Enter, or overlapping keydown handlers)
  // can fire two checkout POSTs — each consuming an SI number — before the
  // disabled state applies. This ref blocks the second call immediately.
  const isSubmittingRef = useRef(false);
  const [view, setView] = useState<ViewType>('tender');
  const [completedSale, setCompletedSale] = useState<CompletedSale | null>(null);
  const [pointsToRedeemInput, setPointsToRedeemInput] = useState<string>('');
  const { toast } = useToast();
  const pointsInputRef = useRef<HTMLInputElement>(null);

  const pointsMethod = useMemo(() => {
    return paymentMethods.find(pm => pm.name.toLowerCase().includes('points'));
  }, [paymentMethods]);

  const pointsRate = useMemo(() => {
    if (!pointsMethod || !pointsMethod.pointsAmount || !pointsMethod.currencyEquivalent) {
      return 1;
    }
    return Number(pointsMethod.currencyEquivalent) / Number(pointsMethod.pointsAmount);
  }, [pointsMethod]);

  useEffect(() => {
    if (isOpen && paymentMethod) {
      setSelectedMethod(paymentMethod);
    }
  }, [isOpen, paymentMethod]);

  useEffect(() => {
    if (paymentMethods.length > 0 && selectedMethod) {
      const match = paymentMethods.find(p => p.name.toUpperCase() === selectedMethod.toUpperCase());
      if (match && match.name !== selectedMethod) {
        setSelectedMethod(match.name);
      }
    }
  }, [paymentMethods, selectedMethod]);

  const isCashPayment = selectedMethod?.toUpperCase() === 'CASH';
  const isChargePayment = selectedMethod?.toUpperCase() === 'CHARGE';

  const lastOpenRef = useRef(false);
  useEffect(() => {
    const justOpened = isOpen && !lastOpenRef.current;

    if (justOpened) {
      setAmountTendered(totalDue.toFixed(2));
      setPointsToRedeemInput('');
      setPayments([]);
    }
    lastOpenRef.current = isOpen;
  }, [isOpen, totalDue]);

  const customerPoints = Number((customer as any)?.current_points || (customer as any)?.loyaltyPoints || 0);
  const pointsToRedeemValueRaw = useMemo(() => parseFloat(pointsToRedeemInput) || 0, [pointsToRedeemInput]);
  const pointsToRedeemValue = useMemo(() => Math.min(pointsToRedeemValueRaw, totalDue, customerPoints), [pointsToRedeemValueRaw, totalDue, customerPoints]);
  const pointsToRedeemCount = pointsToRedeemValue;

  const amountTenderedNum = useMemo(() => parseFloat(amountTendered) || 0, [amountTendered]);
  const totalAddedPayments = useMemo(() => payments.reduce((acc, p) => acc + p.amount, 0), [payments]);

  const balanceRemaining = useMemo(() => {
    return Math.max(0, totalDue - pointsToRedeemValue - totalAddedPayments);
  }, [totalDue, pointsToRedeemValue, totalAddedPayments]);

  const lastBalanceRef = useRef(balanceRemaining);
  useEffect(() => {
    const isDefaultAmount = amountTendered === '' || parseFloat(amountTendered) === lastBalanceRef.current;
    if (isDefaultAmount) {
      setAmountTendered(balanceRemaining.toFixed(2));
    }
    lastBalanceRef.current = balanceRemaining;
  }, [balanceRemaining, amountTendered]);

  const change = useMemo(() => {
    return Math.max(0, totalAddedPayments + (isCashPayment ? amountTenderedNum : 0) - (totalDue - pointsToRedeemValue));
  }, [amountTenderedNum, totalAddedPayments, totalDue, pointsToRedeemValue, isCashPayment]);

  const isReferenceRequired = useMemo(() => {
    if (!selectedMethod) return false;
    if (selectedMethod.toUpperCase() === 'CASH') return false;
    const method = paymentMethods.find(pm => pm.name === selectedMethod);
    return method?.isReferenceRequired || false;
  }, [selectedMethod, paymentMethods]);

  useEffect(() => {
    if (!isOpen || view !== 'tender') return;
    try {
      const channel = new BroadcastChannel('pos-customer-display');
      const tendered = totalAddedPayments + (isCashPayment ? amountTenderedNum : 0);
      channel.postMessage({
        type: 'PAYMENT_UPDATE',
        tendered,
        change,
        currency: settings?.currencySymbol || '₱',
      });
      channel.close();
    } catch { }
  }, [amountTenderedNum, totalAddedPayments, change, isOpen, view, isCashPayment, settings?.currencySymbol]);

  const handleAddPayment = useCallback(() => {
    if (isReferenceRequired && !referenceInput.trim()) {
      toast({
        title: "Reference Required",
        description: "Please enter a reference number.",
        variant: 'destructive'
      });
      return;
    }
    if (amountTenderedNum <= 0 && !isChargePayment) return;

    setPayments([...payments, {
      id: Math.random().toString(),
      method: selectedMethod,
      amount: isChargePayment ? balanceRemaining : amountTenderedNum,
      reference: isReferenceRequired ? referenceInput : undefined
    }]);
    setAmountTendered('');
    setReferenceInput('');
    setSelectedMethod('');
  }, [isReferenceRequired, referenceInput, amountTenderedNum, isChargePayment, payments, selectedMethod, balanceRemaining, toast]);

  const handleConfirmPayment = useCallback(async () => {
    const availablePoints = (customer as any)?.current_points || (customer as any)?.loyaltyPoints || 0;

    if (pointsToRedeemValue > (Number(availablePoints) * pointsRate)) {
      toast({
        title: "Insufficient Points",
        description: `Customer only has ${Number(availablePoints).toFixed(0)} points.`,
        variant: "destructive"
      });
      return;
    }

    const finalPayments = [...payments];
    if (amountTenderedNum > 0 || (isChargePayment && balanceRemaining > 0)) {
      if (isReferenceRequired && !referenceInput.trim()) {
        toast({
          title: "Reference Required",
          description: "Please enter a reference number for this payment method.",
          variant: 'destructive'
        });
        return;
      }
      finalPayments.push({
        id: Math.random().toString(),
        method: selectedMethod,
        amount: isChargePayment ? balanceRemaining : amountTenderedNum,
        reference: isReferenceRequired ? referenceInput : undefined
      });
    }

    const totalTenderedAll = finalPayments.reduce((acc, p) => acc + p.amount, 0);

    if (totalTenderedAll < balanceRemaining) {
      toast({
        title: "Insufficient Amount",
        description: `Amount tendered must be greater than or equal to balance due (₱${balanceRemaining.toFixed(2)}).`,
        variant: 'destructive'
      });
      return;
    }

    // Block a concurrent second submission before React re-renders the disabled
    // state. Without this, a double-trigger fires two checkouts → two SI numbers.
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;

    setIsProcessing(true);

    try {
      const response = await fetch(getApiUrl('/pos/checkout'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transactionDate: new Date(),
          totalDue,
          subtotal: items.reduce((acc, item) => acc + (item.price * item.quantity), 0),
          discountAmount: items.reduce((acc, item) => acc + (item.price * item.quantity * ((item.discount || 0) / 100)), 0),
          taxAmount: items.reduce((acc, item) => {
            const netItemTotal = item.price * item.quantity * (1 - (item.discount || 0) / 100);
            const taxType = item.taxType || mapTax(item.vatStatus);
            if (taxType === 'VAT') {
              return acc + (netItemTotal - (netItemTotal / 1.12));
            }
            return acc;
          }, 0),
          payments: finalPayments,
          change,
          paymentMethod: pointsToRedeemValue > 0 && finalPayments.length === 0 ? 'POINTS' : (finalPayments.length > 1 ? 'MULTIPLE' : finalPayments[0]?.method || 'UNKNOWN'),
          items: items.map(item => ({
            id: item.id,
            name: item.name,
            quantity: item.quantity,
            price: item.price,
            discount: item.discount,
            discountType: item.discountType,
            discountIdNumber: item.discountIdNumber,
            discountHolderName: item.discountHolderName,
            taxType: item.taxType || mapTax(item.vatStatus),
            cost: item.cost
          })),
          customer: customer || { id: 'walk-in', name: 'Walk-in Customer' },
          status: 'completed',
          paymentDetails: {
            pointsUsed: pointsToRedeemCount,
            pointsConversionRate: pointsRate
          },
          currentUser: { ...currentUser, id: currentUser?.id || 'admin' },
          userId: currentUser?.id || currentUser?.uid || 'admin',
          shiftId,
          terminalId
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to save transaction');
      }

      toast({
        title: "Payment Successful",
        description: "Transaction saved. Printing receipt...",
        duration: 2000
      });

      const vatableGross = items.reduce((acc, item) => {
        const netItemTotal = item.price * item.quantity * (1 - (item.discount || 0) / 100);
        const taxType = item.taxType || mapTax(item.vatStatus);
        return taxType === 'VAT' ? acc + netItemTotal : acc;
      }, 0);

      const vatableSales = vatableGross / 1.12;
      const vatAmountResult = vatableGross - vatableSales;

      const vatExemptSales = items.reduce((acc, item) => {
        const netItemTotal = item.price * item.quantity * (1 - (item.discount || 0) / 100);
        const taxType = item.taxType || mapTax(item.vatStatus);
        return taxType === 'VAT_EXEMPT' ? acc + netItemTotal : acc;
      }, 0);

      const zeroRatedSales = items.reduce((acc, item) => {
        const netItemTotal = item.price * item.quantity * (1 - (item.discount || 0) / 100);
        const taxType = item.taxType || mapTax(item.vatStatus);
        return taxType === 'ZERO_RATED' ? acc + netItemTotal : acc;
      }, 0);

      const nonVatSales = items.reduce((acc, item) => {
        const netItemTotal = item.price * item.quantity * (1 - (item.discount || 0) / 100);
        const taxType = item.taxType || mapTax(item.vatStatus);
        return taxType === 'NON_VAT' ? acc + netItemTotal : acc;
      }, 0);

      const saleDetails: CompletedSale = {
        items: [...items],
        customer: customer || { id: 'walk-in', name: 'Walk-in' } as any,
        totalDue,
        change,
        paymentMethod: pointsToRedeemValue > 0 && finalPayments.length === 0 ? 'POINTS' : (finalPayments.length > 1 ? 'MULTIPLE' : finalPayments[0]?.method || 'UNKNOWN'),
        payments: finalPayments,
        orderNumber: result.data.orderNumber?.toString() || '',
        siNumber: result.data.siNumber || result.data.orderNumber?.toString() || '',
        amountTendered: totalTenderedAll,
        transactionDate: new Date(),
        cashierName: currentUser?.display_name || currentUser?.username || 'Admin',
        pointsEarned: result.data.pointsEarned,
        pointsUsedCount: pointsToRedeemCount,
        pointsUsedValue: pointsToRedeemValue,
        pointsBalance: result.data.pointsRemaining,
        terminalMin: terminalMin ?? settings?.minNumber ?? undefined,
        terminalSerialNumber: terminalSerialNumber ?? settings?.serialNumber ?? undefined,
        terminalPermitNo: terminalPermitNo ?? undefined,
        terminalAccreditationNo: terminalAccreditationNo ?? undefined,
        terminalPermitDateIssued: terminalPermitDateIssued ?? undefined,
        terminalName: terminalName,
        isTrainingMode: isTrainingMode,
        taxBreakdown: {
          vatableSales,
          vatAmount: vatAmountResult,
          vatExemptSales,
          zeroRatedSales,
          nonVatSales
        }
      };

      setCompletedSale(saleDetails);
      onCheckoutComplete?.(change, result.data.orderNumber.toString());

      if (change > 0) {
        setView('change');
      } else {
        setView('print_prompt');
      }

    } catch (error: any) {
      const isBatchError = error.message?.includes('Batch stock exhausted');

      if (isBatchError) {
        toast({
          title: "Stock Alert",
          description: error.message,
          variant: "destructive",
          duration: 5000,
        });
      } else {
        console.error('Error saving payment:', error);
        toast({
          title: "Transaction Error",
          description: error.message || "Failed to save the transaction to the database.",
          variant: "destructive",
        });
      }
    } finally {
      setIsProcessing(false);
      isSubmittingRef.current = false;
    }
  }, [pointsToRedeemValue, customer, pointsRate, referenceInput, isReferenceRequired, amountTenderedNum, isChargePayment, payments, selectedMethod, balanceRemaining, totalDue, items, change, pointsToRedeemCount, terminalMin, terminalSerialNumber, terminalPermitNo, terminalAccreditationNo, terminalPermitDateIssued, terminalName, isTrainingMode, settings, currentUser, shiftId, terminalId, toast, onCheckoutComplete]);

  const getQuickAmounts = useCallback((total: number) => {
    const amounts = new Set<number>();
    amounts.add(Math.ceil(total));
    if (total < 50) {
      amounts.add(50);
      amounts.add(100);
    } else if (total < 100) {
      amounts.add(Math.ceil(total / 50) * 50);
      amounts.add(Math.ceil(total / 50) * 50 + 50);
    } else if (total < 1000) {
      amounts.add(Math.ceil(total / 100) * 100);
      amounts.add(Math.ceil(total / 100) * 100 + 100);
    }
    amounts.add(1000);

    return Array.from(amounts).filter(a => a >= total).sort((a, b) => a - b).slice(0, 4);
  }, []);

  useEffect(() => {
    if (isOpen) {
      setView('tender');
      setCompletedSale(null);
      setIsProcessing(false);
      setPointsToRedeemInput('');
      setAmountTendered(totalDue.toFixed(2));
      setReferenceInput('');
    }
  }, [isOpen, totalDue]);

  return {
    selectedMethod,
    setSelectedMethod,
    amountTendered,
    setAmountTendered,
    referenceInput,
    setReferenceInput,
    payments,
    setPayments,
    isProcessing,
    view,
    setView,
    completedSale,
    setCompletedSale,
    pointsToRedeemInput,
    setPointsToRedeemInput,
    pointsInputRef,
    isCashPayment,
    isChargePayment,
    customerPoints,
    pointsToRedeemValue,
    pointsToRedeemCount,
    amountTenderedNum,
    totalAddedPayments,
    balanceRemaining,
    change,
    isReferenceRequired,
    handleAddPayment,
    handleConfirmPayment,
    getQuickAmounts,
    pointsRate,
  };
}
