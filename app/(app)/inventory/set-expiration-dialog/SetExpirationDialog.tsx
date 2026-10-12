'use client';

import { CalendarClock, PackageOpen } from 'lucide-react';

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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { Product } from '@/lib/types';
import { formatQuantity } from '@/lib/utils';

import { useSetExpiration } from './use-set-expiration';

/**
 * Sets expiration dates on stock already on hand, without adjusting it.
 *
 * Dates are per batch because that is where expiry lives — a June delivery and
 * a July delivery of the same product keep separate dates, which is what FIFO
 * deduction and the expiring-soon report already assume.
 */
export function SetExpirationDialog({
  product,
  open,
  onOpenChange,
  onSuccess,
}: {
  product: Product;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}) {
  const {
    batches,
    isLoading,
    isSaving,
    untrackedQuantity,
    untrackedExpiration,
    setUntrackedExpiration,
    setBatchExpiration,
    applyDateToAll,
    hasChanges,
    pastDateCount,
    save,
  } = useSetExpiration({ product, open, onOpenChange, onSuccess });

  const rowCount = batches.length + (untrackedQuantity > 0 ? 1 : 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <CalendarClock className="h-5 w-5 text-primary" />
            </div>
            <div>
              <DialogTitle>Set Expiration</DialogTitle>
              <DialogDescription className="text-xs mt-0.5">
                {product.name} — stock will not be changed.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-3 py-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full rounded-lg" />
            ))}
          </div>
        ) : rowCount === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 text-muted-foreground py-12">
            <PackageOpen className="h-10 w-10 opacity-20" />
            <p className="text-sm font-medium">No stock on hand</p>
            <p className="text-xs text-center max-w-[380px]">
              There is nothing to date. Receive stock for this product first, or set the
              expiration while adding stock in Adjust Stock.
            </p>
          </div>
        ) : (
          <div className="space-y-3 py-2">
            {rowCount > 1 && (
              <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-muted/40 border">
                <Label htmlFor="applyAll" className="text-xs text-muted-foreground">
                  Same date for all
                </Label>
                <Input
                  id="applyAll"
                  type="date"
                  className="h-8 w-[160px] bg-background"
                  onChange={(e) => applyDateToAll(e.target.value)}
                />
              </div>
            )}

            <div className="max-h-[320px] overflow-auto rounded-lg border">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow>
                    <TableHead className="text-xs">Batch</TableHead>
                    <TableHead className="text-xs">Received</TableHead>
                    <TableHead className="text-right text-xs">Remaining</TableHead>
                    <TableHead className="text-xs w-[170px]">Expiration</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {batches.map((batch) => (
                    <TableRow key={batch.id} className="text-xs">
                      <TableCell className="font-mono font-semibold text-[11px] text-primary">
                        {batch.id}
                        {batch.poReference && (
                          <span className="block text-[10px] text-muted-foreground font-normal uppercase">
                            {batch.poReference}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {batch.receivedDate ? String(batch.receivedDate).slice(0, 10) : '—'}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {formatQuantity(batch.quantityRemaining)}
                      </TableCell>
                      <TableCell>
                        <Input
                          type="date"
                          className="h-8"
                          value={batch.expirationDate}
                          onChange={(e) => setBatchExpiration(batch.id, e.target.value)}
                        />
                      </TableCell>
                    </TableRow>
                  ))}

                  {untrackedQuantity > 0 && (
                    <TableRow className="text-xs bg-amber-500/5">
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className="text-[10px] px-1.5 h-5 text-amber-700 dark:text-amber-500"
                        >
                          Untracked
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">—</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {formatQuantity(untrackedQuantity)}
                      </TableCell>
                      <TableCell>
                        <Input
                          type="date"
                          className="h-8"
                          value={untrackedExpiration}
                          onChange={(e) => setUntrackedExpiration(e.target.value)}
                        />
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            {untrackedQuantity > 0 && (
              <p className="text-xs text-muted-foreground">
                {formatQuantity(untrackedQuantity)} unit(s) of stock on hand are not recorded
                against any batch. Setting a date here files them as an opening batch so they
                appear in the Expiring Soon report. Your stock total stays the same.
              </p>
            )}

            {pastDateCount > 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-500">
                {pastDateCount} date{pastDateCount !== 1 ? 's are' : ' is'} in the past. That
                stock will be reported as already expired.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={isSaving || isLoading || !hasChanges}>
            {isSaving ? 'Saving...' : 'Save Expiration'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
