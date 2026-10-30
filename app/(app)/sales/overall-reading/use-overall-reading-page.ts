'use client';

import { useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useReactToPrint } from 'react-to-print';
import { format, subDays } from 'date-fns';
import { DateRange } from 'react-day-picker';
import { useToast } from '@/hooks/use-toast';
import { getApiUrl } from '@/lib/api-config';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import type { OverallReadingData, PrinterFormat } from './overall-reading-types';

export type { PrinterFormat };

// fetch() has no timeout of its own, so a route that never answers (a
// saturated connection pool used to hang one forever) left this page loading
// indefinitely with nothing to report. Fail at a bound instead.
const REPORT_FETCH_TIMEOUT_MS = 45_000;

export interface Shift {
  id: string;
  cashier_name: string;
  terminal_id: string;
  end_time: string;
}

interface ShiftQueryParams {
  from: string;
  to: string;
  terminalId: string;
}

export function useOverallReadingPage() {
  const today = new Date();
  const { toast } = useToast();

  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: subDays(today, 7),
    to: today,
  });
  const [terminal, setTerminal] = useState<string>('all');
  const [shiftsQueryParams, setShiftsQueryParams] = useState<ShiftQueryParams>({
    from: format(subDays(today, 7), 'yyyy-MM-dd'),
    to: format(today, 'yyyy-MM-dd'),
    terminalId: 'all',
  });
  const [selectedShift, setSelectedShift] = useState<Shift | null>(null);
  const [printerFormat, setPrinterFormat] = useState<PrinterFormat>('80mm');
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'view' | 'print'>('view');

  const previewRef = useRef<HTMLDivElement>(null);

  const {
    data: shifts = [],
    isLoading: shiftsLoading,
    isError: shiftsError,
    error: shiftsErrorObj,
    refetch: refetchShifts,
  } = useQuery<Shift[]>({
    queryKey: ['overallReadingShifts', shiftsQueryParams],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.append('startDate', shiftsQueryParams.from);
      params.append('endDate', shiftsQueryParams.to);
      if (shiftsQueryParams.terminalId !== 'all') {
        params.append('terminalId', shiftsQueryParams.terminalId);
      }
      const res = await fetch(getApiUrl(`/pos/shifts?${params.toString()}`), {
        signal: AbortSignal.timeout(REPORT_FETCH_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const result = await res.json();
      if (!result.success) throw new Error(result.error || 'Failed to fetch shifts');
      if (result.data.length === 0) {
        toast({ title: 'Info', description: 'No completed shifts found for the selected criteria.' });
      }
      return result.data;
    },
  });

  const {
    data: readingData,
    isLoading: readingLoading,
    isError: readingError,
    error: readingErrorObj,
    refetch: refetchReading,
  } = useQuery<OverallReadingData>({
    queryKey: ['shiftReading', selectedShift?.id],
    queryFn: async () => {
      if (!selectedShift) throw new Error('No shift selected');
      const params = new URLSearchParams();
      params.append('terminalId', selectedShift.terminal_id);
      params.append('shiftId', selectedShift.id);
      const res = await fetch(getApiUrl(`/sales/overall-reading?${params.toString()}`), {
        signal: AbortSignal.timeout(REPORT_FETCH_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const result = await res.json();
      if (!result.success) throw new Error(result.error || 'Failed to fetch reading for shift');
      if (result.data.transactionCount === 0) {
        toast({ title: 'Info', description: `No transactions found for shift ID: ${selectedShift.id}.` });
      }
      return result.data;
    },
    enabled: !!selectedShift,
  });

  const isLoading = shiftsLoading || readingLoading;

  const handleSearchShifts = () => {
    if (!dateRange?.from) {
      toast({ title: 'Error', description: 'Please select a date range', variant: 'destructive' });
      return;
    }
    setSelectedShift(null);
    setShiftsQueryParams({
      from: format(dateRange.from, 'yyyy-MM-dd'),
      to: dateRange.to ? format(dateRange.to, 'yyyy-MM-dd') : format(dateRange.from, 'yyyy-MM-dd'),
      terminalId: terminal,
    });
  };

  const handleReactToPrintFn = useReactToPrint({
    contentRef: previewRef,
    documentTitle: 'Overall-Reading-Report',
    pageStyle: `
      @page { size: ${printerFormat === 'A4' ? 'A4 portrait' : (printerFormat === '58mm' ? '58mm' : '80mm')} auto; margin: 0; }
      @media print {
        body { visibility: hidden !important; }
        .printable-area { visibility: visible !important; position: absolute; left: 0; top: 0; width: 100%; background-color: white !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        .printable-area * { visibility: visible !important; }
      }
    `,
  });

  const handleExportPDF = async () => {
    if (!readingData) return;
    try {
      setIsPreviewOpen(true);
      setTimeout(async () => {
        if (previewRef.current) {
          const canvas = await html2canvas(previewRef.current, { scale: 2, backgroundColor: '#ffffff' });
          const imgData = canvas.toDataURL('image/png');
          const pdfWidth = printerFormat === 'A4' ? 210 : (printerFormat === '58mm' ? 58 : 80);
          const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
          const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: printerFormat === 'A4' ? 'a4' : [pdfWidth, pdfHeight] });
          pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
          pdf.save(`Overall-Reading-${selectedShift?.id || 'export'}.pdf`);
          toast({ title: 'Success', description: 'Report exported as PDF' });
        }
      }, 500);
    } catch {
      toast({ title: 'Error', description: 'Failed to export PDF', variant: 'destructive' });
    }
  };

  const maxTerminalSales = readingData?.terminals.reduce((max, t) => Math.max(max, t.netSales), 0) || 1;
  const maxCashierSales = readingData?.cashiers.reduce((max, c) => Math.max(max, c.netSales), 0) || 1;

  return {
    dateRange, setDateRange,
    terminal, setTerminal,
    selectedShift, setSelectedShift,
    printerFormat, setPrinterFormat,
    isPreviewOpen, setIsPreviewOpen,
    modalMode, setModalMode,
    shifts, shiftsLoading,
    readingData, readingLoading,
    isLoading,
    // Surfaced so the page can distinguish "no shifts in this range" from
    // "the request failed" — rendering both as an empty screen is what made
    // users report the reading as simply not displaying.
    isError: shiftsError || readingError,
    errorMessage:
      (shiftsErrorObj instanceof Error ? shiftsErrorObj.message : null) ??
      (readingErrorObj instanceof Error ? readingErrorObj.message : null),
    retry: () => {
      if (shiftsError) refetchShifts();
      if (readingError) refetchReading();
    },
    previewRef,
    handleSearchShifts,
    handleReactToPrintFn,
    handleExportPDF,
    maxTerminalSales,
    maxCashierSales,
  };
}
