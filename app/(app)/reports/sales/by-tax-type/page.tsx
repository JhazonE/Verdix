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
import {
  CalendarIcon,
  FileDown,
  FileSpreadsheet,
  Download,
  ChevronDown,
  // PhilippinePeso, not Receipt or DollarSign: lucide's Receipt glyph draws a
  // dollar sign on its face, which is wrong for a Philippine BIR tax report.
  PhilippinePeso,
  Landmark,
  Percent,
  Coins,
} from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { getApiUrl } from '@/lib/api-config';
import { REPORT_FETCH_TIMEOUT_MS } from '@/lib/fetch-report';
import { exportReportPdf, exportReportExcel } from '@/lib/report-print';
import { TAX_TYPES, TAX_TYPE_LABELS, TaxType } from '@/lib/tax-utils';

/**
 * Sales by Tax Type — the BIR tax buckets for a date range.
 *
 * Deliberately aggregates LINE ITEMS, not transactions: a single receipt can
 * carry VAT and VAT_EXEMPT lines at once (a senior citizen's basket), so only a
 * line-level sum puts each peso in the bucket it belongs to. This is why the
 * figures here cannot be reproduced by filtering the transaction-level Sales
 * Summary report.
 */

interface TaxBucket {
  taxType: TaxType;
  grossSales: number;
  totalDiscount: number;
  totalSales: number;
  netOfVat: number;
  vatAmount: number;
  unitsSold: number;
  lineCount: number;
  transactionCount: number;
  shareOfSales: number;
}

interface DailyRow {
  date: string;
  totalSales: number;
  totalDiscount: number;
  unitsSold: number;
  byTaxType: Record<string, { totalSales: number; totalDiscount: number; unitsSold: number }>;
}

interface Totals {
  grossSales: number;
  totalDiscount: number;
  totalSales: number;
  netOfVat: number;
  vatAmount: number;
  unitsSold: number;
  lineCount: number;
}

const EMPTY_TOTALS: Totals = {
  grossSales: 0,
  totalDiscount: 0,
  totalSales: 0,
  netOfVat: 0,
  vatAmount: 0,
  unitsSold: 0,
  lineCount: 0,
};

