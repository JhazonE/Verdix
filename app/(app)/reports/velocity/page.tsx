'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import { Loader2, TrendingUp, TrendingDown, Printer, MinusCircle, FileSpreadsheet } from 'lucide-react';
import { formatCurrency, formatQuantity } from '@/lib/utils';
import { format, subDays } from 'date-fns';
import { Button } from '@/components/ui/button';
import { ReportHeader } from '@/components/reports/ReportHeader';
import { getApiUrl } from '@/lib/api-config';
import { printReportTable, exportReportExcel } from '@/lib/report-print';
import { ReportSearchInput } from '@/components/reports/ReportSearchInput';
import { useToast } from '@/hooks/use-toast';

import { DataTablePagination } from '@/components/ui/data-table-pagination';

interface VelocityProduct {
  id: string;
  name: string;
  sku: string;
  barcode: string;
  category: string;
  stock: number;
  total_sold: number;
  total_revenue: number;
}

export default function FastSlowMovingReportPage() {
  const { toast } = useToast();
  const [products, setProducts] = useState<VelocityProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'fast' | 'slow' | 'none'>('fast');
  const [searchTerm, setSearchTerm] = useState('');

  // Default lookback 30 days
  const startDate = format(subDays(new Date(), 30), 'yyyy-MM-dd');
  const endDate = format(new Date(), 'yyyy-MM-dd');

  // Pagination State
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);

  const [isPrinting, setIsPrinting] = useState(false);

  const tabLabel = (t: string) => (t === 'fast' ? 'Fast Moving' : t === 'slow' ? 'Slow Moving' : 'None Moving');

  const handlePrint = async () => {
    setIsPrinting(true);
    try {
      const params = new URLSearchParams();
      params.append('type', activeTab);
      params.append('startDate', startDate);
      params.append('endDate', endDate);
      params.append('page', '1');
      params.append('limit', '100000');

      let rows: VelocityProduct[] = products;
      try {
        const res = await fetch(getApiUrl(`/reports/velocity?${params.toString()}`));
        const data = await res.json();
        if (data.success && Array.isArray(data.data)) rows = data.data;
      } catch {
        // fall back to the currently loaded page
      }

      printReportTable<VelocityProduct>({
        title: `Product Velocity Report — ${tabLabel(activeTab)}`,
        subtitle: 'Analysis of fast and slow moving products.',
        period: `${startDate} to ${endDate}`,
        columns: [
          { header: 'Barcode', cell: (p) => p.barcode || '-' },
          { header: 'Product Name', cell: (p) => p.name },
          { header: 'Category', cell: (p) => p.category },
          { header: 'Units Sold (30d)', align: 'right', emphasize: true, cell: (p) => p.total_sold },
          { header: 'Revenue Generated', align: 'right', cell: (p) => formatCurrency(p.total_revenue) },
          { header: 'Current Stock', align: 'right', cell: (p) => formatQuantity(p.stock) },
        ],
        rows,
        emptyMessage: 'No data available.',
      });
    } finally {
      setIsPrinting(false);
    }
  };

  const filteredProducts = products.filter((p) => {
    if (!searchTerm.trim()) return true;
    const search = searchTerm.toLowerCase();
    return (
      p.name?.toLowerCase().includes(search) ||
      p.barcode?.toLowerCase().includes(search)
    );
  });

  const exportToExcel = () => {
    const fileName = `Product_Velocity_${tabLabel(activeTab).replace(/\s+/g, '_')}_${format(new Date(startDate), 'yyyyMMdd')}.xls`;
    const ok = exportReportExcel<VelocityProduct>({
      title: `Product Velocity Report — ${tabLabel(activeTab)}`,
      subtitle: `${startDate} to ${endDate}`,
      columns: [
        { header: 'Barcode', cell: (p) => p.barcode || '-' },
        { header: 'Product Name', cell: (p) => p.name },
        { header: 'Category', cell: (p) => p.category },
        { header: 'Units Sold (30d)', align: 'right', cell: (p) => p.total_sold },
        { header: 'Revenue Generated', align: 'right', cell: (p) => p.total_revenue },
        { header: 'Current Stock', align: 'right', cell: (p) => p.stock },
      ],
      rows: filteredProducts,
      fileName,
    });
    if (!ok) {
      toast({ title: 'No Data', description: 'No data available to export.', variant: 'destructive' });
      return;
    }
    toast({ title: 'Excel Exported', description: `Report saved as ${fileName}` });
  };

  useEffect(() => {
    fetchData();
  }, [activeTab, page, pageSize]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.append('type', activeTab);
      params.append('startDate', startDate);
      params.append('endDate', endDate);
      params.append('page', page.toString());
      params.append('limit', pageSize.toString());

      const res = await fetch(getApiUrl(`/reports/velocity?${params.toString()}`));
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const data = await res.json();
      
      if (data.success) {
        setProducts(data.data);
        if (data.pagination) {
            setTotalPages(data.pagination.totalPages);
            setTotalItems(data.pagination.totalItems);
        }
      }

    } catch (error) {
      console.error('Failed to fetch velocity data:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Product Velocity Report</h2>
          <p className="text-muted-foreground">
            Analysis of fast and slow moving products over the last 30 days.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ReportSearchInput
            value={searchTerm}
            onChange={setSearchTerm}
            placeholder="Search product, barcode..."
          />
          <Button onClick={() => handlePrint()} variant="outline" className="gap-2" disabled={isPrinting}>
              {isPrinting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
              Print Report
          </Button>
          <Button
            onClick={exportToExcel}
            variant="outline"
            className="gap-2 border-emerald-700 text-emerald-700 hover:bg-emerald-50"
            disabled={filteredProducts.length === 0}
          >
            <FileSpreadsheet className="h-4 w-4" />
            Export to Excel
          </Button>
        </div>
      </div>

      <div>
        <ReportHeader 
            title="Product Velocity Report" 
            subtitle="Analysis of fast and slow moving products."
            period={`${startDate} to ${endDate}`}
        />

        <Tabs value={activeTab} onValueChange={(v) => {
            setActiveTab(v as 'fast' | 'slow' | 'none');
            setPage(1); // Reset page on tab change
        }} className="w-full">
          <TabsList className="grid w-full max-w-[600px] grid-cols-3 print:hidden">
            <TabsTrigger value="fast" className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Fast Moving
            </TabsTrigger>
            <TabsTrigger value="slow" className="flex items-center gap-2">
              <TrendingDown className="h-4 w-4" />
              Slow Moving
            </TabsTrigger>
            <TabsTrigger value="none" className="flex items-center gap-2">
              <MinusCircle className="h-4 w-4" />
              None Moving
            </TabsTrigger>
          </TabsList>
          
            <Card className="print:border-0 print:shadow-none bg-transparent border-0 shadow-none">
              <CardHeader className="print:px-0 px-0">
                <CardTitle>{activeTab === 'fast' ? 'Top Selling Products' : activeTab === 'slow' ? 'Slow Moving Products' : 'None Moving Products'}</CardTitle>
                <CardDescription>
                    {activeTab === 'fast' 
                        ? 'Highest turnover items in the last 30 days.' 
                        : activeTab === 'slow' ? 'Lowest turnover items in the last 30 days. Consider discounting.'
                        : 'Items with ZERO sales in the last 30 days.'}
                </CardDescription>
              </CardHeader>
              <CardContent className="print:px-0 px-0">
                <div className="rounded-md border mb-4 print:border-none print:overflow-visible">
                    <Table>
                    <TableHeader>
                        <TableRow>
                        <TableHead>Barcode</TableHead>
                        <TableHead>Product Name</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead className="text-right">Units Sold (30d)</TableHead>
                        <TableHead className="text-right">Revenue Generated</TableHead>
                        <TableHead className="text-right">Current Stock</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                        <TableRow>
                            <TableCell colSpan={6} className="h-24 text-center">
                            <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                            </TableCell>
                        </TableRow>
                        ) : filteredProducts.length === 0 ? (
                        <TableRow>
                            <TableCell colSpan={6} className="h-24 text-center">
                                No data available.
                            </TableCell>
                        </TableRow>
                        ) : (
                        filteredProducts.map((product, index) => (
                            <TableRow key={product.id}>
                            <TableCell className="font-medium text-muted-foreground">
                                {product.barcode || '-'}
                            </TableCell>
                            <TableCell className="font-medium">{product.name}</TableCell>
                            <TableCell>{product.category}</TableCell>
                            <TableCell className={`text-right font-bold ${activeTab === 'fast' ? 'text-green-600' : activeTab === 'slow' ? 'text-orange-600' : 'text-red-600'}`}>
                                {product.total_sold}
                            </TableCell>
                            <TableCell className="text-right">{formatCurrency(product.total_revenue)}</TableCell>
                            <TableCell className="text-right">{formatQuantity(product.stock)}</TableCell>
                            </TableRow>
                        ))
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
              </CardContent>
            </Card>
        </Tabs>
      </div>
    </div>
  );
}
