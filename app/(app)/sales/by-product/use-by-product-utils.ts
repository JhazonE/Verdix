'use client';

import { format } from 'date-fns';
import { DateRange } from 'react-day-picker';
import { getApiUrl } from '@/lib/api-config';
import type { ProductSalesData } from './by-product-types';

type UtilParams = {
  productSales: ProductSalesData[];
  dateRange: DateRange | undefined;
  terminal: string;
  categoryFilter: string;
  brandFilter: string;
  cashierFilter: string;
  referenceFilter: string;
  searchTerm: string;
  totals: { totalRevenue: number; totalDiscount: number; totalCost: number; totalProfit: number; unitsSold: number };
};

export function useByProductUtils({
  productSales, dateRange, terminal,
  categoryFilter, brandFilter, cashierFilter, referenceFilter, searchTerm, totals,
}: UtilParams) {
  // Totals come from the server, aggregated across ALL products matching the active
  // filters/date range — not just the current page of products.
  const summaryTotals = totals;

  const fetchAllProductSalesForExport = async (): Promise<ProductSalesData[]> => {
    const params = new URLSearchParams();
    if (dateRange?.from) params.append('startDate', format(dateRange.from, 'yyyy-MM-dd'));
    if (dateRange?.to) params.append('endDate', format(dateRange.to, 'yyyy-MM-dd'));
    if (terminal && terminal !== 'all') params.append('terminalId', terminal);
    if (categoryFilter && categoryFilter !== 'all') params.append('category', categoryFilter);
    if (brandFilter && brandFilter !== 'all') params.append('brand', brandFilter);
    if (cashierFilter && cashierFilter !== 'all') params.append('cashier', cashierFilter);
    if (referenceFilter) params.append('reference', referenceFilter);
    if (searchTerm) params.append('search', searchTerm);
    params.append('limit', '1000000');
    try {
      const res = await fetch(getApiUrl(`/sales/by-product?${params.toString()}`));
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const result = await res.json();
      if (result.success && Array.isArray(result.data)) return result.data;
      return [];
    } catch {
      return [];
    }
  };

  const fmt = (val: any) =>
    parseFloat(val || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const exportToCSV = async () => {
    const data = await fetchAllProductSalesForExport();
    const headers = [
      'Code', 'Description', 'Category', 'Brand', 'UOM', 'Quantity',
      'Sales Discount', 'Sales Amount', 'Cost', 'Profit', 'Avg Price/Unit', 'No. of Sales',
    ];
    const csvRows = data.map((item) => [
      item.product.sku || '', item.product.name || '', item.product.category || '',
      item.product.brand || '', item.product.unitOfMeasure || '', item.unitsSold || 0,
      item.totalDiscount || 0, item.totalRevenue || 0, item.totalCost || 0,
      item.totalProfit || 0, item.avgPricePerUnit || 0, item.numberOfSales || 0,
    ]);
    const csvContent = [
      headers.join(','),
      ...csvRows.map((r) => r.map((c) => `"${c}"`).join(',')),
    ].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `sales_by_product_${format(new Date(), 'yyyy-MM-dd')}.csv`;
    link.click();
  };

  const exportToPDF = async () => {
    const data = await fetchAllProductSalesForExport();
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    const printContent = `
      <html>
        <head>
          <title>Sales by Product Report</title>
          <style>
            body { font-family: sans-serif; font-size: 10px; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
            th, td { border: 1px solid #ddd; padding: 4px; text-align: left; }
            th { background-color: #f2f2f2; font-weight: bold; }
            .text-right { text-align: right; }
            .summary-row { font-weight: bold; background-color: #f9f9f9; }
            h2 { margin-bottom: 10px; }
            p { margin: 5px 0; }
          </style>
        </head>
        <body>
          <h2>Sales by Product Report</h2>
          <p>Generated: ${format(new Date(), 'PPpp')}</p>
          <table>
            <thead>
              <tr>
                <th>Code</th><th>Description</th><th>Category/Brand</th>
                <th class="text-right">Quantity</th><th class="text-right">Sales Discount</th>
                <th class="text-right">Sales Amount</th><th class="text-right">Cost</th>
                <th class="text-right">Profit</th>
              </tr>
            </thead>
            <tbody>
              ${data.map((item) => `
                <tr>
                  <td>${item.product.sku || ''}</td>
                  <td>${item.product.name || ''}</td>
                  <td>${item.product.category || ''} / ${item.product.brand || ''}</td>
                  <td class="text-right">${item.unitsSold.toLocaleString()}</td>
                  <td class="text-right">${item.totalDiscount > 0 ? `(${fmt(item.totalDiscount)})` : '0.00'}</td>
                  <td class="text-right">${fmt(item.totalRevenue)}</td>
                  <td class="text-right">${fmt(item.totalCost)}</td>
                  <td class="text-right">${fmt(item.totalProfit)}</td>
                </tr>`).join('')}
              <tr class="summary-row">
                <td colspan="3">TOTAL</td>
                <td class="text-right">${data.reduce((s, i) => s + i.unitsSold, 0).toLocaleString()}</td>
                <td class="text-right">${fmt(data.reduce((s, i) => s + i.totalDiscount, 0))}</td>
                <td class="text-right">${fmt(data.reduce((s, i) => s + i.totalRevenue, 0))}</td>
                <td class="text-right">${fmt(data.reduce((s, i) => s + i.totalCost, 0))}</td>
                <td class="text-right">${fmt(data.reduce((s, i) => s + i.totalProfit, 0))}</td>
              </tr>
            </tbody>
          </table>
        </body>
      </html>`;
    printWindow.document.write(printContent);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 500);
  };

  return { summaryTotals, exportToCSV, exportToPDF };
}
