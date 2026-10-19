'use client';

import { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import { DateRange } from 'react-day-picker';
import {
  CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Eye,
  Loader2,
  Printer,
  Repeat,
  Search,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { reprintStockAdjustment } from '@/lib/reprint-stock-adjustment';
import { cn } from '@/lib/utils';

import { TransactionDetailsDialog, type TransactionRef } from './TransactionDetailsDialog';

interface TransactionRow {
  id: string;
  kind: 'batch' | 'single' | 'transfer';
  mode: 'add' | 'remove' | 'transfer';
  transactionDate: string;
  referenceNo: string | null;
  notes: string | null;
  warehouseName: string | null;
  targetWarehouseName: string | null;
  itemCount: number;
  totalQuantity: number;
}

const modeConfig = {
  add: { label: 'Add', icon: TrendingUp, className: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/30' },
  remove: { label: 'Remove', icon: TrendingDown, className: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/30' },
  transfer: { label: 'Transfer', icon: Repeat, className: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/30' },
} as const;

const PAGE_SIZE = 15;

function TransactionSkeleton() {
  return (
    <TableRow>
      <TableCell><Skeleton className="h-5 w-36" /></TableCell>
      <TableCell><Skeleton className="h-6 w-20 rounded-full" /></TableCell>
      <TableCell><Skeleton className="h-5 w-24" /></TableCell>
      <TableCell><Skeleton className="h-5 w-32" /></TableCell>
      <TableCell className="text-center"><Skeleton className="h-5 w-8 mx-auto" /></TableCell>
      <TableCell className="text-center"><Skeleton className="h-5 w-10 mx-auto" /></TableCell>
      <TableCell><Skeleton className="h-8 w-20" /></TableCell>
    </TableRow>
  );
}

function TransactionTableRow({
  row,
  onView,
}: {
  row: TransactionRow;
  onView: (ref: TransactionRef) => void;
}) {
  const { toast } = useToast();
  const [isPrinting, setIsPrinting] = useState(false);

  const config = modeConfig[row.mode] || modeConfig.add;
  const Icon = config.icon;

  const handlePrint = async () => {
    setIsPrinting(true);
    const result = await reprintStockAdjustment(
      row.kind === 'transfer'
        ? { transferId: row.id }
        : row.kind === 'single'
          ? { adjustmentId: row.id }
          : { batchId: row.id }
    );
    setIsPrinting(false);
    if (!result.ok) {
      toast({ variant: 'destructive', title: 'Could not print slip', description: result.message });
    }
  };

  return (
    <TableRow>
      <TableCell className="whitespace-nowrap" suppressHydrationWarning>
        {(() => {
          try {
            return format(new Date(row.transactionDate), 'PP p');
          } catch {
            return '—';
          }
        })()}
      </TableCell>
      <TableCell>
        <Badge variant="outline" className={cn('text-[11px] gap-1', config.className)}>
          <Icon className="h-3 w-3" /> {config.label}
        </Badge>
      </TableCell>
      <TableCell className="font-mono text-xs">{row.referenceNo || '—'}</TableCell>
      <TableCell className="text-sm">
        {row.mode === 'transfer'
          ? `${row.warehouseName || '—'} → ${row.targetWarehouseName || '—'}`
          : row.warehouseName || 'All warehouses'}
      </TableCell>
      <TableCell className="text-center">{row.itemCount}</TableCell>
      <TableCell className="text-center font-semibold">
        {Number(row.totalQuantity).toLocaleString('en-US')}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => onView({ id: row.id, kind: row.kind })}
          >
            <Eye className="h-4 w-4" />
            <span className="text-xs">View Details</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            title="Print slip"
            onClick={handlePrint}
            disabled={isPrinting}
          >
            {isPrinting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

export default function AdjustmentHistoryPage() {
  const { toast } = useToast();

  const [rows, setRows] = useState<TransactionRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);

  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);

  const [viewing, setViewing] = useState<TransactionRef | null>(null);

  // Typing hits the server, so wait for a pause rather than firing per keystroke.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(searchTerm.trim()), 300);
    return () => clearTimeout(id);
  }, [searchTerm]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, dateRange]);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (dateRange?.from) params.set('startDate', format(dateRange.from, 'yyyy-MM-dd'));
      if (dateRange?.to) params.set('endDate', format(dateRange.to, 'yyyy-MM-dd'));

      const res = await fetch(`/api/inventory/adjust/batches?${params.toString()}`);
      const payload = await res.json();
      if (!payload.success) throw new Error(payload.error || 'Failed to load history');

      setRows(payload.data);
      setTotalPages(payload.pagination.totalPages);
      setTotalItems(payload.pagination.totalItems);
    } catch (err: any) {
      console.error('Failed to fetch adjustment history:', err);
      setError('Failed to load adjustment history. Please try again.');
      setRows([]);
    } finally {
      setIsLoading(false);
    }
  }, [page, debouncedSearch, dateRange]);

  useEffect(() => {
    load();
  }, [load]);

  const resetFilters = () => {
    setSearchTerm('');
    setDateRange(undefined);
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Adjustment History</CardTitle>
          <CardDescription>
            Stock adjustments and transfers, grouped as transactions. Open one to see its items.
          </CardDescription>
          <div className="flex flex-wrap items-center justify-between gap-4 pt-4">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search by product, reason or reference..."
                className="pl-8 sm:w-[320px]"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
            </div>
            {error && <div className="text-destructive text-sm font-medium flex items-center">{error}</div>}
            <div className="flex items-center gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn('w-[280px] justify-start text-left font-normal', !dateRange && 'text-muted-foreground')}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dateRange?.from ? (
                      dateRange.to ? (
                        <>{format(dateRange.from, 'LLL dd, y')} - {format(dateRange.to, 'LLL dd, y')}</>
                      ) : (
                        format(dateRange.from, 'LLL dd, y')
                      )
                    ) : (
                      <span>Pick a date range</span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end">
                  <Calendar
                    initialFocus
                    mode="range"
                    defaultMonth={dateRange?.from}
                    selected={dateRange}
                    onSelect={setDateRange}
                    numberOfMonths={2}
                  />
                </PopoverContent>
              </Popover>
              {(searchTerm || dateRange) && (
                <Button variant="ghost" onClick={resetFilters} size="icon">
                  <X className="h-4 w-4" />
                  <span className="sr-only">Reset filters</span>
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border overflow-hidden">
            <Table wrapperClassName="overflow-auto max-h-[calc(100vh-300px)]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Warehouse</TableHead>
                  <TableHead className="text-center">Items</TableHead>
                  <TableHead className="text-center">Total Qty</TableHead>
                  <TableHead className="w-[190px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && Array.from({ length: 5 }).map((_, i) => <TransactionSkeleton key={i} />)}
                {!isLoading && rows.length > 0 ? (
                  rows.map(row => (
                    <TransactionTableRow key={`${row.kind}-${row.id}`} row={row} onView={setViewing} />
                  ))
                ) : (
                  !isLoading && (
                    <TableRow>
                      <TableCell colSpan={7} className="h-24 text-center">
                        No transactions found for the selected criteria.
                      </TableCell>
                    </TableRow>
                  )
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between mt-4">
            <div className="text-sm text-muted-foreground">
              {totalItems === 0
                ? 'No entries'
                : `Showing ${(page - 1) * PAGE_SIZE + 1} to ${Math.min(page * PAGE_SIZE, totalItems)} of ${totalItems} transactions`}
            </div>
            <div className="flex items-center space-x-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1 || isLoading}
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || isLoading}
              >
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <TransactionDetailsDialog target={viewing} onClose={() => setViewing(null)} />
    </>
  );
}
