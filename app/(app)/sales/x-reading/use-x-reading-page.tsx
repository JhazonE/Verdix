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
import { cn } from '@/lib/utils';
import { getApiUrl } from '@/lib/api-config';
import { XReadingData } from './x-reading-preview';
import { BusinessSettings } from '../z-reading/z-reading-preview';

export type PrinterFormat = '58mm' | '80mm';

// Long enough for a wide date range over a remote (cloud) DB, short enough
// that a wedged request reports itself instead of spinning until the user
// gives up and calls the report "broken".
const REPORT_FETCH_TIMEOUT_MS = 45_000;

export function useXReadingPage() {
  const { toast } = useToast();
  const previewRef = useRef<HTMLDivElement>(null);

  const [dateRange, setDateRange] = useState<DateRange | undefined>({ from: new Date(), to: new Date() });
  const [queryParams, setQueryParams] = useState<{ from: string; to: string } | null>(null);
  const [printerFormat, setPrinterFormat] = useState<PrinterFormat>('80mm');
  const [selectedCashier, setSelectedCashier] = useState<string>('all');
  const [selectedReading, setSelectedReading] = useState<XReadingData | null>(null);
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

  const { data: xReadings = [], isLoading, isError, error, refetch } = useQuery<XReadingData[]>({
    queryKey: ['xReadings', queryParams],
    queryFn: async () => {
      if (!queryParams) return [];
      const params = new URLSearchParams();
      params.append('startDate', queryParams.from);
      params.append('endDate', queryParams.to);
      // A request that never answers is the failure users actually hit (a
      // saturated pool used to hang the route forever), and fetch() has no
      // timeout of its own — without this the page spins indefinitely with
      // nothing to report. Fail loudly instead so the UI can say so.
      const res = await fetch(getApiUrl(`/sales/x-reading?${params.toString()}`), {
        signal: AbortSignal.timeout(REPORT_FETCH_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const result = await res.json();
      // A 200 carrying success:false is still a failure, and it is the one the
      // API reports its own `details` through. Returning [] here rendered it
      // as "no X-readings found" — indistinguishable from an empty date range,
      // which is why users saw a blank report and no reason for it.
      if (!result.success) {
        throw new Error(result.details || result.error || 'Failed to fetch X-readings');
      }
      return result.data ?? [];
    },
    enabled: !!queryParams,
  });

  const uniqueCashiers = useMemo(
    () => Array.from(new Set(xReadings.map(r => r.cashierName).filter(Boolean))) as string[],
    [xReadings]
  );

  const filteredReadings = useMemo(
    () => xReadings.filter(r => selectedCashier === 'all' || r.cashierName === selectedCashier),
    [xReadings, selectedCashier]
  );

  const handleShowReport = () => {
    if (!dateRange?.from) {
      toast({ title: 'Error', description: 'Please select a date range', variant: 'destructive' });
      return;
    }
    setQueryParams({
      from: format(dateRange.from, 'yyyy-MM-dd'),
      to: dateRange.to ? format(dateRange.to, 'yyyy-MM-dd') : format(dateRange.from, 'yyyy-MM-dd'),
    });
  };

  const handleView = (reading: XReadingData) => {
    setSelectedReading(reading);
    setIsPreviewOpen(true);
  };

  const handleReactToPrintFn = useReactToPrint({
    contentRef: previewRef,
    documentTitle: 'X-Reading-Report',
    pageStyle: `
      @page { size: ${printerFormat === '58mm' ? '58mm' : '80mm'} auto; margin: 0; }
      @media print { body { visibility: visible !important; -webkit-print-color-adjust: exact; } * { visibility: visible !important; } }
    `,
  });

  const handlePrint = (reading?: XReadingData) => {
    if (reading) {
      setSelectedReading(reading);
      setIsPreviewOpen(true);
      setTimeout(() => handleReactToPrintFn(), 500);
    } else if (selectedReading) {
      handleReactToPrintFn();
    }
  };

  const handleExportPDF = async (reading: XReadingData) => {
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
          pdf.save(`X-Reading-${reading.id}.pdf`);
          toast({ title: 'Success', description: 'X-Reading exported as PDF' });
        }
      }, 500);
    } catch {
      toast({ title: 'Error', description: 'Failed to export PDF', variant: 'destructive' });
    }
  };

  const handleExportImage = async (reading: XReadingData) => {
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
              link.download = `X-Reading-${reading.id}.png`;
              link.click();
              URL.revokeObjectURL(url);
              toast({ title: 'Success', description: 'X-Reading exported as image' });
            }
          });
        }
      }, 500);
    } catch {
      toast({ title: 'Error', description: 'Failed to export image', variant: 'destructive' });
    }
  };

  const columns = useMemo<ColumnDef<XReadingData>[]>(() => [
    {
      accessorKey: 'id',
      header: 'Shift ID',
      cell: ({ row }) => <span className="font-medium font-mono">{row.getValue('id')}</span>,
    },
    {
      accessorKey: 'shiftStart',
      header: ({ column }) => (
        <Button variant="ghost" size="sm" className="-ml-3 h-8" onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}>
          Shift Start
          {column.getIsSorted() === 'asc' ? <ArrowUp className="ml-2 h-4 w-4" /> : column.getIsSorted() === 'desc' ? <ArrowDown className="ml-2 h-4 w-4" /> : <ArrowUpDown className="ml-2 h-4 w-4" />}
        </Button>
      ),
      cell: ({ row }) => {
        const v = row.getValue<string>('shiftStart');
        return v ? format(new Date(v), 'PP p') : 'N/A';
      },
    },
    {
      accessorKey: 'shiftEnd',
      header: ({ column }) => (
        <Button variant="ghost" size="sm" className="-ml-3 h-8" onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}>
          Shift End
          {column.getIsSorted() === 'asc' ? <ArrowUp className="ml-2 h-4 w-4" /> : column.getIsSorted() === 'desc' ? <ArrowDown className="ml-2 h-4 w-4" /> : <ArrowUpDown className="ml-2 h-4 w-4" />}
        </Button>
      ),
      cell: ({ row }) => {
        const v = row.getValue<string>('shiftEnd');
        return v ? format(new Date(v), 'PP p') : 'Active';
      },
    },
    {
      accessorKey: 'cashierName',
      header: ({ column }) => (
        <Button variant="ghost" size="sm" className="-ml-3 h-8" onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}>
          Cashier
          {column.getIsSorted() === 'asc' ? <ArrowUp className="ml-2 h-4 w-4" /> : column.getIsSorted() === 'desc' ? <ArrowDown className="ml-2 h-4 w-4" /> : <ArrowUpDown className="ml-2 h-4 w-4" />}
        </Button>
      ),
      cell: ({ row }) => row.getValue('cashierName') || 'N/A',
    },
    {
      accessorKey: 'shiftStatus',
      header: 'Status',
      cell: ({ row }) => {
        const status = row.getValue<string>('shiftStatus');
        return (
          <span className={cn('px-2 py-1 rounded-full text-xs font-semibold', status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800')}>
            {status}
          </span>
        );
      },
    },
    {
      accessorKey: 'netSales',
      header: ({ column }) => (
        <div className="text-right">
          <Button variant="ghost" size="sm" className="-mr-3 h-8" onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}>
            Net Sales
            {column.getIsSorted() === 'asc' ? <ArrowUp className="ml-2 h-4 w-4" /> : column.getIsSorted() === 'desc' ? <ArrowDown className="ml-2 h-4 w-4" /> : <ArrowUpDown className="ml-2 h-4 w-4" />}
          </Button>
        </div>
      ),
      cell: ({ row }) => (
        <div className="text-right font-mono">₱{(row.getValue<number>('netSales') ?? 0).toFixed(2)}</div>
      ),
    },
    {
      id: 'actions',
      enableSorting: false,
      enableHiding: false,
      header: () => <div className="text-right">Actions</div>,
      cell: ({ row }) => {
        const reading = row.original;
        return (
          <div className="flex items-center justify-end gap-1">
            <Button variant="ghost" size="icon" onClick={() => handleView(reading)} title="View"><Eye className="h-4 w-4" /></Button>
            <Button variant="ghost" size="icon" onClick={() => handlePrint(reading)} title="Print"><Printer className="h-4 w-4" /></Button>
            <Button variant="ghost" size="icon" onClick={() => handleExportPDF(reading)} title="Export as PDF"><FileText className="h-4 w-4" /></Button>
            <Button variant="ghost" size="icon" onClick={() => handleExportImage(reading)} title="Export as Image"><ImageIcon className="h-4 w-4" /></Button>
          </div>
        );
      },
    },
  ], [handleView, handlePrint, handleExportPDF, handleExportImage]);

  const table = useReactTable({
    data: filteredReadings,
    columns,
    state: { sorting, columnVisibility },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return {
    dateRange, setDateRange,
    queryParams,
    printerFormat, setPrinterFormat,
    selectedCashier, setSelectedCashier,
    selectedReading,
    isPreviewOpen, setIsPreviewOpen,
    businessSettings,
    xReadings, isLoading,
    isError,
    errorMessage: error instanceof Error ? error.message : null,
    refetch,
    uniqueCashiers,
    filteredReadings,
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
