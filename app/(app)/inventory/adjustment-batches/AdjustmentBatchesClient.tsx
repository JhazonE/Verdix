'use client';

import { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Printer,
  Repeat,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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

interface BatchRow {
  id: string;
  kind: 'batch' | 'transfer';
  mode: 'add' | 'remove' | 'transfer';
  transactionDate: string;
  referenceNo: string | null;
  notes: string | null;
  warehouseName: string | null;
  targetWarehouseName: string | null;
  itemCount: number;
  totalQuantity: number;
}

const modeBadge = {
  add: { label: 'Add', icon: TrendingUp, className: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/30' },
  remove: { label: 'Remove', icon: TrendingDown, className: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/30' },
  transfer: { label: 'Transfer', icon: Repeat, className: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/30' },
} as const;

export default function AdjustmentBatchesClient() {
  const { toast } = useToast();

  const [rows, setRows] = useState<BatchRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  // Which row is currently printing, so only its own button shows a spinner.
  const [printingId, setPrintingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);

      const res = await fetch(`/api/inventory/adjust/batches?${params.toString()}`);
      const payload = await res.json();
      if (payload.success) {
        setRows(payload.data);
        setTotalPages(payload.pagination.totalPages);
      } else {
        throw new Error(payload.error || 'Failed to load batches');
      }
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Could not load batches', description: error.message });
    } finally {
      setIsLoading(false);
    }
  }, [page, startDate, endDate, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const handleReprint = async (row: BatchRow) => {
    setPrintingId(row.id);
    const result = await reprintStockAdjustment(
      row.kind === 'transfer' ? { transferId: row.id } : { batchId: row.id }
    );
    setPrintingId(null);
    if (!result.ok) {
      toast({ variant: 'destructive', title: 'Could not print slip', description: result.message });
    }
  };

  return (
    <Card>
      <CardContent className="p-4 md:p-6 space-y-4">
        {/* Date filters */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">From</label>
            <Input
              type="date"
              value={startDate}
              onChange={e => { setStartDate(e.target.value); setPage(1); }}
              className="h-9 w-[160px]"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">To</label>
            <Input
              type="date"
              value={endDate}
              onChange={e => { setEndDate(e.target.value); setPage(1); }}
              className="h-9 w-[160px]"
            />
          </div>
          {(startDate || endDate) && (
            <Button
              variant="ghost"
              className="h-9"
              onClick={() => { setStartDate(''); setEndDate(''); setPage(1); }}
            >
              Clear
            </Button>
          )}
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : rows.length === 0 ? (
          <div className="py-16 text-center">
            <p className="font-semibold">No batches found</p>
            <p className="text-sm text-muted-foreground mt-1">
              Bulk adjustments made before this feature was added are not grouped into batches —
              reprint those individually from Inventory → History.
            </p>
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-xs font-bold uppercase tracking-wider">Date</TableHead>
                  <TableHead className="text-xs font-bold uppercase tracking-wider">Type</TableHead>
                  <TableHead className="text-xs font-bold uppercase tracking-wider">Reference</TableHead>
                  <TableHead className="text-xs font-bold uppercase tracking-wider">Warehouse</TableHead>
                  <TableHead className="text-xs font-bold uppercase tracking-wider text-center">Items</TableHead>
                  <TableHead className="text-xs font-bold uppercase tracking-wider text-center">Total Qty</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => {
                  const badge = modeBadge[row.mode] || modeBadge.add;
                  const Icon = badge.icon;
                  return (
                    <TableRow key={`${row.kind}-${row.id}`}>
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
                        <Badge variant="outline" className={cn('text-[11px] gap-1', badge.className)}>
                          <Icon className="h-3 w-3" /> {badge.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{row.referenceNo || '—'}</TableCell>
                      <TableCell className="text-sm">
                        {row.mode === 'transfer'
                          ? `${row.warehouseName || '—'} → ${row.targetWarehouseName || '—'}`
                          : row.warehouseName || 'All warehouses'}
                      </TableCell>
                      <TableCell className="text-center">{row.itemCount}</TableCell>
                      <TableCell className="text-center font-semibold">{row.totalQuantity}</TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Reprint slip"
                          onClick={() => handleReprint(row)}
                          disabled={printingId === row.id}
                        >
                          {printingId === row.id
                            ? <Loader2 className="h-4 w-4 animate-spin" />
                            : <Printer className="h-4 w-4" />}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-muted-foreground">Page {page} of {totalPages}</span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page <= 1}
                >
                  <ChevronLeft className="h-4 w-4" /> Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                >
                  Next <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
