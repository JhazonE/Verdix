'use client';

import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

import { useAddPurchaseOrder, type UseAddPurchaseOrderProps } from './use-add-purchase-order';
import { PurchaseOrderForm } from './purchase-order-form';

/**
 * Dialog host for the purchase order form, used where a PO is edited,
 * reordered or pre-filled from another screen. A blank "New Purchase Order"
 * is a page now (app/(app)/purchases/new).
 */
export function AddPurchaseOrderDialog(props: UseAddPurchaseOrderProps & { trigger?: React.ReactNode }) {
  const { trigger, ...hookProps } = props;
  const controller = useAddPurchaseOrder(hookProps);
  const { isOpen, setOpen } = controller;

  return (
    <Dialog open={isOpen} onOpenChange={(val) => setOpen(val)}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}

      <DialogContent className="sm:max-w-none max-w-full w-full h-screen max-h-screen flex flex-col p-0 gap-0 bg-background border-none rounded-none m-0 shadow-none">
        <DialogTitle className="sr-only">{hookProps.editOrder ? 'Edit' : 'New'} Purchase Order</DialogTitle>
        <div className="flex-1 min-h-0 flex flex-col p-2 overflow-auto">
          <PurchaseOrderForm
            controller={controller}
            isEdit={!!hookProps.editOrder}
            onCancel={() => setOpen(false)}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
