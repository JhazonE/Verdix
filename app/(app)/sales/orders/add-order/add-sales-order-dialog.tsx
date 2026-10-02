'use client';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import type { Sale } from '@/lib/types';
import { AddOrderForm } from './AddOrderForm';

interface EditSalesOrderDialogProps {
  initialData?: Sale;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

/**
 * Edit-only dialog. "New Sales Order" is a page now
 * (app/(app)/sales/orders/new). DialogContent unmounts its children when
 * closed, so the form re-initialises from `initialData` on every open.
 */
export function AddSalesOrderDialog({ initialData, isOpen, onOpenChange, onSuccess }: EditSalesOrderDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-none max-w-full w-full h-screen max-h-screen flex flex-col p-0 gap-0 bg-background border-none rounded-none m-0 shadow-none">
        <DialogTitle className="sr-only">Edit Sales Order</DialogTitle>
        <div className="flex-1 min-h-0 flex flex-col p-2 overflow-auto">
          <AddOrderForm
            initialData={initialData}
            onClose={() => onOpenChange(false)}
            onSuccess={onSuccess}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
