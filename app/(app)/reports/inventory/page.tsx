'use client';

// Stock on Hand & Valuation. This page and Cost vs Retail used to be two
// reports over the same products, and they valued the same stock differently:
// this one from the remaining inventory batches, Cost vs Retail as stock × cost.
// They are now one report on the stock × cost basis (see
// app/api/reports/cost-vs-retail/route.ts); /reports/cost-vs-retail redirects
// here.

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Loader2, Printer, FileSpreadsheet } from 'lucide-react';
import { formatCurrency, formatStockQuantity } from '@/lib/utils';
import { ReportHeader } from '@/components/reports/ReportHeader';
import { getApiUrl } from '@/lib/api-config';
import { REPORT_FETCH_TIMEOUT_MS } from '@/lib/fetch-report';
import { printReportTable, exportReportExcel } from '@/lib/report-print';
import { DataTablePagination } from '@/components/ui/data-table-pagination';
import { getCategories } from '@/app/(app)/products/actions';
import { Category } from '@/lib/types';
import { ReportSearchInput } from '@/components/reports/ReportSearchInput';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';

interface Row {
  id: string;
  name: string;
  barcode: string;
  category: string;
  brand: string;
  warehouse_name: string | null;
  stock: number;
  unit_of_measure: string;
  cost: number;
  price: number;
  cost_value: number;
  retail_value: number;
  profit: number;
}

interface Summary {
  totalItems: number;
  totalStock: number;
  totalCostValue: number;
  totalRetailValue: number;
  totalProfit: number;
  marginPct: number;
}

const EMPTY_SUMMARY: Summary = {
  totalItems: 0, totalStock: 0, totalCostValue: 0, totalRetailValue: 0, totalProfit: 0, marginPct: 0,
};

const TITLE = 'Stock on Hand & Valuation';
const SUBTITLE = 'Current stock with its value at cost and at selling price, potential profit and margin.';

const marginOf = (retail: number, profit: number) =>
  retail > 0 ? (profit / retail) * 100 : 0;

