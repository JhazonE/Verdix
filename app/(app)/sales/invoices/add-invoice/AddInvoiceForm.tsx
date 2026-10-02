'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { FormTotalsBar, formatPeso } from '@/components/form-totals-bar';
import { DiscardChangesDialog } from '@/components/discard-changes-dialog';
import { Form } from '@/components/ui/form';
import { Loader2, ArrowRight, ArrowLeft, ChevronDown, ChevronUp } from 'lucide-react';
import { useAddInvoiceData } from './use-add-invoice-data';
import { useAddInvoiceForm } from './use-add-invoice-form';
import { AddInvoiceFormHeader } from './AddInvoiceFormHeader';
import { AddInvoiceItemsTable } from './AddInvoiceItemsTable';

interface AddInvoiceFormProps {
  onClose: () => void;
  onSuccess?: () => void;
}

/** Full-page "New Sales Invoice" form. Mounted by app/(app)/sales/invoices/new. */
export function AddInvoiceForm({ onClose, onSuccess }: AddInvoiceFormProps) {
  const data = useAddInvoiceData({ isOpen: true });
  const {
    form, fields, remove,
    total, vatAmount, isSubmitting, isReferenceRequired,
    handleAddProduct, onSubmit,
  } = useAddInvoiceForm({ paymentMethods: data.paymentMethods, onClose, onSuccess });

  const [showDetails, setShowDetails] = useState(true);

  const isDirty = form.formState.isDirty || fields.length > 0;

  const [isDiscardOpen, setIsDiscardOpen] = useState(false);

  const handleCancel = () => {
    if (isDirty) setIsDiscardOpen(true);
    else onClose();
  };

  // Warn on tab close / refresh while there is unsaved work.
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  // Ctrl/Cmd+S saves.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (!isSubmitting && fields.length > 0) form.handleSubmit(onSubmit)();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isSubmitting, fields.length, form, onSubmit]);

  const shipping = Number(form.watch('shipping') || 0);
  const totalQty = fields.reduce((sum, f) => sum + Number(f.quantity || 0), 0);

  return (
    <div className="flex-1 min-h-[900px] flex flex-col rounded-lg border bg-background overflow-hidden">
      <div className="px-4 py-3 border-b bg-background flex items-center gap-3 shrink-0">
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={handleCancel} aria-label="Back to invoices">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-lg font-semibold leading-tight">New Sales Invoice</h1>
          <p className="text-xs text-muted-foreground">
            Reference: <span className="font-mono font-medium text-primary">Auto-generated</span>
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
            {showDetails ? 'Hide' : 'Show'} invoice details
          </Button>
          <Button type="button" variant="outline" size="sm" className="h-8" onClick={handleCancel}>
            Cancel
          </Button>
          <Button
              type="submit" form="invoice-form" title="Ctrl+S to save"
              disabled={isSubmitting || fields.length === 0}
              className="w-40 h-8 font-semibold shadow-lg shadow-primary/20"
            >
              {isSubmitting ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Processing...</>
              ) : (
                <>Create Invoice <ArrowRight className="ml-2 h-4 w-4" /></>
              )}
          </Button>
        </div>
      </div>

      <FormTotalsBar
        items={[
          { label: 'Lines', value: String(fields.length) },
          { label: 'Total Qty', value: String(totalQty) },
          { label: 'Subtotal', value: formatPeso(Number(total) - shipping - vatAmount) },
          { label: 'VAT (12%)', value: formatPeso(vatAmount) },
          { label: 'Shipping', value: formatPeso(shipping) },
          { label: 'Total', value: formatPeso(Number(total)), emphasis: true },
        ]}
      />

      <Form {...form}>
        <form id="invoice-form" onSubmit={form.handleSubmit(onSubmit, () => setShowDetails(true))} className="flex-1 min-h-0 flex flex-col">
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-muted/10">
            {/* Hidden, not unmounted, so entered values and validation survive a collapse. */}
            <div className={showDetails ? '' : 'hidden'}>
              <AddInvoiceFormHeader
                form={form}
                customers={data.customers}
                refetchCustomers={data.refetchCustomers}
                warehouses={data.warehouses}
                paymentMethods={data.paymentMethods}
                isReferenceRequired={isReferenceRequired}
                fetchWarehouses={data.fetchWarehouses}
                fetchPaymentMethods={data.fetchPaymentMethods}
              />
            </div>

            <AddInvoiceItemsTable
              form={form}
              fields={fields}
              remove={remove}
              total={total}
              vatAmount={vatAmount}
              handleAddProduct={handleAddProduct}
            />
          </div>

        </form>
      </Form>

      <DiscardChangesDialog open={isDiscardOpen} onOpenChange={setIsDiscardOpen} onConfirm={onClose} />
    </div>
  );
}
