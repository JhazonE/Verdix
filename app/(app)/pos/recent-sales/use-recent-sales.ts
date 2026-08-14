'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { Sale, SystemSettings } from '@/lib/types';
import { usePrinter } from '@/lib/use-printer';
import { useToast } from '@/hooks/use-toast';
import { ReceiptGenerator } from '@/lib/receipt-generator';
import { getApiUrl } from '@/lib/api-config';
import { mapSaleToReceiptDetails } from './recent-sales-utils';
import { buildRecentSalesQuery } from '../transaction-search/build-recent-sales-query';

type Options = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  printMode: 'browser' | 'escpos' | 'usb' | 'native';
  initialSettings?: SystemSettings | null;
};

type ReturnType = {
  step: 'loading' | 'auth' | 'list';
  saleToPrint: any;
  selectedSale: any;
  recentSales: any[];
  isLoading: boolean;
  posSettings: any;
  isPrinting: boolean;
  setSelectedSale: (sale: any) => void;
  handleAuthSuccess: () => void;
  handleAuthClose: (open: boolean) => void;
  handlePrintReceiptAction: (sale: any) => Promise<void>;
  handlePrintReceipt: (sale: any) => void;
  handleBackToList: () => void;
  handleOpenChange: (open: boolean) => void;
  searchText: string;
  setSearchText: (v: string) => void;
  dateFrom: string;
  setDateFrom: (v: string) => void;
  dateTo: string;
  setDateTo: (v: string) => void;
  clearSearch: () => void;
};

export function useRecentSales({
  isOpen,
  onOpenChange,
  printMode,
  initialSettings
}: Options): ReturnType {
  const [step, setStep] = useState<'loading' | 'auth' | 'list'>('loading');
  const [saleToPrint, setSaleToPrint] = useState<Sale | null>(null);
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [recentSales, setRecentSales] = useState<Sale[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchText, setSearchText] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const searchParamsRef = useRef({ query: '', dateFrom: '', dateTo: '' });
  searchParamsRef.current = { query: searchText, dateFrom, dateTo };
  const [posSettings, setPosSettings] = useState<SystemSettings | null>(initialSettings || null);
  const nativePrinterName = typeof window !== 'undefined' ? localStorage.getItem('pos_printer_name') || undefined : undefined;
  const { isPrinting, isConnected, connect, print } = usePrinter(printMode, nativePrinterName);
  const { toast } = useToast();
  const authSucceededRef = useRef(false);

  useEffect(() => {
    if (isOpen) {
      authSucceededRef.current = false;
      setStep('loading');
      setIsLoading(true);
      setSaleToPrint(null);
      setSelectedSale(null);
      setSearchText('');
      setDateFrom('');
      setDateTo('');

      if (initialSettings) {
        setPosSettings(initialSettings);
        if (initialSettings.enableRecentSalesAuth) {
          setStep('auth');
        } else {
          setStep('list');
        }
        return;
      }

      fetch(getApiUrl(`/pos-settings?_t=${Date.now()}`), { cache: 'no-store' })
        .then(res => res.json())
        .then(result => {
          if (result.success) {
            const settings = result.data;
            setPosSettings(settings);

            if (settings.enableRecentSalesAuth) {
              setStep('auth');
            } else {
              setStep('list');
            }
          } else {
            setStep('list');
          }
        })
        .catch(err => {
          console.error(err);
          setStep('list');
        });
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && step === 'list') {
      const fetchRecentSales = async () => {
        try {
          const qs = buildRecentSalesQuery(searchParamsRef.current);
          const response = await fetch(getApiUrl(`/pos/recent-sales${qs}`), { cache: 'no-store' });
          if (!response.ok) throw new Error(`API error ${response.status}`);
          const result = await response.json();

          if (result.success) {
            setRecentSales(result.data);
            setSelectedSale(prev => prev || result.data[0] || null);
          } else {
            console.error('Failed to fetch recent sales:', result.error);
          }
        } catch (error) {
          console.error('Error fetching recent sales:', error);
        } finally {
          setIsLoading(false);
        }
      };

      fetchRecentSales();
      const interval = setInterval(fetchRecentSales, 3000);
      return () => clearInterval(interval);
    }
  }, [isOpen, step]);

  useEffect(() => {
    if (!(isOpen && step === 'list')) return;
    const t = setTimeout(() => {
      const qs = buildRecentSalesQuery(searchParamsRef.current);
      fetch(getApiUrl(`/pos/recent-sales${qs}`), { cache: 'no-store' })
        .then(res => res.json())
        .then(result => { if (result.success) setRecentSales(result.data); })
        .catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [searchText, dateFrom, dateTo, isOpen, step]);

  const handleAuthSuccess = useCallback(() => {
    authSucceededRef.current = true;
    setStep('list');
  }, []);

  const handleAuthClose = useCallback((open: boolean) => {
    if (!open && !authSucceededRef.current) {
      onOpenChange(false);
    }
    authSucceededRef.current = false;
  }, [onOpenChange]);

  const handlePrintReceiptAction = useCallback(async (sale: Sale) => {
    if (printMode === 'browser') {
      try {
        const { printReactComponent } = await import('@/app/lib/print-utils');
        const React = await import('react');
        const { ReceiptPrintView } = await import('./ReceiptPrintView');
        printReactComponent(
          React.createElement(ReceiptPrintView, {
            sale,
            onBack: () => {},
            onPrint: () => {},
            settings: posSettings,
            isReprint: true
          }),
          '80mm'
        );
        return;
      } catch (e) {
        console.error('Browser print error:', e);
        window.print();
        return;
      }
    }

    if (!isConnected) {
      const success = await connect();
      if (!success) return;
    }

    try {
      const generator = new ReceiptGenerator();
      const receiptData = {
        ...mapSaleToReceiptDetails(sale),
        orderNumber: String(sale.orderNumber || sale.id),
        isReprint: true,
      };
      const bytes = generator.generateReceipt(receiptData, posSettings);
      await print(bytes);
      toast({ title: "Re-printed", description: "Receipt sent to printer." });
    } catch (e) {
      console.error("Reprint error", e);
      toast({ title: "Print Failed", description: "Could not send data to printer.", variant: "destructive" });
    }
  }, [printMode, isConnected, connect, print, posSettings, toast]);

  const handlePrintReceipt = useCallback((sale: Sale) => {
    setSaleToPrint(sale);
  }, []);

  const handleBackToList = useCallback(() => {
    setSaleToPrint(null);
  }, []);

  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setSaleToPrint(null);
      setSelectedSale(null);
    }
    onOpenChange(open);
  }, [onOpenChange]);

  const clearSearch = useCallback(() => {
    setSearchText('');
    setDateFrom('');
    setDateTo('');
  }, []);

  return {
    step,
    saleToPrint,
    selectedSale,
    recentSales,
    isLoading,
    posSettings,
    isPrinting,
    setSelectedSale,
    handleAuthSuccess,
    handleAuthClose,
    handlePrintReceiptAction,
    handlePrintReceipt,
    handleBackToList,
    handleOpenChange,
    searchText,
    setSearchText,
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
    clearSearch,
  };
}
