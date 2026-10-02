'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { FormTotalsBar, formatPeso } from '@/components/form-totals-bar';
import { DiscardChangesDialog } from '@/components/discard-changes-dialog';
import { Form } from '@/components/ui/form';
import { Loader2, ArrowRight, ArrowLeft, ChevronDown, ChevronUp } from 'lucide-react';
import type { Sale } from '@/lib/types';
import { useAddOrderData } from './use-add-order-data';
import { useAddOrderForm } from './use-add-order-form';
import { AddOrderFormHeader } from './AddOrderFormHeader';
import { AddOrderItemsTable } from './AddOrderItemsTable';

interface AddOrderFormProps {
  /** Present when editing an existing order; absent for a new one. */
  initialData?: Sale;
  onClose: () => void;
  onSuccess: () => void;
}

/**
 * Sales order form body. Rendered full-page for "New Sales Order"
 * (app/(app)/sales/orders/new) and inside a dialog for editing.
 */
export function AddOrderForm({ initialData, onClose, onSuccess }: AddOrderFormProps) {
  const data = useAddOrderData({ isOpen: true });
  const formHook = useAddOrderForm({
    paymentMethods: data.paymentMethods,
    salesPersons: data.salesPersons,
    customers: data.customers,
    initialData,
    isOpen: true,
    onClose,
    onSuccess,
  });
  const { form, fields, isSubmitting, onSubmit, onInvalid } = formHook;

  const [showDetails, setShowDetails] = useState(true);

  const isDirty = initialData ? form.formState.isDirty : form.formState.isDirty || fields.length > 0;

  const [isDiscardOpen, setIsDiscardOpen] = useState(false);

  const handleCancel = () => {
    if (isDirty) setIsDiscardOpen(true);
    else onClose();
  };

  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (!isSubmitting && fields.length > 0) form.handleSubmit(onSubmit, onInvalid)();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isSubmitting, fields.length, form, onSubmit, onInvalid]);

  const shipping = Number(form.watch('shipping') || 0);
  const totalQty = fields.reduce((sum, f) => sum + Number(f.quantity || 0), 0);

  return (
    <div className="flex-1 min-h-[900px] flex flex-col rounded-lg border bg-background overflow-hidden">
      <div className="px-4 py-3 border-b bg-background flex items-center gap-3 shrink-0">
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={handleCancel} aria-label="Back">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-lg font-semibold leading-tight">{initialData ? 'Edit' : 'New'} Sales Order</h1>
          <p className="text-xs text-muted-foreground">
            {/* On a new order the number is allocated by the server at save
                time, so there is nothing to show yet. Editing an existing
                order still displays its assigned number. */}
            Reference:{' '}
            <span className="font-mono font-medium text-primary">
              {form.watch('reference') || 'assigned on save'}
            </span>
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden lg:flex items-center gap-1.5 text-xs text-muted-foreground mr-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500" /> Ready to process
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={() => setShowDetails((v) => !v)}
            aria-expanded={showDetails}
          >
            {showDetails ? <ChevronUp className="mr-1.5 h-3.5 w-3.5" /> : <ChevronDown className="mr-1.5 h-3.5 w-3.5" />}
            {showDetails ? 'Hide' : 'Show'} order details
          </Button>
          <Button type="button" variant="outline" size="sm" className="h-8" onClick={handleCancel}>
            Cancel
          </Button>
          <Button type="submit" form="order-form" title="Ctrl+S to save" disabled={isSubmitting || fields.length === 0} className="w-40 h-8 font-semibold shadow-lg shadow-primary/20">
              {isSubmitting ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Processing...</>
              ) : (
                <>{initialData ? 'Update Order' : 'Create Order'} <ArrowRight className="ml-2 h-4 w-4" /></>
              )}
          </Button>
        </div>
      </div>

      <FormTotalsBar
        items={[
          { label: 'Lines', value: String(fields.length) },
          { label: 'Total Qty', value: String(totalQty) },
          { label: 'Subtotal', value: formatPeso(Number(formHook.total) - shipping - formHook.vatAmount) },
          { label: 'VAT (12%)', value: formatPeso(formHook.vatAmount) },
          { label: 'Shipping', value: formatPeso(shipping) },
          { label: 'Total', value: formatPeso(Number(formHook.total)), emphasis: true },
        ]}
      />

      <Form {...form}>
        <form id="order-form" onSubmit={form.handleSubmit(onSubmit, (errors) => { setShowDetails(true); onInvalid(errors); })} className="flex-1 min-h-0 flex flex-col">
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-muted/10">
            {/* Hidden, not unmounted, so entered values and validation survive a collapse. */}
            <div className={showDetails ? '' : 'hidden'}>
              <AddOrderFormHeader
                form={form}
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
            </div>

            <AddOrderItemsTable
              form={form}
              fields={fields}
              remove={formHook.remove}
              total={formHook.total}
              vatAmount={formHook.vatAmount}
              handleAddProduct={formHook.handleAddProduct}
            />
          </div>

        </form>
      </Form>

      <DiscardChangesDialog open={isDiscardOpen} onOpenChange={setIsDiscardOpen} onConfirm={onClose} />
    </div>
  );
}
