'use client';

import { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { getApiUrl } from '@/lib/api-config';
import { usePrinter } from '@/lib/use-printer';
import { OverallReadingGenerator } from '@/lib/overall-reading-generator';
import { OverallReadingPreview, OverallReadingData } from '../../sales/overall-reading/overall-reading-preview';

type Props = {
  isOpen: boolean;
  terminalId: string;
  terminalName?: string;
  printMode: 'browser' | 'escpos' | 'usb' | 'native';
};

export function useOverallReading({ isOpen, terminalId, terminalName, printMode }: Props) {
  const [reportData, setReportData] = useState<OverallReadingData | null>(null);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const nativePrinterName = typeof window !== 'undefined' ? localStorage.getItem('pos_printer_name') || undefined : undefined;
  const { isPrinting, isConnected, connect, print } = usePrinter(printMode, nativePrinterName);

  useEffect(() => {
    if (isOpen) {
      loadReportData();
    } else {
      setReportData(null);
    }
  }, [isOpen, terminalId]);

  const loadReportData = async () => {
    if (!terminalId) return;
    setLoading(true);
    try {
      const res = await fetch(getApiUrl(`/sales/overall-reading?terminalId=${terminalId}`));
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const result = await res.json();
      if (result.success) {
        setReportData({
          ...result.data,
          terminalName: result.data.terminalName || terminalName || terminalId,
        });
      } else {
        toast({ title: 'Error', description: result.error || 'Failed to load report data', variant: 'destructive' });
      }
    } catch (e) {
      console.error('Error loading overall reading:', e);
      toast({ title: 'Error', description: 'Failed to connect to server', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = async () => {
    if (!reportData) return;

    if (printMode === 'browser') {
      try {
        const { printReactComponent } = await import('@/app/lib/print-utils');
        printReactComponent(<OverallReadingPreview data={reportData} printerFormat="80mm" />, '80mm');
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
      const generator = new OverallReadingGenerator();
      const bytes = generator.generate(reportData);
      await print(bytes);
      toast({ title: 'Success', description: 'Overall Reading report sent to printer.' });
    } catch (e) {
      console.error('Print error:', e);
      toast({ title: 'Print Failed', description: 'Failed to send data to printer.', variant: 'destructive' });
    }
  };

  return { reportData, loading, isPrinting, handlePrint, loadReportData };
}
