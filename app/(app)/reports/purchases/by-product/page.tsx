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
import { CalendarIcon, FileDown, FileSpreadsheet, Search, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, PhilippinePeso, Package2, TrendingUp, BarChart } from 'lucide-react';
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

interface ProductPurchase {
  productId: string;
  productName: string;
  sku: string;
  barcode: string;
  category: string;
  brand: string;
  uom: string;
  totalQuantity: number;
  totalCost: number;
  avgCost: number;
}

export default function PurchasesByProductPage() {
  const [fromDate, setFromDate] = useState<Date | undefined>(startOfMonth(new Date()));
  const [toDate, setToDate] = useState<Date | undefined>(endOfMonth(new Date()));
  const [records, setRecords] = useState<ProductPurchase[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const { toast } = useToast();

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
      if (searchTerm) {
        params.append('search', searchTerm);
      }

      const response = await fetch(getApiUrl(`/reports/purchases/by-product?${params.toString()}`));
      if (!response.ok) throw new Error(`API error ${response.status}`);
      const result = await response.json();
      if (result.success) {
        setRecords(result.data || []);
      }
    } catch (error) {
      console.error("Error fetching purchases by product:", error);
      toast({
        title: "Error",
        description: "Failed to fetch product purchase data. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchReport();
  }, []);

  // Client-side filtering and pagination
  const filteredRecords = records.filter(record => {
    if (!searchTerm.trim()) return true;
    const search = searchTerm.toLowerCase();
    return (
      record.productName?.toLowerCase().includes(search) ||
      record.sku?.toLowerCase().includes(search) ||
      record.barcode?.toLowerCase().includes(search) ||
      record.category?.toLowerCase().includes(search) ||
      record.brand?.toLowerCase().includes(search)
    );
  });

  const totalPages = Math.ceil(filteredRecords.length / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const paginatedRecords = filteredRecords.slice(startIndex, endIndex);

  // Reset to page 1 when search term changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm]);

  const totals = {
    totalQuantity: records.reduce((sum, r) => sum + r.totalQuantity, 0),
    totalCost: records.reduce((sum, r) => sum + r.totalCost, 0),
    totalProducts: records.length,
    avgUnitCost: records.length > 0 ? records.reduce((sum, r) => sum + r.avgCost, 0) / records.length : 0,
  };

  const exportToPDF = () => {
    const fileName = `Purchases_By_Product_${format(new Date(), 'yyyyMMdd_HHmm')}.pdf`;
    const ok = exportReportPdf<ProductPurchase>({
      title: 'Purchases by Product Report',
      dateRange: `From: ${fromDate ? format(fromDate, 'yyyy-MM-dd') : 'N/A'} To: ${toDate ? format(toDate, 'yyyy-MM-dd') : 'N/A'}`,
      summary: [
        { label: 'Total Products', value: String(totals.totalProducts) },
        { label: 'Total Units Purchased', value: String(totals.totalQuantity) },
        { label: 'Total Spend', value: formatCurrency(totals.totalCost) },
      ],
      columns: [
        { header: 'Product Name', width: 50, cell: (r) => r.productName || 'N/A' },
        { header: 'Barcode', width: 40, cell: (r) => r.barcode || '-' },
        { header: 'Category', width: 40, cell: (r) => r.category || '-' },
        { header: 'Quantity', width: 25, align: 'right', cell: (r) => r.totalQuantity.toString() },
        { header: 'UOM', width: 20, cell: (r) => r.uom || '-' },
        { header: 'Avg Cost', width: 30, align: 'right', cell: (r) => formatCurrency(r.avgCost) },
        { header: 'Total Spend', width: 40, align: 'right', cell: (r) => formatCurrency(r.totalCost) },
      ],
      rows: records,
      totals: ['TOTAL', null, null, String(totals.totalQuantity), null, null, formatCurrency(totals.totalCost)],
      fileName,
    });
    if (!ok) {
      toast({ title: 'No Data', description: 'No records to export. Please fetch the report first.', variant: 'destructive' });
      return;
    }
    toast({ title: 'PDF Exported', description: `Report saved as ${fileName}` });
  };

  const exportToExcel = () => {
    const fileName = `Purchases_By_Product_${format(new Date(), 'yyyyMMdd_HHmm')}.xls`;
    const ok = exportReportExcel<ProductPurchase>({
      title: 'Purchases by Product Report',
      subtitle: `From: ${fromDate ? format(fromDate, 'yyyy-MM-dd') : 'N/A'} To: ${toDate ? format(toDate, 'yyyy-MM-dd') : 'N/A'}`,
      columns: [
        { header: 'Product Name', cell: (r) => r.productName || 'N/A' },
        { header: 'Barcode', cell: (r) => r.barcode || '-' },
        { header: 'Category', cell: (r) => r.category || '-' },
        { header: 'Quantity', align: 'right', cell: (r) => r.totalQuantity },
        { header: 'UOM', cell: (r) => r.uom || '-' },
        { header: 'Avg Cost', align: 'right', cell: (r) => r.avgCost },
        { header: 'Total Spend', align: 'right', cell: (r) => r.totalCost },
      ],
      rows: filteredRecords,
      totals: ['TOTAL', null, null, totals.totalQuantity, null, null, totals.totalCost.toFixed(2)],
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
                Purchases by Product Report
              </CardTitle>
              <CardDescription>
                Detailed breakdown of item procurement and landed cost analysis (inclusive of shipping)
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
              className="bg-green-600 hover:bg-green-700 text-white"
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
            <CardTitle className="text-sm font-medium">Total Spend</CardTitle>
            <PhilippinePeso className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">{formatCurrency(totals.totalCost)}</div>
            <p className="text-xs text-muted-foreground">Total procurement value</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Units Purchased</CardTitle>
            <BarChart className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{totals.totalQuantity.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">Total items bought</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Unique Products</CardTitle>
            <Package2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-600">{totals.totalProducts}</div>
            <p className="text-xs text-muted-foreground">Different items purchased</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Unit Cost</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">{formatCurrency(totals.avgUnitCost)}</div>
            <p className="text-xs text-muted-foreground">Weighted average cost</p>
          </CardContent>
        </Card>
      </div>

      {/* Data Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Product Procurement Details</CardTitle>
              <CardDescription>
                Detailed breakdown of quantity and spend per product
              </CardDescription>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search products, category, brand..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 w-[300px]"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="py-2 px-4">Product Name</TableHead>
                <TableHead className="py-2 px-4 text-right">Quantity</TableHead>
                <TableHead className="py-2 px-4">UOM</TableHead>
                <TableHead className="py-2 px-4 text-right">Avg Unit Cost</TableHead>
                <TableHead className="py-2 px-4 text-right">Total Spend</TableHead>
                <TableHead className="py-2 px-4">Category</TableHead>
                <TableHead className="py-2 px-4">Brand</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedRecords.length > 0 ? (
                paginatedRecords.map((record, index) => (
                  <TableRow key={index} className="hover:bg-muted/50 transition-colors text-sm">
                    <TableCell className="py-2 px-4 font-medium">
                      <div className="flex flex-col">
                        <span>{record.productName}</span>
                        <span className="text-xs text-muted-foreground">{record.barcode || record.sku || '-'}</span>
                      </div>
                    </TableCell>
                    <TableCell className="py-2 px-4 text-right font-mono font-semibold">{record.totalQuantity.toLocaleString()}</TableCell>
                    <TableCell className="py-2 px-4">{record.uom || '-'}</TableCell>
                    <TableCell className="py-2 px-4 text-right font-mono">{formatCurrency(record.avgCost)}</TableCell>
                    <TableCell className="py-2 px-4 text-right font-mono font-semibold text-green-600">
                      {formatCurrency(record.totalCost)}
                    </TableCell>
                    <TableCell className="py-2 px-4">{record.category || '-'}</TableCell>
                    <TableCell className="py-2 px-4">{record.brand || '-'}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center">
                    {isLoading ? (
                      <div className="flex items-center justify-center gap-2">
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
                        Loading...
                      </div>
                    ) : (
                      <span className="text-muted-foreground">
                        No product purchase data found for the selected range.
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
