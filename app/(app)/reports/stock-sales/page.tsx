'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Loader2, Printer, FileSpreadsheet, X } from 'lucide-react';
import { formatCurrency, formatStockQuantity } from '@/lib/utils';
import { ReportHeader } from '@/components/reports/ReportHeader';
import { ReportSearchInput } from '@/components/reports/ReportSearchInput';
import { getApiUrl } from '@/lib/api-config';
import { printReportTable, exportReportExcel } from '@/lib/report-print';
import { DataTablePagination } from '@/components/ui/data-table-pagination';
import { getCategories, getBrands, getSuppliers } from '@/app/(app)/products/actions';
import { Category, Supplier } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { PRODUCT_SEARCH_DEBOUNCE_MS } from '@/lib/product-search';
import { format, startOfMonth } from 'date-fns';

interface Row {
  id: string;
  name: string;
  barcode: string;
  category: string;
  brand: string;
  unit_of_measure: string;
  /** Net of returns, in base units. */
  qty_sold: number;
  /** Returned quantity as a positive number, in base units. */
  qty_returned: number;
  /** Stock right now — not an as-of-date figure. */
  qty_remaining: number;
  revenue: number;
  remaining_value: number;
}

interface Summary {
  totalProducts: number;
  totalSold: number;
  totalReturned: number;
  totalRemaining: number;
  totalRevenue: number;
  totalRemainingValue: number;
}

interface Brand {
  id: string;
  name: string;
}

const EMPTY_SUMMARY: Summary = {
  totalProducts: 0,
  totalSold: 0,
  totalReturned: 0,
  totalRemaining: 0,
  totalRevenue: 0,
  totalRemainingValue: 0,
};

const REPORT_TITLE = 'Stock & Sales Summary';
const REPORT_SUBTITLE = 'Quantity sold in the period against stock remaining on hand.';

/**
 * How many rows Print and Export pull. Both must show the whole filtered set,
 * not the page on screen — a printout of 10 rows labelled with a period total
 * is worse than no printout. The catalogue is ~16,000 products and this report
 * only returns ones that moved, so this ceiling is far above any real result.
 */
const FULL_EXPORT_LIMIT = 100000;