const formatCurrency = (v: number) =>
  `₱${(v || 0).toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const formatPercent = (v: number) => `${(v || 0).toFixed(1)}%`;

export default function SalesByTaxTypePage() {
  const [fromDate, setFromDate] = useState<Date | undefined>(startOfMonth(new Date()));
  const [toDate, setToDate] = useState<Date | undefined>(endOfMonth(new Date()));
  const [buckets, setBuckets] = useState<TaxBucket[]>([]);
  const [totals, setTotals] = useState<Totals>(EMPTY_TOTALS);
  const [daily, setDaily] = useState<DailyRow[]>([]);
  const [showDaily, setShowDaily] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const { toast } = useToast();

  const fetchReport = async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (fromDate) params.append('startDate', format(fromDate, 'yyyy-MM-dd'));
      if (toDate) params.append('endDate', format(toDate, 'yyyy-MM-dd'));
      if (showDaily) params.append('groupBy', 'date');

      const response = await fetch(
        getApiUrl(`/sales/by-tax-type?${params.toString()}`),
        { signal: AbortSignal.timeout(REPORT_FETCH_TIMEOUT_MS) }
      );
      if (!response.ok) throw new Error(`API error ${response.status}`);
      const result = await response.json();
      // A 200 carrying success:false is how these report APIs surface their own
      // failures; falling through would read as "no sales in this range".
      if (!result.success) {
        throw new Error(result.details || result.error || 'The report could not be generated.');
      }
      setBuckets(result.data?.buckets || []);
      setTotals(result.data?.totals || EMPTY_TOTALS);
      setDaily(result.data?.daily || []);
      setHasLoaded(true);
    } catch (error) {
      console.error('Error fetching sales by tax type:', error);
      toast({
        title: 'Error',
        description: 'Failed to fetch tax type sales data. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchReport();
    // Intentionally runs once on mount; the date range is applied by Show Report.
  }, []);

  const dateRangeLabel = `From: ${
    fromDate ? format(fromDate, 'yyyy-MM-dd') : 'N/A'
  } To: ${toDate ? format(toDate, 'yyyy-MM-dd') : 'N/A'}`;

  const exportColumns = [
    { header: 'Tax Type', width: 34, cell: (r: TaxBucket) => TAX_TYPE_LABELS[r.taxType] },
    { header: 'Gross Sales', width: 28, align: 'right' as const, cell: (r: TaxBucket) => r.grossSales.toFixed(2) },
    { header: 'Discount', width: 24, align: 'right' as const, cell: (r: TaxBucket) => r.totalDiscount.toFixed(2) },
    { header: 'Net Sales', width: 28, align: 'right' as const, cell: (r: TaxBucket) => r.totalSales.toFixed(2) },
    { header: 'Sales Net of VAT', width: 30, align: 'right' as const, cell: (r: TaxBucket) => r.netOfVat.toFixed(2) },
    { header: 'VAT', width: 24, align: 'right' as const, cell: (r: TaxBucket) => r.vatAmount.toFixed(2) },
    { header: 'Qty Sold', width: 22, align: 'right' as const, cell: (r: TaxBucket) => String(r.unitsSold) },
    { header: 'Share', width: 20, align: 'right' as const, cell: (r: TaxBucket) => formatPercent(r.shareOfSales) },
  ];

  const exportToPDF = () => {
    const ok = exportReportPdf<TaxBucket>({
      title: 'Sales by Tax Type',
      // Carried into the export itself, not just the screen: these figures get
      // filed, and a reader of the PDF must know what is and is not counted.
      dateRange: `${dateRangeLabel}  |  POS sales only (invoices and orders record no tax type)`,
      summary: [
        { label: 'Net Sales', value: formatCurrency(totals.totalSales) },
        { label: 'Sales Net of VAT', value: formatCurrency(totals.netOfVat) },
        { label: 'Output VAT', value: formatCurrency(totals.vatAmount) },
        { label: 'Total Discount', value: formatCurrency(totals.totalDiscount) },
      ],
      columns: exportColumns,
      rows: buckets,
      fileName: `Sales_By_Tax_Type_${format(fromDate || new Date(), 'yyyyMMdd')}_${format(
        toDate || new Date(),
        'yyyyMMdd'
      )}.pdf`,
      orientation: 'landscape',
    });
    if (!ok) {
      toast({ title: 'Nothing to export', description: 'Run the report first.' });
    }
  };

  const exportToExcel = () => {
    const ok = exportReportExcel<TaxBucket>({
      title: 'Sales by Tax Type',
      subtitle: `${dateRangeLabel} | POS sales only (invoices and orders record no tax type)`,
      columns: exportColumns,
      rows: buckets,
      fileName: `Sales_By_Tax_Type_${format(fromDate || new Date(), 'yyyyMMdd')}_${format(
        toDate || new Date(),
        'yyyyMMdd'
      )}.xls`,
    });
    if (!ok) {
      toast({ title: 'Nothing to export', description: 'Run the report first.' });
    }
  };

  // A range with no sales at all is a legitimate answer, distinct from "not run
  // yet" — the API always returns all four buckets, so emptiness is the totals.
  const hasSales = totals.totalSales > 0 || totals.lineCount > 0;

  return (
    <div className="space-y-6 p-6">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <PhilippinePeso className="h-5 w-5 text-green-600" />
                Sales by Tax Type
              </CardTitle>
              <CardDescription>
                Sales totals per BIR tax classification — VATable, VAT Exempt,
                Zero-Rated and Non-VAT
              </CardDescription>
            </div>
            <Badge variant="outline" className="text-sm border-green-600 text-green-600">
              {totals.lineCount.toLocaleString()} Line{totals.lineCount !== 1 ? 's' : ''}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-2">
              <label className="block text-sm font-medium">From Date</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      'w-[210px] justify-start text-left font-normal',
                      !fromDate && 'text-muted-foreground'
                    )}
                  >
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
              <label className="block text-sm font-medium">To Date</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      'w-[210px] justify-start text-left font-normal',
                      !toDate && 'text-muted-foreground'
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {toDate ? format(toDate, 'PPP') : 'Select date'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={toDate} onSelect={setToDate} initialFocus />
                </PopoverContent>
              </Popover>
            </div>

            <div className="flex items-center gap-2 pb-2">
              <Checkbox
                id="showDaily"
                checked={showDaily}
                onCheckedChange={(v) => setShowDaily(v === true)}
              />
              <label htmlFor="showDaily" className="text-sm font-medium">
                Daily breakdown
              </label>
            </div>

            <Button onClick={fetchReport} disabled={isLoading}>
              {isLoading ? 'Loading...' : 'Show Report'}
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  disabled={isLoading || !hasSales}
                  variant="outline"
                  className="border-green-600 text-green-600 hover:bg-green-50"
                >
                  <Download className="mr-2 h-4 w-4" />
                  Export
                  <ChevronDown className="ml-2 h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem onClick={exportToPDF}>
                  <FileDown className="mr-2 h-4 w-4 text-green-600" />
                  Export to PDF
                </DropdownMenuItem>
                <DropdownMenuItem onClick={exportToExcel}>
                  <FileSpreadsheet className="mr-2 h-4 w-4 text-emerald-700" />
                  Export to Excel
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Always shown, not only on a filter: this report has exactly one
              source and presenting it as all-sales would overstate nothing less
              than reported revenue. */}
          <p className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
            <strong>POS sales only.</strong> Sales invoices and sales orders do not
            record a tax type, so they are not included here. Prices are
            VAT-inclusive; VATable net is computed at 12%.
          </p>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Net Sales</CardTitle>
            <Coins className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totals.totalSales)}</div>
            <p className="text-xs text-muted-foreground">All tax types combined</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Sales Net of VAT</CardTitle>
            <Landmark className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totals.netOfVat)}</div>
            <p className="text-xs text-muted-foreground">VAT removed from VATable sales</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Output VAT</CardTitle>
            <Percent className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totals.vatAmount)}</div>
            <p className="text-xs text-muted-foreground">12% of VATable net sales</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Discount</CardTitle>
            <Percent className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totals.totalDiscount)}</div>
            <p className="text-xs text-muted-foreground">Across all tax types</p>
          </CardContent>
        </Card>
      </div>

      {/* Per-bucket breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Breakdown by Tax Type</CardTitle>
          <CardDescription>
            Each bucket&apos;s share of net sales for the selected range
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
          ) : !hasSales ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {hasLoaded
                ? 'No POS sales found in the selected date range.'
                : 'Choose a date range and select Show Report.'}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tax Type</TableHead>
                  <TableHead className="text-right">Gross Sales</TableHead>
                  <TableHead className="text-right">Discount</TableHead>
                  <TableHead className="text-right">Net Sales</TableHead>
                  <TableHead className="text-right">Sales Net of VAT</TableHead>
                  <TableHead className="text-right">VAT</TableHead>
                  <TableHead className="text-right">Qty Sold</TableHead>
                  <TableHead className="text-right">Share</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {buckets.map((b) => (
                  <TableRow key={b.taxType}>
                    <TableCell className="font-medium">{TAX_TYPE_LABELS[b.taxType]}</TableCell>
                    <TableCell className="text-right">{formatCurrency(b.grossSales)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(b.totalDiscount)}</TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(b.totalSales)}
                    </TableCell>
                    <TableCell className="text-right">{formatCurrency(b.netOfVat)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(b.vatAmount)}</TableCell>
                    <TableCell className="text-right">{b.unitsSold.toLocaleString()}</TableCell>
                    <TableCell className="text-right">{formatPercent(b.shareOfSales)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="font-bold">Total</TableCell>
                  <TableCell className="text-right font-bold">
                    {formatCurrency(totals.grossSales)}
                  </TableCell>
                  <TableCell className="text-right font-bold">
                    {formatCurrency(totals.totalDiscount)}
                  </TableCell>
                  <TableCell className="text-right font-bold">
                    {formatCurrency(totals.totalSales)}
                  </TableCell>
                  <TableCell className="text-right font-bold">
                    {formatCurrency(totals.netOfVat)}
                  </TableCell>
                  <TableCell className="text-right font-bold">
                    {formatCurrency(totals.vatAmount)}
                  </TableCell>
                  <TableCell className="text-right font-bold">
                    {totals.unitsSold.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right font-bold">100.0%</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Daily breakdown */}
      {showDaily && daily.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Daily Breakdown</CardTitle>
            <CardDescription>
              Net sales per day, split by tax type. Transaction counts are omitted
              here because one receipt can span several tax types.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  {TAX_TYPES.map((t) => (
                    <TableHead key={t} className="text-right whitespace-nowrap">
                      {TAX_TYPE_LABELS[t]}
                    </TableHead>
                  ))}
                  <TableHead className="text-right">Day Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {daily.map((d) => (
                  <TableRow key={d.date}>
                    <TableCell className="whitespace-nowrap font-medium">
                      {format(new Date(d.date), 'MMM dd, yyyy')}
                    </TableCell>
                    {TAX_TYPES.map((t) => (
                      <TableCell key={t} className="text-right">
                        {formatCurrency(d.byTaxType?.[t]?.totalSales || 0)}
                      </TableCell>
                    ))}
                    <TableCell className="text-right font-medium">
                      {formatCurrency(d.totalSales)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
