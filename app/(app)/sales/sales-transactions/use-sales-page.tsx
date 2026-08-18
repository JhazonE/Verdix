'use client';

import { useState, useMemo } from 'react';
import { ColumnDef, SortingState, VisibilityState, getCoreRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table';
import { format } from 'date-fns';
import { DateRange } from 'react-day-picker';
import { ChevronDown, ChevronUp, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { getApiUrl } from '@/lib/api-config';
import { useQuery } from '@tanstack/react-query';
import type { Sale, SalesTotals } from './sales-types';

function SortHeader({ column, label, className }: { column: any; label: string; className?: string }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn('h-8 -ml-3 text-primary-foreground hover:text-primary-foreground hover:bg-primary/80 font-semibold', className)}
      onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
    >
      {label}
      {column.getIsSorted() === 'asc' ? <ArrowUp className="ml-1 h-3 w-3" /> : column.getIsSorted() === 'desc' ? <ArrowDown className="ml-1 h-3 w-3" /> : <ArrowUpDown className="ml-1 h-3 w-3 opacity-60" />}
    </Button>
  );
}

export function useSalesPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [terminalId, setTerminalId] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(10);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});

  const [paymentTypeFilter, setPaymentTypeFilter] = useState('all');
  const [salesStatusFilter, setSalesStatusFilter] = useState('all');
  const [customerFilter, setCustomerFilter] = useState('');
  const [cashierFilter, setCashierFilter] = useState('all');
  const [referenceNumberFilter, setReferenceNumberFilter] = useState('');

  // dialog open states
  const [paymentTypeDialogOpen, setPaymentTypeDialogOpen] = useState(false);
  const [terminalDialogOpen, setTerminalDialogOpen] = useState(false);
  const [dateRangeDialogOpen, setDateRangeDialogOpen] = useState(false);
  const [salesStatusDialogOpen, setSalesStatusDialogOpen] = useState(false);
  const [customerDialogOpen, setCustomerDialogOpen] = useState(false);
  const [cashierDialogOpen, setCashierDialogOpen] = useState(false);
  const [referenceNumberDialogOpen, setReferenceNumberDialogOpen] = useState(false);

  // temp filter values
  const [tempPaymentType, setTempPaymentType] = useState('all');
  const [tempTerminalId, setTempTerminalId] = useState('all');
  const [tempDateRange, setTempDateRange] = useState<DateRange | undefined>(undefined);
  const [tempSalesStatus, setTempSalesStatus] = useState('all');
  const [tempCustomer, setTempCustomer] = useState('');
  const [tempCashier, setTempCashier] = useState('');
  const [tempReferenceNumber, setTempReferenceNumber] = useState('');

  const buildSalesParams = () => {
    const params = new URLSearchParams();
    if (dateRange?.from) params.append('startDate', format(dateRange.from, 'yyyy-MM-dd'));
    if (dateRange?.to) params.append('endDate', format(dateRange.to, 'yyyy-MM-dd'));
    if (terminalId && terminalId !== 'all') params.append('terminalId', terminalId);
    if (paymentTypeFilter !== 'all') params.append('paymentMethod', paymentTypeFilter);
    if (salesStatusFilter !== 'all') params.append('status', salesStatusFilter);
    if (customerFilter) params.append('customer', customerFilter);
    if (cashierFilter && cashierFilter !== 'all') params.append('cashier', cashierFilter);
    if (referenceNumberFilter) params.append('reference', referenceNumberFilter);
    if (searchTerm) params.append('search', searchTerm);
    return params;
  };

  const { data: salesResult, isLoading } = useQuery({
    queryKey: [
      'salesTransactions', dateRange?.from?.toISOString(), dateRange?.to?.toISOString(), terminalId,
      currentPage, limit, paymentTypeFilter, salesStatusFilter, customerFilter, cashierFilter,
      referenceNumberFilter, searchTerm,
    ],
    queryFn: async () => {
      const params = buildSalesParams();
      params.append('page', currentPage.toString());
      params.append('limit', limit.toString());
      const res = await fetch(getApiUrl(`/sales/transactions?${params.toString()}`));
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const result = await res.json();
      if (!result.success) throw new Error(result.error || 'Failed to fetch sales');
      return result;
    },
    placeholderData: (prev) => prev,
  });

  const { data: users = [] } = useQuery<any[]>({
    queryKey: ['users'],
    queryFn: async () => {
      const res = await fetch('/api/users');
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
    staleTime: 5 * 60 * 1000,
  });

  const sales: Sale[] = salesResult?.data || [];
  const totalPages = salesResult?.pagination?.totalPages ?? 1;

  const toggleRowExpansion = (id: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  };

  // Filtering (search, payment type, status, customer, cashier, reference) is applied
  // server-side by /api/sales/transactions — `sales` already reflects the active filters.
  const filteredSales = sales;

  const columns = useMemo<ColumnDef<Sale>[]>(() => [
    {
      id: 'expand',
      enableSorting: false,
      enableHiding: false,
      header: () => null,
      cell: ({ row }) => {
        const rowId = row.original.posTransactionId || row.original.id;
        return expandedRows.has(rowId) ? <ChevronUp className="h-4 w-4 text-primary" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />;
      },
    },
    { accessorKey: 'siNumber', header: ({ column }) => <SortHeader column={column} label="SI No." />, cell: ({ row }) => {
      const siNo = row.original.siNumber ? String(row.original.siNumber).padStart(6, '0') : (row.original.orderNumber ? String(row.original.orderNumber).padStart(6, '0') : '-');
      return <span className="inline-flex items-center justify-center w-12 px-1 rounded-full bg-primary text-primary-foreground text-xs font-medium">{siNo}</span>;
    } },
    { accessorKey: 'date', header: ({ column }) => <SortHeader column={column} label="Date" />, cell: ({ row }) => { const d = row.original.date || row.original.invoiceDate; return d ? format(new Date(d), 'MMM dd, yyyy hh:mm a') : 'N/A'; } },
    { accessorKey: 'terminal', header: ({ column }) => <SortHeader column={column} label="Terminal" />, cell: ({ row }) => row.original.terminal || '-' },
    { accessorKey: 'cashier', header: ({ column }) => <SortHeader column={column} label="Cashier" />, cell: ({ row }) => row.original.cashier || '-' },
    { id: 'customer', accessorFn: (row) => row.customer?.name || 'Walk-in Customer', header: ({ column }) => <SortHeader column={column} label="Customer" />, cell: ({ row }) => row.original.customer?.name || 'Walk-in Customer' },
    { accessorKey: 'total', header: ({ column }) => <div className="text-right"><SortHeader column={column} label="Sales Amount" className="-mr-3" /></div>, cell: ({ row }) => <div className="text-right font-medium">{Number(row.original.total || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div> },
    { accessorKey: 'paymentMethod', header: ({ column }) => <SortHeader column={column} label="Payment Type" />, cell: ({ row }) => row.original.paymentMethod || '-' },
    { id: 'paymentStatus', accessorFn: (row) => row.paymentStatus || row.status, header: ({ column }) => <SortHeader column={column} label="Payment Status" />, cell: ({ row }) => { const isPaid = row.original.paymentStatus === 'completed' || row.original.status === 'Paid'; return <Badge variant={isPaid ? 'default' : 'destructive'}>{isPaid ? 'Paid' : row.original.status || 'Pending'}</Badge>; } },
  ], [expandedRows]);

  const table = useReactTable({
    data: filteredSales,
    columns,
    state: { sorting, columnVisibility },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    manualPagination: true,
    pageCount: totalPages,
  });

  // Totals come from the server, aggregated across ALL rows matching the active
  // filters/date range — not just the current page — so the summary cards reflect
  // the whole filtered result set instead of one page of it.
  const summaryTotals = useMemo<SalesTotals>(() => salesResult?.totals || {
    discounts: 0, revenue: 0, amountPaid: 0, customerBalance: 0, cost: 0,
    grossProfit: 0, vatableSales: 0, vatAmount: 0, nonVatSales: 0, accountPayments: 0,
  }, [salesResult]);

  const hasActiveFilters = !!(searchTerm || dateRange || terminalId !== 'all' ||
    paymentTypeFilter !== 'all' || salesStatusFilter !== 'all' || customerFilter ||
    (cashierFilter && cashierFilter !== 'all') || referenceNumberFilter);

  const resetFilters = () => {
    setSearchTerm(''); setDateRange(undefined); setTerminalId('all');
    setPaymentTypeFilter('all'); setSalesStatusFilter('all'); setCustomerFilter('');
    setCashierFilter('all'); setReferenceNumberFilter(''); setCurrentPage(1);
  };

  const clearFilterValues = () => {
    setPaymentTypeFilter('all'); setTerminalId('all'); setDateRange(undefined);
    setSalesStatusFilter('all'); setCustomerFilter(''); setCashierFilter('all');
    setReferenceNumberFilter('');
  };

  const fetchAllSalesForExport = async () => {
    const params = buildSalesParams();
    params.append('limit', '1000000');
    try {
      const res = await fetch(getApiUrl(`/sales/transactions?${params.toString()}`));
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const result = await res.json();
      return result.success && Array.isArray(result.data) ? result.data : [];
    } catch { return []; }
  };

  const exportToCSV = async () => {
    const data = await fetchAllSalesForExport();
    let printedBy = 'admin';
    try { const u = localStorage.getItem('mock-user-session'); if (u) { const user = JSON.parse(u); printedBy = user.display_name || user.email || 'admin'; } } catch {}
    let businessName = 'BUSINESS NAME';
    try { const r = await (await fetch(getApiUrl('/pos-settings'))).json(); if (r.success && r.data?.businessName) businessName = r.data.businessName; } catch {}
    const period = dateRange?.from ? `${format(dateRange.from, 'yyyy-MM-dd')} to ${dateRange.to ? format(dateRange.to, 'yyyy-MM-dd') : format(dateRange.from, 'yyyy-MM-dd')}` : 'All Time';
    const summary = data.reduce((acc: any, s: any) => ({ salesAmount: acc.salesAmount + Number(s.total || 0), discount: acc.discount + Number(s.discount || 0), amountPaid: acc.amountPaid + Number(s.amountPaid || s.total || 0), balance: acc.balance + Number(s.balance || 0), cost: acc.cost + Number(s.cost || 0), profit: acc.profit + Number(s.profit || 0) }), { salesAmount: 0, discount: 0, amountPaid: 0, balance: 0, cost: 0, profit: 0 });
    const fmt = (n: any) => Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const metadata = [[businessName], ['Printed by:', printedBy], ['Print Out Date:', format(new Date(), 'yyyy-MM-dd')], ['Period:', period], []];
    const headers = ['SI No.', 'Date', 'Terminal', 'Cashier', 'Customer', 'Discount', 'Sales Amount', 'Amount Paid', 'Balance', 'Cost', 'Profit'];
    const rows = data.map((s: any) => {
      const siNo = s.siNumber ? String(s.siNumber).padStart(6, '0') : (s.orderNumber ? String(s.orderNumber).padStart(6, '0') : '');
      return [siNo, s.date ? format(new Date(s.date), 'MMMM dd, yyyy hh:mm a') : '', s.terminal || '', s.cashier || '', s.customer?.name || 'Walk-in Customer', fmt(s.discount), fmt(s.total), fmt(s.amountPaid || s.total), fmt(s.balance), fmt(s.cost), fmt(s.profit)];
    });
    const totalRow = ['Grand Total', '', '', '', '', '', fmt(summary.discount), fmt(summary.salesAmount), fmt(summary.amountPaid), fmt(summary.balance), fmt(summary.cost), fmt(summary.profit)];
    const csv = [...metadata.map(r => r.map(c => `"${c}"`).join(',')), headers.join(','), ...rows.map((r: any[]) => r.map(c => `"${c}"`).join(',')), totalRow.map(c => `"${c}"`).join(',')].join('\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    link.download = `sales_transactions_${format(new Date(), 'yyyy-MM-dd')}.csv`;
    link.click();
  };

  const exportToPDF = async () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    printWindow.document.write('<html><head><title>Generating Report...</title></head><body><h1>Loading Sales Data...</h1></body></html>');
    let printedBy = 'admin';
    try { const u = localStorage.getItem('mock-user-session'); if (u) { const user = JSON.parse(u); printedBy = user.display_name || user.email || 'admin'; } } catch {}
    let data: any[] = []; let businessName = 'BUSINESS NAME';
    try {
      const [salesData, settingsRes] = await Promise.all([fetchAllSalesForExport(), fetch(getApiUrl('/pos-settings')).then(r => r.json()).catch(() => ({ success: false }))]);
      data = salesData;
      if (settingsRes.success && settingsRes.data?.businessName) businessName = settingsRes.data.businessName;
    } catch {}
    const reportSummary = data.reduce((acc: any, s: any) => ({ salesAmount: acc.salesAmount + Number(s.total || 0), discount: acc.discount + Number(s.discount || 0), amountPaid: acc.amountPaid + Number(s.amountPaid || s.total || 0), balance: acc.balance + Number(s.balance || 0), cost: acc.cost + Number(s.cost || 0), profit: acc.profit + Number(s.profit || 0) }), { salesAmount: 0, discount: 0, amountPaid: 0, balance: 0, cost: 0, profit: 0 });
    const period = dateRange?.from ? `${format(dateRange.from, 'yyyy-MM-dd')} to ${dateRange.to ? format(dateRange.to, 'yyyy-MM-dd') : format(dateRange.from, 'yyyy-MM-dd')}` : 'All Time';
    const fmt = (n: any) => Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const printContent = `<html><head><title>Sales Transaction Report</title><style>body{font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;font-size:10px;padding:20px;color:#000;}.header-container{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;}.business-name{font-size:14px;font-weight:bold;margin-bottom:10px;text-transform:uppercase;}.report-title{font-size:14px;font-weight:bold;text-align:right;}.meta-info{font-size:10px;line-height:1.4;}.meta-row{display:flex;}.meta-label{width:80px;}table{width:100%;border-collapse:collapse;margin-top:15px;}th{text-align:left;font-weight:bold;padding:6px;border-bottom:2px solid #000;font-size:10px;background-color:#f2f2f2;}td{padding:6px;font-size:10px;vertical-align:top;color:#333;border-bottom:1px solid #eee;}.row-main{font-weight:500;}.row-detail{background-color:#fafafa;color:#555;}.detail-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;padding:4px 8px;font-size:9px;}.detail-item{display:flex;flex-direction:column;}.detail-label{font-size:8px;color:#888;text-transform:uppercase;letter-spacing:0.5px;}.detail-value{font-weight:500;}.text-right{text-align:right;}.summary-box{margin-top:30px;border-top:2px solid #000;padding-top:10px;width:40%;margin-left:auto;}.summary-row{display:flex;justify-content:space-between;padding:3px 0;}.summary-total{font-weight:bold;font-size:11px;border-top:1px solid #ccc;padding-top:5px;margin-top:5px;}@media print{@page{margin:0.5cm;size:landscape;}body{margin:0;padding:0;}.row-detail{background-color:#f9f9f9!important;-webkit-print-color-adjust:exact;}th{background-color:#f2f2f2!important;-webkit-print-color-adjust:exact;}}</style></head><body><div class="header-container"><div><div class="business-name">${businessName}</div><div class="meta-info"><div class="meta-row"><span class="meta-label">Printed by:</span><span>${printedBy}</span></div><div class="meta-row"><span class="meta-label">Print Out Date:</span><span>${format(new Date(), 'yyyy-MM-dd')}</span></div><div class="meta-row"><span class="meta-label">Period:</span><span>${period}</span></div></div></div><div class="report-title">Sales Transaction Report</div></div><table><thead><tr><th style="width:10%">SI No.</th><th style="width:15%">Date</th><th style="width:25%">Customer</th><th style="width:15%">Payment Type</th><th style="width:15%">Status</th><th class="text-right" style="width:20%">Sales Amount</th></tr></thead><tbody>${data.map((s: any) => {
      const siNo = s.siNumber ? String(s.siNumber).padStart(6, '0') : (s.orderNumber ? String(s.orderNumber).padStart(6, '0') : '');
      return `<tr class="row-main"><td><strong>${siNo}</strong></td><td>${s.date ? format(new Date(s.date), 'MMM dd, yyyy HH:mm') : ''}</td><td>${s.customer?.name || 'Walk-in Customer'}</td><td>${s.paymentMethod || ''}</td><td>${s.paymentStatus || s.status || ''}</td><td class="text-right"><strong>${fmt(s.total)}</strong></td></tr><tr class="row-detail"><td colspan="6"><div class="detail-grid"><div class="detail-item"><span class="detail-label">Terminal / Cashier</span><span class="detail-value">${s.terminal || '-'} / ${s.cashier || '-'}</span></div><div class="detail-item"><span class="detail-label">Discount</span><span class="detail-value">${fmt(s.discount)}</span></div><div class="detail-item"><span class="detail-label">Amount Paid</span><span class="detail-value">${fmt(s.amountPaid || s.total)}</span></div><div class="detail-item"><span class="detail-label">Balance</span><span class="detail-value">${fmt(s.balance)}</span></div><div class="detail-item"><span class="detail-label">Cost</span><span class="detail-value">${fmt(s.cost)}</span></div><div class="detail-item"><span class="detail-label">Profit</span><span class="detail-value">${fmt(s.profit)}</span></div><div class="detail-item"><span class="detail-label">Tax</span><span class="detail-value">${fmt(Number(s.taxAmount || 0) + Number(s.nonVatSales || 0))}</span></div></div></td></tr>`;
    }).join('')}</tbody></table><div class="summary-box"><div class="summary-row"><span>Total Sales:</span><span>${fmt(reportSummary.salesAmount)}</span></div><div class="summary-row"><span>Total Discount:</span><span>${fmt(reportSummary.discount)}</span></div><div class="summary-row"><span>Total Cost:</span><span>${fmt(reportSummary.cost)}</span></div><div class="summary-row summary-total"><span>Total Profit:</span><span>${fmt(reportSummary.profit)}</span></div></div></body></html>`;
    printWindow.document.open();
    printWindow.document.write(printContent);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 500);
  };

  // combined "open dialog" handlers (set temp + open)
  const openPaymentTypeDialog = () => { setTempPaymentType(paymentTypeFilter); setPaymentTypeDialogOpen(true); };
  const openTerminalDialog = () => { setTempTerminalId(terminalId); setTerminalDialogOpen(true); };
  const openDateRangeDialog = () => { setTempDateRange(dateRange); setDateRangeDialogOpen(true); };
  const openSalesStatusDialog = () => { setTempSalesStatus(salesStatusFilter); setSalesStatusDialogOpen(true); };
  const openCustomerDialog = () => { setTempCustomer(customerFilter); setCustomerDialogOpen(true); };
  const openCashierDialog = () => { setTempCashier(cashierFilter); setCashierDialogOpen(true); };
  const openReferenceNumberDialog = () => { setTempReferenceNumber(referenceNumberFilter); setReferenceNumberDialogOpen(true); };

  // combined "apply filter" handlers (apply + close)
  const applyPaymentType = () => { setPaymentTypeFilter(tempPaymentType); setPaymentTypeDialogOpen(false); };
  const applyTerminal = () => { setTerminalId(tempTerminalId); setTerminalDialogOpen(false); };
  const applyDateRange = () => { setDateRange(tempDateRange); setDateRangeDialogOpen(false); };
  const applySalesStatus = () => { setSalesStatusFilter(tempSalesStatus); setSalesStatusDialogOpen(false); };
  const applyCustomer = () => { setCustomerFilter(tempCustomer); setCustomerDialogOpen(false); };
  const applyCashier = () => { setCashierFilter(tempCashier); setCashierDialogOpen(false); };
  const applyReferenceNumber = () => { setReferenceNumberFilter(tempReferenceNumber); setReferenceNumberDialogOpen(false); };

  return {
    // data
    sales, isLoading, users,
    // table
    table, columns,
    // expand
    expandedRows, toggleRowExpansion,
    // pagination
    currentPage, setCurrentPage, limit, setLimit, totalPages,
    // search
    searchTerm, setSearchTerm,
    // active filter values (for badge display)
    paymentTypeFilter, terminalId, dateRange, salesStatusFilter,
    customerFilter, cashierFilter, referenceNumberFilter,
    // filter dialog open states
    paymentTypeDialogOpen, setPaymentTypeDialogOpen,
    terminalDialogOpen, setTerminalDialogOpen,
    dateRangeDialogOpen, setDateRangeDialogOpen,
    salesStatusDialogOpen, setSalesStatusDialogOpen,
    customerDialogOpen, setCustomerDialogOpen,
    cashierDialogOpen, setCashierDialogOpen,
    referenceNumberDialogOpen, setReferenceNumberDialogOpen,
    // temp values
    tempPaymentType, setTempPaymentType,
    tempTerminalId, setTempTerminalId,
    tempDateRange, setTempDateRange,
    tempSalesStatus, setTempSalesStatus,
    tempCustomer, setTempCustomer,
    tempCashier, setTempCashier,
    tempReferenceNumber, setTempReferenceNumber,
    // combined handlers
    openPaymentTypeDialog, openTerminalDialog, openDateRangeDialog,
    openSalesStatusDialog, openCustomerDialog, openCashierDialog,
    openReferenceNumberDialog,
    applyPaymentType, applyTerminal, applyDateRange,
    applySalesStatus, applyCustomer, applyCashier,
    applyReferenceNumber,
    // computed
    summaryTotals, hasActiveFilters,
    // actions
    resetFilters, clearFilterValues, exportToCSV, exportToPDF,
  };
}