export default function InventoryReportPage() {
  const { toast } = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [summary, setSummary] = useState<Summary>(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [settings, setSettings] = useState<any>(null);
  const [isPrinting, setIsPrinting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  // The search runs on the server (the table is paginated there), debounced so
  // each keystroke does not fire a query.
  const [search, setSearch] = useState('');

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchTerm.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchTerm]);

  const buildParams = (pageNum: number, limit: number) => {
    const params = new URLSearchParams();
    if (selectedCategory && selectedCategory !== 'all') params.append('category', selectedCategory);
    if (search) params.append('search', search);
    params.append('page', String(pageNum));
    params.append('limit', String(limit));
    return params;
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCategory, search, page, pageSize]);

  useEffect(() => {
    getCategories().then(setCategories).catch((e) => console.error('Failed to fetch categories:', e));
    (async () => {
      try {
        const res = await fetch(getApiUrl('/pos-settings'), { signal: AbortSignal.timeout(REPORT_FETCH_TIMEOUT_MS) });
        if (!res.ok) throw new Error(`API error ${res.status}`);
        const data = await res.json();
        if (data.success) setSettings(data.data);
      } catch (e) {
        console.error('Failed to fetch settings:', e);
      }
    })();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch(getApiUrl(`/reports/cost-vs-retail?${buildParams(page, pageSize).toString()}`), { signal: AbortSignal.timeout(REPORT_FETCH_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const data = await res.json();
      // A 200 carrying success:false is how this API reports its own errors.
      if (!data.success) {
        throw new Error(data.details || data.error || 'The report could not be generated.');
      }
      setRows(data.data);
      setSummary({ ...EMPTY_SUMMARY, ...data.summary });
      if (data.pagination) {
        setTotalPages(data.pagination.totalPages);
        setTotalItems(data.pagination.totalItems);
      }
    } catch (error) {
      console.error('Failed to fetch inventory valuation:', error);
      toast({ title: 'Error', description: 'Failed to load the inventory report. Please try again.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  // Print and export cover the whole filtered set, not just the visible page.
  const fetchAll = async (): Promise<{ rows: Row[]; summary: Summary } | null> => {
    try {
      const res = await fetch(getApiUrl(`/reports/cost-vs-retail?${buildParams(1, 100000).toString()}`), { signal: AbortSignal.timeout(REPORT_FETCH_TIMEOUT_MS) });
      const data = await res.json();
      if (data.success && Array.isArray(data.data)) {
        return { rows: data.data, summary: { ...EMPTY_SUMMARY, ...data.summary } };
      }
    } catch {
      // handled by the caller
    }
    return null;
  };

  const columnsFor = (money: (n: number) => string | number) => [
    { header: 'Product Name', cell: (r: Row) => r.name },
    { header: 'Barcode', cell: (r: Row) => r.barcode || '-' },
    { header: 'Category', cell: (r: Row) => r.category },
    { header: 'Warehouse', cell: (r: Row) => r.warehouse_name || '-' },
    { header: 'Stock', align: 'right' as const, cell: (r: Row) => `${formatStockQuantity(r.stock)} ${r.unit_of_measure || ''}`.trim() },
    { header: 'Cost', align: 'right' as const, cell: (r: Row) => money(r.cost) },
    { header: 'Price', align: 'right' as const, cell: (r: Row) => money(r.price) },
    { header: 'Cost Value', align: 'right' as const, cell: (r: Row) => money(r.cost_value) },
    { header: 'Retail Value', align: 'right' as const, cell: (r: Row) => money(r.retail_value) },
    { header: 'Profit', align: 'right' as const, cell: (r: Row) => money(r.profit) },
    { header: 'Margin %', align: 'right' as const, cell: (r: Row) => `${marginOf(r.retail_value, r.profit).toFixed(1)}%` },
  ];

  const handlePrint = async () => {
    setIsPrinting(true);
    try {
      const all = await fetchAll();
      if (!all) {
        toast({ title: 'Print Failed', description: 'Could not load the full report. Printing the visible page only.', variant: 'destructive' });
      }
      const printRows = all?.rows ?? rows;
      const s = all?.summary ?? summary;
      printReportTable<Row>({
        title: TITLE,
        subtitle: SUBTITLE,
        business: settings || undefined,
        columns: columnsFor((n) => formatCurrency(n)),
        rows: printRows,
        summary: [
          { label: 'Total Items', value: String(s.totalItems) },
          { label: 'Total Quantity', value: formatStockQuantity(s.totalStock) },
          { label: 'Total Cost Value', value: formatCurrency(s.totalCostValue) },
          { label: 'Total Retail Value', value: formatCurrency(s.totalRetailValue) },
          { label: 'Total Potential Profit', value: formatCurrency(s.totalProfit) },
          { label: 'Overall Margin', value: `${s.marginPct.toFixed(1)}%` },
        ],
        showSignature: true,
        emptyMessage: 'No products found.',
      });
    } finally {
      setIsPrinting(false);
    }
  };

  const exportToExcel = async () => {
    setIsExporting(true);
    try {
      const all = await fetchAll();
      if (!all) {
        toast({ title: 'Export Failed', description: 'Could not load the full report. Please try again.', variant: 'destructive' });
        return;
      }
      const s = all.summary;
      const fileName = `Stock_On_Hand_Valuation_${format(new Date(), 'yyyyMMdd')}.xls`;
      const ok = exportReportExcel<Row>({
        title: TITLE,
        subtitle: `Generated ${format(new Date(), 'yyyy-MM-dd')}`,
        columns: columnsFor((n) => n),
        rows: all.rows,
        totals: ['TOTALS', null, null, null, formatStockQuantity(s.totalStock), null, null, s.totalCostValue.toFixed(2), s.totalRetailValue.toFixed(2), s.totalProfit.toFixed(2), `${s.marginPct.toFixed(1)}%`],
        fileName,
      });
      if (!ok) {
        toast({ title: 'No Data', description: 'No records to export.', variant: 'destructive' });
        return;
      }
      toast({ title: 'Excel Exported', description: `Report saved as ${fileName}` });
    } catch (error) {
      console.error('Failed to export inventory to Excel:', error);
      toast({ title: 'Export Failed', description: 'Could not export the report. Please try again.', variant: 'destructive' });
    } finally {
      setIsExporting(false);
    }
  };

  const cards: { label: string; value: string; className?: string }[] = [
    { label: 'Total Items', value: summary.totalItems.toLocaleString() },
    { label: 'Total Quantity', value: formatStockQuantity(summary.totalStock) },
    { label: 'Total Cost Value', value: formatCurrency(summary.totalCostValue) },
    { label: 'Total Retail Value', value: formatCurrency(summary.totalRetailValue) },
    {
      label: 'Potential Profit',
      value: formatCurrency(summary.totalProfit),
      className: summary.totalProfit < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400',
    },
    { label: 'Overall Margin', value: `${summary.marginPct.toFixed(1)}%` },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">{TITLE}</h2>
          <p className="text-muted-foreground">{SUBTITLE}</p>
        </div>
        <div className="flex items-center gap-2">
          <ReportSearchInput
            value={searchTerm}
            onChange={setSearchTerm}
            placeholder="Search product, barcode, category, warehouse..."
          />
          <Button onClick={handlePrint} variant="outline" className="gap-2" disabled={isPrinting}>
            {isPrinting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
            Print Report
          </Button>
          <Button
            onClick={() => exportToExcel()}
            variant="outline"
            className="gap-2 border-emerald-700 text-emerald-700 hover:bg-emerald-50"
            disabled={isExporting || rows.length === 0}
          >
            {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
            Export to Excel
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="w-[200px]">
          <Select value={selectedCategory} onValueChange={(val) => { setSelectedCategory(val); setPage(1); }}>
            <SelectTrigger>
              <SelectValue placeholder="Filter by Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">{c.label}</CardTitle></CardHeader>
            <CardContent><div className={`text-2xl font-bold ${c.className ?? ''}`}>{c.value}</div></CardContent>
          </Card>
        ))}
      </div>

      <div className="bg-background p-4 rounded-md border">
        <ReportHeader
          title={TITLE}
          subtitle="Stock value at cost (stock × cost) and at selling price."
          businessName={settings?.businessName}
          address={settings?.address}
          contactNumber={settings?.contactNumber}
          tin={settings?.tin}
        />

        <div className="rounded-md border mb-4 print:border-none print:overflow-visible">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[260px]">Product Name</TableHead>
                <TableHead>Barcode</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Warehouse</TableHead>
                <TableHead className="text-right">Stock</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Cost Value</TableHead>
                <TableHead className="text-right">Retail Value</TableHead>
                <TableHead className="text-right">Profit</TableHead>
                <TableHead className="text-right">Margin %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={11} className="h-24 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={11} className="h-24 text-center">No products found.</TableCell></TableRow>
              ) : (
                rows.map((r) => {
                  const margin = marginOf(r.retail_value, r.profit);
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell className="text-muted-foreground">{r.barcode || '-'}</TableCell>
                      <TableCell>{r.category}</TableCell>
                      <TableCell className="text-muted-foreground">{r.warehouse_name || '-'}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">{formatStockQuantity(r.stock)} {r.unit_of_measure}</TableCell>
                      <TableCell className="text-right">{formatCurrency(r.cost)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(r.price)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(r.cost_value)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(r.retail_value)}</TableCell>
                      <TableCell className={`text-right font-medium ${r.profit < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                        {formatCurrency(r.profit)}
                      </TableCell>
                      <TableCell className="text-right">{margin.toFixed(1)}%</TableCell>
                    </TableRow>
                  );
                })
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
