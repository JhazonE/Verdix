'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Form } from '@/components/ui/form';
import { PlusCircle, Loader2, ArrowRight } from 'lucide-react';
import { useAddInvoice } from './use-add-invoice';
import { AddInvoiceFormHeader } from './AddInvoiceFormHeader';
import { AddInvoiceItemsTable } from './AddInvoiceItemsTable';

interface AddSalesInvoiceDialogProps { onSuccess?: () => void }

export function AddSalesInvoiceDialog({ onSuccess }: AddSalesInvoiceDialogProps = {}) {
  const {
    isOpen, setIsOpen,
    customers, refetchCustomers,
    warehouses, fetchWarehouses,
    paymentMethods, fetchPaymentMethods,
    form, fields, remove,
    total, vatAmount, isSubmitting, isReferenceRequired,
    handleAddProduct, onSubmit,
  } = useAddInvoice({ onSuccess });

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <PlusCircle className="mr-2 h-4 w-4" />
          New Sales Invoice
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-none max-w-full w-full h-screen max-h-screen flex flex-col p-0 gap-0 bg-background border-none rounded-none m-0 shadow-none">
        <DialogHeader className="px-6 py-4 border-b bg-background">
          <DialogTitle>New Sales Invoice</DialogTitle>
          <DialogDescription>
            Create a transaction. Reference: <span className="font-mono font-medium text-primary">Auto-generated</span>
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex-1 flex flex-col overflow-hidden">
            <div className="flex-1 flex flex-col overflow-hidden bg-muted/10">

              <AddInvoiceFormHeader
                form={form}
                customers={customers}
                refetchCustomers={refetchCustomers}
                warehouses={warehouses}
                paymentMethods={paymentMethods}
                isReferenceRequired={isReferenceRequired}
                fetchWarehouses={fetchWarehouses}
                fetchPaymentMethods={fetchPaymentMethods}
              />

              <AddInvoiceItemsTable
                form={form}
                fields={fields}
                remove={remove}
                total={total}
                vatAmount={vatAmount}
                handleAddProduct={handleAddProduct}
              />

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
              <Button
                type="submit"
                disabled={isSubmitting || fields.length === 0}
                className="w-40 font-semibold shadow-lg shadow-primary/20"
              >
                {isSubmitting ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Processing...</>
                ) : (
                  <>Create Invoice <ArrowRight className="ml-2 h-4 w-4" /></>
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
