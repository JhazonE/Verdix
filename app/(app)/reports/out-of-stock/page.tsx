'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Pagination, PaginationContent, PaginationItem, PaginationNext, PaginationPrevious,
} from '@/components/ui/pagination';
import { Loader2, Printer, PackageX, Search, X, FileSpreadsheet } from 'lucide-react';
import { format, formatDistanceToNowStrict } from 'date-fns';
import { ReportHeader } from '@/components/reports/ReportHeader';
import { getApiUrl } from '@/lib/api-config';
import { REPORT_FETCH_TIMEOUT_MS } from '@/lib/fetch-report';
import { formatStockQuantity } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { exportReportExcel } from '@/lib/report-print';

// Escape user-provided text before injecting into the print document.
function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface Product {
  id: string;
  name: string;
  barcode: string;
  category: string;
  brand: string;
  warehouse_name: string | null;
  stock: number;
  unit_of_measure: string;
  reorder_point: number;
  out_since: string | null;
  last_sold: string | null;
}

const TITLE = 'Out of Stock Report';
const SUBTITLE = 'Products with nothing left on hand.';

const fmtDate = (v: string | null) => (v ? format(new Date(v), 'MMM dd, yyyy') : '-');
const fmtAgo = (v: string | null) => (v ? formatDistanceToNowStrict(new Date(v), { addSuffix: true }) : '');
// Negative stock: more was sold than the system had on hand.
const statusOf = (p: Product) => (p.stock < 0 ? 'Oversold' : 'Out of Stock');

