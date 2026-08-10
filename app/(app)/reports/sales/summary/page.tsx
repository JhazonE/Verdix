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
import { CalendarIcon, FileDown, FileSpreadsheet, DollarSign, TrendingUp, Receipt, Percent, ShoppingCart, LayoutGrid, Table as TableIcon, Search, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, PhilippinePeso } from 'lucide-react';
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

interface SalesTransaction {
  id: string;
  orderNumber: string;
  date: string;
  customer: {
    name: string;
  };
  cashier: string;
  terminal: string;
  paymentMethod: string;
  subtotal: number;
  discount: number;
  taxAmount: number;
  total: number;
  cost: number;
  profit: number;
}

export default function SalesSummaryPage() {
  const [fromDate, setFromDate] = useState<Date | undefined>(startOfMonth(new Date()));
  const [toDate, setToDate] = useState<Date | undefined>(endOfMonth(new Date()));
  const [records, setRecords] = useState<SalesTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedRow, setSelectedRow] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<'table' | 'card'>('table');
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const { toast } = useToast();

  // Filter records based on search term
  const filteredRecords = records.filter(record => {
    if (!searchTerm.trim()) return true;
    const search = searchTerm.toLowerCase();
    return (
      String(record.orderNumber || '').toLowerCase().includes(search) ||
      String(record.customer?.name || '').toLowerCase().includes(search) ||
      String(record.cashier || '').toLowerCase().includes(search) ||
      String(record.terminal || '').toLowerCase().includes(search)
    );
  });

  // Pagination logic
  const totalPages = Math.ceil(filteredRecords.length / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const paginatedRecords = filteredRecords.slice(startIndex, endIndex);

  // Reset to page 1 when search term changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm]);

  // Calculate totals
  const totals = {
    revenue: records.reduce((sum, r) => sum + r.total, 0),
    cost: records.reduce((sum, r) => sum + r.cost, 0),
    profit: records.reduce((sum, r) => sum + r.profit, 0),
    discount: records.reduce((sum, r) => sum + r.discount, 0),
    tax: records.reduce((sum, r) => sum + r.taxAmount, 0),
    transactions: records.length,
    avgTransaction: records.length > 0 ? records.reduce((sum, r) => sum + r.total, 0) / records.length : 0,
  };

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

      const response = await fetch(getApiUrl(`/sales/transactions?${params.toString()}`));
      if (!response.ok) throw new Error(`API error ${response.status}`);
      const result = await response.json();
      if (result.success) {
        setRecords(result.data || []);
      }
    } catch (error) {
      console.error("Error fetching sales summary:", error);
      toast({
        title: "Error",
        description: "Failed to fetch sales data. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchReport();
  }, []);

  const exportToPDF = () => {
    const subtotalSum = records.reduce((s, r) => s + r.subtotal, 0);
    const fileName = `Sales_Summary_${format(fromDate || new Date(), 'yyyyMMdd')}_${format(toDate || new Date(), 'yyyyMMdd')}.pdf`;
    const ok = exportReportPdf<SalesTransaction>({
      title: 'Sales Summary Report',
      dateRange: `From: ${fromDate ? format(fromDate, 'yyyy-MM-dd') : 'N/A'} To: ${toDate ? format(toDate, 'yyyy-MM-dd') : 'N/A'}`,
      summary: [
        { label: 'Total Transactions', value: String(totals.transactions) },
        { label: 'Total Revenue', value: formatCurrency(totals.revenue) },
        { label: 'Total Profit', value: formatCurrency(totals.profit) },
        { label: 'Avg Transaction', value: formatCurrency(totals.avgTransaction) },
        { label: 'Total Tax', value: formatCurrency(totals.tax) },
        { label: 'Total Discount', value: formatCurrency(totals.discount) },
      ],
      columns: [
        { header: 'OR No.', width: 22, cell: (r) => r.orderNumber || 'N/A' },
        { header: 'Date/Time', width: 28, cell: (r) => r.date ? format(new Date(r.date), 'MM/dd/yy hh:mma') : '-' },
        { header: 'Customer', width: 30, cell: (r) => r.customer?.name || 'Walk-in' },
        { header: 'Cashier', width: 25, cell: (r) => r.cashier || 'N/A' },
        { header: 'Terminal', width: 20, cell: (r) => r.terminal || 'N/A' },
        { header: 'Payment', width: 20, cell: (r) => r.paymentMethod || 'N/A' },
        { header: 'Subtotal', width: 20, align: 'right', cell: (r) => r.subtotal.toFixed(2) },
        { header: 'Discount', width: 18, align: 'right', cell: (r) => r.discount.toFixed(2) },
        { header: 'Tax', width: 16, align: 'right', cell: (r) => r.taxAmount.toFixed(2) },
        { header: 'Total', width: 20, align: 'right', cell: (r) => r.total.toFixed(2) },
        { header: 'Profit', width: 18, align: 'right', cell: (r) => r.profit.toFixed(2) },
      ],
      rows: records,
      totals: ['TOTALS', null, null, null, null, null, subtotalSum.toFixed(2), totals.discount.toFixed(2), totals.tax.toFixed(2), totals.revenue.toFixed(2), totals.profit.toFixed(2)],
      fileName,
    });
    if (!ok) {
      toast({ title: 'No Data', description: 'No records to export. Please fetch the report first.', variant: 'destructive' });
      return;
    }
    toast({ title: 'PDF Exported', description: `Report saved as ${fileName}` });
  };

  const exportToExcel = () => {
    const subtotalSum = filteredRecords.reduce((s, r) => s + Number(r.subtotal), 0);
    const discountSum = filteredRecords.reduce((s, r) => s + Number(r.discount), 0);
    const taxSum = filteredRecords.reduce((s, r) => s + Number(r.taxAmount), 0);
    const totalSum = filteredRecords.reduce((s, r) => s + Number(r.total), 0);
    const profitSum = filteredRecords.reduce((s, r) => s + Number(r.profit), 0);
    const fileName = `Sales_Summary_${format(fromDate || new Date(), 'yyyyMMdd')}_${format(toDate || new Date(), 'yyyyMMdd')}.xls`;
    const ok = exportReportExcel<SalesTransaction>({
      title: 'Sales Summary Report',
      subtitle: `From: ${fromDate ? format(fromDate, 'yyyy-MM-dd') : 'N/A'} To: ${toDate ? format(toDate, 'yyyy-MM-dd') : 'N/A'}`,
      columns: [
        { header: 'OR No.', cell: (r) => r.orderNumber || 'N/A' },
        { header: 'Date/Time', cell: (r) => r.date ? format(new Date(r.date), 'MM/dd/yy hh:mma') : '-' },
        { header: 'Customer', cell: (r) => r.customer?.name || 'Walk-in' },
        { header: 'Cashier', cell: (r) => r.cashier || 'N/A' },
        { header: 'Terminal', cell: (r) => r.terminal || 'N/A' },
        { header: 'Payment', cell: (r) => r.paymentMethod || 'N/A' },
        { header: 'Subtotal', align: 'right', cell: (r) => r.subtotal },
        { header: 'Discount', align: 'right', cell: (r) => r.discount },
        { header: 'Tax', align: 'right', cell: (r) => r.taxAmount },
        { header: 'Total', align: 'right', cell: (r) => r.total },
        { header: 'Profit', align: 'right', cell: (r) => r.profit },
      ],
      rows: filteredRecords,
      totals: ['TOTALS', null, null, null, null, null, subtotalSum.toFixed(2), discountSum.toFixed(2), taxSum.toFixed(2), totalSum.toFixed(2), profitSum.toFixed(2)],
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
      {/* Header Card */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <PhilippinePeso className="h-5 w-5 text-blue-600" />
                Sales Summary Report
              </CardTitle>
              <CardDescription>
                Comprehensive overview of all sales transactions
              </CardDescription>
            </div>
            <Badge variant="outline" className="text-sm border-blue-600 text-blue-600">
              {records.length} Transaction{records.length !== 1 ? 's' : ''}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">From Date</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-[180px] justify-start text-left font-normal",
                      !fromDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {fromDate ? format(fromDate, "PPP") : "Select date"}
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
              <label className="text-sm font-medium">To Date</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-[180px] justify-start text-left font-normal",
                      !toDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {toDate ? format(toDate, "PPP") : "Select date"}
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

            <Button 
              onClick={fetchReport} 
              disabled={isLoading}
            >
              {isLoading ? 'Loading...' : 'Show Report'}
            </Button>

            <Button 
              onClick={exportToPDF} 
              disabled={isLoading || records.length === 0}
              variant="outline"
              className="border-blue-600 text-blue-600 hover:bg-blue-50"
            >
              <FileDown className="mr-2 h-4 w-4" />
              Export to PDF
            </Button>

            <Button
              onClick={exportToExcel}
              disabled={isLoading || records.length === 0}
              variant="outline"
              className="border-emerald-700 text-emerald-700 hover:bg-emerald-50"
            >
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              Export to Excel
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
            <div className="h-4 w-4 flex items-center justify-center text-muted-foreground font-semibold text-base">₱</div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">{formatCurrency(totals.revenue)}</div>
            <p className="text-xs text-muted-foreground">Total sales amount</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Transactions</CardTitle>
            <ShoppingCart className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{totals.transactions}</div>
            <p className="text-xs text-muted-foreground">Number of sales</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Transaction</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-600">{formatCurrency(totals.avgTransaction)}</div>
            <p className="text-xs text-muted-foreground">Average sale value</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Profit</CardTitle>
            <Percent className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className={cn("text-2xl font-bold", totals.profit >= 0 ? "text-green-600" : "text-red-600")}>
              {formatCurrency(totals.profit)}
            </div>
            <p className="text-xs text-muted-foreground">Revenue minus cost</p>
          </CardContent>
        </Card>
      </div>

      {/* Data Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Transaction Details</CardTitle>
              <CardDescription>
                Detailed list of all sales transactions
              </CardDescription>
            </div>
            <div className="flex items-center gap-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search transactions..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9 w-[250px]"
                />
              </div>
              <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
              <Button
                variant={viewMode === 'table' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setViewMode('table')}
                className="h-8 px-3"
              >
                <TableIcon className="h-4 w-4 mr-1" />
                Table
              </Button>
              <Button
                variant={viewMode === 'card' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setViewMode('card')}
                className="h-8 px-3"
              >
                <LayoutGrid className="h-4 w-4 mr-1" />
                Cards
              </Button>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className={viewMode === 'table' ? 'p-0' : 'pt-0'}>
          {viewMode === 'card' ? (
            /* Card View */
            paginatedRecords.length > 0 ? (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {paginatedRecords.map((record, index) => (
                  <Card 
                    key={index} 
                    className={cn(
                      "cursor-pointer transition-all hover:shadow-md",
                      selectedRow === index && "ring-2 ring-primary"
                    )}
                    onClick={() => setSelectedRow(index)}
                  >
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <CardTitle className="text-base text-primary">{record.orderNumber}</CardTitle>
                          <CardDescription className="text-xs">{record.date ? format(new Date(record.date), 'MMM dd, yyyy hh:mma') : '-'}</CardDescription>
                        </div>
                        <Badge variant="outline" className="border-blue-600 text-blue-600">Sale</Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <span className="text-muted-foreground text-xs">Customer</span>
                          <p className="font-medium truncate" title={record.customer?.name}>{record.customer?.name || 'Walk-in'}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground text-xs">Cashier</span>
                          <p className="font-medium">{record.cashier || '-'}</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <span className="text-muted-foreground text-xs">Terminal</span>
                          <p>{record.terminal || '-'}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground text-xs">Payment</span>
                          <p>{record.paymentMethod || '-'}</p>
                        </div>
                      </div>
                      <div className="pt-2 border-t space-y-1">
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Subtotal</span>
                          <span className="font-mono">{formatCurrency(record.subtotal)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Discount</span>
                          <span className="font-mono text-orange-600">-{formatCurrency(record.discount)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Tax</span>
                          <span className="font-mono">{formatCurrency(record.taxAmount)}</span>
                        </div>
                        <div className="flex justify-between text-sm font-semibold border-t pt-1">
                          <span>Total</span>
                          <span className="font-mono text-blue-600">{formatCurrency(record.total)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Profit</span>
                          <span className={cn("font-mono font-semibold", record.profit >= 0 ? "text-green-600" : "text-red-600")}>
                            {formatCurrency(record.profit)}
                          </span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="flex items-center justify-center h-24 text-muted-foreground">
                {isLoading ? (
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
                    Loading...
                  </div>
                ) : (
                  'No sales transactions found for the selected date range.'
                )}
              </div>
            )
          ) : (
          <Table className="w-full text-sm">
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="py-2 px-3">OR No.</TableHead>
                <TableHead className="py-2 px-2">Date/Time</TableHead>
                <TableHead className="py-2 px-2">Customer</TableHead>
                <TableHead className="py-2 px-2">Cashier</TableHead>
                <TableHead className="py-2 px-2">Terminal</TableHead>
                <TableHead className="py-2 px-2">Payment</TableHead>
                <TableHead className="py-2 px-2 text-right">Subtotal</TableHead>
                <TableHead className="py-2 px-2 text-right">Discount</TableHead>
                <TableHead className="py-2 px-2 text-right">Tax</TableHead>
                <TableHead className="py-2 px-2 text-right">Total</TableHead>
                <TableHead className="py-2 px-2 text-right">Profit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedRecords.length > 0 ? (
                paginatedRecords.map((record, index) => (
                  <TableRow 
                    key={index}
                    className={cn(
                      "cursor-pointer hover:bg-muted/50 transition-colors text-xs",
                      selectedRow === index && "bg-muted"
                    )}
                    onClick={() => setSelectedRow(index)}
                  >
                    <TableCell className="py-2 px-3 font-medium text-primary">{record.orderNumber}</TableCell>
                    <TableCell className="py-2 px-2">
                      {record.date ? format(new Date(record.date), 'MM/dd/yy hh:mma') : '-'}
                    </TableCell>
                    <TableCell className="py-2 px-2">{record.customer?.name || 'Walk-in'}</TableCell>
                    <TableCell className="py-2 px-2">{record.cashier || '-'}</TableCell>
                    <TableCell className="py-2 px-2">{record.terminal || '-'}</TableCell>
                    <TableCell className="py-2 px-2">{record.paymentMethod || '-'}</TableCell>
                    <TableCell className="py-2 px-2 text-right font-mono">
                      {record.subtotal.toFixed(2)}
                    </TableCell>
                    <TableCell className="py-2 px-2 text-right font-mono text-orange-600">
                      {record.discount.toFixed(2)}
                    </TableCell>
                    <TableCell className="py-2 px-2 text-right font-mono">
                      {record.taxAmount.toFixed(2)}
                    </TableCell>
                    <TableCell className="py-2 px-2 text-right font-mono font-semibold text-blue-600">
                      {record.total.toFixed(2)}
                    </TableCell>
                    <TableCell className={cn(
                      "py-2 px-2 text-right font-mono",
                      record.profit >= 0 ? "text-green-600" : "text-red-600"
                    )}>
                      {record.profit.toFixed(2)}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={11} className="h-24 text-center">
                    {isLoading ? (
                      <div className="flex items-center justify-center gap-2">
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
                        Loading...
                      </div>
                    ) : (
                      <span className="text-muted-foreground">
                        No sales transactions found for the selected date range.
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          )}
          
          {/* Pagination Controls */}
          {filteredRecords.length > 0 && (
            <div className="flex items-center justify-between px-6 py-4 border-t">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  Showing {startIndex + 1} to {Math.min(endIndex, filteredRecords.length)} of {filteredRecords.length} entries
                </span>
              </div>
              
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Rows per page:</span>
                  <Select
                    value={pageSize.toString()}
                    onValueChange={(value) => {
                      setPageSize(Number(value));
                      setCurrentPage(1);
                    }}
                  >
                    <SelectTrigger className="w-[70px] h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="5">5</SelectItem>
                      <SelectItem value="10">10</SelectItem>
                      <SelectItem value="20">20</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                      <SelectItem value="100">100</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center gap-1">
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
                  
                  <div className="flex items-center gap-1 px-2">
                    <span className="text-sm font-medium">
                      Page {currentPage} of {totalPages}
                    </span>
                  </div>

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
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
