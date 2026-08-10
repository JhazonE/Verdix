'use client';

import { useState, useEffect } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { Button } from '@/components/ui/button';
import { CalendarIcon, FileDown, FileSpreadsheet, CreditCard, UserPlus, RefreshCw } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { getApiUrl } from '@/lib/api-config';
import { exportReportPdf, exportReportExcel } from '@/lib/report-print';
import { ReportSearchInput } from '@/components/reports/ReportSearchInput';

interface MembershipRow {
  id: string;
  createdAt: string;
  customerName: string;
  rfidCode: string | null;
  type: 'activation' | 'renewal';
  amount: number;
  paymentMethod: string;
  cashierName: string;
  newExpiry: string;
}

interface Summary {
  count: number;
  totalActivations: number;
  totalRenewals: number;
  totalCollected: number;
  cashTotal: number;
  cardTotal: number;
}

const EMPTY: Summary = { count: 0, totalActivations: 0, totalRenewals: 0, totalCollected: 0, cashTotal: 0, cardTotal: 0 };

export default function MembershipReportPage() {
  const [fromDate, setFromDate] = useState<Date | undefined>(startOfMonth(new Date()));
  const [toDate, setToDate] = useState<Date | undefined>(endOfMonth(new Date()));
  const [rows, setRows] = useState<MembershipRow[]>([]);
  const [summary, setSummary] = useState<Summary>(EMPTY);
  const [isLoading, setIsLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const { toast } = useToast();

  const formatCurrency = (v: number) => `₱${v.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const fetchReport = async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (fromDate) params.append('startDate', format(fromDate, 'yyyy-MM-dd'));
      if (toDate) params.append('endDate', format(toDate, 'yyyy-MM-dd'));
      const res = await fetch(getApiUrl(`/reports/membership?${params.toString()}`));
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const result = await res.json();
      if (result.success) {
        setRows(result.data.rows);
        setSummary(result.data.summary);
      }
    } catch (e) {
      console.error('Error fetching membership report:', e);
      toast({ title: 'Error', description: 'Failed to fetch membership report.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { fetchReport(); }, []);

  const exportToPDF = () => {
    const fileName = `Membership_${format(fromDate || new Date(), 'yyyyMMdd')}_${format(toDate || new Date(), 'yyyyMMdd')}.pdf`;
    const ok = exportReportPdf<MembershipRow>({
      title: 'Membership Report',
      dateRange: `From: ${fromDate ? format(fromDate, 'yyyy-MM-dd') : 'N/A'} To: ${toDate ? format(toDate, 'yyyy-MM-dd') : 'N/A'}`,
      summary: [
        { label: 'Activations', value: String(summary.totalActivations) },
        { label: 'Renewals', value: String(summary.totalRenewals) },
        { label: 'Total Collected', value: formatCurrency(summary.totalCollected) },
      ],
      columns: [
        { header: 'Date', width: 28, cell: (r) => format(new Date(r.createdAt), 'MMM dd, yyyy') },
        { header: 'Customer', width: 40, cell: (r) => r.customerName },
        { header: 'RFID', width: 28, cell: (r) => r.rfidCode || '-' },
        { header: 'Type', width: 22, cell: (r) => r.type === 'activation' ? 'Activation' : 'Renewal' },
        { header: 'Amount', width: 22, align: 'right', cell: (r) => r.amount.toFixed(2) },
        { header: 'Method', width: 18, cell: (r) => r.paymentMethod.toUpperCase() },
        { header: 'Cashier', width: 30, cell: (r) => r.cashierName },
        { header: 'Valid Until', width: 28, cell: (r) => format(new Date(r.newExpiry), 'MMM dd, yyyy') },
      ],
      rows,
      totals: ['TOTALS', null, null, null, summary.totalCollected.toFixed(2), null, null, null],
      fileName,
    });
    if (!ok) {
      toast({ title: 'No Data', description: 'No records to export. Please fetch the report first.', variant: 'destructive' });
      return;
    }
    toast({ title: 'PDF Exported', description: `Report saved as ${fileName}` });
  };

  const filteredRows = rows.filter((r) => {
    if (!searchTerm.trim()) return true;
    const search = searchTerm.toLowerCase();
    return (
      r.customerName?.toLowerCase().includes(search) ||
      r.rfidCode?.toLowerCase().includes(search)
    );
  });

  const exportToExcel = () => {
    const collectedSum = filteredRows.reduce((s, r) => s + r.amount, 0);
    const fileName = `Membership_${format(fromDate || new Date(), 'yyyyMMdd')}_${format(toDate || new Date(), 'yyyyMMdd')}.xls`;
    const ok = exportReportExcel<MembershipRow>({
      title: 'Membership Report',
      subtitle: `From: ${fromDate ? format(fromDate, 'yyyy-MM-dd') : 'N/A'} To: ${toDate ? format(toDate, 'yyyy-MM-dd') : 'N/A'}`,
      columns: [
        { header: 'Date', cell: (r) => format(new Date(r.createdAt), 'MMM dd, yyyy') },
        { header: 'Customer', cell: (r) => r.customerName },
        { header: 'RFID', cell: (r) => r.rfidCode || '-' },
        { header: 'Type', cell: (r) => r.type === 'activation' ? 'Activation' : 'Renewal' },
        { header: 'Amount', align: 'right', cell: (r) => r.amount },
        { header: 'Method', cell: (r) => r.paymentMethod.toUpperCase() },
        { header: 'Cashier', cell: (r) => r.cashierName },
        { header: 'Valid Until', cell: (r) => format(new Date(r.newExpiry), 'MMM dd, yyyy') },
      ],
      rows: filteredRows,
      totals: ['TOTALS', null, null, null, collectedSum.toFixed(2), null, null, null],
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
              <CardTitle className="flex items-center gap-2"><CreditCard className="h-5 w-5 text-amber-600" />Membership Report</CardTitle>
              <CardDescription>Membership activations and renewals with cashier, amount, and validity</CardDescription>
            </div>
            <Badge variant="outline" className="text-sm border-amber-600 text-amber-600">{summary.count} Record{summary.count !== 1 ? 's' : ''}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">From Date</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn('w-[180px] justify-start text-left font-normal', !fromDate && 'text-muted-foreground')}>
                    <CalendarIcon className="mr-2 h-4 w-4" />{fromDate ? format(fromDate, 'PPP') : 'Select date'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start"><Calendar mode="single" selected={fromDate} onSelect={setFromDate} initialFocus /></PopoverContent>
              </Popover>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">To Date</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn('w-[180px] justify-start text-left font-normal', !toDate && 'text-muted-foreground')}>
                    <CalendarIcon className="mr-2 h-4 w-4" />{toDate ? format(toDate, 'PPP') : 'Select date'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start"><Calendar mode="single" selected={toDate} onSelect={setToDate} initialFocus /></PopoverContent>
              </Popover>
            </div>
            <Button onClick={fetchReport} disabled={isLoading}>{isLoading ? 'Loading...' : 'Show Report'}</Button>
            <Button onClick={exportToPDF} disabled={isLoading || rows.length === 0} variant="outline" className="border-amber-600 text-amber-600 hover:bg-amber-50">
              <FileDown className="mr-2 h-4 w-4" />Export to PDF
            </Button>
            <Button
              onClick={exportToExcel}
              disabled={isLoading || rows.length === 0}
              variant="outline"
              className="border-emerald-700 text-emerald-700 hover:bg-emerald-50"
            >
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              Export to Excel
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">Activations</CardTitle><UserPlus className="h-4 w-4 text-muted-foreground" /></CardHeader>
          <CardContent><div className="text-2xl font-bold text-emerald-600">{summary.totalActivations}</div><p className="text-xs text-muted-foreground">New cards</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">Renewals</CardTitle><RefreshCw className="h-4 w-4 text-muted-foreground" /></CardHeader>
          <CardContent><div className="text-2xl font-bold text-blue-600">{summary.totalRenewals}</div><p className="text-xs text-muted-foreground">Extended cards</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">Total Collected</CardTitle><div className="h-4 w-4 flex items-center justify-center text-muted-foreground font-semibold text-base">₱</div></CardHeader>
          <CardContent><div className="text-2xl font-bold text-amber-600">{formatCurrency(summary.totalCollected)}</div><p className="text-xs text-muted-foreground">All membership fees</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">Cash / Card</CardTitle><CreditCard className="h-4 w-4 text-muted-foreground" /></CardHeader>
          <CardContent><div className="text-lg font-bold">{formatCurrency(summary.cashTotal)} <span className="text-muted-foreground">/</span> {formatCurrency(summary.cardTotal)}</div><p className="text-xs text-muted-foreground">Cash vs card</p></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle>Membership Details</CardTitle>
              <CardDescription>Each activation and renewal in the selected date range</CardDescription>
            </div>
            <ReportSearchInput
              value={searchTerm}
              onChange={setSearchTerm}
              placeholder="Search customer, RFID..."
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table className="w-full text-sm">
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="py-2 px-3">Date</TableHead>
                <TableHead className="py-2 px-2">Customer</TableHead>
                <TableHead className="py-2 px-2">RFID</TableHead>
                <TableHead className="py-2 px-2">Type</TableHead>
                <TableHead className="py-2 px-2 text-right">Amount</TableHead>
                <TableHead className="py-2 px-2">Method</TableHead>
                <TableHead className="py-2 px-2">Cashier</TableHead>
                <TableHead className="py-2 px-2">Valid Until</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRows.length > 0 ? filteredRows.map((r) => (
                <TableRow key={r.id} className="text-xs">
                  <TableCell className="py-2 px-3">{format(new Date(r.createdAt), 'MMM dd, yyyy')}</TableCell>
                  <TableCell className="py-2 px-2 font-medium">{r.customerName}</TableCell>
                  <TableCell className="py-2 px-2 text-muted-foreground">{r.rfidCode || '-'}</TableCell>
                  <TableCell className="py-2 px-2">
                    <Badge variant="outline" className={cn(r.type === 'activation' ? 'border-emerald-600 text-emerald-600' : 'border-blue-600 text-blue-600')}>
                      {r.type === 'activation' ? 'Activation' : 'Renewal'}
                    </Badge>
                  </TableCell>
                  <TableCell className="py-2 px-2 text-right font-mono text-amber-600">{r.amount.toFixed(2)}</TableCell>
                  <TableCell className="py-2 px-2 uppercase">{r.paymentMethod}</TableCell>
                  <TableCell className="py-2 px-2">{r.cashierName}</TableCell>
                  <TableCell className="py-2 px-2">{format(new Date(r.newExpiry), 'MMM dd, yyyy')}</TableCell>
                </TableRow>
              )) : (
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center">
                    {isLoading ? 'Loading...' : <span className="text-muted-foreground">{rows.length > 0 ? 'No records match your search.' : 'No membership records for the selected date range.'}</span>}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
