'use client';

import { useState, useEffect, useMemo } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { addDays } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { logActivity } from '@/lib/client-activity-logger';
import { getApiUrl } from '@/lib/api-config';
import type { Product, PaymentMethod } from '@/lib/types';
import { mapVatStatusToTaxType } from '@/lib/tax-utils';
import { salesInvoiceSchema, type SalesInvoiceFormValues } from './add-invoice-types';

const VAT_RATE = 0.12;

type Props = {
  paymentMethods: PaymentMethod[];
  onClose: () => void;
  onSuccess?: () => void;
};

export function useAddInvoiceForm({ paymentMethods, onClose, onSuccess }: Props) {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [total, setTotal] = useState(0);
  const [vatAmount, setVatAmount] = useState(0);
  const [vatableSales, setVatableSales] = useState(0);

  const refinedSchema = useMemo(
    () => salesInvoiceSchema.refine(data => {
      const method = paymentMethods.find(m => m.name === data.paymentMethod);
      if (method?.isReferenceRequired && !data.paymentReference?.trim()) return false;
      return true;
    }, { message: 'Payment reference is required for this method', path: ['paymentReference'] }),
    [paymentMethods]
  );

  const form = useForm<SalesInvoiceFormValues>({
    resolver: zodResolver(refinedSchema),
    defaultValues: {
      customer: undefined,
      invoiceDate: new Date().toISOString().split('T')[0],
      deliveryDate: '',
      dueDate: new Date().toISOString().split('T')[0],
      reference: '',
      paymentReference: '',
      deliveryAddress: '',
      paymentMethod: '',
      items: [],
      shipping: 0,
      note: '',
    },
  });

  const { fields, append, remove, update } = useFieldArray({ control: form.control, name: 'items' });

  // Prices on this form are VAT-EXCLUSIVE (unlike POS, where the tendered
  // price already includes VAT and gets backed out) — a VATable line adds
  // 12% on top instead of splitting it out of the line total. Each line's
  // own `vatable` checkbox decides this, not the product's vatStatus
  // directly — that status only sets the checkbox's initial value when the
  // product is added, since staff can override it per line afterward.
  const computeTotals = (items: any[], shipping: number) => {
    let itemsTotal = 0;
    let vatable = 0;
    let vat = 0;
    for (const item of items || []) {
      const lineTotal = Number(item?.price || 0) * Number(item?.quantity || 0);
      itemsTotal += lineTotal;
      if (item?.vatable) {
        vatable += lineTotal;
        vat += lineTotal * VAT_RATE;
      }
    }
    setVatableSales(vatable);
    setVatAmount(vat);
    setTotal(itemsTotal + vat + Number(shipping || 0));
  };

  useEffect(() => {
    const sub = form.watch((value, { name }) => {
      if (name?.startsWith('items') || name === 'shipping') {
        computeTotals(value.items as any[], Number(value.shipping || 0));
      }
    });
    const cur = form.getValues();
    computeTotals(cur.items, Number(cur.shipping || 0));
    return () => sub.unsubscribe();
  }, []);

  const watchedCustomer = form.watch('customer');
  const watchedInvoiceDate = form.watch('invoiceDate');
  const watchedPaymentMethod = form.watch('paymentMethod');

  const selectedPaymentMethod = paymentMethods.find(m => m.name === watchedPaymentMethod);
  const isReferenceRequired = selectedPaymentMethod?.isReferenceRequired ?? false;

  useEffect(() => {
    if (!watchedInvoiceDate) return;
    let calculatedDueDate = watchedInvoiceDate;
    const immediatePaymentMethods = ['Cash', 'PayPal', 'GCash'];
    if (watchedPaymentMethod && immediatePaymentMethods.includes(watchedPaymentMethod)) {
      form.setValue('dueDate', calculatedDueDate);
      return;
    }
    if (watchedPaymentMethod?.toLowerCase() === 'charge' && watchedCustomer?.paymentTerms) {
      const terms = watchedCustomer.paymentTerms.toLowerCase();
      if (terms.includes('due on receipt')) {
        calculatedDueDate = watchedInvoiceDate;
      } else {
        const match = terms.match(/(\d+)/);
        if (match) {
          calculatedDueDate = addDays(new Date(watchedInvoiceDate), parseInt(match[1], 10)).toISOString().split('T')[0];
        }
      }
    }
    form.setValue('dueDate', calculatedDueDate, { shouldValidate: true });
  }, [watchedCustomer, watchedInvoiceDate, watchedPaymentMethod]);

  const handleAddProduct = (product: Product, unit?: { id?: string; name: string; factor: number; price: number }) => {
    const existingIndex = fields.findIndex(f => f.product.id === product.id && f.sellingUnitId === unit?.id);
    if (existingIndex !== -1) {
      update(existingIndex, { ...fields[existingIndex], quantity: fields[existingIndex].quantity + 1 });
    } else {
      append({
        product,
        quantity: 1,
        price: unit ? unit.price : product.price,
        sellingUnitId: unit?.id,
        sellingUnitName: unit?.name,
        sellingUnitFactor: unit?.factor,
        vatable: mapVatStatusToTaxType(product.vatStatus) === 'VAT',
      });
    }
  };

  const onSubmit = async (values: SalesInvoiceFormValues) => {
    try {
      setIsSubmitting(true);
      const res = await fetch(getApiUrl('/sales'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const data = await res.json();
      if (data.success) {
        await logActivity({
          action: 'CREATE', module: 'SALES',
          description: `Created sales invoice: ${values.reference || values.paymentReference || 'N/A'} — Customer: ${values.customer || 'Walk-in'}`,
          referenceId: data.data?.id || values.reference,
        });
        toast({ title: 'Sales Invoice Added', description: `Invoice ${values.reference || values.paymentReference} created successfully.` });
        form.reset();
        onClose();
        onSuccess?.();
      } else {
        toast({ title: 'Error', description: data.error || 'Failed to create sales invoice', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to create sales invoice', variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    form, fields, append, remove, update,
    total, vatAmount, vatableSales, isSubmitting, isReferenceRequired,
    handleAddProduct, onSubmit,
  };
}
