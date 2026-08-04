'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { getApiUrl } from '@/lib/api-config';
import { usePrinter } from '@/lib/use-printer';
import { VoidSlipGenerator } from '@/lib/void-slip-generator';
import type { Sale } from '@/lib/types';
import type { VoidStep, PosSettings } from './void-sales-types';
import { buildRecentSalesQuery } from '../transaction-search/build-recent-sales-query';

type Options = {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
};

export function useVoidSales({ isOpen, onOpenChange }: Options) {
  const [step, setStep] = useState<VoidStep>('loading');
  const [isLoading, setIsLoading] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [searchError, setSearchError] = useState('');
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [posSettings, setPosSettings] = useState<PosSettings | null>(null);
  const [recentSales, setRecentSales] = useState<Sale[]>([]);
  const [isRecentLoading, setIsRecentLoading] = useState(false);
  const [isVoiding, setIsVoiding] = useState(false);
  const [voidError, setVoidError] = useState('');
  const [voidReason, setVoidReason] = useState('');
  const authSucceededRef = useRef(false);
  const printMode = (posSettings?.printMode && posSettings.printMode !== 'none'
    ? posSettings.printMode
    : 'browser') as 'browser' | 'escpos' | 'usb' | 'native' | 'epson';
  const { print, connect, isConnected } = usePrinter(printMode, posSettings?.nativePrinterName);

  useEffect(() => {
    if (isOpen) {
      authSucceededRef.current = false;
      setStep('loading');
      setSearchText('');
      setDateFrom('');
      setDateTo('');
      setSearchError('');
      setSelectedSale(null);
      setVoidReason('');

      fetch(getApiUrl(`/pos-settings?_t=${Date.now()}`), { cache: 'no-store' })
        .then(res => res.json())
        .then(result => {
          if (result.success) {
            // Apply the same localStorage overrides the main POS uses — the
            // real printer mode/name are stored per-terminal in localStorage,
            // not in the server's pos_settings (which defaults to 'browser').
            const localPrintMode = localStorage.getItem('pos_printer_mode');
            const localPrinterName = localStorage.getItem('pos_printer_name');
            const localPaperSize = localStorage.getItem('pos_paper_size');
            const settings = {
              ...result.data,
              ...(localPrintMode ? { printMode: localPrintMode } : {}),
              ...(localPrinterName ? { nativePrinterName: localPrinterName } : {}),
              ...(localPaperSize ? { paperSize: localPaperSize } : {}),
            };
            setPosSettings(settings);
            if (settings.enableVoidReturnAuth) {
              setStep('auth');
            } else {
              setStep('input_so');
            }
          } else {
            setStep('input_so');
          }
        })
        .catch(() => setStep('input_so'));
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

  const handlePrintVoid = useCallback(async (saleData: any) => {
    if (!posSettings || posSettings.printMode === 'none') return;

    // Force a connect for hardware modes before printing. The local isConnected
    // flag can be stale — the native spooler connection lives in the Electron
    // main process — so unconditionally (re)connecting is what makes the void
    // slip actually spool. connect() is idempotent.
    if (printMode !== 'browser') {
      const connected = await connect();
      if (!connected) return;
    }

    try {
      const generator = new VoidSlipGenerator();
      const buffer = generator.generateVoidSlip(saleData, posSettings as any);
      await print(buffer);
    } catch (error) {
      console.error('Error printing void slip:', error);
    }
  }, [posSettings, printMode, connect, print]);

  const handleVoidTransaction = useCallback(async () => {
    if (!selectedSale) return;

    setIsVoiding(true);
    setVoidError('');

    try {
      const trimmedReason = voidReason.trim();
      let voidedByUserId: string | undefined;
      let voidedByName: string | undefined;
      try {
        const storedUser = JSON.parse(localStorage.getItem('pos_current_user') || 'null');
        voidedByUserId = storedUser?.uid || storedUser?.id;
        voidedByName = storedUser?.displayName;
      } catch {}

      const response = await fetch(getApiUrl('/pos/void-transaction'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ saleId: selectedSale.id, voidReason: trimmedReason, voidedByUserId, voidedByName }),
      });
      const result = await response.json();

      if (result.success) {
        await handlePrintVoid({ ...selectedSale, voidReason: trimmedReason });

        setTimeout(() => {
          onOpenChange(false);
        }, 1000);
      } else {
        setVoidError(result.error || 'Failed to void transaction');
      }
    } catch (err) {
      console.error('Error voiding transaction', err);
      setVoidError('Error connecting to server');
    } finally {
      setIsVoiding(false);
    }
  }, [selectedSale, voidReason, handlePrintVoid, onOpenChange]);

  const handleBackToSearch = useCallback(() => {
    setStep('input_so');
    setSelectedSale(null);
    setVoidReason('');
    setSearchText('');
    setDateFrom('');
    setDateTo('');
  }, []);

  return {
    step,
    setStep,
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
    posSettings,
    recentSales,
    isRecentLoading,
    isVoiding,
    voidError,
    voidReason,
    setVoidReason,
    handlePickSale,
    handleAuthSuccess,
    handleAuthClose,
    handleVoidTransaction,
    handleBackToSearch,
  };
}