export default function StockSalesReportPage() {
  const { toast } = useToast();

  const [rows, setRows] = useState<Row[]>([]);
  const [summary, setSummary] = useState<Summary>(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(true);

  const [startDate, setStartDate] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedBrand, setSelectedBrand] = useState('all');
  const [selectedSupplier, setSelectedSupplier] = useState('all');
  /**
   * Empty means "stock as it stands right now". A date means stock
   * reconstructed as of the end of that day, from the movement log.
   */
  const [asOfDate, setAsOfDate] = useState('');
  const [sort, setSort] = useState('sold_desc');
  const [searchTerm, setSearchTerm] = useState('');

  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [settings, setSettings] = useState<any>(null);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);

  const [isPrinting, setIsPrinting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // Searching is done by the SERVER (see the debounced refetch below), across
  // the whole catalogue rather than the loaded page — the table, the summary
  // tiles and the pagination then all describe the same set.
  //
  // `rows` is therefore already the answer and is rendered as-is. An extra
  // client-side filter here would be worse than redundant: it re-checks fewer
  // columns than the SQL does, so it would hide rows the server legitimately
  // matched while the tiles still counted them.
  const filteredRows = rows;

  const buildParams = (limit: number, pageNum: number) => {
    const params = new URLSearchParams();
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);
    if (selectedCategory !== 'all') params.append('category', selectedCategory);
    if (selectedBrand !== 'all') params.append('brand', selectedBrand);
    if (selectedSupplier !== 'all') params.append('supplier', selectedSupplier);
    if (asOfDate) params.append('asOfDate', asOfDate);
    if (searchTerm.trim()) params.append('search', searchTerm.trim());
    params.append('sort', sort);
    params.append('page', String(pageNum));
    params.append('limit', String(limit));
    return params;
  };

  useEffect(() => {
    getCategories().then(setCategories).catch((e) => console.error('Failed to fetch categories:', e));
    getBrands().then(setBrands).catch((e) => console.error('Failed to fetch brands:', e));
    getSuppliers().then(setSuppliers).catch((e) => console.error('Failed to fetch suppliers:', e));
    (async () => {
      try {
        const res = await fetch(getApiUrl('/pos-settings'));
        if (!res.ok) throw new Error(`API error ${res.status}`);
        const data = await res.json();
        if (data.success) setSettings(data.data);
      } catch (e) {
        console.error('Failed to fetch settings:', e);
      }
    })();
  }, []);

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate, selectedCategory, selectedBrand, selectedSupplier, asOfDate, sort, page, pageSize]);

  // The search term drives a SERVER-side filter, so it needs its own refetch —
  // without one, the summary tiles and pagination keep describing the
  // unsearched set while the table filters the stale page down to nothing.
  // Debounced because a barcode scanner types a whole code in milliseconds.
  useEffect(() => {
    const t = setTimeout(() => { fetchData(); }, PRODUCT_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch(getApiUrl(`/reports/stock-sales?${buildParams(pageSize, page).toString()}`));
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const data = await res.json();
      if (data.success) {
        setRows(data.data);
        setSummary(data.summary || EMPTY_SUMMARY);
        if (data.pagination) {
          setTotalPages(data.pagination.totalPages);
          setTotalItems(data.pagination.totalItems);
        }
      }
    } catch (error) {
      console.error('Failed to fetch stock & sales summary:', error);
    } finally {
      setLoading(false);
    }
  };

  /** Fetch the whole filtered set for Print/Export, falling back to the page. */
  const fetchAllRows = async (): Promise<{ rows: Row[]; summary: Summary }> => {
    try {
      const res = await fetch(getApiUrl(`/reports/stock-sales?${buildParams(FULL_EXPORT_LIMIT, 1).toString()}`));
      const data = await res.json();
      if (data.success && Array.isArray(data.data)) {
        return { rows: data.data, summary: data.summary || summary };
      }
    } catch {
      // fall back to the currently loaded page
    }
    return { rows, summary };
  };

  const periodLabel = `${startDate} to ${endDate}`;

  // The remaining figure means two different things depending on `asOfDate`,
  // so it is labelled differently everywhere it appears. A printed report that
  // just said "Remaining" would be read as current stock whatever it showed.
  const remainingLabel = asOfDate ? `Remaining as of ${asOfDate}` : 'Remaining';
  const remainingValueLabel = asOfDate ? `Value as of ${asOfDate}` : 'Remaining Value';
  const periodWithAsOf = asOfDate
    ? `${periodLabel} · stock as of ${asOfDate}`
    : periodLabel;

  const handlePrint = async () => {
    setIsPrinting(true);
    try {
      // Already filtered by the server: `fetchAllRows` sends the same search
      // and filter parameters the screen is showing, just without the page
      // limit, so what prints is exactly the full set behind the table.
      const all = await fetchAllRows();
      const printRows = all.rows;

      printReportTable<Row>({
        title: REPORT_TITLE,
        subtitle: REPORT_SUBTITLE,
        period: periodWithAsOf,
        business: settings || undefined,
        columns: [
          { header: 'Barcode', cell: (r) => r.barcode || '-' },
          { header: 'Product Name', cell: (r) => r.name },
          { header: 'Category', cell: (r) => r.category || '-' },
          { header: 'Sold', align: 'right', emphasize: true, cell: (r) => formatStockQuantity(r.qty_sold) },
          { header: 'Returned', align: 'right', cell: (r) => formatStockQuantity(r.qty_returned) },
          { header: remainingLabel, align: 'right', emphasize: true, cell: (r) => `${formatStockQuantity(r.qty_remaining)} ${r.unit_of_measure || ''}`.trim() },
          { header: 'Sales', align: 'right', cell: (r) => formatCurrency(r.revenue) },
          { header: remainingValueLabel, align: 'right', cell: (r) => formatCurrency(r.remaining_value) },
        ],
        rows: printRows,
        summary: [
          { label: 'Products Sold', value: String(all.summary.totalProducts) },
          { label: 'Total Qty Sold', value: formatStockQuantity(all.summary.totalSold) },
          { label: 'Total Qty Returned', value: formatStockQuantity(all.summary.totalReturned) },
          { label: 'Total Sales', value: formatCurrency(all.summary.totalRevenue) },
          { label: asOfDate ? `Total ${remainingValueLabel}` : 'Total Remaining Value', value: formatCurrency(all.summary.totalRemainingValue) },
        ],
        showSignature: true,
        emptyMessage: 'No products were sold in this period.',
      });
    } finally {
      setIsPrinting(false);
    }
  };

  const exportToExcel = async () => {
    setIsExporting(true);
    try {
      const all = await fetchAllRows();
      const exportRows = all.rows;

      // Totals are summed over the exported rows rather than reused from the
      // API summary, so the TOTALS line can never disagree with the rows
      // printed above it even if the two were fetched a moment apart.
      const soldSum = exportRows.reduce((s, r) => s + Number(r.qty_sold), 0);
      const returnedSum = exportRows.reduce((s, r) => s + Number(r.qty_returned), 0);
      const remainingSum = exportRows.reduce((s, r) => s + Number(r.qty_remaining), 0);
      const revenueSum = exportRows.reduce((s, r) => s + Number(r.revenue), 0);
      const remainingValueSum = exportRows.reduce((s, r) => s + Number(r.remaining_value), 0);

      const fileName = `Stock_and_Sales_${format(new Date(startDate), 'yyyyMMdd')}_${format(new Date(endDate), 'yyyyMMdd')}${asOfDate ? `_asof_${format(new Date(asOfDate), 'yyyyMMdd')}` : ''}.xls`;
      const ok = exportReportExcel<Row>({
        title: REPORT_TITLE,
        subtitle: periodWithAsOf,
        columns: [
          { header: 'Barcode', cell: (r) => r.barcode || '-' },
          { header: 'Product Name', cell: (r) => r.name },
          { header: 'Category', cell: (r) => r.category || '-' },
          { header: 'Brand', cell: (r) => r.brand || '-' },
          { header: 'Unit', cell: (r) => r.unit_of_measure || '-' },
          { header: 'Sold', align: 'right', cell: (r) => r.qty_sold },
          { header: 'Returned', align: 'right', cell: (r) => r.qty_returned },
          { header: remainingLabel, align: 'right', cell: (r) => r.qty_remaining },
          { header: 'Sales', align: 'right', cell: (r) => r.revenue },
          { header: remainingValueLabel, align: 'right', cell: (r) => r.remaining_value },
        ],
        rows: exportRows,
        totals: [
          'TOTALS', null, null, null, null,
          soldSum,
          returnedSum,
          remainingSum,
          revenueSum.toFixed(2),
          remainingValueSum.toFixed(2),
        ],
        fileName,
      });
      if (!ok) {
        toast({ title: 'No Data', description: 'No records to export.', variant: 'destructive' });
        return;
      }
      toast({ title: 'Excel Exported', description: `Report saved as ${fileName}` });
    } catch (error) {
      console.error('Failed to export stock & sales summary to Excel:', error);
      toast({ title: 'Export Failed', description: 'Could not export the report. Please try again.', variant: 'destructive' });
    } finally {
      setIsExporting(false);
    }
  };

  const resetPage = () => setPage(1);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">{REPORT_TITLE}</h2>
          <p className="text-muted-foreground">
            How much of each product sold in the period, and how much is left on hand.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ReportSearchInput
            value={searchTerm}
            onChange={(v) => { setSearchTerm(v); resetPage(); }}
            placeholder="Search product, barcode..."
          />
          <Button onClick={handlePrint} variant="outline" className="gap-2" disabled={isPrinting}>
            {isPrinting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
            Print Report
          </Button>
          <Button
            onClick={exportToExcel}
            variant="outline"
            className="gap-2 border-emerald-700 text-emerald-700 hover:bg-emerald-50"
            disabled={isExporting || filteredRows.length === 0}
          >
            {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
            Export to Excel
          </Button>
        </div>
      </div>

      <Card className="print:hidden">
        <CardHeader>
          <div className="flex flex-wrap gap-4 items-end">
            <div className="grid gap-2">
              <label className="text-sm font-medium">Start Date</label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => { setStartDate(e.target.value); resetPage(); }}
                className="w-[180px]"
              />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium">End Date</label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => { setEndDate(e.target.value); resetPage(); }}
                className="w-[180px]"
              />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium">Category</label>
              <Select value={selectedCategory} onValueChange={(v) => { setSelectedCategory(v); resetPage(); }}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="All Categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium">Brand</label>
              <Select value={selectedBrand} onValueChange={(v) => { setSelectedBrand(v); resetPage(); }}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="All Brands" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Brands</SelectItem>
                  {brands.map((b) => (
                    <SelectItem key={b.id} value={b.name}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium">Supplier</label>
              <Select value={selectedSupplier} onValueChange={(v) => { setSelectedSupplier(v); resetPage(); }}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="All Suppliers" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Suppliers</SelectItem>
                  {suppliers.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium">
                Stock As Of
                <span className="ml-1 font-normal text-muted-foreground">(blank = now)</span>
              </label>
              <div className="flex items-center gap-1">
                <Input
                  type="date"
                  value={asOfDate}
                  onChange={(e) => { setAsOfDate(e.target.value); resetPage(); }}
                  className="w-[150px]"
                />
                {asOfDate && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 shrink-0"
                    title="Back to current stock"
                    onClick={() => { setAsOfDate(''); resetPage(); }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium">Sort By</label>
              <Select value={sort} onValueChange={(v) => { setSort(v); resetPage(); }}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sold_desc">Most Sold</SelectItem>
                  <SelectItem value="sold_asc">Least Sold</SelectItem>
                  <SelectItem value="remaining_desc">Most Remaining</SelectItem>
                  <SelectItem value="remaining_asc">Least Remaining</SelectItem>
                  <SelectItem value="revenue_desc">Highest Sales</SelectItem>
                  <SelectItem value="name_asc">Product Name</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
      </Card>

      <div className="grid gap-4 md:grid-cols-4 print:hidden">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Products Sold</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{summary.totalProducts}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Total Qty Sold</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{formatStockQuantity(summary.totalSold)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Total Sales</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{formatCurrency(summary.totalRevenue)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">{asOfDate ? `Stock Value as of ${asOfDate}` : 'Remaining Stock Value'}</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{formatCurrency(summary.totalRemainingValue)}</div></CardContent>
        </Card>
      </div>

      <div className="bg-background p-4 rounded-md border">
        <ReportHeader
          title={REPORT_TITLE}
          subtitle={REPORT_SUBTITLE}
          period={periodWithAsOf}
          businessName={settings?.businessName}
          address={settings?.address}
          contactNumber={settings?.contactNumber}
          tin={settings?.tin}
        />

        <div className="rounded-md border mb-4 print:border-none print:overflow-visible">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Barcode</TableHead>
                <TableHead className="w-[280px]">Product Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Sold</TableHead>
                <TableHead className="text-right">Returned</TableHead>
                <TableHead className="text-right">{remainingLabel}</TableHead>
                <TableHead className="text-right">Sales</TableHead>
                <TableHead className="text-right">{remainingValueLabel}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                  </TableCell>
                </TableRow>
              ) : filteredRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center">
                    No products were sold in this period.
                  </TableCell>
                </TableRow>
              ) : (
                filteredRows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium text-muted-foreground">{r.barcode || '-'}</TableCell>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell>{r.category || '-'}</TableCell>
                    <TableCell className="text-right font-bold text-emerald-600 dark:text-emerald-400">
                      {formatStockQuantity(r.qty_sold)}
                    </TableCell>
                    <TableCell className={`text-right ${r.qty_returned > 0 ? 'text-orange-600 dark:text-orange-400' : 'text-muted-foreground'}`}>
                      {formatStockQuantity(r.qty_returned)}
                    </TableCell>
                    <TableCell className="text-right font-bold">
                      {`${formatStockQuantity(r.qty_remaining)} ${r.unit_of_measure || ''}`.trim()}
                    </TableCell>
                    <TableCell className="text-right">{formatCurrency(r.revenue)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(r.remaining_value)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
            {!loading && filteredRows.length > 0 && (
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={3} className="font-bold">
                    TOTALS ({summary.totalProducts} products)
                  </TableCell>
                  <TableCell className="text-right font-bold">{formatStockQuantity(summary.totalSold)}</TableCell>
                  <TableCell className="text-right font-bold">{formatStockQuantity(summary.totalReturned)}</TableCell>
                  <TableCell className="text-right font-bold">{formatStockQuantity(summary.totalRemaining)}</TableCell>
                  <TableCell className="text-right font-bold">{formatCurrency(summary.totalRevenue)}</TableCell>
                  <TableCell className="text-right font-bold">{formatCurrency(summary.totalRemainingValue)}</TableCell>
                </TableRow>
              </TableFooter>
            )}
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
