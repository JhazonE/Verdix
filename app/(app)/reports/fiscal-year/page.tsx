'use client';

import { useState, useEffect } from 'react';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Calendar, FileDown, FileSpreadsheet, ShoppingCart, TrendingUp, Percent } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { getApiUrl } from '@/lib/api-config';
import { exportReportPdf, exportReportExcel } from '@/lib/report-print';
import { ReportSearchInput } from '@/components/reports/ReportSearchInput';

interface MonthRow {
  period: number;
  monthLabel: string;
  revenue: number;
  transactions: number;
  profit: number;
}

interface FiscalReport {
  fiscalYear: number;
  label: string;
  availableFiscalYears: number[];
  summary: { revenue: number; transactions: number; profit: number; avgTransaction: number };
  months: MonthRow[];
}

export default function FiscalYearReportPage() {
  const [report, setReport] = useState<FiscalReport | null>(null);
  const [selectedYear, setSelectedYear] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const { toast } = useToast();

  const formatCurrency = (value: number) =>
    `₱${value.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const fetchReport = async (year?: string) => {
    setIsLoading(true);
    try {
      const q = year ? `?fiscalYear=${year}` : '';
      const res = await fetch(getApiUrl(`/reports/fiscal-year${q}`));
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const result = await res.json();
      if (result.success) {
        setReport(result);
        setSelectedYear(String(result.fiscalYear));
      }
    } catch (error) {
      console.error('Error fetching fiscal year report:', error);
      toast({ title: 'Error', description: 'Failed to fetch fiscal year report.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { fetchReport(); }, []);

  const exportToPDF = () => {
    if (!report) return;
    const fileName = `Fiscal_Year_${report.label.replace(/\s+/g, '_')}.pdf`;
    const ok = exportReportPdf<MonthRow>({
      title: 'Fiscal Year Report',
      dateRange: report.label,
      summary: [
        { label: 'Total Revenue', value: formatCurrency(report.summary.revenue) },
        { label: 'Total Transactions', value: String(report.summary.transactions) },
        { label: 'Total Profit', value: formatCurrency(report.summary.profit) },
        { label: 'Avg Transaction', value: formatCurrency(report.summary.avgTransaction) },
      ],
      columns: [
        { header: 'Month', width: 40, cell: (r) => r.monthLabel },
        { header: 'Transactions', width: 30, align: 'right', cell: (r) => String(r.transactions) },
        { header: 'Revenue', width: 35, align: 'right', cell: (r) => r.revenue.toFixed(2) },
        { header: 'Profit', width: 35, align: 'right', cell: (r) => r.profit.toFixed(2) },
      ],
      rows: report.months,
      totals: [
        'TOTALS',
        String(report.summary.transactions),
        report.summary.revenue.toFixed(2),
        report.summary.profit.toFixed(2),
      ],
      fileName,
    });
    if (!ok) {
      toast({ title: 'No Data', description: 'No report loaded to export.', variant: 'destructive' });
      return;
    }
    toast({ title: 'PDF Exported', description: `Report saved as ${fileName}` });
  };

  const filteredMonths = (report?.months || []).filter((m) => {
    if (!searchTerm.trim()) return true;
    return m.monthLabel.toLowerCase().includes(searchTerm.toLowerCase());
  });

  const exportToExcel = () => {
    if (!report) return;
    const transactionsSum = filteredMonths.reduce((s, m) => s + m.transactions, 0);
    const revenueSum = filteredMonths.reduce((s, m) => s + m.revenue, 0);
    const profitSum = filteredMonths.reduce((s, m) => s + m.profit, 0);
    const fileName = `Fiscal_Year_${report.label.replace(/\s+/g, '_')}.xls`;
    const ok = exportReportExcel<MonthRow>({
      title: 'Fiscal Year Report',
      subtitle: report.label,
      columns: [
        { header: 'Month', cell: (r) => r.monthLabel },
        { header: 'Transactions', align: 'right', cell: (r) => r.transactions },
        { header: 'Revenue', align: 'right', cell: (r) => r.revenue },
        { header: 'Profit', align: 'right', cell: (r) => r.profit },
      ],
      rows: filteredMonths,
      totals: [
        'TOTALS',
        String(transactionsSum),
        revenueSum.toFixed(2),
        profitSum.toFixed(2),
      ],
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
                <Calendar className="h-5 w-5 text-blue-600" />
                Fiscal Year Report
              </CardTitle>
              <CardDescription>Revenue, transactions, and profit for a chosen fiscal year, broken down by month.</CardDescription>
            </div>
            {report && (
              <Badge variant="outline" className="text-sm border-blue-600 text-blue-600">
                {report.label}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Fiscal Year</label>
              <Select
                value={selectedYear}
                onValueChange={(v) => { setSelectedYear(v); fetchReport(v); }}
              >
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Select fiscal year" />
                </SelectTrigger>
                <SelectContent>
                  {(report?.availableFiscalYears || []).map((fy) => (
                    <SelectItem key={fy} value={String(fy)}>
                      {report && fy === report.fiscalYear ? report.label : `FY ${fy}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button onClick={() => fetchReport(selectedYear)} disabled={isLoading}>
              {isLoading ? 'Loading...' : 'Show Report'}
            </Button>

            <Button
              onClick={exportToPDF}
              disabled={isLoading || !report}
              variant="outline"
              className="border-blue-600 text-blue-600 hover:bg-blue-50"
            >
              <FileDown className="mr-2 h-4 w-4" />
              Export to PDF
            </Button>

            <Button
              onClick={exportToExcel}
              disabled={isLoading || !report}
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
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
            <div className="h-4 w-4 flex items-center justify-center text-muted-foreground font-semibold text-base">₱</div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">{formatCurrency(report?.summary.revenue || 0)}</div>
            <p className="text-xs text-muted-foreground">Fiscal year total</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Transactions</CardTitle>
            <ShoppingCart className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{report?.summary.transactions || 0}</div>
            <p className="text-xs text-muted-foreground">Number of sales</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Transaction</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-600">{formatCurrency(report?.summary.avgTransaction || 0)}</div>
            <p className="text-xs text-muted-foreground">Average sale value</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Profit</CardTitle>
            <Percent className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className={cn('text-2xl font-bold', (report?.summary.profit || 0) >= 0 ? 'text-green-600' : 'text-red-600')}>
              {formatCurrency(report?.summary.profit || 0)}
            </div>
            <p className="text-xs text-muted-foreground">Revenue minus cost</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle>Monthly Breakdown</CardTitle>
              <CardDescription>Each fiscal period mapped to its calendar month.</CardDescription>
            </div>
            <ReportSearchInput
              value={searchTerm}
              onChange={setSearchTerm}
              placeholder="Search month..."
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table className="w-full text-sm">
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="py-2 px-3">Month</TableHead>
                <TableHead className="py-2 px-2 text-right">Transactions</TableHead>
                <TableHead className="py-2 px-2 text-right">Revenue</TableHead>
                <TableHead className="py-2 px-2 text-right">Profit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report && filteredMonths.length > 0 ? (
                filteredMonths.map((m) => (
                  <TableRow key={m.period} className="text-xs">
                    <TableCell className="py-2 px-3 font-medium">{m.monthLabel}</TableCell>
                    <TableCell className="py-2 px-2 text-right font-mono">{m.transactions}</TableCell>
                    <TableCell className="py-2 px-2 text-right font-mono text-blue-600">{m.revenue.toFixed(2)}</TableCell>
                    <TableCell className={cn('py-2 px-2 text-right font-mono', m.profit >= 0 ? 'text-green-600' : 'text-red-600')}>
                      {m.profit.toFixed(2)}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={4} className="h-24 text-center">
                    {isLoading ? 'Loading...' : <span className="text-muted-foreground">No data for this fiscal year.</span>}
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