export default function OutOfStockReportPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState({ totalItems: 0, oversold: 0 });

  const [searchTerm, setSearchTerm] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [limit, setLimit] = useState(10);
  const [sort, setSort] = useState('recent_sale');
  // Never-stocked products are hidden by default: an imported catalogue is
  // mostly rows that were never stocked, and they would bury what ran out.
  const [includeNeverStocked, setIncludeNeverStocked] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const { toast } = useToast();

  const buildParams = (page: number, pageLimit: number) =>
    new URLSearchParams({
      page: String(page),
      limit: String(pageLimit),
      sort,
      ...(includeNeverStocked ? { includeNeverStocked: 'true' } : {}),
      ...(searchQuery ? { search: searchQuery } : {}),
    });

  // Every matching row, page by page, for print and Excel. Throws rather than
  // returning a partial list: falling back to the rows on screen, or stopping
  // at the API's per-request cap, exported an incomplete report as if whole.
  const EXPORT_PAGE = 5000;
  const fetchAll = async (): Promise<Product[]> => {
    const all: Product[] = [];
    for (let page = 1; ; page++) {
      const res = await fetch(getApiUrl(`/reports/out-of-stock?${buildParams(page, EXPORT_PAGE).toString()}`), {
        signal: AbortSignal.timeout(REPORT_FETCH_TIMEOUT_MS),
      });
      const data = await res.json();
      if (!res.ok || !data.success || !Array.isArray(data.data)) {
        throw new Error(data?.error || `API error ${res.status}`);
      }
      all.push(...data.data);
      const total = Number(data.pagination?.totalItems) || 0;
      if (all.length >= total || data.data.length === 0) return all;
    }
  };

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const res = await fetch(getApiUrl(`/reports/out-of-stock?${buildParams(currentPage, limit).toString()}`), {
          signal: AbortSignal.timeout(REPORT_FETCH_TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(`API error ${res.status}`);
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'The report could not be generated.');
        setProducts(data.data);
        setSummary(data.summary);
        setTotalPages(data.pagination.totalPages);
      } catch (error) {
        console.error('Failed to fetch out-of-stock data:', error);
        toast({ title: 'Error', description: 'Failed to load the out-of-stock report.', variant: 'destructive' });
      } finally {
        setLoading(false);
      }
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, searchQuery, limit, sort, includeNeverStocked]);

  const handlePrint = async () => {
    let rows: Product[];
    try {
      rows = await fetchAll();
    } catch (error) {
      console.error('Failed to load the full out-of-stock list for printing:', error);
      toast({ title: 'Print Failed', description: 'Could not load the full report. Please try again.', variant: 'destructive' });
      return;
    }
    const body = rows.length > 0
      ? rows.map((p) => `
          <tr>
            <td>${escapeHtml(p.name)}</td>
            <td>${escapeHtml(p.barcode || '-')}</td>
            <td>${escapeHtml(p.category || '-')}</td>
            <td>${escapeHtml(p.warehouse_name || '-')}</td>
            <td class="num stock">${escapeHtml(formatStockQuantity(p.stock))} ${escapeHtml(p.unit_of_measure || '')}</td>
            <td>${escapeHtml(fmtDate(p.out_since))}</td>
            <td>${escapeHtml(fmtDate(p.last_sold))}</td>
            <td class="status">${escapeHtml(statusOf(p))}</td>
          </tr>`).join('')
      : `<tr><td colspan="8" style="text-align:center;padding:24px;color:#16a34a;">No products are out of stock.</td></tr>`;

    const html = `<!DOCTYPE html><html><head><title>${TITLE}</title>
      <style>
        * { box-sizing: border-box; }
        body { font-family: Arial, Helvetica, sans-serif; color: #111; padding: 24px; }
        h1 { font-size: 20px; margin: 0 0 2px; }
        .sub { color: #666; font-size: 12px; margin: 0 0 16px; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; }
        th, td { border-bottom: 1px solid #ddd; padding: 8px 10px; text-align: left; }
        th { background: #f5f5f5; font-weight: bold; text-transform: uppercase; font-size: 10px; letter-spacing: .05em; }
        th.num, td.num { text-align: right; }
        td.stock { color: #dc2626; font-weight: 700; }
        td.status { text-align: right; color: #dc2626; font-weight: 600; }
        .meta { color: #888; font-size: 10px; margin-top: 16px; }
        @page { margin: 1cm; }
      </style></head>
      <body>
        <h1>${TITLE}</h1>
        <p class="sub">${SUBTITLE}${includeNeverStocked ? ' Includes products that were never stocked.' : ''}</p>
        <table>
          <thead><tr>
            <th>Product Name</th><th>Barcode</th><th>Category</th><th>Warehouse</th>
            <th class="num">Stock</th><th>Out Since</th><th>Last Sold</th><th class="num">Status</th>
          </tr></thead>
          <tbody>${body}</tbody>
        </table>
        <p class="meta">Generated: ${escapeHtml(format(new Date(), 'PPpp'))} &middot; ${rows.length} item(s)</p>
      </body></html>`;

    const printWindow = window.open('', '_blank', 'width=900,height=650');
    if (!printWindow) return;
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    printWindow.onload = () => printWindow.print();
    setTimeout(() => { try { printWindow.print(); } catch { /* noop */ } }, 300);
  };

  const exportToExcel = async () => {
    setIsExporting(true);
    try {
      const rows = await fetchAll();
      const fileName = `Out_of_Stock_Report_${format(new Date(), 'yyyyMMdd')}.xls`;
      const ok = exportReportExcel<Product>({
        title: TITLE,
        subtitle: `Generated ${format(new Date(), 'yyyy-MM-dd')}`,
        columns: [
          { header: 'Product Name', cell: (p) => p.name },
          { header: 'Barcode', cell: (p) => p.barcode || '-' },
          { header: 'Category', cell: (p) => p.category || '-' },
          { header: 'Warehouse', cell: (p) => p.warehouse_name || '-' },
          { header: 'Stock', align: 'right', cell: (p) => `${formatStockQuantity(p.stock)} ${p.unit_of_measure || ''}`.trim() },
          { header: 'Reorder Point', align: 'right', cell: (p) => formatStockQuantity(p.reorder_point) },
          { header: 'Out Since', cell: (p) => fmtDate(p.out_since) },
          { header: 'Last Sold', cell: (p) => fmtDate(p.last_sold) },
          { header: 'Status', cell: (p) => statusOf(p) },
        ],
        rows,
        fileName,
      });
      if (!ok) {
        toast({ title: 'No Data', description: 'No records to export.', variant: 'destructive' });
        return;
      }
      toast({ title: 'Excel Exported', description: `Report saved as ${fileName}` });
    } catch (error) {
      console.error('Failed to export out-of-stock report:', error);
      toast({ title: 'Export Failed', description: 'Could not export the report. Please try again.', variant: 'destructive' });
    } finally {
      setIsExporting(false);
    }
  };

  const handleSearch = () => { setSearchQuery(searchTerm); setCurrentPage(1); };
  const handleClearSearch = () => { setSearchTerm(''); setSearchQuery(''); setCurrentPage(1); };
  const handlePageChange = (page: number) => { if (page >= 1 && page <= totalPages) setCurrentPage(page); };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-red-600 flex items-center gap-2">
            <PackageX className="h-8 w-8" />
            {TITLE}
          </h2>
          <p className="text-muted-foreground">
            {SUBTITLE} Items that sold most recently are listed first.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={handlePrint} variant="outline" className="gap-2">
            <Printer className="h-4 w-4" />
            Print Report
          </Button>
          <Button
            onClick={exportToExcel}
            variant="outline"
            className="gap-2 border-emerald-700 text-emerald-700 hover:bg-emerald-50"
            disabled={isExporting || products.length === 0}
          >
            {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
            Export to Excel
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 non-printable">
        <div className="rounded-md border p-4">
          <p className="text-xs font-medium text-muted-foreground">Products out of stock</p>
          <p className="text-2xl font-bold text-red-600">{summary.totalItems}</p>
        </div>
        <div className="rounded-md border p-4">
          <p className="text-xs font-medium text-muted-foreground">Oversold (stock below zero)</p>
          <p className="text-2xl font-bold text-amber-600">{summary.oversold}</p>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-3 lg:items-center justify-between non-printable">
        <div className="flex flex-1 items-center gap-2 w-full lg:w-auto">
          <div className="relative flex-1 sm:max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search name or barcode..."
              className="pl-8"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
          </div>
          <Button onClick={handleSearch}>Search</Button>
          {(searchTerm || searchQuery) && (
            <Button variant="ghost" onClick={handleClearSearch} className="gap-2 text-muted-foreground">
              <X className="h-4 w-4" />
              Clear
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch
              id="include-never-stocked"
              checked={includeNeverStocked}
              onCheckedChange={(v) => { setIncludeNeverStocked(v); setCurrentPage(1); }}
            />
            <Label htmlFor="include-never-stocked" className="text-sm whitespace-nowrap">
              Include never-stocked products
            </Label>
          </div>
          <Select value={sort} onValueChange={(v) => { setSort(v); setCurrentPage(1); }}>
            <SelectTrigger className="w-[200px]" aria-label="Sort by">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recent_sale">Most recently sold</SelectItem>
              <SelectItem value="out_newest">Newly out of stock</SelectItem>
              <SelectItem value="out_longest">Out the longest</SelectItem>
              <SelectItem value="name">Product name</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="bg-background p-4 rounded-md border">
        <ReportHeader title={TITLE} subtitle={SUBTITLE} />

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product Name</TableHead>
                <TableHead>Barcode</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Warehouse</TableHead>
                <TableHead className="text-right">Stock</TableHead>
                <TableHead>Out Since</TableHead>
                <TableHead>Last Sold</TableHead>
                <TableHead className="text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                  </TableCell>
                </TableRow>
              ) : products.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center text-green-600 font-medium">
                    {searchQuery ? 'No out-of-stock products match your search.' : 'Good news! No products are out of stock.'}
                  </TableCell>
                </TableRow>
              ) : (
                products.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell>{p.barcode || '-'}</TableCell>
                    <TableCell>{p.category || '-'}</TableCell>
                    <TableCell className="text-muted-foreground">{p.warehouse_name || '-'}</TableCell>
                    <TableCell className="text-right font-bold text-red-600 whitespace-nowrap">
                      {formatStockQuantity(p.stock)} {p.unit_of_measure}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {p.out_since ? (
                        <div className="flex flex-col">
                          <span>{fmtDate(p.out_since)}</span>
                          <span className="text-xs text-muted-foreground">{fmtAgo(p.out_since)}</span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">Never stocked</span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {p.last_sold ? (
                        <div className="flex flex-col">
                          <span>{fmtDate(p.last_sold)}</span>
                          <span className="text-xs text-muted-foreground">{fmtAgo(p.last_sold)}</span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">Never sold</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge
                        variant={p.stock < 0 ? 'outline' : 'destructive'}
                        className={p.stock < 0 ? 'border-amber-600 text-amber-700' : undefined}
                        title={p.stock < 0 ? 'More was sold than the system had on hand.' : undefined}
                      >
                        {statusOf(p)}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {!loading && products.length > 0 && (
          <div className="mt-4 flex flex-col sm:flex-row items-center justify-between gap-4 non-printable pt-4 border-t">
            <div className="flex items-center gap-2 order-2 sm:order-1">
              <Label htmlFor="rows-per-page" className="text-xs text-muted-foreground whitespace-nowrap">Rows per page</Label>
              <Select value={limit.toString()} onValueChange={(v) => { setLimit(Number(v)); setCurrentPage(1); }}>
                <SelectTrigger id="rows-per-page" className="h-8 w-[70px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="20">20</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="order-1 sm:order-2">
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      onClick={() => handlePageChange(currentPage - 1)}
                      className={currentPage === 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                    />
                  </PaginationItem>
                  <PaginationItem>
                    <span className="text-sm text-muted-foreground px-4">Page {currentPage} of {totalPages}</span>
                  </PaginationItem>
                  <PaginationItem>
                    <PaginationNext
                      onClick={() => handlePageChange(currentPage + 1)}
                      className={currentPage === totalPages ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
