'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { format } from 'date-fns';
import type { Sale, SaleItem } from '@/lib/types';
import { usePrinter } from '@/lib/use-printer';
import { useToast } from '@/hooks/use-toast';
import { CreditSlipGenerator, CreditSlipData } from '@/lib/credit-slip-generator';
import { getApiUrl } from '@/lib/api-config';
import { useReactToPrint } from 'react-to-print';
import { buildRecentSalesQuery } from '../transaction-search/build-recent-sales-query';

type Options = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  currentUser?: any;
  terminalId?: string;
  printMode: 'browser' | 'escpos' | 'usb' | 'native';
  creditSlipRef?: React.RefObject<HTMLDivElement>;
};

export function useReturnSales({
  isOpen,
  onOpenChange,
  currentUser,
  terminalId,
  printMode,
  creditSlipRef
}: Options) {
  const [step, setStep] = useState<'loading' | 'auth' | 'input_so' | 'select_items' | 'success'>('loading');
  const [sales, setSales] = useState<Sale[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [searchError, setSearchError] = useState('');
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [itemsToReturn, setItemsToReturn] = useState<SaleItem[]>([]);
  const [returnedItems, setReturnedItems] = useState<SaleItem[]>([]);
  const [posSettings, setPosSettings] = useState<any>(null);
  const [returnedTotal, setReturnedTotal] = useState(0);
  // MC number issued by the server for this return. The slip must print the
  // stored number, never a locally-generated one, so paper matches the report.
  const [mcNumber, setMcNumber] = useState('');
  const [recentSales, setRecentSales] = useState<Sale[]>([]);
  const [isRecentLoading, setIsRecentLoading] = useState(false);
  const nativePrinterName = typeof window !== 'undefined' ? localStorage.getItem('pos_printer_name') || undefined : undefined;
  const { isPrinting, isConnected, connect, print } = usePrinter(printMode, nativePrinterName);
  const { toast } = useToast();
  const authSucceededRef = useRef(false);

  const handleBrowserPrint = useReactToPrint({
    contentRef: creditSlipRef,
    documentTitle: `CreditSlip-${new Date().getTime()}`,
    pageStyle: `
      @page {
        size: 58mm auto;
        margin: 0;
      }
      @media print {
        body {
          -webkit-print-color-adjust: exact;
        }
      }
    `
  });

  useEffect(() => {
    if (isOpen) {
      authSucceededRef.current = false;
      setStep('loading');
      setIsLoading(false);
      setSearchText('');
      setDateFrom('');
      setDateTo('');
      setSearchError('');
      setSelectedSale(null);
      setReturnedTotal(0);
      setReturnedItems([]);
      setMcNumber('');

      fetch(getApiUrl(`/pos-settings?_t=${Date.now()}`), { cache: 'no-store' })
        .then(res => res.json())
        .then(result => {
          if (result.success) {
            const settings = result.data;
            setPosSettings(settings);

            if (settings.enableReturnAuth) {
              setStep('auth');
            } else {
              setStep('input_so');
            }
          } else {
            setStep('input_so');
          }
        })
        .catch(err => {
          console.error(err);
          setStep('input_so');
        });
    }
  }, [isOpen]);

  useEffect(() => {
    if (!(isOpen && step === 'input_so')) return;
    const t = setTimeout(() => {
      setIsRecentLoading(true);
      const qs = buildRecentSalesQuery({ query: searchText, dateFrom, dateTo });
      fetch(getApiUrl(`/pos/recent-sales${qs}`), { cache: 'no-store' })
        .then(res => res.json())
        .then(result => { if (result.success) setRecentSales(result.data || []); })
        .catch(() => {})
        .finally(() => setIsRecentLoading(false));
    }, 300);
    return () => clearTimeout(t);
  }, [isOpen, step, searchText, dateFrom, dateTo]);

  const handlePickSale = useCallback((sale: Sale) => {
    setSelectedSale(sale);
    setSearchError('');
    setStep('select_items');
  }, []);

  const handleAuthSuccess = useCallback(() => {
    authSucceededRef.current = true;
    setStep('input_so');
  }, []);

  const handleAuthClose = useCallback((open: boolean) => {
    if (!open && !authSucceededRef.current) {
      onOpenChange(false);
    }
    authSucceededRef.current = false;
  }, [onOpenChange]);

  const clearSearch = useCallback(() => {
    setSearchText('');
    setDateFrom('');
    setDateTo('');
  }, []);

  const handleReturnItems = useCallback(async (items: SaleItem[]) => {
    if (selectedSale && items.length > 0) {
      setIsLoading(true);
      try {
        const totalAmount = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);

        const response = await fetch(getApiUrl('/sales/returns'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            saleId: selectedSale.id,
            items: items.map(item => ({
              productId: item.product.id,
              productName: item.product.name,
              quantity: item.quantity,
              price: item.price
            })),
            terminalId: terminalId || posSettings?.terminalId,
            userId: currentUser?.uid || currentUser?.id || null,
            reason: 'Merchandise Credit',
            totalAmount
          })
        });

        const result = await response.json();
        if (result.success) {
          setReturnedTotal(totalAmount);
          setReturnedItems(items);
          setMcNumber(result.data?.mcNumber || '');
          setStep('success');
        } else {
          const message = result.error || 'Failed to process return';
          setSearchError(message);
          toast({ title: 'Return Failed', description: message, variant: 'destructive' });
        }
      } catch (err) {
        console.error('Error processing return:', err);
        const message = 'Error processing return. Please try again.';
        setSearchError(message);
        toast({ title: 'Return Failed', description: message, variant: 'destructive' });
      } finally {
        setIsLoading(false);
      }
    }
  }, [selectedSale, terminalId, posSettings, currentUser, toast]);

  const handleBackToSearch = useCallback(() => {
    setStep('input_so');
    setSelectedSale(null);
    setSearchText('');
    setDateFrom('');
    setDateTo('');
  }, []);

  const handleCloseSuccess = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  const handlePrintCredit = useCallback(async () => {
    if (!selectedSale || returnedItems.length === 0) return;

    const now = new Date();
    const expiryDate = new Date(now);
    expiryDate.setDate(expiryDate.getDate() + 30);
    // Use the server-issued MC number so a reprint always shows the SAME number
    // as the report. Falls back to the legacy timestamp format only if the
    // return predates MC numbering or the server did not return one.
    const creditSlipId = mcNumber
      || `MC-${selectedSale.orderNumber || selectedSale.id.slice(-6)}-${format(now, 'yyMMddHHmm')}`.toUpperCase();

    if (printMode === 'browser') {
      handleBrowserPrint();
      return;
    }

    if (!isConnected) {
      const success = await connect();
      if (!success) return;
    }

    try {
      const generator = new CreditSlipGenerator();
      const slipData: CreditSlipData = {
        creditSlipId,
        originalSiNumber: selectedSale.siNumber,
        originalSoNumber: String(selectedSale.orderNumber || selectedSale.id),
        customerName: selectedSale.customer?.name || 'Walk-in Customer',
        date: now.toISOString(),
        expiryDate: expiryDate.toISOString(),
        cashierName: currentUser?.name || currentUser?.displayName || currentUser?.username || 'Cashier',
        items: returnedItems.map(item => ({
          name: item.product.name,
          quantity: item.quantity,
          unitOfMeasure: item.product.unitOfMeasure,
          price: item.price,
          total: item.quantity * item.price
        })),
        totalAmount: returnedTotal,
        businessSettings: {
          businessName: posSettings?.businessName,
          address: posSettings?.address,
          contactNumber: posSettings?.contactNumber,
          tin: posSettings?.tin,
          minNumber: posSettings?.minNumber,
          serialNumber: posSettings?.serialNumber,
          currencySymbol: posSettings?.currencySymbol || '₱',
          currencyCode: posSettings?.currencyCode || 'PHP',
          timezone: posSettings?.timezone || 'Asia/Manila',
          dateFormat: posSettings?.dateFormat || 'MM/dd/yyyy'
        }
      };

      const bytes = generator.generate(slipData);
      await print(bytes);
      toast({ title: "Success", description: "Credit slip sent to printer." });
    } catch (err) {
      console.error("Print error", err);
      toast({ title: "Print Failed", description: "Could not send data to printer.", variant: "destructive" });
    }
  }, [selectedSale, returnedItems, returnedTotal, mcNumber, printMode, isConnected, connect, print, posSettings, currentUser, handleBrowserPrint, toast]);

  return {
    step,
    isLoading,
    searchText,
    setSearchText,
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
    clearSearch,
    searchError,
    selectedSale,
    returnedItems,
    returnedTotal,
    mcNumber,
    recentSales,
    isRecentLoading,
    posSettings,
    handlePickSale,
    handleAuthSuccess,
    handleAuthClose,
    handleReturnItems,
    handleBackToSearch,
    handleCloseSuccess,
    handlePrintCredit,
  };
}
