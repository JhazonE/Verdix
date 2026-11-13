'use client';

import { Fragment, useState, useEffect } from 'react';
import { Card, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { Loader2, Printer, ClipboardX, FileSpreadsheet } from 'lucide-react';
import { format } from 'date-fns';
import { ReportHeader } from '@/components/reports/ReportHeader';
import { getApiUrl } from '@/lib/api-config';
import { REPORT_FETCH_TIMEOUT_MS } from '@/lib/fetch-report';
import { formatQuantity, formatCurrency, cn } from '@/lib/utils';
import { DataTablePagination } from '@/components/ui/data-table-pagination';
import { printReportTable, exportReportExcel } from '@/lib/report-print';
import { ReportSearchInput } from '@/components/reports/ReportSearchInput';
import { useToast } from '@/hooks/use-toast';
import { reprintStockAdjustment, type ReprintTarget } from '@/lib/reprint-stock-adjustment';

type Mode = 'add' | 'remove' | 'transfer';

interface AdjustmentLine {
  id: string;
  product_name: string | null;
  barcode: string | null;
  unit_of_measure: string;
  reason: string | null;
  /** Signed base units for add/remove; a transfer's is the (positive) amount moved. */
  quantity: number;
  /** NULL for transfers, which record no resulting stock. */
  new_stock: number | null;
  /** Cost of one base unit: the cost captured on the line, else the product's cost. */
  unit_cost: number;
  /** quantity × unit_cost — signed, so a removal is negative. */
  total_cost: number;
}

/**
 * One Adjustment History transaction. The API reads the same shared
 * definition History does (lib/adjustment-history-lines.ts), so these are the
 * same transactions, under the same reference numbers, in the same order.
 */
interface AdjustmentTransaction {
  id: string;
  kind: 'batch' | 'single' | 'transfer';
  mode: Mode;
  transaction_date: string;
  reference_no: string | null;
  notes: string | null;
  warehouse_name: string | null;
  target_warehouse_name: string | null;
  item_count: number;
  total_quantity: number;
  total_cost: number;
  lines: AdjustmentLine[];
}

interface CostTotals {
  transactions: number;
  lines: number;
  netCost: number;
  removedCost: number;
  addedCost: number;
  transferredCost: number;
}

const EMPTY_TOTALS: CostTotals = { transactions: 0, lines: 0, netCost: 0, removedCost: 0, addedCost: 0, transferredCost: 0 };

const MODE_LABEL: Record<Mode, string> = { add: 'Add', remove: 'Remove', transfer: 'Transfer' };
const MODE_CLASS: Record<Mode, string> = {
  add: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/30',
  remove: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/30',
  transfer: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/30',
};

function formatSignedCurrency(value: number | string): string {
  const n = Number(value) || 0;
  return n < 0 ? `-${formatCurrency(-n)}` : formatCurrency(n);
}

function formatDate(value: string): string {
  try {
    return format(new Date(value), 'MMM dd, yyyy HH:mm');
  } catch {
    return '—';
  }
}

function warehouseText(t: AdjustmentTransaction): string {
  return t.mode === 'transfer'
    ? `${t.warehouse_name || '—'} → ${t.target_warehouse_name || '—'}`
    : t.warehouse_name || 'All warehouses';
}

function quantityText(l: AdjustmentLine, mode: Mode): string {
  const sign = mode !== 'transfer' && Number(l.quantity) > 0 ? '+' : '';
  return `${sign}${formatQuantity(l.quantity, l.unit_of_measure)}`;
}

function reasonText(l: AdjustmentLine, mode: Mode): string {
  return l.reason || (mode === 'transfer' ? 'Transfer' : '—');
}

function reprintTarget(t: AdjustmentTransaction): ReprintTarget {
  if (t.kind === 'transfer') return { transferId: t.id };
  if (t.kind === 'batch') return { batchId: t.id };
  return { adjustmentId: t.id };
}

// ── Print / Excel ────────────────────────────────────────────────────────────
// The shared printers take a flat table, so the grouping is written as rows:
// a transaction header row (date, reference, type, warehouse, its total)
// followed by its item rows.
type PrintRow =
  | { type: 'tx'; tx: AdjustmentTransaction }
  | { type: 'line'; tx: AdjustmentTransaction; line: AdjustmentLine };

function toPrintRows(txs: AdjustmentTransaction[]): PrintRow[] {
  return txs.flatMap<PrintRow>((tx) => [
    { type: 'tx', tx },
    ...tx.lines.map((line) => ({ type: 'line' as const, tx, line })),
  ]);
}

const printColumns = [
  { header: 'Date', cell: (r: PrintRow) => (r.type === 'tx' ? formatDate(r.tx.transaction_date) : '') },
  { header: 'Reference', cell: (r: PrintRow) => (r.type === 'tx' ? r.tx.reference_no || '—' : '') },
  { header: 'Type', cell: (r: PrintRow) => (r.type === 'tx' ? MODE_LABEL[r.tx.mode] ?? r.tx.mode : '') },
  { header: 'Warehouse', cell: (r: PrintRow) => (r.type === 'tx' ? warehouseText(r.tx) : '') },
  {
    header: 'Product',
    cell: (r: PrintRow) =>
      r.type === 'tx'
        ? `${r.tx.item_count} item${r.tx.item_count === 1 ? '' : 's'}`
        : `${r.line.product_name || '—'}${r.line.barcode ? ` (${r.line.barcode})` : ''}`,
  },
  { header: 'Reason', cell: (r: PrintRow) => (r.type === 'line' ? reasonText(r.line, r.tx.mode) : '') },
  { header: 'Quantity', align: 'right' as const, cell: (r: PrintRow) => (r.type === 'line' ? quantityText(r.line, r.tx.mode) : '') },
  {
    header: 'New Stock',
    align: 'right' as const,
    cell: (r: PrintRow) =>
      r.type === 'line' && r.line.new_stock !== null ? formatQuantity(r.line.new_stock, r.line.unit_of_measure) : '',
  },
  { header: 'Unit Cost', align: 'right' as const, cell: (r: PrintRow) => (r.type === 'line' ? formatCurrency(r.line.unit_cost) : '') },
  {
    header: 'Total Cost',
    align: 'right' as const,
    emphasize: true,
    cell: (r: PrintRow) => formatSignedCurrency(r.type === 'tx' ? r.tx.total_cost : r.line.total_cost),
  },
];

/** Totals row aligned to the 10 print/export columns. */
function totalsRow(t: CostTotals): (string | null)[] {
  return [null, null, null, null, `${t.transactions} transactions`, null, null, null, 'NET (excl. transfers)', formatSignedCurrency(t.netCost)];
}

/** Reprints the slip of one transaction. */
function SlipPrintButton({ tx }: { tx: AdjustmentTransaction }) {
  const { toast } = useToast();
  const [isPrinting, setIsPrinting] = useState(false);

  const handleClick = async () => {
    setIsPrinting(true);
    const result = await reprintStockAdjustment(reprintTarget(tx));
    setIsPrinting(false);
    if (!result.ok) {
      toast({ variant: 'destructive', title: 'Could not print slip', description: result.message });
    }
  };

  return (
    <Button variant="ghost" size="icon" title="Reprint this transaction's slip" onClick={handleClick} disabled={isPrinting}>
      {isPrinting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
    </Button>
  );
}

const COLS = 7;

export default function AdjustmentReportPage() {
  const { toast } = useToast();
  const [transactions, setTransactions] = useState<AdjustmentTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const [startDate, setStartDate] = useState(format(new Date().setDate(new Date().getDate() - 30), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [totals, setTotals] = useState<CostTotals>(EMPTY_TOTALS);

  const [isPrinting, setIsPrinting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // Search runs on the server (the same match History uses), so wait for a
  // pause in typing rather than firing per keystroke.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(searchTerm.trim()), 300);
    return () => clearTimeout(id);
  }, [searchTerm]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, startDate, endDate]);

  const buildParams = (p: number, limit: number) => {
    const params = new URLSearchParams();
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);
    if (debouncedSearch) params.append('search', debouncedSearch);
    params.append('page', String(p));
    params.append('limit', String(limit));
    return params;
  };

  /** Every transaction for the current filter, for print/export. Null on failure. */
  const fetchAll = async (): Promise<{ rows: AdjustmentTransaction[]; totals: CostTotals } | null> => {
    try {
      const res = await fetch(getApiUrl(`/reports/adjustments?${buildParams(1, 100000).toString()}`), { signal: AbortSignal.timeout(REPORT_FETCH_TIMEOUT_MS) });
      const data = await res.json();
      if (data.success && Array.isArray(data.data)) return { rows: data.data, totals: data.totals ?? EMPTY_TOTALS };
    } catch {
      // handled by the caller
    }
    return null;
  };

  const handlePrint = async () => {
    setIsPrinting(true);
    try {
      const all = await fetchAll();
      if (!all) {
        toast({ variant: 'destructive', title: 'Print Failed', description: 'Could not load the report. Please try again.' });
        return;
      }
      printReportTable<PrintRow>({
        title: 'Stock Adjustment Report',
        subtitle: 'Adjustment History transactions by reference number, with cost.',
        period: `${startDate} to ${endDate}`,
        columns: printColumns,
        rows: toPrintRows(all.rows),
        totals: totalsRow(all.totals),
        emptyMessage: 'No adjustments found for this period.',
      });
    } finally {
      setIsPrinting(false);
    }
  };

  const exportToExcel = async () => {
    setIsExporting(true);
    try {
      const all = await fetchAll();
      if (!all) {
        toast({ title: 'Export Failed', description: 'Could not load the report. Please try again.', variant: 'destructive' });
        return;
      }
      const fileName = `Stock_Adjustments_${format(new Date(startDate), 'yyyyMMdd')}_${format(new Date(endDate), 'yyyyMMdd')}.xls`;
      const ok = exportReportExcel<PrintRow>({
        title: 'Stock Adjustment Report',
        subtitle: `${startDate} to ${endDate}`,
        columns: printColumns,
        rows: toPrintRows(all.rows),
        totals: totalsRow(all.totals),
        fileName,
      });
      if (!ok) {
        toast({ title: 'No Data', description: 'No records to export.', variant: 'destructive' });
        return;
      }
      toast({ title: 'Excel Exported', description: `Report saved as ${fileName}` });
    } catch (err) {
      console.error('Failed to export adjustments to Excel:', err);
      toast({ title: 'Export Failed', description: 'Could not export the report. Please try again.', variant: 'destructive' });
    } finally {
      setIsExporting(false);
    }
  };

  // Every input the request is built from belongs here, so a page always
  // covers the same range and search as the one before it.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(getApiUrl(`/reports/adjustments?${buildParams(page, pageSize).toString()}`), { signal: AbortSignal.timeout(REPORT_FETCH_TIMEOUT_MS) });
        if (!res.ok) throw new Error(`API error ${res.status}`);
        const data = await res.json();
        // A 200 carrying success:false is how this API reports its own errors.
        if (!data.success) throw new Error(data.details || data.error || 'The report could not be generated.');
        if (cancelled) return;
        setTransactions(data.data);
        setTotals(data.totals ?? EMPTY_TOTALS);
        if (data.pagination) {
          setTotalPages(data.pagination.totalPages);
          setTotalItems(data.pagination.totalItems);
        }
      } catch (err) {
        console.error('Failed to fetch adjustments:', err);
        if (!cancelled) {
          setError('Failed to load the report. Please try again.');
          setTransactions([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, startDate, endDate, debouncedSearch]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Adjustment / Damaged Report</h2>
          <p className="text-muted-foreground">
            Adjustment History transactions by reference number, with unit and total cost.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ReportSearchInput
            value={searchTerm}
            onChange={setSearchTerm}
            placeholder="Search product, reason or reference..."
          />
          <Button onClick={() => handlePrint()} variant="outline" className="gap-2" disabled={isPrinting}>
            {isPrinting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
            Print Report
          </Button>
          <Button
            onClick={() => exportToExcel()}
            variant="outline"
            className="gap-2 border-emerald-700 text-emerald-700 hover:bg-emerald-50"
            disabled={isExporting || transactions.length === 0}
          >
            {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
            Export to Excel
          </Button>
        </div>
      </div>

      <Card className="print:hidden">
        <CardHeader>
          <div className="flex flex-wrap gap-4 items-end">
            <div className="grid gap-2">
              <label className="text-sm font-medium">Start Date</label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-[180px]" />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium">End Date</label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-[180px]" />
            </div>
            {error && <div className="text-destructive text-sm font-medium">{error}</div>}
          </div>
        </CardHeader>
      </Card>

      <div className="bg-background p-4 rounded-md border">
        <ReportHeader
          title="Stock Adjustment Report"
          subtitle="Adjustment History transactions by reference number, with cost."
          period={`${startDate} to ${endDate}`}
        />

        <div className="rounded-md border mb-4 print:border-none print:overflow-visible overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Barcode</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead className="text-right">New Stock</TableHead>
                <TableHead className="text-right">Unit Cost</TableHead>
                <TableHead className="text-right">Total Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={COLS} className="h-24 text-center">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                  </TableCell>
                </TableRow>
              ) : transactions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={COLS} className="h-24 text-center">
                    No adjustments found for this period.
                  </TableCell>
                </TableRow>
              ) : (
                transactions.map((tx) => (
                  <Fragment key={`${tx.kind}-${tx.id}`}>
                    {/* Transaction header — the same row Adjustment History shows. */}
                    <TableRow className="bg-muted/60 hover:bg-muted/60 border-t-2">
                      <TableCell colSpan={COLS}>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                          <span className="font-mono text-sm font-bold">{tx.reference_no || '—'}</span>
                          <Badge variant="outline" className={cn('text-[11px]', MODE_CLASS[tx.mode])}>
                            {MODE_LABEL[tx.mode] ?? tx.mode}
                          </Badge>
                          <span className="text-sm text-muted-foreground">{formatDate(tx.transaction_date)}</span>
                          <span className="text-sm">{warehouseText(tx)}</span>
                          <span className="text-sm text-muted-foreground">
                            {tx.item_count} item{tx.item_count === 1 ? '' : 's'}
                          </span>
                          {tx.notes && <span className="text-sm italic text-muted-foreground">{tx.notes}</span>}
                          <span className="ml-auto flex items-center gap-2">
                            <span
                              className={cn(
                                'text-sm font-bold',
                                tx.mode === 'transfer' ? 'text-blue-600' : tx.total_cost < 0 ? 'text-red-600' : ''
                              )}
                            >
                              {formatSignedCurrency(tx.total_cost)}
                            </span>
                            <span className="print:hidden">
                              <SlipPrintButton tx={tx} />
                            </span>
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                    {tx.lines.map((line) => (
                      <TableRow key={line.id}>
                        <TableCell className="pl-8 font-medium">{line.product_name || '—'}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{line.barcode || '-'}</TableCell>
                        <TableCell className="capitalize">
                          {line.reason === 'damaged' && <ClipboardX className="inline-block w-4 h-4 mr-1 text-red-500" />}
                          {reasonText(line, tx.mode)}
                        </TableCell>
                        <TableCell
                          className={cn(
                            'text-right font-bold',
                            tx.mode === 'transfer' ? 'text-blue-600' : Number(line.quantity) > 0 ? 'text-green-600' : 'text-red-600'
                          )}
                        >
                          {quantityText(line, tx.mode)}
                        </TableCell>
                        <TableCell className="text-right">
                          {line.new_stock === null ? '—' : formatQuantity(line.new_stock, line.unit_of_measure)}
                        </TableCell>
                        <TableCell className="text-right">{formatCurrency(line.unit_cost)}</TableCell>
                        <TableCell
                          className={cn(
                            'text-right font-semibold',
                            tx.mode === 'transfer' ? 'text-muted-foreground' : line.total_cost < 0 ? 'text-red-600' : ''
                          )}
                        >
                          {formatSignedCurrency(line.total_cost)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </Fragment>
                ))
              )}
            </TableBody>
            {!loading && transactions.length > 0 && (
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={6} className="text-right font-bold">
                    Net (whole period, excl. transfers)
                  </TableCell>
                  <TableCell className={cn('text-right font-bold', totals.netCost < 0 && 'text-red-600')}>
                    {formatSignedCurrency(totals.netCost)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </div>

        {!loading && transactions.length > 0 && (
          <div className="flex flex-wrap justify-end gap-6 text-sm mb-4">
            <span>
              Transactions: <span className="font-semibold">{totals.transactions.toLocaleString('en-US')}</span>
            </span>
            <span>
              Removed / Damaged: <span className="font-semibold text-red-600">{formatCurrency(totals.removedCost)}</span>
            </span>
            <span>
              Added: <span className="font-semibold text-green-600">{formatCurrency(totals.addedCost)}</span>
            </span>
            <span>
              Transferred: <span className="font-semibold text-blue-600">{formatCurrency(totals.transferredCost)}</span>
            </span>
          </div>
        )}

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
