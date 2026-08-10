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
import { CalendarIcon, FileDown, FileSpreadsheet, ShoppingCart, TrendingUp, Search, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, PhilippinePeso, Package, Timer, Truck } from 'lucide-react';
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

interface PurchaseOrder {
  id: string;
  supplierId: string;
  supplierName: string;
  date: string;
  total: number;
  paymentMethod: string;
  status: string;
  referenceNumber: string;
  receivedTotal: number;
}

export default function PurchasesSummaryPage() {
  const [fromDate, setFromDate] = useState<Date | undefined>(startOfMonth(new Date()));
  const [toDate, setToDate] = useState<Date | undefined>(endOfMonth(new Date()));
  const [records, setRecords] = useState<PurchaseOrder[]>([]);
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
      // Fetch more to allow client-side searching/pagination for now, or implement server-side
      params.append('limit', '1000');

      const response = await fetch(getApiUrl(`/purchase-orders?${params.toString()}`));
      if (!response.ok) throw new Error(`API error ${response.status}`);
      const result = await response.json();
      if (result.success) {
        setRecords(result.data || []);
      }
    } catch (error) {
      console.error("Error fetching purchases summary:", error);
      toast({
        title: "Error",
        description: "Failed to fetch purchase data. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchReport();
  }, []);

  // Filter records based on search term
  const filteredRecords = records.filter(record => {
    if (!searchTerm.trim()) return true;
    const search = searchTerm.toLowerCase();
    return (
      String(record.id || '').toLowerCase().includes(search) ||
      String(record.supplierName || '').toLowerCase().includes(search) ||
      String(record.referenceNumber || '').toLowerCase().includes(search) ||
      String(record.paymentMethod || '').toLowerCase().includes(search) ||
      String(record.status || '').toLowerCase().includes(search)
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

  const totals = {
    totalSpent: records.reduce((sum, r) => sum + r.total, 0),
    totalOrders: records.length,
    avgOrderValue: records.length > 0 ? records.reduce((sum, r) => sum + r.total, 0) / records.length : 0,
    pendingOrders: records.filter(r => r.status === 'Pending').length,
    receivedOrders: records.filter(r => r.status === 'Received').length,
  };

  const exportToPDF = () => {
    const fileName = `Purchases_Summary_${format(new Date(), 'yyyyMMdd_HHmm')}.pdf`;
    const ok = exportReportPdf<PurchaseOrder>({
      title: 'Purchases Summary Report',
      dateRange: `From: ${fromDate ? format(fromDate, 'yyyy-MM-dd') : 'N/A'} To: ${toDate ? format(toDate, 'yyyy-MM-dd') : 'N/A'}`,
      summary: [
        { label: 'Total Orders', value: String(totals.totalOrders) },
        { label: 'Total Spent', value: formatCurrency(totals.totalSpent) },
        { label: 'Avg Order Value', value: formatCurrency(totals.avgOrderValue) },
        { label: 'Pending', value: String(totals.pendingOrders) },
        { label: 'Received', value: String(totals.receivedOrders) },
      ],
      columns: [
        { header: 'PO ID', width: 40, cell: (r) => r.id || 'N/A' },
        { header: 'Date', width: 30, cell: (r) => r.date ? format(new Date(r.date), 'yyyy-MM-dd') : '-' },
        { header: 'Supplier', width: 60, cell: (r) => r.supplierName || 'N/A' },
        { header: 'Reference', width: 40, cell: (r) => r.referenceNumber || '-' },
        { header: 'Payment', width: 35, cell: (r) => r.paymentMethod || '-' },
        { header: 'Status', width: 30, cell: (r) => r.status || '-' },
        { header: 'Total Amount', width: 40, align: 'right', cell: (r) => formatCurrency(r.total) },
      ],
      rows: records,
      totals: [null, null, null, null, null, 'TOTAL', formatCurrency(totals.totalSpent)],
      fileName,
    });
    if (!ok) {
      toast({ title: 'No Data', description: 'No records to export. Please fetch the report first.', variant: 'destructive' });
      return;
    }
    toast({ title: 'PDF Exported', description: `Report saved as ${fileName}` });
  };

  const exportToExcel = () => {
    const totalSpentSum = filteredRecords.reduce((s, r) => s + Number(r.total), 0);
    const fileName = `Purchases_Summary_${format(new Date(), 'yyyyMMdd_HHmm')}.xls`;
    const ok = exportReportExcel<PurchaseOrder>({
      title: 'Purchases Summary Report',
      subtitle: `From: ${fromDate ? format(fromDate, 'yyyy-MM-dd') : 'N/A'} To: ${toDate ? format(toDate, 'yyyy-MM-dd') : 'N/A'}`,
      columns: [
        { header: 'PO ID', cell: (r) => r.id || 'N/A' },
        { header: 'Date', cell: (r) => r.date ? format(new Date(r.date), 'yyyy-MM-dd') : '-' },
        { header: 'Supplier', cell: (r) => r.supplierName || 'N/A' },
        { header: 'Reference', cell: (r) => r.referenceNumber || '-' },
        { header: 'Payment', cell: (r) => r.paymentMethod || '-' },
        { header: 'Status', cell: (r) => r.status || '-' },
        { header: 'Total Amount', align: 'right', cell: (r) => r.total },
      ],
      rows: filteredRecords,
      totals: [null, null, null, null, null, 'TOTAL', totalSpentSum.toFixed(2)],
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

  const getStatusBadge = (status: string) => {
    switch (status.toLowerCase()) {
      case 'received':
        return <Badge className="bg-green-100 text-green-800 hover:bg-green-100 border-green-200">Received</Badge>;
      case 'pending':
        return <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100 border-yellow-200">Pending</Badge>;
      case 'cancelled':
        return <Badge variant="destructive">Cancelled</Badge>;
      case 'paid':
        return <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100 border-blue-200">Paid</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ShoppingCart className="h-5 w-5 text-blue-600" />
                Purchases Summary Report
              </CardTitle>
              <CardDescription>
                Overview of all purchase orders and procurement activity
              </CardDescription>
            </div>
            <Badge variant="outline" className="text-sm border-blue-600 text-blue-600">
              {records.length} Order{records.length !== 1 ? 's' : ''}
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
              className="bg-blue-600 hover:bg-blue-700 text-white"
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
            <CardTitle className="text-sm font-medium">Total Spent</CardTitle>
            <PhilippinePeso className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">{formatCurrency(totals.totalSpent)}</div>
            <p className="text-xs text-muted-foreground">Total procurement value</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Orders</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{totals.totalOrders}</div>
            <p className="text-xs text-muted-foreground">Number of POs issued</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Order Value</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-600">{formatCurrency(totals.avgOrderValue)}</div>
            <p className="text-xs text-muted-foreground">Average spending per order</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending Orders</CardTitle>
            <Timer className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">{totals.pendingOrders}</div>
            <p className="text-xs text-muted-foreground">Orders awaiting fulfillment</p>
          </CardContent>
        </Card>
      </div>

      {/* Data Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Purchase Order Details</CardTitle>
              <CardDescription>
                Detailed list of all purchase transactions
              </CardDescription>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search orders, suppliers..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 w-[300px]"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="py-2 px-4">PO ID</TableHead>
                <TableHead className="py-2 px-4">Date</TableHead>
                <TableHead className="py-2 px-4">Supplier</TableHead>
                <TableHead className="py-2 px-4">Reference</TableHead>
                <TableHead className="py-2 px-4">Payment</TableHead>
                <TableHead className="py-2 px-4">Status</TableHead>
                <TableHead className="py-2 px-4 text-right">Total Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedRecords.length > 0 ? (
                paginatedRecords.map((record, index) => (
                  <TableRow key={index} className="hover:bg-muted/50 transition-colors">
                    <TableCell className="py-2 px-4 font-medium text-blue-600">{record.id}</TableCell>
                    <TableCell className="py-2 px-4">
                      {record.date ? format(new Date(record.date), 'MMM dd, yyyy') : '-'}
                    </TableCell>
                    <TableCell className="py-2 px-4 font-medium">{record.supplierName}</TableCell>
                    <TableCell className="py-2 px-4 text-muted-foreground">{record.referenceNumber || '-'}</TableCell>
                    <TableCell className="py-2 px-4">{record.paymentMethod || '-'}</TableCell>
                    <TableCell className="py-2 px-4">{getStatusBadge(record.status)}</TableCell>
                    <TableCell className="py-2 px-4 text-right font-mono font-semibold text-blue-600">
                      {formatCurrency(record.total)}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center">
                    {isLoading ? (
                      <div className="flex items-center justify-center gap-2">
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
                        Loading...
                      </div>
                    ) : (
                      <span className="text-muted-foreground">
                        No purchase orders found for the selected date range.
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

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
