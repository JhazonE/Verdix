'use client';

import { useState, useRef, useMemo } from 'react';
import {
  ColumnDef, SortingState, VisibilityState,
  getCoreRowModel, getSortedRowModel, useReactTable,
} from '@tanstack/react-table';
import { Button } from '@/components/ui/button';
import { ArrowUpDown, ArrowUp, ArrowDown, Eye, Printer, FileText, Image as ImageIcon } from 'lucide-react';
import { format } from 'date-fns';
import { DateRange } from 'react-day-picker';
import { useToast } from '@/hooks/use-toast';
import { useQuery } from '@tanstack/react-query';
import { useReactToPrint } from 'react-to-print';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { getApiUrl } from '@/lib/api-config';
import { ZReadingData, BusinessSettings } from './z-reading-preview';

export type PrinterFormat = '58mm' | '80mm';

// See the X-reading page: long enough for a wide range on a remote DB, short
// enough that a wedged request reports itself instead of spinning forever.
const REPORT_FETCH_TIMEOUT_MS = 45_000;

export function useZReadingPage() {
  const { toast } = useToast();
  const previewRef = useRef<HTMLDivElement>(null);

  const initFrom = new Date();
  initFrom.setDate(initFrom.getDate() - 30);
  const initTo = new Date();

  const [dateRange, setDateRange] = useState<DateRange | undefined>({ from: initFrom, to: initTo });
  const [terminal, setTerminal] = useState<string>('all');
  const [queryParams, setQueryParams] = useState<{ from: string; to: string; terminalId: string } | null>({
    from: format(initFrom, 'yyyy-MM-dd'),
    to: format(initTo, 'yyyy-MM-dd'),
    terminalId: 'all',
  });
  const [printerFormat, setPrinterFormat] = useState<PrinterFormat>('80mm');
  const [selectedReading, setSelectedReading] = useState<ZReadingData | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});

  const { data: businessSettings } = useQuery<BusinessSettings | null>({
    queryKey: ['posSettings'],
    queryFn: async () => {
      const res = await fetch(getApiUrl('/pos-settings'));
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const result = await res.json();
      return result.success ? result.data : null;
    },
  });

  const { data: zReadings = [], isLoading, isError, error, refetch } = useQuery<ZReadingData[]>({
    queryKey: ['zReadings', queryParams],
    queryFn: async () => {
      if (!queryParams) return [];
      const params = new URLSearchParams();
      params.append('startDate', queryParams.from);
      params.append('endDate', queryParams.to);
      if (queryParams.terminalId) params.append('terminalId', queryParams.terminalId);
      // This page queries on mount over a 30-day default range, so it is the
      // one users hit first — and fetch() has no timeout, so a route that
      // never answers left it loading forever with nothing to report.
      const res = await fetch(getApiUrl(`/sales/z-reading?${params.toString()}`), {
        signal: AbortSignal.timeout(REPORT_FETCH_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const result = await res.json();
      // Returning [] on success:false rendered a failure as "no Z-readings",
      // hiding both the cause and the fact that anything went wrong.
      if (!result.success) {
        throw new Error(result.details || result.error || 'Failed to fetch Z-readings');
      }
      const rows = result.data ?? [];
      if (rows.length === 1 && queryParams.from === queryParams.to) {
        setSelectedReading(rows[0]);
        setIsPreviewOpen(true);
      }
      return rows;
    },
    enabled: !!queryParams,
  });

  const handleShowReport = () => {
    if (!dateRange?.from) {
      toast({ title: 'Error', description: 'Please select a date range', variant: 'destructive' });
      return;
    }
    setQueryParams({
      from: format(dateRange.from, 'yyyy-MM-dd'),
      to: dateRange.to ? format(dateRange.to, 'yyyy-MM-dd') : format(dateRange.from, 'yyyy-MM-dd'),
      terminalId: terminal,
    });
  };

  const handleView = (reading: ZReadingData) => {
    setSelectedReading(reading);
    setIsPreviewOpen(true);
  };

  const handleReactToPrintFn = useReactToPrint({
    contentRef: previewRef,
    documentTitle: 'Z-Reading-Report',
    pageStyle: `@page { size: ${printerFormat === '58mm' ? '58mm' : '80mm'} auto; margin: 0; } @media print { body { visibility: visible !important; -webkit-print-color-adjust: exact; } * { visibility: visible !important; } }`,
  });

  const handlePrint = (reading?: ZReadingData) => {
    if (reading) {
      setSelectedReading(reading);
      setIsPreviewOpen(true);
      setTimeout(() => handleReactToPrintFn(), 500);
    } else if (selectedReading) {
      handleReactToPrintFn();
    }
  };

  const handleExportPDF = async (reading: ZReadingData) => {
    try {
      setSelectedReading(reading);
      setIsPreviewOpen(true);
      setTimeout(async () => {
        if (previewRef.current) {
          const canvas = await html2canvas(previewRef.current, { scale: 2, backgroundColor: '#ffffff' });
          const imgData = canvas.toDataURL('image/png');
          const pdfWidth = printerFormat === '58mm' ? 58 : 80;
          const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
          const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [pdfWidth, 297] });
          pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
          pdf.save(`Z-Reading-${reading.id}.pdf`);
          toast({ title: 'Success', description: 'Z-Reading exported as PDF' });
        }
      }, 500);
    } catch {
      toast({ title: 'Error', description: 'Failed to export PDF', variant: 'destructive' });
    }
  };

  const handleExportImage = async (reading: ZReadingData) => {
    try {
      setSelectedReading(reading);
      setIsPreviewOpen(true);
      setTimeout(async () => {
        if (previewRef.current) {
          const canvas = await html2canvas(previewRef.current, { scale: 2, backgroundColor: '#ffffff' });
          canvas.toBlob((blob) => {
            if (blob) {
              const url = URL.createObjectURL(blob);
              const link = document.createElement('a');
              link.href = url;
              link.download = `Z-Reading-${reading.id}.png`;
              link.click();
              URL.revokeObjectURL(url);
              toast({ title: 'Success', description: 'Z-Reading exported as image' });
            }
          });
        }
      }, 500);
    } catch {
      toast({ title: 'Error', description: 'Failed to export image', variant: 'destructive' });
    }
  };

  const columns = useMemo<ColumnDef<ZReadingData>[]>(() => [
    {
      accessorKey: 'id',
      header: 'Z-Reading ID',
      cell: ({ row }) => <span className="font-medium font-mono">{row.getValue('id')}</span>,
    },
    {
      accessorKey: 'date',
      header: ({ column }) => (
        <Button variant="ghost" size="sm" className="-ml-3 h-8" onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}>
          Date
          {column.getIsSorted() === 'asc' ? <ArrowUp className="ml-2 h-4 w-4" /> : column.getIsSorted() === 'desc' ? <ArrowDown className="ml-2 h-4 w-4" /> : <ArrowUpDown className="ml-2 h-4 w-4" />}
        </Button>
      ),
      cell: ({ row }) => format(new Date(row.getValue('date')), 'PP'),
    },
    {
      accessorKey: 'terminalId',
      header: 'Terminal',
      cell: ({ row }) => row.original.terminalId || 'N/A',
    },
    {
      accessorKey: 'cashierName',
      header: 'Cashier',
      cell: ({ row }) => row.original.cashierName || 'N/A',
    },
    {
      accessorKey: 'transactionCount',
      header: ({ column }) => (
        <Button variant="ghost" size="sm" className="-ml-3 h-8 text-right" onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}>
          Transactions
          {column.getIsSorted() === 'asc' ? <ArrowUp className="ml-2 h-4 w-4" /> : column.getIsSorted() === 'desc' ? <ArrowDown className="ml-2 h-4 w-4" /> : <ArrowUpDown className="ml-2 h-4 w-4" />}
        </Button>
      ),
      cell: ({ row }) => <div className="text-right">{row.getValue('transactionCount')}</div>,
    },
    {
      accessorKey: 'netSales',
      header: ({ column }) => (
        <Button variant="ghost" size="sm" className="-ml-3 h-8 text-right" onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}>
          Net Sales
          {column.getIsSorted() === 'asc' ? <ArrowUp className="ml-2 h-4 w-4" /> : column.getIsSorted() === 'desc' ? <ArrowDown className="ml-2 h-4 w-4" /> : <ArrowUpDown className="ml-2 h-4 w-4" />}
        </Button>
      ),
      cell: ({ row }) => <div className="text-right font-mono">₱{(row.getValue('netSales') as number).toFixed(2)}</div>,
    },
    {
      id: 'actions',
      header: () => <div className="text-right">Actions</div>,
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => {
        const reading = row.original;
        return (
          <div className="flex items-center justify-end gap-1">
            <Button variant="ghost" size="icon" onClick={() => handleView(reading)} title="View"><Eye className="h-4 w-4" /></Button>
            <Button variant="ghost" size="icon" onClick={() => handlePrint(reading)} title="Print"><Printer className="h-4 w-4" /></Button>
            <Button variant="ghost" size="icon" onClick={() => handleExportPDF(reading)} title="Export PDF"><FileText className="h-4 w-4" /></Button>
            <Button variant="ghost" size="icon" onClick={() => handleExportImage(reading)} title="Export Image"><ImageIcon className="h-4 w-4" /></Button>
          </div>
        );
      },
    },
  ], [handleView, handlePrint, handleExportPDF, handleExportImage]);

  const table = useReactTable({
    data: zReadings,
    columns,
    state: { sorting, columnVisibility },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return {
    dateRange, setDateRange,
    terminal, setTerminal,
    queryParams,
    printerFormat, setPrinterFormat,
    selectedReading,
    isPreviewOpen, setIsPreviewOpen,
    businessSettings,
    zReadings, isLoading,
    isError,
    errorMessage: error instanceof Error ? error.message : null,
    refetch,
    previewRef,
    table, columns,
    handleShowReport,
    handleView,
    handlePrint,
    handleExportPDF,
    handleExportImage,
    handleReactToPrintFn,
  };
}
