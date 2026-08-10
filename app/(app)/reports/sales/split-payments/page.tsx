'use client';

import React, { useState, useEffect } from 'react';
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
import {
  CalendarIcon,
  FileDown,
  FileSpreadsheet,
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  PhilippinePeso,
  CreditCard,
  Package,
  ChevronDown,
  ChevronUp,
  User,
  Clock
} from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { getApiUrl } from '@/lib/api-config';
import { exportReportPdf, exportReportExcel } from '@/lib/report-print';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface PaymentDetail {
  method: string;
  amount: number;
  reference?: string;
  pointsUsed?: number;
  changeGiven?: number;
}

interface ItemDetail {
  productName: string;
  quantity: number;
  price: number;
  total: number;
  discount: number;
}

interface SplitPaymentTransaction {
  id: string;
  orderNumber: string;
  date: string;
  total: number;
  subtotal: number;
  discount: number;
  tax: number;
  cashier: string;
  customer: string;
  payments: PaymentDetail[];
  items: ItemDetail[];
}

export default function SplitPaymentsReportPage() {
  const [fromDate, setFromDate] = useState<Date | undefined>(startOfMonth(new Date()));
  const [toDate, setToDate] = useState<Date | undefined>(endOfMonth(new Date()));
  const [records, setRecords] = useState<SplitPaymentTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const { toast } = useToast();

  const toggleRow = (id: string) => {
    const newExpandedRows = new Set(expandedRows);
    if (newExpandedRows.has(id)) {
      newExpandedRows.delete(id);
    } else {
      newExpandedRows.add(id);
    }
    setExpandedRows(newExpandedRows);
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

      const response = await fetch(getApiUrl(`/sales/split-payments?${params.toString()}`));
      if (!response.ok) throw new Error(`API error ${response.status}`);
      const result = await response.json();
      if (result.success) {
        setRecords(result.data || []);
      }
    } catch (error) {
      console.error("Error fetching split payments report:", error);
      toast({
        title: "Error",
        description: "Failed to fetch split payments data. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchReport();
  }, []);

  const filteredRecords = records.filter(record => {
    if (!searchTerm.trim()) return true;
    const search = searchTerm.toLowerCase();
    return (
      record.orderNumber.toLowerCase().includes(search) ||
      record.customer.toLowerCase().includes(search) ||
      record.cashier.toLowerCase().includes(search)
    );
  });

  const totalPages = Math.ceil(filteredRecords.length / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const paginatedRecords = filteredRecords.slice(startIndex, endIndex);

  const totals = {
    revenue: records.reduce((sum, r) => sum + r.total, 0),
    transactions: records.length,
  };

  const exportToPDF = () => {
    const fileName = `Split_Payments_Report_${format(new Date(), 'yyyyMMdd')}.pdf`;
    const ok = exportReportPdf<SplitPaymentTransaction>({
      title: 'Split Payments Report',
      dateRange: `From: ${fromDate ? format(fromDate, 'yyyy-MM-dd') : 'N/A'} To: ${toDate ? format(toDate, 'yyyy-MM-dd') : 'N/A'}`,
      summary: [
        { label: 'Total Split Transactions', value: String(totals.transactions) },
        { label: 'Total Revenue from Split Sales', value: formatCurrency(totals.revenue) },
      ],
      columns: [
        { header: 'OR No.', width: 30, cell: (r) => String(r.orderNumber) },
        { header: 'Date/Time', width: 40, cell: (r) => format(new Date(r.date), 'MM/dd/yy hh:mma') },
        { header: 'Customer', width: 40, cell: (r) => r.customer },
        { header: 'Cashier', width: 40, cell: (r) => r.cashier },
        { header: 'Total', width: 30, align: 'right', cell: (r) => formatCurrency(r.total) },
        { header: 'Payment Breakdown', width: 90, cell: (r) => r.payments.map((p) => `${p.method}: ${formatCurrency(p.amount)}`).join(' | ') },
      ],
      rows: records,
      totals: ['TOTAL', null, null, null, formatCurrency(totals.revenue), null],
      fileName,
    });
    if (!ok) {
      toast({ title: 'No Data', description: 'No records to export.', variant: 'destructive' });
      return;
    }
    toast({ title: 'PDF Exported', description: `Report saved as ${fileName}` });
  };

  const exportToExcel = () => {
    const revenueSum = filteredRecords.reduce((s, r) => s + Number(r.total), 0);
    const fileName = `Split_Payments_Report_${format(new Date(), 'yyyyMMdd')}.xls`;
    const ok = exportReportExcel<SplitPaymentTransaction>({
      title: 'Split Payments Report',
      subtitle: `From: ${fromDate ? format(fromDate, 'yyyy-MM-dd') : 'N/A'} To: ${toDate ? format(toDate, 'yyyy-MM-dd') : 'N/A'}`,
      columns: [
        { header: 'OR No.', cell: (r) => r.orderNumber },
        { header: 'Date/Time', cell: (r) => format(new Date(r.date), 'MM/dd/yy hh:mma') },
        { header: 'Customer', cell: (r) => r.customer },
        { header: 'Cashier', cell: (r) => r.cashier },
        { header: 'Total', align: 'right', cell: (r) => r.total },
        { header: 'Payment Breakdown', cell: (r) => r.payments.map((p) => `${p.method}: ${p.amount.toFixed(2)}`).join(' | ') },
      ],
      rows: filteredRecords,
      totals: ['TOTAL', null, null, null, revenueSum.toFixed(2), null],
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
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <PhilippinePeso className="h-5 w-5 text-blue-600" />
                Split Payments Report
              </CardTitle>
              <CardDescription>
                Detailed breakdown of sales transactions paid with multiple methods
              </CardDescription>
            </div>
            <Badge variant="outline" className="text-sm border-blue-600 text-blue-600">
              {records.length} Split Transaction{records.length !== 1 ? 's' : ''}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">From Date</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-[180px] justify-start text-left font-normal">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {fromDate ? format(fromDate, "PPP") : "Select date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={fromDate} onSelect={setFromDate} initialFocus />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">To Date</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-[180px] justify-start text-left font-normal">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {toDate ? format(toDate, "PPP") : "Select date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={toDate} onSelect={setToDate} initialFocus />
                </PopoverContent>
              </Popover>
            </div>

            <Button onClick={fetchReport} disabled={isLoading}>
              {isLoading ? 'Loading...' : 'Show Report'}
            </Button>

            <Button onClick={exportToPDF} disabled={isLoading || records.length === 0} variant="outline" className="border-blue-600 text-blue-600 hover:bg-blue-50">
              <FileDown className="mr-2 h-4 w-4" />
              Export to PDF
            </Button>

            <Button onClick={exportToExcel} disabled={isLoading || records.length === 0} variant="outline" className="border-emerald-700 text-emerald-700 hover:bg-emerald-50">
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              Export to Excel
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by OR#, Customer, Cashier..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 w-[300px]"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Rows per page:</span>
              <Select value={pageSize.toString()} onValueChange={(v) => { setPageSize(Number(v)); setCurrentPage(1); }}>
                <SelectTrigger className="w-[70px] h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[5, 10, 20, 50].map(v => <SelectItem key={v} value={v.toString()}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="w-[50px]"></TableHead>
                <TableHead>OR No.</TableHead>
                <TableHead>Date/Time</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Cashier</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Payment Breakdown</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedRecords.length > 0 ? (
                paginatedRecords.map((record) => (
                  <React.Fragment key={record.id}>
                    <TableRow 
                      className="cursor-pointer hover:bg-muted/30"
                      onClick={() => toggleRow(record.id)}
                    >
                      <TableCell className="py-2">
                        {expandedRows.has(record.id) ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </TableCell>
                      <TableCell className="font-medium text-blue-600">{record.orderNumber}</TableCell>
                      <TableCell>{format(new Date(record.date), 'MM/dd/yy hh:mma')}</TableCell>
                      <TableCell>{record.customer}</TableCell>
                      <TableCell>{record.cashier}</TableCell>
                      <TableCell className="text-right font-mono font-semibold">{formatCurrency(record.total)}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {record.payments.map((p, i) => (
                            <Badge key={i} variant="secondary" className="text-[10px]">
                              {p.method}: {formatCurrency(p.amount)}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                    </TableRow>
                    {expandedRows.has(record.id) && (
                      <TableRow className="bg-muted/10">
                        <TableCell colSpan={7} className="p-6">
                          <div className="grid md:grid-cols-2 gap-8 animate-in slide-in-from-top-2 duration-200">
                            {/* Items Section */}
                            <div className="space-y-4">
                              <h4 className="font-bold flex items-center gap-2 text-sm text-muted-foreground uppercase tracking-wider">
                                <Package className="h-4 w-4" /> Items Purchased
                              </h4>
                              <div className="border rounded-lg overflow-hidden bg-white">
                                <Table>
                                  <TableHeader>
                                    <TableRow className="bg-muted/50">
                                      <TableHead className="h-8 text-[10px]">Item</TableHead>
                                      <TableHead className="h-8 text-[10px] text-center">Qty</TableHead>
                                      <TableHead className="h-8 text-[10px] text-right">Price</TableHead>
                                      <TableHead className="h-8 text-[10px] text-right">Total</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {record.items.map((item, i) => (
                                      <TableRow key={i} className="h-8 text-xs">
                                        <TableCell className="py-1">{item.productName}</TableCell>
                                        <TableCell className="py-1 text-center">{item.quantity}</TableCell>
                                        <TableCell className="py-1 text-right">{formatCurrency(item.price)}</TableCell>
                                        <TableCell className="py-1 text-right">{formatCurrency(item.total)}</TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              </div>
                            </div>

                            {/* Detailed Payment Section */}
                            <div className="space-y-4">
                              <h4 className="font-bold flex items-center gap-2 text-sm text-muted-foreground uppercase tracking-wider">
                                <CreditCard className="h-4 w-4" /> Payment Details
                              </h4>
                              <div className="space-y-3">
                                {record.payments.map((p, i) => (
                                  <div key={i} className="flex items-center justify-between p-3 bg-white border rounded-lg shadow-sm">
                                    <div className="flex flex-col">
                                      <span className="font-bold text-sm">{p.method}</span>
                                      {p.reference && <span className="text-[10px] text-muted-foreground">Ref: {p.reference}</span>}
                                      {p.pointsUsed && <span className="text-[10px] text-purple-600 font-medium">{p.pointsUsed} Points used</span>}
                                    </div>
                                    <div className="text-right">
                                      <span className="font-mono font-bold text-blue-600">{formatCurrency(p.amount)}</span>
                                      {p.changeGiven && p.changeGiven > 0 && (
                                        <div className="text-[10px] text-orange-600">Change: {formatCurrency(p.changeGiven)}</div>
                                      )}
                                    </div>
                                  </div>
                                ))}
                                <div className="pt-2 border-t flex justify-between items-center px-1">
                                  <span className="font-bold text-sm">TOTAL PAID</span>
                                  <span className="font-mono font-bold text-lg text-primary">{formatCurrency(record.total)}</span>
                                </div>
                              </div>

                              <div className="mt-6 flex gap-4 text-[10px] text-muted-foreground border-t pt-4">
                                <div className="flex items-center gap-1">
                                  <Clock className="h-3 w-3" /> {format(new Date(record.date), 'MMM dd, yyyy hh:mma')}
                                </div>
                                <div className="flex items-center gap-1">
                                  <User className="h-3 w-3" /> {record.cashier}
                                </div>
                              </div>
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                    {isLoading ? 'Loading records...' : 'No split payment transactions found.'}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          
          <div className="flex items-center justify-between px-6 py-4 border-t">
            <span className="text-sm text-muted-foreground">
              Showing {startIndex + 1} to {Math.min(endIndex, filteredRecords.length)} of {filteredRecords.length} entries
            </span>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCurrentPage(1)} disabled={currentPage === 1}>
                <ChevronsLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCurrentPage(v => Math.max(1, v - 1))} disabled={currentPage === 1}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm font-medium px-2">Page {currentPage} of {totalPages}</span>
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCurrentPage(v => Math.min(totalPages, v + 1))} disabled={currentPage === totalPages}>
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages}>
                <ChevronsRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
