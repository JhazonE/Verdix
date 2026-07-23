'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Printer, Package2 } from 'lucide-react';

import { type ViewPurchaseOrderDialogProps } from './view-purchase-order-types';
import { useViewPurchaseOrder } from './use-view-purchase-order';
import { PoHeaderInfo } from './po-header-info';
import { PoItemsTable } from './po-items-table';
import { PoSummary } from './po-summary';

export function ViewPurchaseOrderDialog(props: ViewPurchaseOrderDialogProps) {
  const { open, onOpenChange, order } = props;
  const { products, profile, handlePrint } = useViewPurchaseOrder(props);

  if (!order) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-none max-w-full w-full h-screen max-h-screen flex flex-col p-0 gap-0 bg-background border-none rounded-none m-0 shadow-none printable-dialog-content">
        <DialogHeader className="px-6 py-4 border-b bg-white non-printable shrink-0">
          <div className="flex items-center justify-between pr-8">
            <DialogTitle className="text-xl font-bold flex items-center gap-2">
              <Package2 className="size-6 text-primary" />
              Purchase Order Details
            </DialogTitle>
            <div className="flex items-center gap-2">
              <Badge
                variant={
                  order.status === 'Received' || order.status === 'Paid'
                    ? 'default'
                    : order.status === 'Voided'
                    ? 'destructive'
                    : 'secondary'
                }
                className="text-sm uppercase px-3 py-1"
              >
                {order.status}
              </Badge>
            </div>
          </div>
          <DialogDescription className="screen-only">
            Detailed view of purchase order {order.referenceNumber}.
          </DialogDescription>
        </DialogHeader>

        <div
          // Paper preview: white sheet with dark ink in both themes, matching
          // what prints. Without an explicit text colour, inherited theme
          // tokens turn near-white in dark mode and disappear.
          className="p-8 space-y-8 bg-white text-slate-900 text-sm overflow-y-auto flex-1"
          id="printable-order-content"
        >
          <PoHeaderInfo order={order} profile={profile} />
          <PoItemsTable order={order} products={products} />
          <PoSummary order={order} />
        </div>

        <DialogFooter className="px-6 py-4 border-t bg-muted/20 non-printable flex-row justify-between items-center shrink-0">
          <div className="text-xs text-muted-foreground">
            Use <kbd className="border rounded px-1 bg-white">Ctrl+P</kbd> to print this view.
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handlePrint}>
              <Printer className="w-4 h-4 mr-2" />
              Print Purchase Order
            </Button>
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
