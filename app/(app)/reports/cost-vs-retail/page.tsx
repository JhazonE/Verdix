'use client';

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
  sku: string;
  barcode: string;
  category: string;
  brand: string;
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
  totalCostValue: number;
  totalRetailValue: number;
  totalProfit: number;
  marginPct: number;
}

const marginOf = (retail: number, profit: number) =>
  retail > 0 ? (profit / retail) * 100 : 0;

export default function CostVsRetailReportPage() {
  const { toast } = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [summary, setSummary] = useState<Summary>({
    totalItems: 0, totalCostValue: 0, totalRetailValue: 0, totalProfit: 0, marginPct: 0,
  });
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [settings, setSettings] = useState<any>(null);
  const [isPrinting, setIsPrinting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const filteredRows = rows.filter((r) => {
    if (!searchTerm.trim()) return true;
    const search = searchTerm.toLowerCase();
    return (
      r.name?.toLowerCase().includes(search) ||
      r.category?.toLowerCase().includes(search)
    );
  });

  useEffect(() => {
    fetchData();
  }, [selectedCategory, page, pageSize]);

  useEffect(() => {
    getCategories().then(setCategories).catch((e) => console.error('Failed to fetch categories:', e));
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

  const fetchData = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedCategory && selectedCategory !== 'all') params.append('category', selectedCategory);
      params.append('page', page.toString());
      params.append('limit', pageSize.toString());

      const res = await fetch(getApiUrl(`/reports/cost-vs-retail?${params.toString()}`));
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const data = await res.json();
      if (data.success) {
        setRows(data.data);
        setSummary(data.summary);
        if (data.pagination) {
          setTotalPages(data.pagination.totalPages);
          setTotalItems(data.pagination.totalItems);
        }
      }
    } catch (error) {
      console.error('Failed to fetch cost vs retail data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = async () => {
    setIsPrinting(true);
    try {
      const params = new URLSearchParams();
      if (selectedCategory && selectedCategory !== 'all') params.append('category', selectedCategory);
      params.append('page', '1');
      params.append('limit', '100000');

      let printRows: Row[] = rows;
      let printSummary: Summary = summary;
      try {
        const res = await fetch(getApiUrl(`/reports/cost-vs-retail?${params.toString()}`));
        const data = await res.json();
        if (data.success && Array.isArray(data.data)) {
          printRows = data.data;
          if (data.summary) printSummary = data.summary;
        }
      } catch {
        // fall back to the currently loaded page
      }

      printReportTable<Row>({
        title: 'Cost vs Retail Valuation',
        subtitle: 'Inventory value at cost vs selling price, with potential profit and margin.',
        business: settings || undefined,
        columns: [
          { header: 'Product Name', cell: (r) => r.name },
          { header: 'Category', cell: (r) => r.category },
          { header: 'Stock', align: 'right', cell: (r) => `${formatStockQuantity(r.stock)} ${r.unit_of_measure || ''}`.trim() },
          { header: 'Cost', align: 'right', cell: (r) => formatCurrency(r.cost) },
          { header: 'Price', align: 'right', cell: (r) => formatCurrency(r.price) },
          { header: 'Cost Value', align: 'right', cell: (r) => formatCurrency(r.cost_value) },
          { header: 'Retail Value', align: 'right', cell: (r) => formatCurrency(r.retail_value) },
          { header: 'Profit', align: 'right', emphasize: true, cell: (r) => formatCurrency(r.profit) },
          { header: 'Margin %', align: 'right', cell: (r) => `${marginOf(r.retail_value, r.profit).toFixed(1)}%` },
        ],
        rows: printRows,
        summary: [
          { label: 'Total Items', value: String(printSummary.totalItems) },
          { label: 'Total Cost Value', value: formatCurrency(printSummary.totalCostValue) },
          { label: 'Total Retail Value', value: formatCurrency(printSummary.totalRetailValue) },
          { label: 'Total Potential Profit', value: formatCurrency(printSummary.totalProfit) },
          { label: 'Overall Margin', value: `${printSummary.marginPct.toFixed(1)}%` },
        ],
        showSignature: true,
        emptyMessage: 'No products found.',
      });
    } finally {
      setIsPrinting(false);
    }
  };

  const [isExporting, setIsExporting] = useState(false);

  const exportToExcel = async () => {
    setIsExporting(true);
    try {
      const params = new URLSearchParams();
      if (selectedCategory && selectedCategory !== 'all') params.append('category', selectedCategory);
      params.append('page', '1');
      params.append('limit', '100000');

      let exportRows: Row[] = rows;
      try {
        const res = await fetch(getApiUrl(`/reports/cost-vs-retail?${params.toString()}`));
        const data = await res.json();
        if (data.success && Array.isArray(data.data)) {
          exportRows = data.data;
        }
      } catch {
        // fall back to the currently loaded page
      }

      const search = searchTerm.toLowerCase();
      const fullFilteredRows = exportRows.filter((r) => {
        if (!searchTerm.trim()) return true;
        return (
          r.name?.toLowerCase().includes(search) ||
          r.category?.toLowerCase().includes(search)
        );
      });

      const costValueSum = fullFilteredRows.reduce((s, r) => s + Number(r.cost_value), 0);
      const retailValueSum = fullFilteredRows.reduce((s, r) => s + Number(r.retail_value), 0);
      const profitSum = fullFilteredRows.reduce((s, r) => s + Number(r.profit), 0);
      const marginPct = retailValueSum > 0 ? ((profitSum / retailValueSum) * 100).toFixed(1) : '0.0';
      const fileName = `Cost_vs_Retail_${format(new Date(), 'yyyyMMdd')}.xls`;
      const ok = exportReportExcel<Row>({
        title: 'Cost vs Retail Valuation',
        subtitle: `Generated ${format(new Date(), 'yyyy-MM-dd')}`,
        columns: [
          { header: 'Product Name', cell: (r) => r.name },
          { header: 'Category', cell: (r) => r.category },
          { header: 'Stock', align: 'right', cell: (r) => `${formatStockQuantity(r.stock)} ${r.unit_of_measure || ''}`.trim() },
          { header: 'Cost', align: 'right', cell: (r) => r.cost },
          { header: 'Price', align: 'right', cell: (r) => r.price },
          { header: 'Cost Value', align: 'right', cell: (r) => r.cost_value },
          { header: 'Retail Value', align: 'right', cell: (r) => r.retail_value },
          { header: 'Profit', align: 'right', cell: (r) => r.profit },
          { header: 'Margin %', align: 'right', cell: (r) => `${marginOf(r.retail_value, r.profit).toFixed(1)}%` },
        ],
        rows: fullFilteredRows,
        totals: ['TOTALS', null, null, null, null, costValueSum.toFixed(2), retailValueSum.toFixed(2), profitSum.toFixed(2), `${marginPct}%`],
        fileName,
      });
      if (!ok) {
        toast({ title: 'No Data', description: 'No records to export.', variant: 'destructive' });
        return;
      }
      toast({ title: 'Excel Exported', description: `Report saved as ${fileName}` });
    } catch (error) {
      console.error('Failed to export cost vs retail to Excel:', error);
      toast({ title: 'Export Failed', description: 'Could not export the report. Please try again.', variant: 'destructive' });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Cost vs Retail Valuation</h2>
          <p className="text-muted-foreground">
            Inventory value at cost vs selling price, with potential profit and margin.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ReportSearchInput
            value={searchTerm}
            onChange={setSearchTerm}
            placeholder="Search product, category..."
          />
          <Button onClick={handlePrint} variant="outline" className="gap-2" disabled={isPrinting}>
            {isPrinting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
            Print Report
          </Button>
          <Button
            onClick={() => exportToExcel()}
            variant="outline"
            className="gap-2 border-emerald-700 text-emerald-700 hover:bg-emerald-50"
            disabled={isExporting || filteredRows.length === 0}
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

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Total Cost Value</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{formatCurrency(summary.totalCostValue)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Total Retail Value</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{formatCurrency(summary.totalRetailValue)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Potential Profit</CardTitle></CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${summary.totalProfit < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
              {formatCurrency(summary.totalProfit)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Overall Margin</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{summary.marginPct.toFixed(1)}%</div></CardContent>
        </Card>
      </div>

      <div className="bg-background p-4 rounded-md border">
        <ReportHeader
          title="Cost vs Retail Valuation"
          subtitle="Inventory value at cost vs selling price."
          businessName={settings?.businessName}
          address={settings?.address}
          contactNumber={settings?.contactNumber}
          tin={settings?.tin}
        />

        <div className="rounded-md border mb-4 print:border-none print:overflow-visible">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[280px]">Product Name</TableHead>
                <TableHead>Category</TableHead>
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
                <TableRow><TableCell colSpan={9} className="h-24 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></TableCell></TableRow>
              ) : filteredRows.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="h-24 text-center">No products found.</TableCell></TableRow>
              ) : (
                filteredRows.map((r) => {
                  const margin = marginOf(r.retail_value, r.profit);
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell>{r.category}</TableCell>
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
