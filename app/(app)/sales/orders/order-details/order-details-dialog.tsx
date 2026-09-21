'use client';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useOrderPosSettings } from './use-order-pos-settings';
import { useOrderPrint } from './use-order-print';
import { OrderDetailsDocument } from './OrderDetailsDocument';
import { OrderDetailsActions } from './OrderDetailsActions';
import type { OrderDetailsDialogProps } from './order-details-types';

export type { OrderDialogMode } from './order-details-types';

export function OrderDetailsDialog({ order, open, onOpenChange, mode = 'order' }: OrderDetailsDialogProps) {
  const { settings } = useOrderPosSettings();
  const print = useOrderPrint({ order, settings, mode });

  if (!order) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-none max-w-full w-full h-screen max-h-screen flex flex-col p-0 gap-0 bg-background border-none rounded-none m-0 shadow-none">
        <DialogHeader className="flex flex-row items-center justify-between non-printable px-6 py-4 border-b shrink-0">
          <DialogTitle>{mode === 'delivery-note' ? 'Delivery Note' : 'Order Details'}</DialogTitle>
          <DialogDescription className="sr-only">
            {mode === 'delivery-note' ? 'View and print the delivery note for this order' : 'View and print the sales order details'}
          </DialogDescription>
        </DialogHeader>

        <OrderDetailsDocument
          order={order}
          settings={settings}
          mode={mode}
          documentTitle={print.documentTitle}
          displayDate={print.displayDate}
          subtotal={print.subtotal}
          shipping={print.shipping}
          vatAmount={print.vatAmount}
          grandTotal={print.grandTotal}
          printContentRef={print.printContentRef}
        />

        <OrderDetailsActions
          onPrint={print.handlePrint}
          onPrintPOSInvoice={print.handlePrintPOSInvoice}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
