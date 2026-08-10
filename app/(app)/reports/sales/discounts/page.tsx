'use client';

import { useState, useEffect } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
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
import { CalendarIcon, FileDown, FileSpreadsheet, ShieldCheck, Search, Users, BadgeCheck } from 'lucide-react';
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

interface DiscountRecord {
  transactionDate: string;
  orderNumber: number | string;
  saleId: string;
  reference: string | null;
  receiptNumber: string | null;
  productName: string;
  discountType: string;
  idNumber: string | null;
  holderName: string | null;
  discountPercentage: number;
  discountAmount: number;
  cashierName: string;
}

const TYPE_LABELS: Record<string, string> = {
  senior: 'Senior Citizen',
  pwd: 'PWD',
  naac: 'NAAC',
  solo_parent: 'Solo Parent',
};

const TYPE_BADGE: Record<string, string> = {
  senior: 'border-orange-500 text-orange-600',
  pwd: 'border-purple-500 text-purple-600',
  naac: 'border-teal-500 text-teal-600',
  solo_parent: 'border-pink-500 text-pink-600',
};

export default function DiscountReportPage() {
  const [fromDate, setFromDate] = useState<Date | undefined>(startOfMonth(new Date()));
  const [toDate, setToDate] = useState<Date | undefined>(endOfMonth(new Date()));
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [records, setRecords] = useState<DiscountRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const { toast } = useToast();

  const totals = {
    count: records.length,
    discount: records.reduce((sum, r) => sum + r.discountAmount, 0),
    senior: records.filter((r) => r.discountType === 'senior').length,
    pwd: records.filter((r) => r.discountType === 'pwd').length,
  };

  const fetchReport = async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (fromDate) params.append('startDate', format(fromDate, 'yyyy-MM-dd'));
      if (toDate) params.append('endDate', format(toDate, 'yyyy-MM-dd'));
      if (typeFilter !== 'all') params.append('type', typeFilter);

      const response = await fetch(getApiUrl(`/sales/discounts?${params.toString()}`));
      if (!response.ok) throw new Error(`API error ${response.status}`);
      const result = await response.json();
      if (result.success) {
        setRecords(result.data || []);
      } else {
        throw new Error(result.error || 'Failed');
      }
    } catch (error) {
      console.error('Error fetching discount report:', error);
      toast({
        title: 'Error',
        description: 'Failed to fetch discount report. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchReport();
  }, []);

  const filteredRecords = records.filter((record) => {
    if (!searchTerm.trim()) return true;
    const s = searchTerm.toLowerCase();
    return (
      record.holderName?.toLowerCase().includes(s) ||
      record.idNumber?.toLowerCase().includes(s) ||
      record.productName?.toLowerCase().includes(s) ||
      String(record.orderNumber).includes(s)
    );
  });

  const formatCurrency = (value: number) =>
    `₱${value.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const exportToPDF = () => {
    const fileName = `Discount_Report_${format(fromDate || new Date(), 'yyyyMMdd')}_${format(toDate || new Date(), 'yyyyMMdd')}.pdf`;
    const grandTotal = filteredRecords.reduce((sum, r) => sum + r.discountAmount, 0);
    const ok = exportReportPdf<DiscountRecord>({
      title: 'Discount Report (SC / PWD / NAAC / Solo Parent)',
      dateRange: `From: ${fromDate ? format(fromDate, 'yyyy-MM-dd') : 'N/A'}  To: ${toDate ? format(toDate, 'yyyy-MM-dd') : 'N/A'}`,
      summary: [
        { label: 'Total Records', value: String(totals.count) },
        { label: 'Total Discount', value: formatCurrency(totals.discount) },
      ],
      columns: [
        { header: 'Date', width: 30, cell: (r) => r.transactionDate ? format(new Date(r.transactionDate), 'yyyy-MM-dd HH:mm') : '-' },
        { header: 'OR/SI No.', width: 24, cell: (r) => String(r.orderNumber || '-').padStart(6, '0') },
        { header: 'Type', width: 26, cell: (r) => TYPE_LABELS[r.discountType] || r.discountType },
        { header: 'Cardholder Name', width: 45, cell: (r) => r.holderName || '-' },
        { header: 'ID Number', width: 35, cell: (r) => r.idNumber || '-' },
        { header: 'Item', width: 40, cell: (r) => r.productName || '-' },
        { header: 'Disc %', width: 16, align: 'right', cell: (r) => `${r.discountPercentage.toFixed(0)}%` },
        { header: 'Disc Amount', width: 25, align: 'right', cell: (r) => r.discountAmount.toFixed(2) },
        { header: 'Cashier', width: 25, cell: (r) => r.cashierName || '-' },
      ],
      rows: filteredRecords,
      totals: ['GRAND TOTAL', null, null, null, null, null, `${filteredRecords.length} rec`, grandTotal.toFixed(2), null],
      fileName,
    });
    if (!ok) {
      toast({ title: 'No Data', description: 'No records to export.', variant: 'destructive' });
      return;
    }
    toast({ title: 'PDF Exported', description: `Report saved as ${fileName}` });
  };

  const exportToExcel = () => {
    const grandTotal = filteredRecords.reduce((sum, r) => sum + r.discountAmount, 0);
    const fileName = `Discount_Report_${format(fromDate || new Date(), 'yyyyMMdd')}_${format(toDate || new Date(), 'yyyyMMdd')}.xls`;
    const ok = exportReportExcel<DiscountRecord>({
      title: 'Discount Report (SC / PWD / NAAC / Solo Parent)',
      subtitle: `From: ${fromDate ? format(fromDate, 'yyyy-MM-dd') : 'N/A'}  To: ${toDate ? format(toDate, 'yyyy-MM-dd') : 'N/A'}`,
      columns: [
        { header: 'Date', cell: (r) => r.transactionDate ? format(new Date(r.transactionDate), 'yyyy-MM-dd HH:mm') : '-' },
        { header: 'OR/SI No.', cell: (r) => String(r.orderNumber || '-').padStart(6, '0') },
        { header: 'Type', cell: (r) => TYPE_LABELS[r.discountType] || r.discountType },
        { header: 'Cardholder Name', cell: (r) => r.holderName || '-' },
        { header: 'ID Number', cell: (r) => r.idNumber || '-' },
        { header: 'Item', cell: (r) => r.productName || '-' },
        { header: 'Disc %', align: 'right', cell: (r) => `${r.discountPercentage.toFixed(0)}%` },
        { header: 'Disc Amount', align: 'right', cell: (r) => r.discountAmount },
        { header: 'Cashier', cell: (r) => r.cashierName || '-' },
      ],
      rows: filteredRecords,
      totals: ['GRAND TOTAL', null, null, null, null, null, `${filteredRecords.length} rec`, grandTotal.toFixed(2), null],
      fileName,
    });
    if (!ok) {
      toast({ title: 'No Data', description: 'No records to export. Please fetch the report first.', variant: 'destructive' });
      return;
    }
    toast({ title: 'Excel Exported', description: `Report saved as ${fileName}` });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-blue-600" />
                Discount Report
              </CardTitle>
              <CardDescription>
                Statutory discounts (Senior Citizen, PWD, NAAC, Solo Parent) with cardholder name and ID number.
              </CardDescription>
            </div>
            <Badge variant="outline" className="text-sm border-blue-600 text-blue-600">
              {records.length} Record{records.length !== 1 ? 's' : ''}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">From Date</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn('w-[180px] justify-start text-left font-normal', !fromDate && 'text-muted-foreground')}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {fromDate ? format(fromDate, 'PPP') : 'Select date'}
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
                  <Button variant="outline" className={cn('w-[180px] justify-start text-left font-normal', !toDate && 'text-muted-foreground')}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {toDate ? format(toDate, 'PPP') : 'Select date'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={toDate} onSelect={setToDate} initialFocus />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Discount Type</label>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-[170px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="senior">Senior Citizen</SelectItem>
                  <SelectItem value="pwd">PWD</SelectItem>
                  <SelectItem value="naac">NAAC</SelectItem>
                  <SelectItem value="solo_parent">Solo Parent</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button onClick={fetchReport} disabled={isLoading}>
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
            <CardTitle className="text-sm font-medium">Total Records</CardTitle>
            <BadgeCheck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">{totals.count.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">Discounted line items</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Discount</CardTitle>
            <div className="h-4 w-4 flex items-center justify-center text-muted-foreground font-semibold text-base">₱</div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{formatCurrency(totals.discount)}</div>
            <p className="text-xs text-muted-foreground">Amount discounted</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Senior Citizen</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">{totals.senior}</div>
            <p className="text-xs text-muted-foreground">Senior discount records</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">PWD</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-600">{totals.pwd}</div>
            <p className="text-xs text-muted-foreground">PWD discount records</p>
          </CardContent>
        </Card>
      </div>

      {/* Data Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Discount Records</CardTitle>
              <CardDescription>Per-item statutory discount log with cardholder details</CardDescription>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search name, ID, item, OR#..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 w-[250px]"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table className="w-full text-sm">
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="py-2 px-3">Date</TableHead>
                <TableHead className="py-2 px-2">OR/SI No.</TableHead>
                <TableHead className="py-2 px-2">Type</TableHead>
                <TableHead className="py-2 px-2">Cardholder Name</TableHead>
                <TableHead className="py-2 px-2">ID Number</TableHead>
                <TableHead className="py-2 px-2">Item</TableHead>
                <TableHead className="py-2 px-2 text-right">Disc %</TableHead>
                <TableHead className="py-2 px-2 text-right">Disc Amount</TableHead>
                <TableHead className="py-2 px-2">Cashier</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRecords.length > 0 ? (
                filteredRecords.map((record, index) => (
                  <TableRow key={index} className="hover:bg-muted/50 transition-colors text-xs">
                    <TableCell className="py-2 px-3 whitespace-nowrap">
                      {record.transactionDate ? format(new Date(record.transactionDate), 'MMM d, yyyy h:mm a') : '-'}
                    </TableCell>
                    <TableCell className="py-2 px-2 font-mono">{String(record.orderNumber || '-').padStart(6, '0')}</TableCell>
                    <TableCell className="py-2 px-2">
                      <Badge variant="outline" className={cn('font-medium', TYPE_BADGE[record.discountType] || '')}>
                        {TYPE_LABELS[record.discountType] || record.discountType}
                      </Badge>
                    </TableCell>
                    <TableCell className="py-2 px-2 font-medium">{record.holderName || '-'}</TableCell>
                    <TableCell className="py-2 px-2 font-mono text-muted-foreground">{record.idNumber || '-'}</TableCell>
                    <TableCell className="py-2 px-2">{record.productName || '-'}</TableCell>
                    <TableCell className="py-2 px-2 text-right font-mono">{record.discountPercentage.toFixed(0)}%</TableCell>
                    <TableCell className="py-2 px-2 text-right font-mono text-green-600">{record.discountAmount.toFixed(2)}</TableCell>
                    <TableCell className="py-2 px-2 text-muted-foreground">{record.cashierName}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={9} className="h-24 text-center">
                    {isLoading ? (
                      <div className="flex items-center justify-center gap-2">
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
                        Loading...
                      </div>
                    ) : (
                      <span className="text-muted-foreground">No discount records found for the selected filters.</span>
                    )}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
            {filteredRecords.length > 0 && (
              <TableFooter>
                <TableRow className="bg-muted/70 font-bold border-t-2">
                  <TableCell className="py-2.5 px-3" colSpan={5}>
                    GRAND TOTAL
                  </TableCell>
                  <TableCell className="py-2.5 px-2 text-right">
                    {filteredRecords.length} record{filteredRecords.length !== 1 ? 's' : ''}
                  </TableCell>
                  <TableCell className="py-2.5 px-2" />
                  <TableCell className="py-2.5 px-2 text-right font-mono text-green-700">
                    {formatCurrency(filteredRecords.reduce((sum, r) => sum + r.discountAmount, 0))}
                  </TableCell>
                  <TableCell className="py-2.5 px-2" />
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
