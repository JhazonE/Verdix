'use client';

import { useState, useEffect } from 'react';
import {
  Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ChevronDown, ChevronLeft, ChevronRight, Download, FileDown, FileSpreadsheet,
  Printer, TrendingUp, PhilippinePeso, Percent, Boxes, CalendarDays,
} from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { getApiUrl } from '@/lib/api-config';
import { REPORT_FETCH_TIMEOUT_MS } from '@/lib/fetch-report';
import { exportReportPdf, exportReportExcel, printReportTable } from '@/lib/report-print';
import { SalesSourceFilter as SalesSourceToggle } from '@/components/sales-source';
import type { SalesSourceFilter } from '@/lib/sales-source';
import type { GrossProfitDay, GrossProfitReport } from '@/lib/gross-profit-report';

const TITLE = 'Sales, Cost of Goods Sold & Gross Profit Monitoring';

const money = (v: number) =>
  (v || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const peso = (v: number) => `₱${money(v)}`;
const pct = (v: number) => `${(v || 0).toFixed(2)}%`;

const ymOf = (d: Date) => format(d, 'yyyy-MM');
const shiftMonth = (ym: string, delta: number) => {
  const [y, m] = ym.split('-').map(Number);
  return ymOf(new Date(y, m - 1 + delta, 1));
};
/** 'YYYY-MM-DD' → Date at LOCAL midnight (new Date('YYYY-MM-DD') is UTC). */
const localDate = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export default function GrossProfitMonitoringPage() {
  const [month, setMonth] = useState<string>(ymOf(new Date()));
  const [sourceFilter, setSourceFilter] = useState<SalesSourceFilter>('all');
  const [report, setReport] = useState<GrossProfitReport | null>(null);
  const [settings, setSettings] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  // Arguments are passed explicitly so a control's onChange never fetches with
  // a stale state value.
  const fetchReport = async (ym: string = month, source: SalesSourceFilter = sourceFilter) => {
    setIsLoading(true);
    try {
      const qs = new URLSearchParams({ month: ym });
      if (source !== 'all') qs.append('source', source);
      const res = await fetch(getApiUrl(`/reports/gross-profit?${qs.toString()}`), {
        signal: AbortSignal.timeout(REPORT_FETCH_TIMEOUT_MS),
      });
      const result = await res.json().catch(() => null);
      // A success:false body is how this API reports its own errors; falling
      // through would read as "no sales this month".
      if (!res.ok || !result?.success) {
        throw new Error(result?.details || result?.error || `API error ${res.status}`);
      }
      setReport(result);
    } catch (error) {
      console.error('Error fetching gross profit report:', error);
      toast({ title: 'Error', description: 'Failed to load the gross profit report.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchReport();
    (async () => {
      try {
        const res = await fetch(getApiUrl('/pos-settings'), { signal: AbortSignal.timeout(REPORT_FETCH_TIMEOUT_MS) });
        const data = await res.json();
        if (data.success) setSettings(data.data);
      } catch (e) {
        // Only the printed letterhead uses it; the report works without.
        console.error('Failed to fetch settings:', e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changeMonth = (ym: string) => {
    if (!/^\d{4}-\d{2}$/.test(ym)) return;
    setMonth(ym);
    fetchReport(ym);
  };

  const monthLabel = report
    ? format(localDate(`${report.month}-01`), 'MMMM yyyy')
    : format(localDate(`${month}-01`), 'MMMM yyyy');
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const days = report?.days ?? [];
  const totals = report?.totals;
  const avg = report?.averagePerDay;
  const hasData = !!report && report.sellingDays > 0;

  // ---- exports -----------------------------------------------------------
  const sourceNote = sourceFilter === 'all' ? '' : ` (${sourceFilter === 'pos' ? 'POS' : 'Backoffice'} only)`;
  const period = `For the month of ${monthLabel}${sourceNote}`;
  const fileBase = `Gross_Profit_Monitoring_${report?.month ?? month}`;

  const summaryItems = () => [
    { label: 'Total Sales', value: peso(totals!.sales) },
    { label: 'Total CoGS', value: peso(totals!.cost) },
    { label: 'Gross Profit', value: peso(totals!.grossProfit) },
    { label: 'Avg Gross Profit / Day', value: peso(avg!.grossProfit) },
    { label: 'Gross Profit Margin', value: pct(totals!.marginPct) },
    { label: 'Markup on Cost', value: pct(totals!.markupPct) },
    { label: 'Avg Sales / Day', value: peso(avg!.sales) },
    { label: 'Avg CoGS / Day', value: peso(avg!.cost) },
    { label: 'Selling Days', value: String(report!.sellingDays) },
  ];

  const columns = [
    { header: 'Date', width: 40, cell: (r: GrossProfitDay) => format(localDate(r.date), 'MM/dd/yyyy') },
    { header: 'Sales', width: 48, align: 'right' as const, cell: (r: GrossProfitDay) => money(r.sales) },
    { header: 'Cost of Goods Sold', width: 48, align: 'right' as const, cell: (r: GrossProfitDay) => money(r.cost) },
    { header: 'Gross Profit', width: 48, align: 'right' as const, cell: (r: GrossProfitDay) => money(r.grossProfit) },
    { header: 'Gross Profit Margin %', width: 46, align: 'right' as const, cell: (r: GrossProfitDay) => pct(r.marginPct) },
    { header: 'Markup on Cost %', width: 46, align: 'right' as const, cell: (r: GrossProfitDay) => pct(r.markupPct) },
  ];
  const totalsRow = () => [
    'TOTAL',
    money(totals!.sales),
    money(totals!.cost),
    money(totals!.grossProfit),
    pct(totals!.marginPct),
    pct(totals!.markupPct),
  ];

  const guard = () => {
    if (!hasData) {
      toast({ title: 'Nothing to export', description: 'There are no sales in this month.' });
      return false;
    }
    return true;
  };

  const handlePrint = () => {
    if (!guard()) return;
    printReportTable<GrossProfitDay>({
      title: TITLE,
      period,
      business: settings || undefined,
      summary: summaryItems(),
      columns,
      rows: days,
      totals: totalsRow(),
      showSignature: true,
    });
  };

  const exportToPDF = () => {
    if (!guard()) return;
    exportReportPdf<GrossProfitDay>({
      title: TITLE,
      dateRange: settings?.businessName ? `${settings.businessName}  |  ${period}` : period,
      summary: summaryItems(),
      columns,
      rows: days,
      totals: totalsRow(),
      fileName: `${fileBase}.pdf`,
      orientation: 'landscape',
    });
  };

  const exportToExcel = () => {
    if (!guard()) return;
    exportReportExcel<GrossProfitDay>({
      title: TITLE,
      subtitle: settings?.businessName ? `${settings.businessName} | ${period}` : period,
      columns: [
        { header: 'Date', cell: (r) => format(localDate(r.date), 'MM/dd/yyyy') },
        // Numbers, not formatted strings, so Excel can sum the columns.
        { header: 'Sales', align: 'right', cell: (r) => Number(r.sales.toFixed(2)) },
        { header: 'Cost of Goods Sold', align: 'right', cell: (r) => Number(r.cost.toFixed(2)) },
        { header: 'Gross Profit', align: 'right', cell: (r) => Number(r.grossProfit.toFixed(2)) },
        { header: 'Gross Profit Margin %', align: 'right', cell: (r) => Number(r.marginPct.toFixed(2)) },
        { header: 'Markup on Cost %', align: 'right', cell: (r) => Number(r.markupPct.toFixed(2)) },
      ],
      rows: days,
      totals: [
        'TOTAL',
        totals!.sales.toFixed(2),
        totals!.cost.toFixed(2),
        totals!.grossProfit.toFixed(2),
        totals!.marginPct.toFixed(2),
        totals!.markupPct.toFixed(2),
      ],
      fileName: `${fileBase}.xls`,
    });
  };

  // ---- render ------------------------------------------------------------
  const tiles = [
    { label: 'Total Sales', value: peso(totals?.sales ?? 0), icon: PhilippinePeso, tone: 'text-blue-600' },
    { label: 'Total CoGS', value: peso(totals?.cost ?? 0), icon: Boxes, tone: 'text-amber-600' },
    {
      label: 'Gross Profit',
      value: peso(totals?.grossProfit ?? 0),
      icon: TrendingUp,
      tone: (totals?.grossProfit ?? 0) >= 0 ? 'text-green-600' : 'text-red-600',
    },
    {
      label: 'Avg Gross Profit',
      value: peso(avg?.grossProfit ?? 0),
      icon: CalendarDays,
      tone: 'text-purple-600',
      note: `per selling day (${report?.sellingDays ?? 0} day${report?.sellingDays === 1 ? '' : 's'})`,
    },
    { label: 'Gross Profit Margin', value: pct(totals?.marginPct ?? 0), icon: Percent, tone: 'text-emerald-600', note: 'Gross profit ÷ sales' },
    { label: 'Markup on Cost', value: pct(totals?.markupPct ?? 0), icon: Percent, tone: 'text-indigo-600', note: 'Gross profit ÷ cost' },
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-green-600" />
            {TITLE}
          </CardTitle>
          <CardDescription>
            Daily sales, cost of goods sold and gross profit for the month, net of returns.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-2">
              <label htmlFor="gp-month" className="block text-sm font-medium">Month</label>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="icon" aria-label="Previous month" onClick={() => changeMonth(shiftMonth(month, -1))}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Input
                  id="gp-month"
                  type="month"
                  value={month}
                  onChange={(e) => changeMonth(e.target.value)}
                  className="w-[170px]"
                />
                <Button variant="outline" size="icon" aria-label="Next month" onClick={() => changeMonth(shiftMonth(month, 1))}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium">Source</label>
              <SalesSourceToggle
                value={sourceFilter}
                onChange={(v) => { setSourceFilter(v); fetchReport(month, v); }}
                className="h-10"
              />
            </div>

            <Button onClick={() => fetchReport()} disabled={isLoading}>
              {isLoading ? 'Loading...' : 'Show Report'}
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  disabled={isLoading || !hasData}
                  variant="outline"
                  className="border-green-600 text-green-600 hover:bg-green-50"
                >
                  <Download className="mr-2 h-4 w-4" />
                  Export
                  <ChevronDown className="ml-2 h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem onClick={handlePrint}>
                  <Printer className="mr-2 h-4 w-4" />
                  Print
                </DropdownMenuItem>
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
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {tiles.map((t) => (
          <Card key={t.label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{t.label}</CardTitle>
              <t.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className={cn('text-xl font-bold tabular-nums', t.tone)}>{t.value}</div>
              <p className="text-xs text-muted-foreground">{t.note ?? monthLabel}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>For the month of {monthLabel}</CardTitle>
          <CardDescription>
            Returns count on the day they were returned. Averages are per selling day
            (days with at least one sale), so days the store was closed or that
            haven&apos;t happened yet don&apos;t pull them down.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table className="w-full text-sm">
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="py-2 px-3">Date</TableHead>
                <TableHead className="py-2 px-3 text-right">Sales</TableHead>
                <TableHead className="py-2 px-3 text-right">Cost of Goods Sold</TableHead>
                <TableHead className="py-2 px-3 text-right">Gross Profit</TableHead>
                <TableHead className="py-2 px-3 text-right">Gross Profit Margin %</TableHead>
                <TableHead className="py-2 px-3 text-right">Markup on Cost %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && !report ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center">Loading...</TableCell>
                </TableRow>
              ) : (
                days.map((d) => {
                  const empty = d.sales === 0 && d.cost === 0;
                  return (
                    <TableRow
                      key={d.date}
                      className={cn(
                        'font-mono text-xs',
                        empty && 'text-muted-foreground',
                        d.date === todayStr && 'bg-green-50 dark:bg-green-950/40 font-semibold'
                      )}
                    >
                      <TableCell className="py-1.5 px-3">{format(localDate(d.date), 'MM/dd/yyyy')}</TableCell>
                      <TableCell className="py-1.5 px-3 text-right">{money(d.sales)}</TableCell>
                      <TableCell className="py-1.5 px-3 text-right">{money(d.cost)}</TableCell>
                      <TableCell className={cn('py-1.5 px-3 text-right', d.grossProfit < 0 && 'text-red-600')}>
                        {money(d.grossProfit)}
                      </TableCell>
                      <TableCell className="py-1.5 px-3 text-right">{empty ? '' : pct(d.marginPct)}</TableCell>
                      <TableCell className="py-1.5 px-3 text-right">{empty ? '' : pct(d.markupPct)}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
            {totals && avg && (
              <TableFooter>
                <TableRow className="font-mono text-xs font-bold">
                  <TableCell className="py-2 px-3 font-sans">Total</TableCell>
                  <TableCell className="py-2 px-3 text-right">{money(totals.sales)}</TableCell>
                  <TableCell className="py-2 px-3 text-right">{money(totals.cost)}</TableCell>
                  <TableCell className={cn('py-2 px-3 text-right', totals.grossProfit < 0 && 'text-red-600')}>
                    {money(totals.grossProfit)}
                  </TableCell>
                  <TableCell className="py-2 px-3 text-right">{pct(totals.marginPct)}</TableCell>
                  <TableCell className="py-2 px-3 text-right">{pct(totals.markupPct)}</TableCell>
                </TableRow>
                <TableRow className="font-mono text-xs font-bold">
                  <TableCell className="py-2 px-3 font-sans">Average per Day</TableCell>
                  <TableCell className="py-2 px-3 text-right">{money(avg.sales)}</TableCell>
                  <TableCell className="py-2 px-3 text-right">{money(avg.cost)}</TableCell>
                  <TableCell className="py-2 px-3 text-right">{money(avg.grossProfit)}</TableCell>
                  <TableCell className="py-2 px-3 text-right">{pct(totals.marginPct)}</TableCell>
                  <TableCell className="py-2 px-3 text-right">{pct(totals.markupPct)}</TableCell>
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
