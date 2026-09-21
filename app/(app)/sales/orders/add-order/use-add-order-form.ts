'use client';

import { useState, useEffect, useMemo } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useToast } from '@/hooks/use-toast';
import { logActivity } from '@/lib/client-activity-logger';
import { getApiUrl } from '@/lib/api-config';
import type { Product, PaymentMethod, SalesPerson, Customer, Sale } from '@/lib/types';
import { mapVatStatusToTaxType } from '@/lib/tax-utils';
import { salesOrderSchema, type SalesOrderFormValues } from './add-order-types';

const VAT_RATE = 0.12;

type Props = {
  paymentMethods: PaymentMethod[];
  salesPersons: SalesPerson[];
  customers: Customer[];
  initialData?: Sale;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
};

export function useAddOrderForm({ paymentMethods, salesPersons, customers, initialData, isOpen, onClose, onSuccess }: Props) {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [total, setTotal] = useState(0);
  const [vatAmount, setVatAmount] = useState(0);
  const [vatableSales, setVatableSales] = useState(0);

  const refinedSchema = useMemo(() => salesOrderSchema.refine((data) => {
    const method = paymentMethods.find(m => m.name === data.paymentMethod);
    if (method?.isReferenceRequired && !data.paymentReference?.trim()) return false;
    return true;
  }, { message: 'Payment reference is required for this method', path: ['paymentReference'] }), [paymentMethods]);

  const form = useForm<SalesOrderFormValues>({
    resolver: zodResolver(refinedSchema),
    defaultValues: {
      customer: undefined,
      orderDate: new Date().toISOString().split('T')[0],
      deliveryDate: '',
      reference: '',
      deliveryAddress: '',
      paymentMethod: '',
      paymentReference: '',
      items: [],
      shipping: 0,
      salesPersonId: '',
      note: '',
    },
  });

  const { fields, append, remove, update } = useFieldArray({ control: form.control, name: 'items' });

  // Initialize form when dialog opens
  useEffect(() => {
    if (!isOpen) return;
    if (initialData) {
      form.reset({
        customer: initialData.customer,
        orderDate: initialData.orderDate ? new Date(initialData.orderDate).toISOString().split('T')[0] : '',
        deliveryDate: initialData.deliveryDate ? new Date(initialData.deliveryDate).toISOString().split('T')[0] : '',
        reference: initialData.reference,
        deliveryAddress: initialData.deliveryAddress,
        paymentMethod: initialData.paymentMethod,
        paymentReference: (initialData as any).paymentReference || '',
        shipping: (initialData as any).shipping || 0,
        warehouse: (initialData as any).warehouse_id,
        salesPersonId: initialData.salesPersonId || '',
        note: initialData.notes,
        items: initialData.items.map(item => ({
          product: { ...item.product },
          quantity: item.quantity,
          price: item.price,
          sellingUnitId: (item as any).sellingUnitId,
          sellingUnitName: (item as any).sellingUnitName,
          sellingUnitFactor: (item as any).sellingUnitFactor,
          vatable: Boolean((item as any).vatable),
        })),
      });
    } else {
      // Left blank on purpose: the SO number comes from the shared counter
      // server-side when the order is saved, so it stays sequential and
      // cannot collide.
      form.setValue('reference', '');
    }
  }, [isOpen]);

  // Auto-populate sales person when customer is selected
  const watchedCustomerId = form.watch('customer.id');
  useEffect(() => {
    if (!watchedCustomerId || initialData) return;
    const customer = customers.find(c => c.id === watchedCustomerId);
    if (customer?.salesPerson) {
      const match = salesPersons.find(sp => sp.name === customer.salesPerson);
      if (match) form.setValue('salesPersonId', match.id);
    }
  }, [watchedCustomerId, customers, salesPersons, initialData]);

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

  // Running total calculation
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

  const handleAddProduct = (product: Product, unit?: { id?: string; name: string; factor: number; price: number }) => {
    const existingIndex = fields.findIndex(f => f.product.id === product.id && f.sellingUnitId === unit?.id);
    if (existingIndex !== -1) {
      update(existingIndex, { ...fields[existingIndex], quantity: fields[existingIndex].quantity + 1 });
    } else {
      append({
        product: { ...product },
        quantity: 1,
        price: unit ? unit.price : product.price,
        sellingUnitId: unit?.id,
        sellingUnitName: unit?.name,
        sellingUnitFactor: unit?.factor,
        vatable: mapVatStatusToTaxType(product.vatStatus) === 'VAT',
      });
    }
  };

  const onSubmit = async (values: SalesOrderFormValues) => {
    try {
      setIsSubmitting(true);
      const url = initialData ? getApiUrl(`/sales/orders/${initialData.id}`) : getApiUrl('/sales/orders');
      const res = await fetch(url, {
        method: initialData ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...values,
          salesPerson: values.salesPersonId,
          status: initialData ? initialData.status : 'Pending',
        }),
      });
      const data = await res.json();
      if (data.success) {
        await logActivity({
          action: initialData ? 'UPDATE' : 'CREATE',
          module: 'SALES',
          description: `${initialData ? 'Updated' : 'Created'} sales order: ${data.data.id}`,
          referenceId: String(data.data.id),
        });
        toast({
          title: initialData ? 'Sales Order Updated' : 'Sales Order Added',
          description: `Sales order ${data.data.id} has been successfully ${initialData ? 'updated' : 'created'}.`,
        });
        if (!initialData) form.reset();
        onClose();
        if (onSuccess) onSuccess();
        else window.location.reload();
      } else {
        toast({ title: 'Error', description: data.error || `Failed to ${initialData ? 'update' : 'create'} sales order`, variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: `Failed to ${initialData ? 'update' : 'create'} sales order`, variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const onInvalid = (errors: any) => {
    const messages: string[] = [];
    const walk = (node: any) => {
      if (!node) return;
      if (typeof node.message === 'string') { messages.push(node.message); return; }
      if (Array.isArray(node)) node.forEach(walk);
      else if (typeof node === 'object') Object.values(node).forEach(walk);
    };
    walk(errors);
    console.warn('Sales order validation failed:', errors);
    toast({
      title: 'Cannot create order',
      description: messages.length ? messages.slice(0, 3).join(' • ') : 'Please complete all required fields before creating the order.',
      variant: 'destructive',
    });
  };

  const watchedPaymentMethod = form.watch('paymentMethod');
  const selectedPaymentMethod = paymentMethods.find(m => m.name === watchedPaymentMethod);
  const isReferenceRequired = selectedPaymentMethod?.isReferenceRequired ?? false;

  return {
    form, fields, remove,
    total, vatAmount, vatableSales, isSubmitting, isReferenceRequired,
    handleAddProduct, onSubmit, onInvalid,
  };
}
