'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from '@/components/ui/badge';
import { Loader2, Printer } from 'lucide-react';
import { formatCurrency, formatQuantity, formatStockQuantity } from '@/lib/utils';
import { ReportHeader } from '@/components/reports/ReportHeader';
import { getApiUrl } from '@/lib/api-config';
import { printReportTable } from '@/lib/report-print';

import { DataTablePagination } from '@/components/ui/data-table-pagination';
import { getCategories } from '@/app/(app)/products/actions';
import { Category } from '@/lib/types';

interface Product {
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
  reorder_point: number;
  total_value: number;
}

interface Summary {
  totalItems: number;
  totalStock: number;
  totalValue: number;
}

interface PaginationState {
    page: number;
    limit: number;
    totalItems: number;
    totalPages: number;
}

export default function InventoryReportPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [summary, setSummary] = useState<Summary>({ totalItems: 0, totalStock: 0, totalValue: 0 });
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  
  // Pagination State
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [settings, setSettings] = useState<any>(null);

  const [isPrinting, setIsPrinting] = useState(false);

  const handlePrint = async () => {
    setIsPrinting(true);
    try {
      const params = new URLSearchParams();
      if (selectedCategory && selectedCategory !== 'all') params.append('category', selectedCategory);
      params.append('page', '1');
      params.append('limit', '100000');

      let rows: Product[] = products;
      let printSummary: Summary = summary;
      try {
        const res = await fetch(getApiUrl(`/reports/inventory?${params.toString()}`));
        const data = await res.json();
        if (data.success && Array.isArray(data.data)) {
          rows = data.data;
          if (data.summary) printSummary = data.summary;
        }
      } catch {
        // fall back to the currently loaded page
      }

      printReportTable<Product>({
        title: 'Stock on Hand Report',
        subtitle: 'Current inventory levels and valuation (based on batch-level FIFO costs).',
        business: settings || undefined,
        columns: [
          { header: 'Product Name', cell: (p) => p.name },
          { header: 'Barcode', cell: (p) => p.barcode || '-' },
          { header: 'Category', cell: (p) => p.category },
          { header: 'Cost', align: 'right', cell: (p) => formatCurrency(p.cost) },
          { header: 'Price', align: 'right', cell: (p) => formatCurrency(p.price) },
          { header: 'Stock', align: 'right', cell: (p) => `${formatStockQuantity(p.stock)} ${p.unit_of_measure || ''}`.trim() },
          { header: 'Total Value', align: 'right', emphasize: true, cell: (p) => formatCurrency(p.total_value) },
        ],
        rows,
        summary: [
          { label: 'Total Items', value: String(printSummary.totalItems) },
          { label: 'Total Quantity', value: formatStockQuantity(printSummary.totalStock) },
          { label: 'Total Value (Avg Cost)', value: formatCurrency(printSummary.totalValue) },
        ],
        showSignature: true,
        emptyMessage: 'No products found.',
      });
    } finally {
      setIsPrinting(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [selectedCategory, page, pageSize]);
  
  // Separate effect to fetch categories only once on mount
  useEffect(() => {
    const fetchCategories = async () => {
        try {
            const data = await getCategories();
            setCategories(data);
        } catch (error) {
            console.error('Failed to fetch categories:', error);
        }
    };
    fetchCategories();

    const fetchSettings = async () => {
        try {
            const res = await fetch(getApiUrl('/pos-settings'));
            if (!res.ok) throw new Error(`API error ${res.status}`);
            const data = await res.json();
            if (data.success) {
                setSettings(data.data);
            }
        } catch (error) {
            console.error('Failed to fetch settings:', error);
        }
    };
    fetchSettings();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedCategory && selectedCategory !== 'all') {
        params.append('category', selectedCategory);
      }
      params.append('page', page.toString());
      params.append('limit', pageSize.toString());
      
      const res = await fetch(getApiUrl(`/reports/inventory?${params.toString()}`));
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const data = await res.json();
      
      if (data.success) {
        setProducts(data.data);
        setSummary(data.summary);
        
        if (data.pagination) {
            setTotalPages(data.pagination.totalPages);
            setTotalItems(data.pagination.totalItems);
        }
      }
    } catch (error) {
      console.error('Failed to fetch inventory data:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Stock on Hand Report</h2>
          <p className="text-muted-foreground">
            Current inventory levels and valuation (based on batch-level FIFO costs).
          </p>
        </div>
        <Button onClick={() => handlePrint()} variant="outline" className="gap-2" disabled={isPrinting}>
            {isPrinting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
            Print Report
        </Button>
      </div>

      <div className="flex items-center gap-4">
        <div className="w-[200px]">
            <Select value={selectedCategory} onValueChange={(val) => {
                setSelectedCategory(val);
                setPage(1); // Reset to first page on filter change
            }}>
                <SelectTrigger>
                    <SelectValue placeholder="Filter by Category" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">All Categories</SelectItem>
                    {categories.map((category) => (
                        <SelectItem key={category.id} value={category.name}>
                            {category.name}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Items</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.totalItems}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Quantity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatStockQuantity(summary.totalStock)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Value (Avg Cost)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(summary.totalValue)}</div>
          </CardContent>
        </Card>
      </div>

      {/* Report table */}
      <div className="bg-background p-4 rounded-md border">
          <ReportHeader 
            title="Stock on Hand Report" 
            subtitle="Current inventory levels and valuation." 
            businessName={settings?.businessName}
            address={settings?.address}
            contactNumber={settings?.contactNumber}
            tin={settings?.tin}
          />
          
          <div className="rounded-md border mb-4 print:border-none print:overflow-visible">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[300px]">Product Name</TableHead>
                    <TableHead>Barcode</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="text-right">Stock</TableHead>
                    <TableHead className="text-right">Total Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={7} className="h-24 text-center">
                        <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                      </TableCell>
                    </TableRow>
                  ) : products.length === 0 ? (
                    <TableRow>
                        <TableCell colSpan={7} className="h-24 text-center">
                            No products found.
                        </TableCell>
                    </TableRow>
                  ) : (
                    products.map((product) => (
                      <TableRow key={product.id}>
                        <TableCell className="font-medium">
                            {product.name}
                            {product.stock <= Math.max(product.reorder_point, settings?.lowStockThreshold || 0) && (
                                <Badge variant="destructive" className="ml-2 print:hidden">Low Stock</Badge>
                            )}
                        </TableCell>
                        <TableCell>{product.barcode || '-'}</TableCell>
                        <TableCell>{product.category}</TableCell>
                        <TableCell className="text-right">{formatCurrency(product.cost)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(product.price)}</TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                            {formatStockQuantity(product.stock)} {product.unit_of_measure}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                            {formatCurrency(product.total_value)}
                        </TableCell>
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

          {/* Footer Summary for Print */}
          {!loading && (
             <div className="mt-12 border-t-2 border-slate-200 pt-6 flex justify-between items-start print:flex hidden">
                 <div className="space-y-1">
                     <p className="text-[10px] uppercase font-bold tracking-widest text-slate-500">Report Summary</p>
                     <div className="flex gap-8">
                        <div>
                            <p className="text-xs text-slate-500">Total Unique Items</p>
                            <p className="text-xl font-black text-slate-900">{summary.totalItems}</p>
                        </div>
                        <div>
                            <p className="text-xs text-slate-500">Total Stock Quantity</p>
                            <p className="text-xl font-black text-slate-900">{formatStockQuantity(summary.totalStock)}</p>
                        </div>
                     </div>
                 </div>
                 <div className="text-right p-4 bg-slate-50 rounded-xl border border-slate-100">
                     <p className="text-[10px] uppercase font-bold tracking-widest text-slate-500 mb-1">Total Inventory Value</p>
                     <p className="text-3xl font-black text-primary leading-none">{formatCurrency(summary.totalValue)}</p>
                     <p className="text-[10px] text-slate-400 mt-2 italic">Based on average cost calculation</p>
                 </div>
             </div>
          )}
          
          <div className="mt-20 pt-8 border-t border-slate-100 flex justify-between items-end print:flex hidden text-[10px] text-slate-400 uppercase tracking-widest">
              <div>
                  <p>Authorized Signature: ___________________________</p>
              </div>
              <div className="text-right">
                  <p>Page 1 of 1</p>
                  <p className="mt-1 font-bold text-primary/40">Powered by Vendix</p>
              </div>
          </div>
      </div>
    </div>
  );
}
