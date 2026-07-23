
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Form } from '@/components/ui/form';
import { PlusCircle, Loader2, ArrowRight } from 'lucide-react';
import type { Sale } from '@/lib/types';
import { useAddOrderData } from './use-add-order-data';
import { useAddOrderForm } from './use-add-order-form';
import { AddOrderProductSelector } from './AddOrderProductSelector';
import { AddOrderFormHeader } from './AddOrderFormHeader';
import { AddOrderItemsTable } from './AddOrderItemsTable';

interface AddSalesOrderDialogProps {
  initialData?: Sale;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSuccess?: () => void;
  hideTrigger?: boolean;
}

export function AddSalesOrderDialog({ initialData, isOpen: controlledIsOpen, onOpenChange: setControlledIsOpen, onSuccess, hideTrigger }: AddSalesOrderDialogProps = {}) {
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const isOpen = controlledIsOpen !== undefined ? controlledIsOpen : internalIsOpen;
  const setIsOpen = setControlledIsOpen || setInternalIsOpen;

  const data = useAddOrderData({ isOpen });
  const formHook = useAddOrderForm({
    paymentMethods: data.paymentMethods,
    salesPersons: data.salesPersons,
    customers: data.customers,
    initialData,
    isOpen,
    onClose: () => setIsOpen(false),
    onSuccess,
  });

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      {!initialData && !hideTrigger && (
        <DialogTrigger asChild>
          <Button size="sm">
            <PlusCircle className="mr-2 h-4 w-4" />
            New Sales Order
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-none max-w-full w-full h-screen max-h-screen flex flex-col p-0 gap-0 bg-background border-none rounded-none m-0 shadow-none">
        <DialogHeader className="px-6 py-4 border-b bg-background">
          <DialogTitle>New Sales Order</DialogTitle>
          <DialogDescription>
            {/* On a new order the number is allocated by the server at save
                time, so there is nothing to show yet. Editing an existing
                order still displays its assigned number. */}
            Create a sales transaction. Reference:{' '}
            <span className="font-mono font-medium text-primary">
              {formHook.form.watch('reference') || 'assigned on save'}
            </span>
          </DialogDescription>
        </DialogHeader>

        <Form {...formHook.form}>
          <form onSubmit={formHook.form.handleSubmit(formHook.onSubmit, formHook.onInvalid)} className="flex-1 flex flex-col overflow-hidden">
            <div className="flex-1 flex flex-col overflow-hidden bg-muted/10">

              <AddOrderFormHeader
                form={formHook.form}
                customers={data.customers}
                refetchCustomers={data.refetchCustomers}
                warehouses={data.warehouses}
                paymentMethods={data.paymentMethods}
                salesPersons={data.salesPersons}
                isReferenceRequired={formHook.isReferenceRequired}
                fetchWarehouses={data.fetchWarehouses}
                fetchPaymentMethods={data.fetchPaymentMethods}
                fetchSalesPersons={data.fetchSalesPersons}
              />

              <div className="flex-1 flex flex-col overflow-hidden bg-muted/5 p-4 relative">
                <div className="max-w-2xl mb-4 z-10">
                  <AddOrderProductSelector
                    onSelectProduct={formHook.handleAddProduct}
                    warehouseId={formHook.form.watch('warehouse')}
                  />
                </div>
                <AddOrderItemsTable
                  form={formHook.form}
                  fields={formHook.fields}
                  remove={formHook.remove}
                  total={formHook.total}
                />
              </div>
            </div>

            <DialogFooter className="p-4 bg-background border-t">
              <div className="flex items-center text-xs text-muted-foreground mr-auto">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" /> Ready to process
                </span>
              </div>
              <Button type="button" variant="outline" onClick={() => setIsOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={formHook.isSubmitting || formHook.fields.length === 0} className="w-40 font-semibold shadow-lg shadow-primary/20">
                {formHook.isSubmitting ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Processing...</>
                ) : (
                  <>{initialData ? 'Update Order' : 'Create Order'} <ArrowRight className="ml-2 h-4 w-4" /></>
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
