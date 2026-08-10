'use client';

import { useState, useEffect } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { Button } from '@/components/ui/button';
import { CalendarIcon, FileDown, FileSpreadsheet, Layers, TrendingUp, Search, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, PhilippinePeso } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { getApiUrl } from '@/lib/api-config';
import { exportReportPdf, exportReportExcel } from '@/lib/report-print';

// Type definitions matching the API response
interface BatchAnalysisRecord {
  saleDate: string;
  saleReference: string;
  productId: string;
  productName: string;
  sku: string;
  barcode: string;
  category: string;
  batchId: string;
  batchReceivedDate: string | null;
  poReference: string | null;
  batchType: string;
  qtySold: number;
  unitCost: number;
  unitSellingPrice: number;
  lineRevenue: number;
  lineCost: number;
  lineProfit: number;
  marginPct: number;
}

interface BatchAnalysisTotals {
  qty: number;
  revenue: number;
  cost: number;
  profit: number;
  marginPct: number;
}

export default function BatchProfitPage() {
  const [fromDate, setFromDate] = useState<Date | undefined>(startOfMonth(new Date()));
  const [toDate, setToDate] = useState<Date | undefined>(endOfMonth(new Date()));
  const [records, setRecords] = useState<BatchAnalysisRecord[]>([]);
  const [totals, setTotals] = useState<BatchAnalysisTotals>({ qty: 0, revenue: 0, cost: 0, profit: 0, marginPct: 0 });
  const [isLoading, setIsLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const { toast } = useToast();

  const fetchReport = async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (fromDate) {
        params.append('startDate', format(fromDate, 'yyyy-MM-dd'));
      }
      if (toDate) {
        params.append('endDate', format(toDate, 'yyyy-MM-dd'));
      }

      const response = await fetch(getApiUrl(`/sales/batch-analysis?${params.toString()}`));
      if (!response.ok) throw new Error(`API error ${response.status}`);
      const result = await response.json();
      if (result.success) {
        setRecords(result.data || []);
        setTotals(result.totals || { qty: 0, revenue: 0, cost: 0, profit: 0, marginPct: 0 });
      } else {
          throw new Error(result.error || 'Failed to fetch data');
      }
    } catch (error: any) {
      console.error("Error fetching batch analysis:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to fetch batch analysis. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchReport();
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm]);

  const filteredRecords = records.filter(record => {
    if (!searchTerm.trim()) return true;
    const search = searchTerm.toLowerCase();
    return (
      record.productName?.toLowerCase().includes(search) ||
      record.sku?.toLowerCase().includes(search) ||
      record.barcode?.toLowerCase().includes(search) ||
      record.category?.toLowerCase().includes(search) ||
      record.saleReference?.toLowerCase().includes(search)
    );
  });

  const totalPages = Math.ceil(filteredRecords.length / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const paginatedRecords = filteredRecords.slice(startIndex, endIndex);

  const exportToPDF = () => {
    const fileName = `Batch_Profit_Report_${format(new Date(), 'yyyyMMdd')}.pdf`;
    const ok = exportReportPdf<BatchAnalysisRecord>({
      title: 'Batch Profit Analysis Report',
      dateRange: `Period: ${fromDate ? format(fromDate, 'yyyy-MM-dd') : 'N/A'} to ${toDate ? format(toDate, 'yyyy-MM-dd') : 'N/A'}`,
      summary: [
        { label: 'Total Qty', value: totals.qty.toLocaleString() },
        { label: 'Total Revenue', value: formatCurrency(totals.revenue) },
        { label: 'Total Profit', value: formatCurrency(totals.profit) },
        { label: 'Avg Margin', value: `${totals.marginPct}%` },
      ],
      columns: [
        { header: 'Sale Date', width: 26, cell: (r) => r.saleDate || 'N/A' },
        { header: 'Ref', width: 24, cell: (r) => r.saleReference },
        { header: 'Product', width: 40, cell: (r) => r.productName },
        { header: 'Batch ID', width: 26, cell: (r) => (r.batchId === 'fallback' ? 'Untracked' : r.batchId) },
        { header: 'Qty', width: 16, align: 'right', cell: (r) => String(r.qtySold) },
        { header: 'U.Cost', width: 20, align: 'right', cell: (r) => r.unitCost.toFixed(2) },
        { header: 'U.Sell', width: 20, align: 'right', cell: (r) => r.unitSellingPrice.toFixed(2) },
        { header: 'Revenue', width: 24, align: 'right', cell: (r) => r.lineRevenue.toFixed(2) },
        { header: 'Cost', width: 22, align: 'right', cell: (r) => r.lineCost.toFixed(2) },
        { header: 'Profit', width: 22, align: 'right', cell: (r) => r.lineProfit.toFixed(2) },
        { header: 'Margin', width: 16, align: 'right', cell: (r) => r.marginPct.toFixed(1) + '%' },
      ],
      rows: filteredRecords,
      totals: ['TOTALS', null, null, null, totals.qty.toLocaleString(), null, null, totals.revenue.toFixed(2), totals.cost.toFixed(2), totals.profit.toFixed(2), `${totals.marginPct}%`],
      fileName,
    });
    if (!ok) {
      toast({ title: 'No Data', description: 'No records to export.', variant: 'destructive' });
      return;
    }
    toast({ title: 'Report Exported', description: `Report saved as ${fileName}` });
  };

  const exportToExcel = () => {
    const qtySum = filteredRecords.reduce((s, r) => s + Number(r.qtySold), 0);
    const revenueSum = filteredRecords.reduce((s, r) => s + Number(r.lineRevenue), 0);
    const costSum = filteredRecords.reduce((s, r) => s + Number(r.lineCost), 0);
    const profitSum = filteredRecords.reduce((s, r) => s + Number(r.lineProfit), 0);
    const marginPct = revenueSum > 0 ? ((profitSum / revenueSum) * 100).toFixed(1) : '0.0';
    const fileName = `Batch_Profit_Report_${format(new Date(), 'yyyyMMdd')}.xls`;
    const ok = exportReportExcel<BatchAnalysisRecord>({
      title: 'Batch Profit Analysis Report',
      subtitle: `Period: ${fromDate ? format(fromDate, 'yyyy-MM-dd') : 'N/A'} to ${toDate ? format(toDate, 'yyyy-MM-dd') : 'N/A'}`,
      columns: [
        { header: 'Sale Date', cell: (r) => r.saleDate || 'N/A' },
        { header: 'Ref', cell: (r) => r.saleReference },
        { header: 'Product', cell: (r) => r.productName },
        { header: 'Batch ID', cell: (r) => (r.batchId === 'fallback' ? 'Untracked' : r.batchId) },
        { header: 'Qty', align: 'right', cell: (r) => r.qtySold },
        { header: 'U.Cost', align: 'right', cell: (r) => r.unitCost },
        { header: 'U.Sell', align: 'right', cell: (r) => r.unitSellingPrice },
        { header: 'Revenue', align: 'right', cell: (r) => r.lineRevenue },
        { header: 'Cost', align: 'right', cell: (r) => r.lineCost },
        { header: 'Profit', align: 'right', cell: (r) => r.lineProfit },
        { header: 'Margin', align: 'right', cell: (r) => r.marginPct.toFixed(1) + '%' },
      ],
      rows: filteredRecords,
      totals: ['TOTALS', null, null, null, qtySum, null, null, revenueSum.toFixed(2), costSum.toFixed(2), profitSum.toFixed(2), `${marginPct}%`],
      fileName,
    });
    if (!ok) {
      toast({ title: 'No Data', description: 'No records to export. Please fetch the report first.', variant: 'destructive' });
      return;
    }
    toast({ title: 'Excel Exported', description: `Report saved as ${fileName}` });
  };

  const formatCurrency = (value: number) => {
    return `₱${value.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  return (
    <div className="space-y-6">
      <Card className="border-amber-200">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Layers className="h-5 w-5 text-amber-600" />
                Batch Profit Analysis
              </CardTitle>
              <CardDescription>
                Detailed profitability tracking per inventory batch (FIFO)
              </CardDescription>
            </div>
            <Badge variant="outline" className="text-sm border-amber-600 text-amber-600">
              {filteredRecords.length} Data Points
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-2">
              <label className="text-sm font-medium">From</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-[160px] justify-start text-left font-normal"
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {fromDate ? format(fromDate, "MMM dd, yyyy") : "Start"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={fromDate}
                    onSelect={setFromDate}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">To</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-[160px] justify-start text-left font-normal"
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {toDate ? format(toDate, "MMM dd, yyyy") : "End"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={toDate}
                    onSelect={setToDate}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            <Button onClick={fetchReport} disabled={isLoading}>
              {isLoading ? 'Updating...' : 'Refresh'}
            </Button>

            <Button 
              onClick={exportToPDF} 
              variant="outline"
              className="border-amber-600 text-amber-700 hover:bg-amber-50"
              disabled={records.length === 0}
            >
              <FileDown className="mr-2 h-4 w-4" />
              Export PDF
            </Button>

            <Button
              onClick={exportToExcel}
              disabled={records.length === 0}
              variant="outline"
              className="border-emerald-700 text-emerald-700 hover:bg-emerald-50"
            >
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              Export Excel
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="py-3 px-4 flex flex-row items-center justify-between pb-1 space-y-0 text-muted-foreground font-medium text-xs uppercase tracking-wider">
            Total Revenue
            <PhilippinePeso className="h-3 w-3" />
          </CardHeader>
          <CardContent className="py-2 px-4">
            <div className="text-xl font-bold text-blue-700">{formatCurrency(totals.revenue)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-3 px-4 flex flex-row items-center justify-between pb-1 space-y-0 text-muted-foreground font-medium text-xs uppercase tracking-wider">
            Total Batch Cost
            <PhilippinePeso className="h-3 w-3" />
          </CardHeader>
          <CardContent className="py-2 px-4">
            <div className="text-xl font-bold text-muted-foreground">{formatCurrency(totals.cost)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-3 px-4 flex flex-row items-center justify-between pb-1 space-y-0 text-muted-foreground font-medium text-xs uppercase tracking-wider">
            Gross Profit
            <TrendingUp className="h-3 w-3 text-green-500" />
          </CardHeader>
          <CardContent className="py-2 px-4">
            <div className={cn("text-xl font-bold", totals.profit >= 0 ? "text-green-600" : "text-red-600")}>
              {formatCurrency(totals.profit)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-3 px-4 flex flex-row items-center justify-between pb-1 space-y-0 text-muted-foreground font-medium text-xs uppercase tracking-wider">
            Avg Batch Margin
            <TrendingUp className="h-3 w-3 text-amber-500" />
          </CardHeader>
          <CardContent className="py-2 px-4">
            <div className={cn("text-xl font-bold", totals.marginPct >= 20 ? "text-green-600" : totals.marginPct >= 10 ? "text-amber-600" : "text-red-600")}>
              {totals.marginPct}%
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="py-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-semibold">Detailed Batch Splits</CardTitle>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Product, Batch ID, or Sale Ref..."
                className="pl-9 w-[300px]"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="rounded-md border-x border-y-0 overflow-hidden">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="py-3 text-xs">Date & Ref</TableHead>
                  <TableHead className="py-3 text-xs">Product / Barcode</TableHead>
                  <TableHead className="py-3 text-xs">Source Batch</TableHead>
                  <TableHead className="py-3 text-right text-xs">Qty</TableHead>
                  <TableHead className="py-3 text-right text-xs">Unit Cost (B)</TableHead>
                  <TableHead className="py-3 text-right text-xs">Sell Price (S)</TableHead>
                  <TableHead className="py-3 text-right text-xs">Line Revenue</TableHead>
                  <TableHead className="py-3 text-right text-xs">Line Profit</TableHead>
                  <TableHead className="py-3 text-right text-xs">Margin %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedRecords.length > 0 ? (
                  paginatedRecords.map((r, i) => (
                    <TableRow key={i} className="text-xs hover:bg-muted/30">
                      <TableCell className="py-2">
                        <div className="font-medium">{r.saleDate}</div>
                        <div className="text-[10px] text-muted-foreground">{r.saleReference}</div>
                      </TableCell>
                      <TableCell className="py-2">
                        <div className="font-medium text-amber-900">{r.productName}</div>
                        <div className="text-[10px] font-mono text-muted-foreground">{r.barcode || '-'}</div>
                      </TableCell>
                      <TableCell className="py-2">
                        {r.batchId === 'fallback' ? (
                          <Badge variant="outline" className="bg-gray-50 text-gray-400 border-gray-200 text-[10px] font-normal italic">
                            Untracked
                          </Badge>
                        ) : (
                          <div className="space-y-0.5">
                            <div className="font-mono text-[10px] text-amber-700">{r.batchId}</div>
                            {r.batchReceivedDate && (
                              <div className="text-[9px] text-muted-foreground">Rcvd: {r.batchReceivedDate}</div>
                            )}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right py-2 font-mono font-semibold">{r.qtySold}</TableCell>
                      <TableCell className="text-right py-2 font-mono text-blue-600">₱{formatCurrency(r.unitCost).replace('₱', '')}</TableCell>
                      <TableCell className="text-right py-2 font-mono">₱{formatCurrency(r.unitSellingPrice).replace('₱', '')}</TableCell>
                      <TableCell className="text-right py-2 font-mono font-medium">₱{formatCurrency(r.lineRevenue).replace('₱', '')}</TableCell>
                      <TableCell className={cn("text-right py-2 font-mono font-semibold", r.lineProfit >= 0 ? "text-green-600" : "text-red-600")}>
                        ₱{formatCurrency(r.lineProfit).replace('₱', '')}
                      </TableCell>
                      <TableCell className="text-right py-2">
                        <Badge variant="outline" className={cn(
                          "text-[10px] font-mono",
                          r.marginPct >= 30 ? "bg-green-50 text-green-700 border-green-200" : 
                          r.marginPct >= 15 ? "bg-amber-50 text-amber-700 border-amber-200" : 
                          "bg-red-50 text-red-700 border-red-200"
                        )}>
                          {r.marginPct.toFixed(1)}%
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={9} className="h-32 text-center text-muted-foreground text-sm">
                      {isLoading ? "Fetching batch analysis..." : "No batch transaction data found for this period."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
        {filteredRecords.length > 0 && (
          <div className="flex items-center justify-between px-6 py-4 border-t">
            <div className="text-sm text-muted-foreground">
              Showing {startIndex + 1} to {Math.min(endIndex, filteredRecords.length)} of {filteredRecords.length} splits
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => setCurrentPage(1)}
                disabled={currentPage === 1}
              >
                <ChevronsLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm font-medium mx-2">Page {currentPage} of {totalPages}</span>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => setCurrentPage(totalPages)}
                disabled={currentPage === totalPages}
              >
                <ChevronsRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
