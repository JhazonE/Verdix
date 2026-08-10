'use client';

import { useState, useEffect } from 'react';
import {
  Table,
  TableBody,
  TableCell,
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
import { CalendarIcon, FileDown, FileSpreadsheet, Package2, TrendingUp, Search, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { getApiUrl } from '@/lib/api-config';
import { exportReportPdf, exportReportExcel } from '@/lib/report-print';

interface ProductSale {
  product: {
    id: string;
    name: string;
    sku: string;
    barcode: string;
    category: string;
    brand: string;
    unitOfMeasure: string;
  };
  unitsSold: number;
  totalRevenue: number;
  totalDiscount: number;
  totalCost: number;
  totalProfit: number;
  numberOfSales: number;
  avgPricePerUnit: number;
}

export default function TopItemsVolumePage() {
  const [fromDate, setFromDate] = useState<Date | undefined>(startOfMonth(new Date()));
  const [toDate, setToDate] = useState<Date | undefined>(endOfMonth(new Date()));
  const [records, setRecords] = useState<ProductSale[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [totalItems, setTotalItems] = useState(0);
  const { toast } = useToast();

  const totals = {
    unitsSold: records.reduce((sum, r) => sum + r.unitsSold, 0),
    revenue: records.reduce((sum, r) => sum + r.totalRevenue, 0),
    cost: records.reduce((sum, r) => sum + r.totalCost, 0),
    profit: records.reduce((sum, r) => sum + r.totalProfit, 0),
    products: records.length,
    avgPrice: records.length > 0 ? records.reduce((sum, r) => sum + r.avgPricePerUnit, 0) / records.length : 0,
  };

  const fetchReport = async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (fromDate) {
        params.append('startDate', format(fromDate, 'yyyy-MM-dd'));
      }
      if (toDate) {
        params.append('endDate', format(toDate, 'yyyy-MM-dd'));
      }
      params.append('page', currentPage.toString());
      params.append('limit', '1000'); // Get all for now
      if (searchTerm) {
        params.append('search', searchTerm);
      }

      const response = await fetch(getApiUrl(`/sales/by-product?${params.toString()}`));
      if (!response.ok) throw new Error(`API error ${response.status}`);
      const result = await response.json();
      if (result.success) {
        setRecords(result.data || []);
        setTotalItems(result.pagination?.totalItems || result.data?.length || 0);
      }
    } catch (error) {
      console.error("Error fetching sales by product:", error);
      toast({
        title: "Error",
        description: "Failed to fetch product sales data. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchReport();
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm]);

  // Client-side filtering and pagination
  const filteredRecords = records.filter(record => {
    if (!searchTerm.trim()) return true;
    const search = searchTerm.toLowerCase();
    return (
      record.product.name?.toLowerCase().includes(search) ||
      record.product.sku?.toLowerCase().includes(search) ||
      record.product.barcode?.toLowerCase().includes(search) ||
      record.product.category?.toLowerCase().includes(search) ||
      record.product.brand?.toLowerCase().includes(search)
    );
  });

  const totalPages = Math.ceil(filteredRecords.length / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const paginatedRecords = filteredRecords.slice(startIndex, endIndex);

  const exportToPDF = () => {
    const fileName = `Top_Items_Volume_${format(fromDate || new Date(), 'yyyyMMdd')}_${format(toDate || new Date(), 'yyyyMMdd')}.pdf`;
    const ok = exportReportPdf<ProductSale>({
      title: 'Top Items by Volume Report',
      dateRange: `From: ${fromDate ? format(fromDate, 'yyyy-MM-dd') : 'N/A'} To: ${toDate ? format(toDate, 'yyyy-MM-dd') : 'N/A'}`,
      summary: [
        { label: 'Total Products', value: String(totals.products) },
        { label: 'Total Units Sold', value: String(totals.unitsSold) },
        { label: 'Total Revenue', value: formatCurrency(totals.revenue) },
        { label: 'Total Profit', value: formatCurrency(totals.profit) },
        { label: 'Avg Price/Unit', value: formatCurrency(totals.avgPrice) },
      ],
      columns: [
        { header: 'Rank', width: 12, cell: (_r, i) => (i + 1).toString() },
        { header: 'Product', width: 30, cell: (r) => r.product.name || 'N/A' },
        { header: 'Barcode', width: 25, cell: (r) => r.product.barcode || '-' },
        { header: 'Category', width: 23, cell: (r) => r.product.category || '-' },
        { header: 'Brand', width: 23, cell: (r) => r.product.brand || '-' },
        { header: 'Units Sold', width: 18, align: 'right', cell: (r) => r.unitsSold.toString() },
        { header: 'UOM', width: 15, cell: (r) => r.product.unitOfMeasure || '-' },
        { header: 'Revenue', width: 22, align: 'right', cell: (r) => r.totalRevenue.toFixed(2) },
        { header: 'Cost', width: 20, align: 'right', cell: (r) => r.totalCost.toFixed(2) },
        { header: 'Profit', width: 20, align: 'right', cell: (r) => r.totalProfit.toFixed(2) },
        { header: 'Margin %', width: 15, align: 'right', cell: (r) => (r.totalRevenue > 0 ? ((r.totalProfit / r.totalRevenue) * 100) : 0).toFixed(1) + '%' },
        { header: '# Sales', width: 15, align: 'right', cell: (r) => r.numberOfSales.toString() },
      ],
      rows: records,
      totals: ['TOTALS', null, null, null, null, totals.unitsSold.toString(), null, totals.revenue.toFixed(2), totals.cost.toFixed(2), totals.profit.toFixed(2), null, null],
      fileName,
    });
    if (!ok) {
      toast({ title: 'No Data', description: 'No records to export. Please fetch the report first.', variant: 'destructive' });
      return;
    }
    toast({ title: 'PDF Exported', description: `Report saved as ${fileName}` });
  };

  const exportToExcel = () => {
    const fileName = `Top_Items_Volume_${format(fromDate || new Date(), 'yyyyMMdd')}_${format(toDate || new Date(), 'yyyyMMdd')}.xls`;
    const ok = exportReportExcel<ProductSale>({
      title: 'Top Items by Volume Report',
      subtitle: `From: ${fromDate ? format(fromDate, 'yyyy-MM-dd') : 'N/A'} To: ${toDate ? format(toDate, 'yyyy-MM-dd') : 'N/A'}`,
      columns: [
        { header: 'Rank', align: 'right', cell: (_r, i) => i + 1 },
        { header: 'Product', cell: (r) => r.product.name || 'N/A' },
        { header: 'Barcode', cell: (r) => r.product.barcode || '-' },
        { header: 'Category', cell: (r) => r.product.category || '-' },
        { header: 'Brand', cell: (r) => r.product.brand || '-' },
        { header: 'Units Sold', align: 'right', cell: (r) => r.unitsSold },
        { header: 'UOM', cell: (r) => r.product.unitOfMeasure || '-' },
        { header: 'Revenue', align: 'right', cell: (r) => r.totalRevenue },
        { header: 'Cost', align: 'right', cell: (r) => r.totalCost },
        { header: 'Profit', align: 'right', cell: (r) => r.totalProfit },
        { header: 'Margin %', align: 'right', cell: (r) => (r.totalRevenue > 0 ? ((r.totalProfit / r.totalRevenue) * 100) : 0).toFixed(1) + '%' },
        { header: '# Sales', align: 'right', cell: (r) => r.numberOfSales },
      ],
      rows: filteredRecords,
      totals: ['TOTALS', null, null, null, null, totals.unitsSold, null, totals.revenue.toFixed(2), totals.cost.toFixed(2), totals.profit.toFixed(2), null, null],
      fileName,
    });
    if (!ok) {
      toast({ title: 'No Data', description: 'No records to export. Please fetch the report first.', variant: 'destructive' });
      return;
    }
    toast({ title: 'Excel Exported', description: `Report saved as ${fileName}` });
  };

  const formatCurrency = (value: number) => {
    return `₱${value.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Package2 className="h-5 w-5 text-green-600" />
                Top Items by Volume Report
              </CardTitle>
              <CardDescription>
                Product performance analysis with sales metrics
              </CardDescription>
            </div>
            <Badge variant="outline" className="text-sm border-green-600 text-green-600">
              {records.length} Product{records.length !== 1 ? 's' : ''}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">From Date</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-[180px] justify-start text-left font-normal",
                      !fromDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {fromDate ? format(fromDate, "PPP") : "Select date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={fromDate}
                    onSelect={setFromDate}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">To Date</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-[180px] justify-start text-left font-normal",
                      !toDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {toDate ? format(toDate, "PPP") : "Select date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={toDate}
                    onSelect={setToDate}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            <Button 
              onClick={fetchReport} 
              disabled={isLoading}
            >
              {isLoading ? 'Loading...' : 'Show Report'}
            </Button>

            <Button 
              onClick={exportToPDF} 
              disabled={isLoading || records.length === 0}
              variant="outline"
              className="border-green-600 text-green-600 hover:bg-green-50"
            >
              <FileDown className="mr-2 h-4 w-4" />
              Export to PDF
            </Button>

            <Button
              onClick={exportToExcel}
              disabled={isLoading || records.length === 0}
              variant="outline"
              className="border-emerald-700 text-emerald-700 hover:bg-emerald-50"
            >
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              Export to Excel
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Units Sold</CardTitle>
            <Package2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{totals.unitsSold.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">Across all products</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
            <div className="h-4 w-4 flex items-center justify-center text-muted-foreground font-semibold text-base">₱</div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">{formatCurrency(totals.revenue)}</div>
            <p className="text-xs text-muted-foreground">Total product sales</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Products</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-600">{totals.products}</div>
            <p className="text-xs text-muted-foreground">Products sold</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Profit</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className={cn("text-2xl font-bold", totals.profit >= 0 ? "text-green-600" : "text-red-600")}>
              {formatCurrency(totals.profit)}
            </div>
            <p className="text-xs text-muted-foreground">Revenue minus cost</p>
          </CardContent>
        </Card>
      </div>

      {/* Data Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Top Items by Volume</CardTitle>
              <CardDescription>
                Detailed breakdown of sales by product
              </CardDescription>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search products..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 w-[250px]"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table className="w-full text-sm">
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="py-2 px-3 w-12 text-center">Rank</TableHead>
                <TableHead className="py-2 px-3">Product Name</TableHead>
                <TableHead className="py-2 px-2">Barcode</TableHead>
                <TableHead className="py-2 px-2">Category</TableHead>
                <TableHead className="py-2 px-2">Brand</TableHead>
                <TableHead className="py-2 px-2 text-right">Units Sold</TableHead>
                <TableHead className="py-2 px-2">UOM</TableHead>
                <TableHead className="py-2 px-2 text-right">Revenue</TableHead>
                <TableHead className="py-2 px-2 text-right">Cost</TableHead>
                <TableHead className="py-2 px-2 text-right">Profit</TableHead>
                <TableHead className="py-2 px-2 text-right">Margin %</TableHead>
                <TableHead className="py-2 px-2 text-right"># Sales</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedRecords.length > 0 ? (
                paginatedRecords.map((record, index) => {
                  const profitMargin = record.totalRevenue > 0 ? ((record.totalProfit / record.totalRevenue) * 100) : 0;
                  return (
                    <TableRow 
                      key={index}
                      className="cursor-pointer hover:bg-muted/50 transition-colors text-xs"
                    >
                      <TableCell className="py-2 px-3 text-center font-bold text-muted-foreground">{startIndex + index + 1}</TableCell>
                      <TableCell className="py-2 px-3 font-medium">{record.product.name}</TableCell>
                      <TableCell className="py-2 px-2 text-muted-foreground">{record.product.barcode || '-'}</TableCell>
                      <TableCell className="py-2 px-2">{record.product.category || '-'}</TableCell>
                      <TableCell className="py-2 px-2">{record.product.brand || '-'}</TableCell>
                      <TableCell className="py-2 px-2 text-right font-mono font-semibold">
                        {record.unitsSold}
                      </TableCell>
                      <TableCell className="py-2 px-2">{record.product.unitOfMeasure || '-'}</TableCell>
                      <TableCell className="py-2 px-2 text-right font-mono text-blue-600">
                        {record.totalRevenue.toFixed(2)}
                      </TableCell>
                      <TableCell className="py-2 px-2 text-right font-mono text-muted-foreground">
                        {record.totalCost.toFixed(2)}
                      </TableCell>
                      <TableCell className={cn(
                        "py-2 px-2 text-right font-mono",
                        record.totalProfit >= 0 ? "text-green-600" : "text-red-600"
                      )}>
                        {record.totalProfit.toFixed(2)}
                      </TableCell>
                      <TableCell className={cn(
                        "py-2 px-2 text-right font-mono font-semibold",
                        profitMargin >= 30 ? "text-green-600" : profitMargin >= 15 ? "text-yellow-600" : "text-red-600"
                      )}>
                        {profitMargin.toFixed(1)}%
                      </TableCell>
                      <TableCell className="py-2 px-2 text-right font-mono">
                        {record.numberOfSales}
                      </TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={11} className="h-24 text-center">
                    {isLoading ? (
                      <div className="flex items-center justify-center gap-2">
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
                        Loading...
                      </div>
                    ) : (
                      <span className="text-muted-foreground">
                        No product sales found for the selected date range.
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          
          {/* Pagination Controls */}
          {filteredRecords.length > 0 && (
            <div className="flex items-center justify-between px-6 py-4 border-t">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  Showing {startIndex + 1} to {Math.min(endIndex, filteredRecords.length)} of {filteredRecords.length} entries
                </span>
              </div>
              
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Rows per page:</span>
                  <Select
                    value={pageSize.toString()}
                    onValueChange={(value) => {
                      setPageSize(Number(value));
                      setCurrentPage(1);
                    }}
                  >
                    <SelectTrigger className="w-[70px] h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="5">5</SelectItem>
                      <SelectItem value="10">10</SelectItem>
                      <SelectItem value="20">20</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                      <SelectItem value="100">100</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setCurrentPage(1)}
                    disabled={currentPage === 1}
                  >
                    <ChevronsLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                    disabled={currentPage === 1}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  
                  <div className="flex items-center gap-1 px-2">
                    <span className="text-sm font-medium">
                      Page {currentPage} of {totalPages}
                    </span>
                  </div>

                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                    disabled={currentPage === totalPages}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setCurrentPage(totalPages)}
                    disabled={currentPage === totalPages}
                  >
                    <ChevronsRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

