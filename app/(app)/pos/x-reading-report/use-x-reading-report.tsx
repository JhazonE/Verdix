'use client';

import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import { usePrinter } from '@/lib/use-printer';
import { getApiUrl } from '@/lib/api-config';
import { XReadingGenerator } from '@/lib/x-reading-generator';
import type { XReadingData } from '@/lib/types';
import type { BusinessSettings } from '../../sales/z-reading/z-reading-preview';

type Options = {
  isOpen: boolean;
  shiftId?: string;
  autoShow?: boolean;
  terminalName?: string;
  printMode: 'browser' | 'escpos' | 'usb' | 'native';
  /** When false, the X-Reading auth step is skipped entirely (POS Setup toggle). */
  requireAuth?: boolean;
};

// A cashier is waiting at the terminal and this asks for a single shift
// (limit=1), so it should never take long.
const REPORT_FETCH_TIMEOUT_MS = 20_000;

export function useXReadingReport({ isOpen, shiftId, autoShow = false, terminalName, printMode, requireAuth = true }: Options) {
  type ReturnType = {
    isAuthDialogOpen: boolean;
    setIsAuthDialogOpen: (v: boolean) => void;
    showReport: boolean;
    setShowReport: (v: boolean) => void;
    reportData: XReadingData | null;
    businessSettings: BusinessSettings | null;
    loading: boolean;
    isPrinting: boolean;
    handlePrint: () => Promise<void>;
    loadReportData: () => Promise<void>;
    handleAdminAuthSuccess: () => void;
  };
  const [isAuthDialogOpen, setIsAuthDialogOpen] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [reportData, setReportData] = useState<XReadingData | null>(null);
  const [businessSettings, setBusinessSettings] = useState<BusinessSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const nativePrinterName = typeof window !== 'undefined' ? localStorage.getItem('pos_printer_name') || undefined : undefined;
  const { isPrinting, isConnected, connect, print } = usePrinter(printMode, nativePrinterName);
  const { toast } = useToast();

  const loadReportData = useCallback(async () => {
    setLoading(true);
    try {
      let url = '/sales/x-reading?limit=1';
      if (shiftId) {
        url = `/sales/x-reading?limit=1&shiftId=${shiftId}`;
      } else {
        url = '/sales/x-reading?shiftStatus=active&limit=1';
      }
      // fetch() has no timeout; without this a wedged route left the dialog
      // on "Loading…" indefinitely with nothing reported.
      const response = await fetch(getApiUrl(url), { signal: AbortSignal.timeout(REPORT_FETCH_TIMEOUT_MS) });
      if (!response.ok) throw new Error(`API error ${response.status}`);
      const result = await response.json();
      // success:false used to fall through this condition and set nothing at
      // all — no data, no toast, a blank dialog with no explanation. Raise it.
      if (!result.success) {
        throw new Error(result.details || result.error || 'The X-reading request failed');
      }
      if (result.data.length > 0) {
        setReportData(result.data[0]);
      } else {
        toast({ title: 'No Active Shift', description: 'There is no shift to report on.', variant: 'destructive' });
      }
    } catch (error) {
      console.error('Error loading X-reading:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to load report data',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [shiftId, toast]);

  const handlePrint = async () => {
    if (!reportData) return;
    if (printMode === 'browser') {
      try {
        const { printReactComponent } = await import('@/app/lib/print-utils');
        const { XReadingPreview } = await import('../../sales/x-reading/x-reading-preview');
        printReactComponent(
          <XReadingPreview data={{ ...reportData, terminalName }} businessSettings={businessSettings || {} as BusinessSettings} printerFormat="80mm" />,
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
      const generator = new XReadingGenerator();
      const printData = {
        ...reportData,
        businessName: businessSettings?.businessName,
        operatedBy: businessSettings?.operatedBy,
        address: businessSettings?.address,
        tin: businessSettings?.tin,
        vatRegistration: businessSettings?.vatRegistration,
        contactNumber: businessSettings?.contactNumber,
        email: businessSettings?.email,
        terminalName: terminalName,
        min: reportData?.min,
        sn: reportData?.sn,
      };
      const bytes = generator.generate(printData as any);
      await print(bytes);
      toast({ title: 'Success', description: 'X-Reading report sent to printer.' });
    } catch (error) {
      console.error('Print error:', error);
      toast({ title: 'Print Failed', description: 'Failed to send data to printer.', variant: 'destructive' });
    }
  };

  const handleAdminAuthSuccess = () => {
    setIsAuthDialogOpen(false);
    setShowReport(true);
    loadReportData();
  };

  useEffect(() => {
    if (isOpen && (autoShow || !requireAuth)) {
      // autoShow is the end-shift report path; !requireAuth is the POS Setup
      // toggle being off. Both go straight to the report with no auth step.
      setShowReport(true);
      loadReportData();
    } else if (isOpen) {
      setIsAuthDialogOpen(true);
      setShowReport(false);
    } else {
      setIsAuthDialogOpen(false);
      setShowReport(false);
      setReportData(null);
    }
  }, [isOpen, autoShow, requireAuth, loadReportData]);

  useEffect(() => {
    if (isOpen) {
      fetch(getApiUrl('/pos-settings'))
        .then(res => res.json())
        .then(data => { if (data.success) setBusinessSettings(data.data); })
        .catch(err => console.error('Failed to load settings', err));
    }
  }, [isOpen]);

  return {
    isAuthDialogOpen, setIsAuthDialogOpen,
    showReport, setShowReport,
    reportData, businessSettings, loading,
    isPrinting,
    handlePrint, loadReportData, handleAdminAuthSuccess,
  } as ReturnType;
}
