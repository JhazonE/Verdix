'use client';

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { ChevronLeft, ChevronRight, PackageOpen, RefreshCw, Search } from 'lucide-react';
import { cn, formatQuantity } from '@/lib/utils';

import { useBatchInventory } from './use-batch-inventory';

interface BatchInventoryDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BatchInventoryDrawer({ open, onOpenChange }: BatchInventoryDrawerProps) {
  const {
    batches,
    isLoading,
    search,
    handleSearch,
    statusFilter,
    handleStatusFilter,
    currentPage,
    setCurrentPage,
    pageSize,
    handlePageSize,
    total,
    totalPages,
    loadBatches,
    formatDate,
    formatCurrency,
    percentUsed,
  } = useBatchInventory(open);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="top" className="h-[85vh] w-full p-0 flex flex-col gap-0 overflow-hidden rounded-b-2xl">

        {/* Header */}
        <SheetHeader className="px-6 pt-6 pb-4 border-b shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center">
                <PackageOpen className="h-5 w-5 text-primary" />
              </div>
              <div>
                <SheetTitle className="text-xl font-bold">Inventory Batches</SheetTitle>
                <SheetDescription className="text-xs mt-0.5">
                  {total} batch{total !== 1 ? 'es' : ''} recorded
                </SheetDescription>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              onClick={loadBatches}
              disabled={isLoading}
            >
              <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
            </Button>
          </div>
        </SheetHeader>

        {/* Filters */}
        <div className="px-6 py-3 border-b flex flex-col sm:flex-row gap-3 shrink-0 bg-muted/20">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search product, batch ID, PO..."
              className="pl-9 h-9 bg-background"
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
            />
          </div>
          <Select value={statusFilter} onValueChange={(v) => handleStatusFilter(v as any)}>
            <SelectTrigger className="w-full sm:w-[160px] h-9 bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Batches</SelectItem>
              <SelectItem value="active">Active (Has Stock)</SelectItem>
              <SelectItem value="exhausted">Exhausted</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full rounded-lg" />
              ))}
            </div>
          ) : batches.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground py-24">
              <PackageOpen className="h-12 w-12 opacity-20" />
              <p className="text-sm font-medium">No batches found</p>
              <p className="text-xs">Try adjusting your filters or receive a purchase order first.</p>
            </div>
          ) : (
            <Table>
              <TableHeader className="sticky top-0 bg-background z-10 shadow-sm">
                <TableRow>
                  <TableHead className="w-[80px] text-xs">Batch ID</TableHead>
                  <TableHead className="text-xs">Product</TableHead>
                  <TableHead className="text-xs">PO Reference</TableHead>
                  <TableHead className="text-xs">Received</TableHead>
                  <TableHead className="text-xs">Expiry</TableHead>
                  <TableHead className="text-right text-xs">Qty In</TableHead>
                  <TableHead className="text-right text-xs">Remaining</TableHead>
                  <TableHead className="text-xs w-[120px]">Usage</TableHead>
                  <TableHead className="text-right text-xs">Unit Cost</TableHead>
                  <TableHead className="text-right text-xs">Sell Price</TableHead>
                  <TableHead className="text-center text-xs">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batches.map((batch) => {
                  const pct = percentUsed(batch);
                  const isExhausted = batch.quantity_remaining <= 0;
                  return (
                    <TableRow key={batch.id} className="text-xs hover:bg-muted/40 transition-colors">
                      <TableCell className="font-mono font-semibold text-[11px] text-primary">
                        {batch.id}
                      </TableCell>
                      <TableCell>
                        <div className="max-w-[160px]">
                          <p className="font-medium leading-tight truncate" title={batch.product_name}>
                            {batch.product_name || '-'}
                          </p>
                          <p className="text-[10px] text-muted-foreground font-mono">{batch.product_barcode || ''}</p>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-[10px] text-muted-foreground uppercase font-bold">
                        {batch.po_reference || batch.purchase_order_id || '-'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDate(batch.received_date)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {batch.expirationDate ? formatDate(batch.expirationDate) : <span className="text-muted-foreground/50">—</span>}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatQuantity(batch.quantity_in)}
                      </TableCell>
                      <TableCell className={cn(
                        'text-right font-semibold tabular-nums',
                        isExhausted ? 'text-muted-foreground' : 'text-emerald-600'
                      )}>
                        {formatQuantity(batch.quantity_remaining)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                            <div
                              className={cn(
                                'h-full rounded-full transition-all',
                                pct >= 100 ? 'bg-muted-foreground/40' :
                                pct >= 70 ? 'bg-amber-500' : 'bg-emerald-500'
                              )}
                              style={{ width: `${Math.min(pct, 100)}%` }}
                            />
                          </div>
                          <span className="text-[10px] text-muted-foreground w-7 text-right tabular-nums">{pct}%</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(batch.unit_cost)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(batch.selling_price)}
                      </TableCell>
                      <TableCell className="text-center">
                        {isExhausted ? (
                          <Badge variant="secondary" className="text-[10px] px-1.5 h-5 text-muted-foreground">
                            Exhausted
                          </Badge>
                        ) : (
                          <Badge className="text-[10px] px-1.5 h-5 bg-emerald-500/10 text-emerald-700 border border-emerald-500/20 hover:bg-emerald-500/20">
                            Active
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>

        {/* Pagination */}
        {!isLoading && total > 0 && (
          <div className="px-6 py-3 border-t flex flex-wrap items-center justify-between gap-3 shrink-0 bg-muted/10">
            <div className="flex items-center gap-4">
              <p className="text-xs text-muted-foreground whitespace-nowrap">
                Showing {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, total)} of {total}
              </p>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Rows:</span>
                <Select value={String(pageSize)} onValueChange={handlePageSize}>
                  <SelectTrigger className="h-7 w-[65px] text-[11px] bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="20">20</SelectItem>
                    <SelectItem value="50">50</SelectItem>
                    <SelectItem value="100">100</SelectItem>
                    <SelectItem value="200">200</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="flex items-center gap-1 min-w-[70px] justify-center">
                <span className="text-xs font-semibold tabular-nums">{currentPage}</span>
                <span className="text-[10px] text-muted-foreground font-medium">of</span>
                <span className="text-xs font-semibold tabular-nums">{totalPages}</span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

      </SheetContent>
    </Sheet>
  );
}
