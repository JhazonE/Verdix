'use client';

import { useMemo } from 'react';
import { format } from 'date-fns';
import { DateRange } from 'react-day-picker';

export const formatAmount = (val: any) =>
  Number(val || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type UtilParams = {
  sales: any[];
  searchTerm: string;
  dateRange: DateRange | undefined;
  terminalId: string;
  paymentTypeFilter: string;
};

export function useDetailsUtils({ sales, searchTerm, dateRange, terminalId, paymentTypeFilter }: UtilParams) {
  // Payment type is applied server-side by /api/sales/transactions — `sales`
  // already reflects it. Search remains client-side (free text over the loaded page).
  const filteredSales = useMemo(() => sales.filter(sale => {
    if (searchTerm) {
      const t = searchTerm.toLowerCase();
      if (!String(sale.id || sale.posTransactionId).toLowerCase().includes(t) &&
          !sale.customer?.name?.toLowerCase().includes(t)) return false;
    }
    return true;
  }), [sales, searchTerm]);

  const summaryTotals = sales.reduce((acc, sale) => {
    const totalAmount = Number(sale.total || 0);
    const costAmount = Number(sale.cost || 0);
    const taxAmount = Number(sale.taxAmount || 0);
    return {
      discounts: acc.discounts + Number(sale.discount || 0),
      revenue: acc.revenue + totalAmount,
      amountPaid: acc.amountPaid + Number(sale.amountPaid || totalAmount),
      customerBalance: acc.customerBalance + Number(sale.balance || 0),
      cost: acc.cost + costAmount,
      grossProfit: acc.grossProfit + (totalAmount - costAmount - taxAmount),
      vatableSales: acc.vatableSales + Number(sale.vatableSales || 0),
      vatAmount: acc.vatAmount + taxAmount,
      nonVatSales: acc.nonVatSales + Number(sale.nonVatSales || 0),
      accountPayments: acc.accountPayments + (sale.paymentMethod === 'Account' ? totalAmount : 0),
    };
  }, { discounts: 0, revenue: 0, amountPaid: 0, customerBalance: 0, cost: 0, grossProfit: 0, vatableSales: 0, vatAmount: 0, nonVatSales: 0, accountPayments: 0 });

  const fetchAllSalesForExport = async (): Promise<any[]> => {
    const params = new URLSearchParams();
    if (dateRange?.from) params.append('startDate', format(dateRange.from, 'yyyy-MM-dd'));
    if (dateRange?.to) params.append('endDate', format(dateRange.to, 'yyyy-MM-dd'));
    if (terminalId && terminalId !== 'all') params.append('terminalId', terminalId);
    if (paymentTypeFilter && paymentTypeFilter !== 'all') params.append('paymentMethod', paymentTypeFilter);
    params.append('limit', '1000000');
    try {
      const res = await fetch(`/api/sales/transactions?${params.toString()}`);
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const result = await res.json();
      return result.success && Array.isArray(result.data) ? result.data : [];
    } catch { return []; }
  };

  const exportToCSV = async () => {
    const data = await fetchAllSalesForExport();
    const rows = data.flatMap((sale: any) => {
      const items = sale.items || [];
      if (items.length === 0) return [{ ...sale, itemName: 'No Items', itemCost: 0, itemPrice: 0, itemQty: 0, itemTotal: 0 }];
      return items.map((item: any) => ({ ...sale, ...item, itemName: item.productName, itemCost: item.cost, itemPrice: item.price, itemQty: item.quantity, itemTotal: item.total }));
    });
    const headers = ['SI No.', 'Date', 'Terminal', 'Cashier', 'Customer', 'Description', 'Cost', 'Price', 'Quantity', 'Discount', 'Amount Due', 'Profit', 'Payment Type', 'Note'];
    const csvRows = rows.map((row: any) => {
      const siNo = row.siNumber ? String(row.siNumber).padStart(6, '0') : (row.orderNumber ? String(row.orderNumber).padStart(6, '0') : '');
      return [
        siNo,
        row.date ? format(new Date(row.date), 'yyyy-MM-dd HH:mm') : '',
        row.terminal || '', row.cashier || '', row.customer?.name || 'Walk-in',
        row.itemName || 'General Item', row.itemCost || 0, row.itemPrice || 0, row.itemQty || 1,
        row.discount || 0, row.itemTotal || row.total || 0,
        (row.itemTotal || 0) - ((row.itemCost || 0) * (row.itemQty || 1)),
        row.paymentMethod || '', row.notes || '',
      ];
    });
    const csv = [headers.join(','), ...csvRows.map((r: any[]) => r.map(c => `"${c}"`).join(','))].join('\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    link.download = `sales_details_${format(new Date(), 'yyyy-MM-dd')}.csv`;
    link.click();
  };

  const exportToPDF = async () => {
    const data = await fetchAllSalesForExport();
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    const printContent = `<html><head><title>Sales Details Report</title><style>body{font-family:sans-serif;font-size:10px;}table{width:100%;border-collapse:collapse;margin-bottom:20px;}th,td{border:1px solid #ddd;padding:4px;text-align:left;}th{background-color:#f2f2f2;font-weight:bold;}.text-right{text-align:right;}.sub-table{margin:10px;width:95%;background-color:#fafafa;}.sub-table th{background-color:#eee;}.summary-row{font-weight:bold;background-color:#f9f9f9;}</style></head><body><h2>Sales Details Report</h2><p>Generated: ${format(new Date(), 'PPpp')}</p><table><thead><tr><th>SI No.</th><th>Date</th><th>Customer</th><th>Payment Type</th><th>Total Amount</th></tr></thead><tbody>${data.map((sale: any) => {
      const siNo = sale.siNumber ? String(sale.siNumber).padStart(6, '0') : (sale.orderNumber ? String(sale.orderNumber).padStart(6, '0') : '');
      return `<tr class="summary-row"><td>${siNo}</td><td>${sale.date ? format(new Date(sale.date), 'MM/dd/yyyy HH:mm') : ''}</td><td>${sale.customer?.name || 'Walk-in'}</td><td>${sale.paymentMethod || '-'}</td><td class="text-right">${formatAmount(sale.total)}</td></tr><tr><td colspan="5"><table class="sub-table"><thead><tr><th>Description</th><th class="text-right">Cost</th><th class="text-right">Price</th><th class="text-right">Qty</th><th class="text-right">Total</th></tr></thead><tbody>${(sale.items || []).map((item: any) => `<tr><td>${item.productName}</td><td class="text-right">${formatAmount(item.cost)}</td><td class="text-right">${formatAmount(item.price)}</td><td class="text-right">${item.quantity}</td><td class="text-right">${formatAmount(item.total)}</td></tr>`).join('')}</tbody></table></td></tr>`;
    }).join('')}</tbody></table></body></html>`;
    printWindow.document.write(printContent);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 500);
  };

  return { filteredSales, summaryTotals, exportToCSV, exportToPDF };
}
