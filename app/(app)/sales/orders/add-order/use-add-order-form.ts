'use client';

import { useState, useEffect, useMemo } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useToast } from '@/hooks/use-toast';
import { logActivity } from '@/lib/client-activity-logger';
import { getApiUrl } from '@/lib/api-config';
import type { Product, PaymentMethod, SalesPerson, Customer, Sale } from '@/lib/types';
import { salesOrderSchema, type SalesOrderFormValues } from './add-order-types';

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

  // Running total calculation
  useEffect(() => {
    const sub = form.watch((value, { name }) => {
      if (name?.startsWith('items') || name === 'shipping') {
        const itemsTotal = (value.items || []).reduce((acc: number, item: any) =>
          acc + (Number(item?.price || 0) * Number(item?.quantity || 0)), 0);
        setTotal(itemsTotal + Number(value.shipping || 0));
      }
    });
    const cur = form.getValues();
    const itemsTotal = (cur.items || []).reduce((acc: number, item: any) =>
      acc + (Number(item?.price || 0) * Number(item?.quantity || 0)), 0);
    setTotal(itemsTotal + Number(cur.shipping || 0));
    return () => sub.unsubscribe();
  }, []);

  const handleAddProduct = (product: Product) => {
    const existingIndex = fields.findIndex(f => f.product.id === product.id);
    if (existingIndex !== -1) {
      update(existingIndex, { ...fields[existingIndex], quantity: fields[existingIndex].quantity + 1 });
    } else {
      append({ product: { ...product }, quantity: 1, price: product.price });
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
    total, isSubmitting, isReferenceRequired,
    handleAddProduct, onSubmit, onInvalid,
  };
}
