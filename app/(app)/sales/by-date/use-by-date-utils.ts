'use client';

import { useMemo } from 'react';
import { format } from 'date-fns';
import { DateRange } from 'react-day-picker';
import type { SalesData } from './by-date-types';

type UtilParams = {
  salesData: SalesData[];
  interval: string;
  dateRange: DateRange | undefined;
  terminal: string;
  paymentType: string;
  searchTerm: string;
};

export function useByDateUtils({ salesData, interval, dateRange, terminal, paymentType, searchTerm }: UtilParams) {
  const formatCurrency = (val: number) =>
    new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: 'PHP',
      minimumFractionDigits: 2,
    }).format(val || 0);

  const formatDate = (dateString: string) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return '-';
    if (interval === 'monthly') return format(date, 'MMMM yyyy');
    if (interval === 'hourly') return format(date, 'PP p');
    return format(date, 'PP');
  };

  const filteredSalesData = useMemo(() => {
    if (!searchTerm) return salesData;
    const term = searchTerm.toLowerCase();
    return salesData.filter((row) => {
      const dateStr = formatDate(row.date).toLowerCase();
      const orStart = (row.startOR || '').toLowerCase();
      const orEnd = (row.endOR || '').toLowerCase();
      const birOrStart = (row.startBirOr || '').toLowerCase();
      const birOrEnd = (row.endBirOr || '').toLowerCase();
      return (
        dateStr.includes(term) ||
        orStart.includes(term) ||
        orEnd.includes(term) ||
        birOrStart.includes(term) ||
        birOrEnd.includes(term)
      );
    });
  }, [salesData, searchTerm, interval]);

  const summaryTotals = useMemo(
    () =>
      salesData.reduce(
        (acc, row) => ({
          discount: acc.discount + row.totalDiscount,
          revenue: acc.revenue + row.totalRevenue,
          vatable: acc.vatable + row.vatableSales,
          vatAmount: acc.vatAmount + row.vatAmount,
          vatExempt: acc.vatExempt + row.vatExemptSales,
          zeroRated: acc.zeroRated + row.zeroRatedSales,
          nonVat: acc.nonVat + row.nonVatSales,
          cost: acc.cost + row.cost,
          profit: acc.profit + row.profit,
        }),
        { discount: 0, revenue: 0, vatable: 0, vatAmount: 0, vatExempt: 0, zeroRated: 0, nonVat: 0, cost: 0, profit: 0 }
      ),
    [salesData]
  );

  const fetchAllSalesForExport = async () => {
    const params = new URLSearchParams();
    if (dateRange?.from) params.append('startDate', format(dateRange.from, 'yyyy-MM-dd'));
    if (dateRange?.to) params.append('endDate', format(dateRange.to, 'yyyy-MM-dd'));
    if (terminal && terminal !== 'all') params.append('terminalId', terminal);
    if (interval) params.append('interval', interval);
    if (paymentType && paymentType !== 'all') params.append('paymentType', paymentType);
    params.append('limit', '1000000');
    try {
      const res = await fetch(`/api/sales/by-date?${params.toString()}`);
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const result = await res.json();
      if (result.success && Array.isArray(result.data)) return result.data as SalesData[];
      return [];
    } catch {
      return [];
    }
  };

  const exportToCSV = async () => {
    const data = await fetchAllSalesForExport();
    const headers = [
      'Date', 'Terminal', 'SI No. Start', 'SI No. End', 'OR No. Start', 'OR No. End',
      'Transaction Count', 'Discount', 'Revenue',
      'Vatable Sales', 'VAT Amount', 'VAT Exempt', 'Zero Rated', 'Non-VAT', 'Cost', 'Profit',
    ];
    const csvRows = data.map((item) => [
      formatDate(item.date) || '',
      terminal === 'all' ? 'All' : terminal,
      item.startOR || '', item.endOR || '',
      item.startBirOr || '', item.endBirOr || '',
      item.transactionCount || 0, item.totalDiscount || 0, item.totalRevenue || 0,
      item.vatableSales || 0, item.vatAmount || 0, item.vatExemptSales || 0,
      item.zeroRatedSales || 0, item.nonVatSales || 0, item.cost || 0, item.profit || 0,
    ]);
    const csvContent = [
      headers.join(','),
      ...csvRows.map((r) => r.map((c) => `"${c}"`).join(',')),
    ].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `sales_by_date_${format(new Date(), 'yyyy-MM-dd')}.csv`;
    link.click();
  };

  const exportToPDF = async () => {
    const data = await fetchAllSalesForExport();
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    const printContent = `
      <html>
        <head>
          <title>Sales by Date Report</title>
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
          <h2>Sales by Date Report</h2>
          <p>Generated: ${format(new Date(), 'PPpp')}</p>
          <p>Interval: ${interval.charAt(0).toUpperCase() + interval.slice(1)}</p>
          <table>
            <thead>
              <tr>
                <th>Date</th><th>SI No. Range</th><th>OR No. Range</th>
                <th class="text-right">Discount</th><th class="text-right">Revenue</th>
                <th class="text-right">Vatable</th><th class="text-right">VAT</th>
                <th class="text-right">Exempt</th><th class="text-right">Zero</th>
                <th class="text-right">Non-VAT</th><th class="text-right">Cost</th>
                <th class="text-right">Profit</th>
              </tr>
            </thead>
            <tbody>
              ${data.map((item) => `
                <tr>
                  <td>${formatDate(item.date) || ''}</td>
                  <td>${item.startOR && item.endOR ? `${item.startOR} - ${item.endOR}` : '-'}</td>
                  <td>${item.startBirOr && item.endBirOr ? `${item.startBirOr} - ${item.endBirOr}` : '-'}</td>
                  <td class="text-right">${formatCurrency(item.totalDiscount)}</td>
                  <td class="text-right">${formatCurrency(item.totalRevenue)}</td>
                  <td class="text-right">${formatCurrency(item.vatableSales)}</td>
                  <td class="text-right">${formatCurrency(item.vatAmount)}</td>
                  <td class="text-right">${formatCurrency(item.vatExemptSales)}</td>
                  <td class="text-right">${formatCurrency(item.zeroRatedSales)}</td>
                  <td class="text-right">${formatCurrency(item.nonVatSales)}</td>
                  <td class="text-right">${formatCurrency(item.cost)}</td>
                  <td class="text-right">${formatCurrency(item.profit)}</td>
                </tr>`).join('')}
              <tr class="summary-row">
                <td colspan="3">TOTAL</td>
                <td class="text-right">${formatCurrency(data.reduce((s, i) => s + i.totalDiscount, 0))}</td>
                <td class="text-right">${formatCurrency(data.reduce((s, i) => s + i.totalRevenue, 0))}</td>
                <td class="text-right">${formatCurrency(data.reduce((s, i) => s + i.vatableSales, 0))}</td>
                <td class="text-right">${formatCurrency(data.reduce((s, i) => s + i.vatAmount, 0))}</td>
                <td class="text-right">${formatCurrency(data.reduce((s, i) => s + i.vatExemptSales, 0))}</td>
                <td class="text-right">${formatCurrency(data.reduce((s, i) => s + i.zeroRatedSales, 0))}</td>
                <td class="text-right">${formatCurrency(data.reduce((s, i) => s + i.nonVatSales, 0))}</td>
                <td class="text-right">${formatCurrency(data.reduce((s, i) => s + i.cost, 0))}</td>
                <td class="text-right">${formatCurrency(data.reduce((s, i) => s + i.profit, 0))}</td>
              </tr>
            </tbody>
          </table>
        </body>
      </html>`;
    printWindow.document.write(printContent);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 500);
  };

  return {
    formatCurrency,
    formatDate,
    filteredSalesData,
    summaryTotals,
    exportToCSV,
    exportToPDF,
  };
}
