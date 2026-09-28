'use client';

import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Printer, User, CreditCard, Hash, Calendar, Clock, ShoppingBag } from 'lucide-react';
import type { Sale } from '@/lib/types';
import { formatSINumber } from '@/lib/si-number';
import { format } from 'date-fns';
import { formatCurrency } from './recent-sales-utils';

interface SaleDetailViewProps {
  sale: Sale;
  onReprint: () => void;
}

export function SaleDetailView({ sale, onReprint }: SaleDetailViewProps) {
  const items = sale.items || [];
  const gross = items.reduce((acc: number, it: any) => acc + it.price * it.quantity, 0);
  const totalDiscount = items.reduce((acc: number, it: any) => acc + (it.discount || 0), 0);
  const totalQty = items.reduce((acc: number, it: any) => acc + it.quantity, 0);
  const tendered = sale.amountTendered ?? sale.total;
  const change = sale.change ?? Math.max(0, tendered - sale.total);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b pb-3 shrink-0">
        <h2 className="text-sm font-semibold">Transaction Details</h2>
        <Button size="sm" className="gap-1.5" onClick={onReprint}>
          <Printer className="h-4 w-4" />
          Reprint Receipt
        </Button>
      </div>

      <div className="mt-4 rounded-xl border bg-gradient-to-br from-primary/5 to-transparent p-4 shrink-0">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Clock className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">SI Number</p>
              <p className="truncate font-mono text-lg font-bold leading-tight">{sale.siNumber ? formatSINumber(sale.siNumber) : (sale.orderNumber || sale.id?.substring(0, 8))}</p>
            </div>
          </div>
          <div className="text-right shrink-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Total</p>
            <p className="font-mono text-2xl font-black tabular-nums text-primary leading-tight">₱{formatCurrency(sale.total)}</p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          {[
            { icon: User, label: 'Customer', value: sale.customer?.name || 'Walk-in' },
            { icon: Calendar, label: 'Date & Time', value: format(new Date(sale.date || new Date()), 'MMM d, yyyy • p') },
            { icon: CreditCard, label: 'Payment', value: sale.paymentMethod || '-' },
            { icon: User, label: 'Cashier', value: sale.cashierName || sale.salesPerson || '-' },
            { icon: Hash, label: 'Reference', value: sale.paymentReference || '-' },
            { icon: Clock, label: 'Points Earned', value: String(sale.pointsEarned || 0) },
          ].map(({ icon: Icon, label, value }) => (
            <div key={label} className="flex items-start gap-2 min-w-0">
              <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground leading-none">{label}</p>
                <p className="mt-0.5 truncate text-sm font-medium">{value}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2 shrink-0">
        <ShoppingBag className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Products</h3>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {items.length} {items.length === 1 ? 'line' : 'lines'} · {totalQty} {totalQty === 1 ? 'pc' : 'pcs'}
        </span>
      </div>

      <div className="mt-2 flex-1 overflow-hidden rounded-xl border">
        <ScrollArea className="h-full">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-muted">
              <TableRow className="hover:bg-transparent">
                <TableHead className="text-xs font-semibold uppercase tracking-wide">Product</TableHead>
                <TableHead className="text-center text-xs font-semibold uppercase tracking-wide">Qty</TableHead>
                <TableHead className="text-center text-xs font-semibold uppercase tracking-wide">Returned</TableHead>
                <TableHead className="text-right text-xs font-semibold uppercase tracking-wide">Unit Price</TableHead>
                <TableHead className="text-right text-xs font-semibold uppercase tracking-wide">Disc</TableHead>
                <TableHead className="text-right text-xs font-semibold uppercase tracking-wide">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length > 0 ? items.map((it: any, idx: number) => {
                const returnedQty = it.returnedQuantity ?? 0;
                const remainingQty = it.quantity; // net remaining after returns
                const lineGross = it.price * remainingQty;
                const lineTotal = lineGross - (it.discount || 0);
                return (
                  <TableRow key={idx} className="border-b-border/50">
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium text-sm leading-tight">{it.product?.name || it.name}</span>
                        {(it.product?.barcode || it.product?.unitOfMeasure) && (
                          <span className="text-[11px] text-muted-foreground">
                            {it.product?.barcode ? `${it.product.barcode}` : ''}
                            {it.product?.barcode && it.product?.unitOfMeasure ? ' · ' : ''}
                            {it.product?.unitOfMeasure || ''}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-center font-mono text-sm">
                      {remainingQty > 0
                        ? remainingQty
                        : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-center font-mono text-sm">
                      {returnedQty > 0
                        ? <span className="font-semibold text-amber-600 dark:text-amber-400">{returnedQty}</span>
                        : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">₱{formatCurrency(it.price)}</TableCell>
                    <TableCell className="text-right font-mono text-sm text-rose-600">
                      {it.discount ? `−₱${formatCurrency(it.discount)}` : '—'}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm font-semibold">₱{formatCurrency(lineTotal)}</TableCell>
                  </TableRow>
                );
              }) : (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    No product lines on this transaction.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </ScrollArea>
      </div>

      <div className="mt-4 space-y-2 rounded-xl border bg-muted/30 p-4 shrink-0">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Subtotal</span>
          <span className="font-mono tabular-nums">₱{formatCurrency(gross)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Discount</span>
          <span className="font-mono tabular-nums text-rose-600">−₱{formatCurrency(totalDiscount)}</span>
        </div>
        <div className="h-px bg-border" />
        <div className="flex justify-between">
          <span className="text-sm font-bold uppercase tracking-wide">Total</span>
          <span className="font-mono text-lg font-black tabular-nums text-primary">₱{formatCurrency(sale.total)}</span>
        </div>
        <div className="flex justify-between text-sm pt-1">
          <span className="flex items-center gap-1.5 text-muted-foreground"><Clock className="h-3.5 w-3.5" /> Tendered</span>
          <span className="font-mono tabular-nums">₱{formatCurrency(tendered)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Change</span>
          <span className="font-mono tabular-nums">₱{formatCurrency(change)}</span>
        </div>
      </div>
    </div>
  );
}
