'use client';

import { AlertTriangle } from 'lucide-react';
import { formatCurrency, toSafeNumber } from '@/lib/utils';

import { Button } from '@/components/ui/button';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';

export function ReviewDialog({
  open,
  onOpenChange,
  count,
  items,
  countedCount,
  variancesCount,
  uncountedCount,
  isCompleting,
  onComplete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: any;
  items: any[];
  countedCount: number;
  variancesCount: number;
  uncountedCount: number;
  isCompleting: boolean;
  onComplete: () => void;
}) {
  const totalInventoryValue = items.reduce((sum, item) => {
    if (item.counted_quantity === null) return sum;
    return sum + item.counted_quantity * toSafeNumber(item.product_cost);
  }, 0);

  const totalVarianceAmount = items.reduce((sum, item) => {
    if (item.counted_quantity === null) return sum;
    const variance = item.counted_quantity - item.snapshot_quantity;
    return sum + variance * toSafeNumber(item.product_cost);
  }, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-5xl sm:max-w-5xl rounded-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Review Stock Count</DialogTitle>
          <DialogDescription>
            Review the variances before applying. Once completed, inventory levels will be
            adjusted immediately.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 my-2">
          {/* Stock count details */}
          <div className="bg-muted/40 rounded-xl p-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">Count Name</p>
              <p className="font-medium">{count.name}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">Created By</p>
              <p className="font-medium">{count.created_by || '—'}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">Date</p>
              <p className="font-medium">{new Date(count.created_at).toLocaleDateString()}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">Status</p>
              <p className="font-medium capitalize">{count.status.replace('_', ' ')}</p>
            </div>
            {count.notes && (
              <div className="col-span-2">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">Notes</p>
                <p className="text-muted-foreground italic">{count.notes}</p>
              </div>
            )}
          </div>

          {/* Uncounted warning */}
          {uncountedCount > 0 && (
            <div className="bg-amber-50 text-amber-900 dark:bg-amber-900/20 dark:text-amber-200 border border-amber-200 dark:border-amber-900/50 p-4 rounded-xl flex gap-3">
              <AlertTriangle className="h-5 w-5 flex-shrink-0 mt-0.5" />
              <div>
                <h4 className="font-medium text-sm">
                  Uncounted Items ({uncountedCount})
                </h4>
                <p className="text-xs mt-1 leading-relaxed">
                  These items will not be adjusted and remain at their current live stock
                  level.
                </p>
              </div>
            </div>
          )}

          {/* Summary chips */}
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-muted/50 rounded-xl p-3 text-center">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                Total
              </p>
              <p className="text-lg font-bold">{items.length}</p>
            </div>
            <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-xl p-3 text-center">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                Counted
              </p>
              <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                {countedCount}
              </p>
            </div>
            <div className="bg-red-50 dark:bg-red-900/20 rounded-xl p-3 text-center">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                Variances
              </p>
              <p className="text-lg font-bold text-red-600 dark:text-red-400">
                {variancesCount}
              </p>
            </div>
          </div>

          {/* Valuation chips */}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-muted/50 rounded-xl p-3 text-center">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                Inventory Value
              </p>
              <p className="text-lg font-bold">{formatCurrency(totalInventoryValue)}</p>
            </div>
            <div className="bg-muted/50 rounded-xl p-3 text-center">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                Variance Value
              </p>
              <p className={`text-lg font-bold ${
                totalVarianceAmount < 0
                  ? 'text-red-600 dark:text-red-400'
                  : totalVarianceAmount > 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-muted-foreground'
              }`}>
                {formatCurrency(totalVarianceAmount)}
              </p>
            </div>
          </div>

          {/* All items table */}
          <div>
            <h3 className="text-sm font-semibold mb-2">
              All Products ({items.length})
            </h3>

            {/* Mobile cards */}
            <div className="flex flex-col gap-2 sm:hidden">
              {items.map((item) => {
                const variance =
                  item.counted_quantity !== null
                    ? item.counted_quantity - item.snapshot_quantity
                    : null;
                const isUncounted = item.counted_quantity === null;
                const hasVar = variance !== null && variance !== 0;
                const varianceAmt = variance !== null ? variance * toSafeNumber(item.product_cost) : null;
                return (
                  <div
                    key={item.id}
                    className={`border rounded-xl px-3 py-2.5 ${
                      isUncounted
                        ? 'border-amber-200 bg-amber-50/50 dark:border-amber-900/40 dark:bg-amber-900/10'
                        : hasVar
                        ? variance! < 0
                          ? 'border-red-200 bg-red-50/50 dark:border-red-900/40 dark:bg-red-900/10'
                          : 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-900/40 dark:bg-emerald-900/10'
                        : 'border-border'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{item.product_name}</p>
                        {(item.product_sku || item.product_barcode) && (
                          <p className="text-xs text-muted-foreground">
                            {item.product_sku || item.product_barcode}
                          </p>
                        )}
                      </div>
                      {isUncounted ? (
                        <span className="flex-shrink-0 text-xs font-medium text-amber-600">Not counted</span>
                      ) : (
                        <span className={`flex-shrink-0 text-sm font-bold ${
                          !hasVar ? 'text-muted-foreground' : variance! < 0 ? 'text-red-500' : 'text-emerald-500'
                        }`}>
                          {!hasVar ? '±0' : variance! > 0 ? `+${variance}` : variance}
                        </span>
                      )}
                    </div>
                    <div className="flex gap-4 mt-1 text-xs text-muted-foreground">
                      <span>Expected: {item.snapshot_quantity}</span>
                      <span>Counted: {isUncounted ? '—' : item.counted_quantity}</span>
                      {!isUncounted && (
                        <span className={!hasVar ? 'text-muted-foreground' : variance! < 0 ? 'text-red-500' : 'text-emerald-500'}>
                          {formatCurrency(varianceAmt!)}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop table */}
            <div className="hidden sm:block border rounded-xl overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>SKU / Barcode</TableHead>
                    <TableHead className="text-right">Expected</TableHead>
                    <TableHead className="text-right">Counted</TableHead>
                    <TableHead className="text-right">Variance</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => {
                    const variance =
                      item.counted_quantity !== null
                        ? item.counted_quantity - item.snapshot_quantity
                        : null;
                    const isUncounted = item.counted_quantity === null;
                    const hasVar = variance !== null && variance !== 0;
                    const varianceAmt = variance !== null ? variance * toSafeNumber(item.product_cost) : null;
                    return (
                      <TableRow key={item.id} className={
                        isUncounted
                          ? 'bg-amber-50/40 dark:bg-amber-900/10'
                          : hasVar
                          ? variance! < 0
                            ? 'bg-red-50/40 dark:bg-red-900/10'
                            : 'bg-emerald-50/40 dark:bg-emerald-900/10'
                          : ''
                      }>
                        <TableCell className="font-medium">{item.product_name}</TableCell>
                        <TableCell className="text-muted-foreground text-xs">
                          {item.product_sku || item.product_barcode || '—'}
                        </TableCell>
                        <TableCell className="text-right">{item.snapshot_quantity}</TableCell>
                        <TableCell className="text-right font-medium">
                          {isUncounted ? <span className="text-amber-500">—</span> : item.counted_quantity}
                        </TableCell>
                        <TableCell className={`text-right font-bold ${
                          isUncounted
                            ? 'text-amber-500'
                            : !hasVar
                            ? 'text-muted-foreground'
                            : variance! < 0
                            ? 'text-red-500'
                            : 'text-emerald-500'
                        }`}>
                          {isUncounted ? 'Not counted' : !hasVar ? '±0' : variance! > 0 ? `+${variance}` : variance}
                        </TableCell>
                        <TableCell className={`text-right font-medium ${
                          !hasVar || isUncounted
                            ? 'text-muted-foreground'
                            : variance! < 0
                            ? 'text-red-500'
                            : 'text-emerald-500'
                        }`}>
                          {isUncounted ? '—' : formatCurrency(varianceAmt!)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>

        <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isCompleting}
            className="flex-1 sm:flex-none"
          >
            Continue Counting
          </Button>
          <Button
            onClick={onComplete}
            disabled={isCompleting}
            className="flex-1 sm:flex-none"
          >
            {isCompleting ? 'Applying Variances…' : 'Complete Count & Adjust Stock'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
