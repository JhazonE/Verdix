'use client';

import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Loader2, Printer, Repeat, TrendingDown, TrendingUp } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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

export interface TransactionRef {
  id: string;
  kind: 'batch' | 'single' | 'transfer';
}

interface TransactionItem {
  productName: string;
  barcode: string | null;
  unitOfMeasure: string | null;
  quantity: number;
  previousStock: number | null;
  newStock: number | null;
  reason: string | null;
}

interface TransactionDetails {
  id: string;
  kind: string;
  mode: 'add' | 'remove' | 'transfer';
  transactionDate: string;
  referenceNo: string | null;
  notes: string | null;
  warehouseName: string | null;
  targetWarehouseName: string | null;
  supplierName: string | null;
  hasStockFigures: boolean;
  items: TransactionItem[];
}

const modeConfig = {
  add: { label: 'Add Stock', icon: TrendingUp, className: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/30' },
  remove: { label: 'Remove Stock', icon: TrendingDown, className: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/30' },
  transfer: { label: 'Transfer', icon: Repeat, className: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/30' },
} as const;

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 py-1 text-sm">
      <span className="font-medium text-muted-foreground shrink-0">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

export function TransactionDetailsDialog({
  target,
  onClose,
}: {
  target: TransactionRef | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [data, setData] = useState<TransactionDetails | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);

  useEffect(() => {
    if (!target) {
      setData(null);
      return;
    }
    let cancelled = false;

    (async () => {
      setIsLoading(true);
      try {
        const params = new URLSearchParams({ id: target.id, kind: target.kind });
        const res = await fetch(`/api/inventory/adjust/transaction?${params.toString()}`);
        const payload = await res.json();
        // The dialog may have been closed or switched while this was in
        // flight; dropping a stale response keeps it from overwriting the
        // newer one.
        if (cancelled) return;
        if (payload.success) {
          setData(payload.data);
        } else {
          throw new Error(payload.error || 'Failed to load transaction');
        }
      } catch (error: any) {
        if (!cancelled) {
          toast({ variant: 'destructive', title: 'Could not load details', description: error.message });
          onClose();
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [target, toast, onClose]);

  const handlePrint = async () => {
    if (!target) return;
    setIsPrinting(true);
    const result = await reprintStockAdjustment(
      target.kind === 'transfer'
        ? { transferId: target.id }
        : target.kind === 'single'
          ? { adjustmentId: target.id }
          : { batchId: target.id }
    );
    setIsPrinting(false);
    if (!result.ok) {
      toast({ variant: 'destructive', title: 'Could not print slip', description: result.message });
    }
  };

  const config = data ? modeConfig[data.mode] || modeConfig.add : null;
  const Icon = config?.icon;
  const showStock = Boolean(data?.hasStockFigures);
  const totalQty = data?.items.reduce((sum, i) => sum + (Number(i.quantity) || 0), 0) ?? 0;

  return (
    <Dialog open={target !== null} onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Transaction Details
            {config && Icon && (
              <Badge variant="outline" className={cn('text-[11px] gap-1', config.className)}>
                <Icon className="h-3 w-3" /> {config.label}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            {data
              ? `${data.items.length} item${data.items.length !== 1 ? 's' : ''} in this transaction.`
              : 'Loading the items in this transaction…'}
          </DialogDescription>
        </DialogHeader>

        {isLoading || !data ? (
          <div className="space-y-2 py-4">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-x-8 sm:grid-cols-2 rounded-lg border p-4">
              <div>
                <Field
                  label="Date"
                  value={(() => {
                    try {
                      return format(new Date(data.transactionDate), 'PP p');
                    } catch {
                      return '—';
                    }
                  })()}
                />
                <Field label="Reference No." value={data.referenceNo || 'Not specified'} />
                <Field label="Supplier" value={data.supplierName || 'None / External'} />
              </div>
              <div>
                {data.mode === 'transfer' ? (
                  <>
                    <Field label="From" value={data.warehouseName || 'Not specified'} />
                    <Field label="To" value={data.targetWarehouseName || 'Not specified'} />
                  </>
                ) : (
                  <Field label="Warehouse" value={data.warehouseName || 'All warehouses'} />
                )}
                <Field label="Total Quantity" value={totalQty.toLocaleString('en-US')} />
              </div>
            </div>

            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-xs font-bold uppercase tracking-wider">Product</TableHead>
                  <TableHead className="text-xs font-bold uppercase tracking-wider text-center">Unit</TableHead>
                  <TableHead className="text-xs font-bold uppercase tracking-wider text-center">Qty</TableHead>
                  {showStock && (
                    <>
                      <TableHead className="text-xs font-bold uppercase tracking-wider text-center">Prev.</TableHead>
                      <TableHead className="text-xs font-bold uppercase tracking-wider text-center">New</TableHead>
                    </>
                  )}
                  <TableHead className="text-xs font-bold uppercase tracking-wider">Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((item, i) => (
                  <TableRow key={`${item.productName}-${i}`}>
                    <TableCell>
                      <div className="font-medium">{item.productName}</div>
                      {item.barcode && (
                        <div className="font-mono text-[10px] text-muted-foreground">{item.barcode}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-center text-sm">{item.unitOfMeasure || '—'}</TableCell>
                    <TableCell className="text-center font-semibold">
                      {Number(item.quantity).toLocaleString('en-US')}
                    </TableCell>
                    {showStock && (
                      <>
                        <TableCell className="text-center text-sm">
                          {item.previousStock === null ? '—' : Number(item.previousStock).toLocaleString('en-US')}
                        </TableCell>
                        <TableCell className="text-center text-sm font-semibold">
                          {item.newStock === null ? '—' : Number(item.newStock).toLocaleString('en-US')}
                        </TableCell>
                      </>
                    )}
                    <TableCell className="text-xs text-muted-foreground italic">
                      {item.reason || '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {data.notes && (
              <div className="rounded-lg border p-3">
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
                  Notes
                </div>
                <div className="text-sm whitespace-pre-wrap">{data.notes}</div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button onClick={handlePrint} disabled={isPrinting || isLoading} className="gap-2">
            {isPrinting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
            Print Slip
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
