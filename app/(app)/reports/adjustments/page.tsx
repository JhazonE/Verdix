'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { Loader2, Printer, ClipboardX, FileSpreadsheet } from 'lucide-react';
import { format } from 'date-fns';
import { ReportHeader } from '@/components/reports/ReportHeader';
import { getApiUrl } from '@/lib/api-config';
import { formatQuantity } from '@/lib/utils';
import { DataTablePagination } from '@/components/ui/data-table-pagination';
import { printReportTable, exportReportExcel } from '@/lib/report-print';
import { ReportSearchInput } from '@/components/reports/ReportSearchInput';
import { useToast } from '@/hooks/use-toast';

interface Adjustment {
  id: string;
  product_name: string;
  sku: string;
  quantity: number;
  reason: string;
  new_stock: number;
  created_at: string;
  barcode: string;
  unit_of_measure: string;
}

export default function AdjustmentReportPage() {
  const { toast } = useToast();
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  const [startDate, setStartDate] = useState(format(new Date().setDate(new Date().getDate() - 30), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  // Pagination State
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);

  const [isPrinting, setIsPrinting] = useState(false);

  const handlePrint = async () => {
    setIsPrinting(true);
    try {
      const params = new URLSearchParams();
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);
      params.append('page', '1');
      params.append('limit', '100000');

      let rows: Adjustment[] = adjustments;
      try {
        const res = await fetch(getApiUrl(`/reports/adjustments?${params.toString()}`));
        const data = await res.json();
        if (data.success && Array.isArray(data.data)) rows = data.data;
      } catch {
        // fall back to the currently loaded page
      }

      printReportTable<Adjustment>({
        title: 'Stock Adjustment Report',
        subtitle: 'Log of manual stock corrections, damaged goods, and losses.',
        period: `${startDate} to ${endDate}`,
        columns: [
          { header: 'Date', cell: (a) => format(new Date(a.created_at), 'MMM dd, yyyy HH:mm') },
          { header: 'Product', cell: (a) => a.product_name },
          { header: 'Barcode', cell: (a) => a.barcode || '-' },
          { header: 'Reason', cell: (a) => a.reason },
          { header: 'Adjustment', align: 'right', emphasize: true, cell: (a) => `${Number(a.quantity) > 0 ? '+' : ''}${formatQuantity(a.quantity, a.unit_of_measure)}` },
          { header: 'New Stock', align: 'right', cell: (a) => formatQuantity(a.new_stock, a.unit_of_measure) },
        ],
        rows,
        emptyMessage: 'No adjustments found for this period.',
      });
    } finally {
      setIsPrinting(false);
    }
  };

  const filteredAdjustments = adjustments.filter((a) => {
    if (!searchTerm.trim()) return true;
    const search = searchTerm.toLowerCase();
    return (
      a.product_name?.toLowerCase().includes(search) ||
      a.barcode?.toLowerCase().includes(search) ||
      a.reason?.toLowerCase().includes(search)
    );
  });

  const [isExporting, setIsExporting] = useState(false);

  const exportToExcel = async () => {
    setIsExporting(true);
    try {
      const params = new URLSearchParams();
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);
      params.append('page', '1');
      params.append('limit', '100000');

      let rows: Adjustment[] = adjustments;
      try {
        const res = await fetch(getApiUrl(`/reports/adjustments?${params.toString()}`));
        const data = await res.json();
        if (data.success && Array.isArray(data.data)) rows = data.data;
      } catch {
        // fall back to the currently loaded page
      }

      const search = searchTerm.toLowerCase();
      const fullFilteredRows = rows.filter((a) => {
        if (!searchTerm.trim()) return true;
        return (
          a.product_name?.toLowerCase().includes(search) ||
          a.barcode?.toLowerCase().includes(search) ||
          a.reason?.toLowerCase().includes(search)
        );
      });

      const fileName = `Stock_Adjustments_${format(new Date(startDate), 'yyyyMMdd')}_${format(new Date(endDate), 'yyyyMMdd')}.xls`;
      const ok = exportReportExcel<Adjustment>({
        title: 'Stock Adjustment Report',
        subtitle: `${startDate} to ${endDate}`,
        columns: [
          { header: 'Date', cell: (a) => format(new Date(a.created_at), 'MMM dd, yyyy HH:mm') },
          { header: 'Product', cell: (a) => a.product_name },
          { header: 'Barcode', cell: (a) => a.barcode || '-' },
          { header: 'Reason', cell: (a) => a.reason },
          { header: 'Adjustment', align: 'right', cell: (a) => `${Number(a.quantity) > 0 ? '+' : ''}${formatQuantity(a.quantity, a.unit_of_measure)}` },
          { header: 'New Stock', align: 'right', cell: (a) => formatQuantity(a.new_stock, a.unit_of_measure) },
        ],
        rows: fullFilteredRows,
        fileName,
      });
      if (!ok) {
        toast({ title: 'No Data', description: 'No records to export.', variant: 'destructive' });
        return;
      }
      toast({ title: 'Excel Exported', description: `Report saved as ${fileName}` });
    } catch (error) {
      console.error('Failed to export adjustments to Excel:', error);
      toast({ title: 'Export Failed', description: 'Could not export the report. Please try again.', variant: 'destructive' });
    } finally {
      setIsExporting(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [page, pageSize]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);
      params.append('page', page.toString());
      params.append('limit', pageSize.toString());

      const res = await fetch(getApiUrl(`/reports/adjustments?${params.toString()}`));
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const data = await res.json();
      
      if (data.success) {
        setAdjustments(data.data);
        if (data.pagination) {
            setTotalPages(data.pagination.totalPages);
            setTotalItems(data.pagination.totalItems);
        }
      }
    } catch (error) {
      console.error('Failed to fetch adjustments:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Adjustment / Damaged Report</h2>
          <p className="text-muted-foreground">
            Log of manual stock corrections, damaged goods, and losses.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ReportSearchInput
            value={searchTerm}
            onChange={setSearchTerm}
            placeholder="Search product, reason..."
          />
          <Button onClick={() => handlePrint()} variant="outline" className="gap-2" disabled={isPrinting}>
              {isPrinting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
              Print Report
          </Button>
          <Button
            onClick={() => exportToExcel()}
            variant="outline"
            className="gap-2 border-emerald-700 text-emerald-700 hover:bg-emerald-50"
            disabled={isExporting || filteredAdjustments.length === 0}
          >
            {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
            Export to Excel
          </Button>
        </div>
      </div>

       <Card className="print:hidden">
        <CardHeader>
           <div className="flex flex-wrap gap-4 items-end">
             <div className="grid gap-2">
                <label className="text-sm font-medium">Start Date</label>
                <Input 
                   type="date" 
                   value={startDate} 
                   onChange={(e) => setStartDate(e.target.value)} 
                   className="w-[180px]"
                />
             </div>
             <div className="grid gap-2">
                <label className="text-sm font-medium">End Date</label>
                <Input 
                   type="date" 
                   value={endDate} 
                   onChange={(e) => setEndDate(e.target.value)} 
                   className="w-[180px]"
                />
             </div>
             <Button onClick={() => { setPage(1); fetchData(); }}>Filter Report</Button>
           </div>
        </CardHeader>
      </Card>

      <div className="bg-background p-4 rounded-md border">
          <ReportHeader 
              title="Stock Adjustment Report" 
              subtitle="Log of manual stock corrections, damaged goods, and losses." 
              period={`${startDate} to ${endDate}`}
          />

          <div className="rounded-md border mb-4 print:border-none print:overflow-visible">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Barcode</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead className="text-right">Adjustment</TableHead>
                <TableHead className="text-right">New Stock</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                  </TableCell>
                </TableRow>
              ) : filteredAdjustments.length === 0 ? (
                <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center">
                        No adjustments found for this period.
                    </TableCell>
                </TableRow>
              ) : (
                filteredAdjustments.map((adj) => (
                  <TableRow key={adj.id}>
                    <TableCell>
                        {format(new Date(adj.created_at), 'MMM dd, yyyy HH:mm')}
                    </TableCell>
                    <TableCell className="font-medium">{adj.product_name}</TableCell>
                    <TableCell>{adj.barcode || '-'}</TableCell>
                    <TableCell className="capitalize">
                        {adj.reason === 'damaged' && <ClipboardX className="inline-block w-4 h-4 mr-1 text-red-500"/>}
                        {adj.reason}
                    </TableCell>
                    <TableCell className={`text-right font-bold ${Number(adj.quantity) > 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {Number(adj.quantity) > 0 ? '+' : ''}{formatQuantity(adj.quantity, adj.unit_of_measure)}
                    </TableCell>
                    <TableCell className="text-right">
                        {formatQuantity(adj.new_stock, adj.unit_of_measure)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          </div>

          <DataTablePagination 
            currentPage={page}
            totalPages={totalPages}
            pageSize={pageSize}
            totalItems={totalItems}
            setPage={setPage}
            setPageSize={setPageSize}
          />
      </div>
    </div>
  );
}
