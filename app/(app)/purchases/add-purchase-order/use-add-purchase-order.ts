'use client';

import { useState, useEffect, useCallback } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import { dispatchStockUpdate } from '@/hooks/use-live-refresh';
import { calculatePurchaseCosts } from '@/lib/purchase-utils';
import { PurchaseOrder, Product, Warehouse, TaxRate, SystemSettings, Category, Brand, PriceLevel } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { logActivity } from '@/lib/client-activity-logger';
import { useProducts, usePaymentMethods } from '@/hooks/use-api';
import { useUser } from '@/hooks/use-user';
import { getApiUrl } from '@/lib/api-config';
import { toSafeNumber } from '@/lib/utils';

import {
  getWarehouses,
  getCategories,
  getBrands,
  getSubcategories,
  getSuppliers,
} from '../../products/actions';
import { purchaseOrderSchema, type PurchaseOrderFormValues } from './purchase-order-schema';

export interface UseAddPurchaseOrderProps {
  onAddOrder?: (order: PurchaseOrder) => void;
  prefillProduct?: Product;
  prefillSupplierId?: string;
  editOrder?: PurchaseOrder | null;
  reorderData?: PurchaseOrder | null;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

function generateReference() {
  const randomNum = Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
  return `PO-${randomNum}`;
}

export function useAddPurchaseOrder({
  onAddOrder,
  prefillProduct,
  prefillSupplierId,
  editOrder,
  reorderData,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: UseAddPurchaseOrderProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setOpen = (val: boolean) => {
    controlledOnOpenChange?.(val);
    setInternalOpen(val);
  };

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [confirmValues, setConfirmValues] = useState<PurchaseOrderFormValues | null>(null);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [isLoadingWarehouses, setIsLoadingWarehouses] = useState(false);

  const { toast } = useToast();
  const { paymentMethods, refetch: refetchPaymentMethods } = usePaymentMethods();
  const { products } = useProducts();
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const fetchSuppliers = useCallback(async () => {
    const mod = await import('../../products/actions');
    const data = await mod.getSuppliers();
    setSuppliers(data || []);
  }, []);
  const { user } = useUser();

  const [systemSettings, setSystemSettings] = useState<SystemSettings | null>(null);
  const [priceLevels, setPriceLevels] = useState<PriceLevel[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [subcategories, setSubcategories] = useState<Category[]>([]);
  const [taxRates, setTaxRates] = useState<TaxRate[]>([]);
  const [activeTaxRate, setActiveTaxRate] = useState<TaxRate | null>(null);

  const [total, setTotal] = useState(0);
  const [vatTotal, setVatTotal] = useState(0);
  const [purchaseResults, setPurchaseResults] = useState<any>(null);

  // ---- initial data fetches ------------------------------------------------

  useEffect(() => {
    fetch(getApiUrl('/pos-settings'))
      .then((res) => res.json())
      .then((data) => { if (data.success) setSystemSettings(data.data); });

    fetch(getApiUrl('/price-levels'))
      .then((res) => res.json())
      .then((data) => {
        if (data || data.success) {
          const levels = Array.isArray(data) ? data : data.data;
          setPriceLevels(levels || []);
        }
      });

    const fetchMarkups = async () => {
      try {
        const [cats, brnds, subs, sups] = await Promise.all([
          getCategories(),
          getBrands(),
          getSubcategories(),
          getSuppliers(),
        ]);
        setCategories(cats || []);
        setBrands(brnds || []);
        setSubcategories(subs || []);
        setSuppliers(sups || []);
      } catch (error) {
        console.error('Error fetching markup entities:', error);
      }
    };
    fetchMarkups();
  }, []);

  useEffect(() => {
    fetchSuppliers();
  }, [fetchSuppliers]);

  useEffect(() => {
    fetch(getApiUrl('/settings/tax-rates'))
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setTaxRates(data);
          const defaultRate = data.find((r) => r.isDefault);
          if (defaultRate) setActiveTaxRate(defaultRate);
          else if (data.length > 0) setActiveTaxRate(data[0]);
        }
      })
      .catch((err) => console.error('Failed to fetch tax rates', err));
  }, []);

  // ---- form ----------------------------------------------------------------

  const form = useForm<PurchaseOrderFormValues>({
    resolver: zodResolver(purchaseOrderSchema),
    defaultValues: {
      purchaseType: 'Order',
      issueDate: new Date().toISOString().split('T')[0],
      deliveryDate: '',
      reference: '',
      supplierId: '',
      shipping: undefined,
      receiveToWarehouse: '',
      deliveryAddress: '',
      paymentMethod: '',
      note: '',
      items: [],
    },
  });

  const { fields, append, remove, update } = useFieldArray({
    control: form.control,
    name: 'items',
  });

  // ---- total calculation ---------------------------------------------------

  const calculateTotal = (items: any[], shipping?: number | string) => {
    const results = calculatePurchaseCosts(
      (items || []).map((item) => ({
        ...item,
        productId: item.productId || '',
        productName: item.productName || '',
        quantity: toSafeNumber(item.quantity),
        cost: toSafeNumber(item.cost),
        discount: toSafeNumber(item.discount),
        discountType: item.discountType || 'amount',
        vatSubject: !!item.vatSubject,
      })),
      toSafeNumber(shipping),
      activeTaxRate ? toSafeNumber(activeTaxRate.rate) : 12,
    );
    setVatTotal(results.vatAmount);
    setTotal(results.grandTotal);
    setPurchaseResults(results);
  };

  useEffect(() => {
    const subscription = form.watch((value, { name }) => {
      if (name?.startsWith('items') || name === 'shipping') {
        calculateTotal(value.items || [], value.shipping);
      }

      if (name === 'supplierId' || name === 'issueDate') {
        const supplierId = value.supplierId;
        const issueDate = value.issueDate;
        if (supplierId && issueDate) {
          const supplier = suppliers.find((s) => s.id === supplierId);
          if (supplier?.paymentTerms) {
            const parseDays = (terms: string) => {
              const lower = terms.toLowerCase();
              if (lower.includes('cod') || lower.includes('cash')) return 0;
              const match = terms.match(/\d+/);
              return match ? parseInt(match[0], 10) : 0;
            };
            const days = parseDays(supplier.paymentTerms);
            const date = new Date(issueDate);
            if (!isNaN(date.getTime())) {
              date.setDate(date.getDate() + days);
              const dueDateFormatted = date.toISOString().split('T')[0];
              if (form.getValues('deliveryDate') !== dueDateFormatted) {
                form.setValue('deliveryDate', dueDateFormatted, { shouldDirty: true });
              }
            }
          }
        }
      }
    });

    const currentValues = form.getValues();
    calculateTotal(currentValues.items, currentValues.shipping);

    return () => subscription.unsubscribe();
  }, [activeTaxRate, suppliers]);

  // ---- warehouses ----------------------------------------------------------

  const fetchWarehouses = async () => {
    setIsLoadingWarehouses(true);
    try {
      const warehouseData = await getWarehouses();
      setWarehouses(warehouseData);
    } catch (error) {
      console.error('Error loading warehouses:', error);
    } finally {
      setIsLoadingWarehouses(false);
    }
  };

  // ---- dialog open / prefill -----------------------------------------------

  useEffect(() => {
    if (!isOpen) return;

    fetchWarehouses();

    if (editOrder) {
      form.reset({
        purchaseType: 'Order',
        issueDate: editOrder.date
          ? new Date(editOrder.date).toISOString().split('T')[0]
          : new Date().toISOString().split('T')[0],
        deliveryDate: editOrder.deliveryDate
          ? new Date(editOrder.deliveryDate).toISOString().split('T')[0]
          : '',
        reference: editOrder.referenceNumber || '',
        supplierId: editOrder.supplierId,
        shipping: editOrder.shippingFee || undefined,
        receiveToWarehouse: '',
        deliveryAddress: '',
        paymentMethod: editOrder.paymentMethod,
        note: '',
        items: editOrder.items.map((item) => {
          const currentProduct = products.find((p) => p.id === item.productId);
          return {
            productId: item.productId,
            productName: item.productName,
            quantity: item.quantity,
            cost: item.cost,
            sellingPrice: (item as any).sellingPrice ?? currentProduct?.price ?? 0,
            discount: item.discount || 0,
            discountType: 'amount' as const,
            vatSubject: false,
            expirationDate: '',
            currentStock: currentProduct ? currentProduct.stock : 0,
            barcode: currentProduct ? currentProduct.barcode : '',
          };
        }),
      });
    } else if (reorderData) {
      const autoReference = generateReference();
      const updatedItems = reorderData.items.map((item) => {
        const currentProduct = products.find((p) => p.id === item.productId);
        return {
          productId: item.productId,
          productName: item.productName,
          quantity: item.quantity,
          cost: item.cost,
          sellingPrice: currentProduct ? currentProduct.price : 0,
          discount: item.discount || 0,
          discountType: (item.discountType as 'amount' | 'percentage') || 'amount' as const,
          vatSubject: false,
          expirationDate: '',
          currentStock: currentProduct ? currentProduct.stock : 0,
          barcode: currentProduct ? currentProduct.barcode : '',
        };
      });
      form.reset({
        purchaseType: 'Order',
        issueDate: new Date().toISOString().split('T')[0],
        deliveryDate: '',
        reference: autoReference,
        supplierId: reorderData.supplierId,
        shipping: reorderData.shippingFee || undefined,
        receiveToWarehouse: '',
        deliveryAddress: '',
        paymentMethod: reorderData.paymentMethod,
        note: '',
        items: updatedItems,
      });
    } else {
      const autoReference = generateReference();
      form.setValue('reference', autoReference);

      if (prefillSupplierId) {
        if (suppliers.length > 0) {
          const sup = suppliers.find((s) => s.id === prefillSupplierId);
          if (sup) form.setValue('supplierId', sup.id);
        } else {
          form.setValue('supplierId', prefillSupplierId);
        }
      }

      if (prefillProduct && fields.length === 0) {
        if (prefillProduct.supplier) {
          const sup = suppliers.find(
            (s) => s.id === prefillProduct.supplier || s.name === prefillProduct.supplier,
          );
          if (sup) form.setValue('supplierId', sup.id);
        }
        handleAddProduct(prefillProduct);
      }
    }
  }, [isOpen, editOrder, reorderData, prefillProduct, prefillSupplierId, suppliers, products]);

  // ---- product actions -----------------------------------------------------

  function handleAddProduct(product: Product) {
    const existingItemIndex = fields.findIndex((field) => field.productId === product.id);
    if (existingItemIndex !== -1) {
      const existingItem = fields[existingItemIndex];
      update(existingItemIndex, { ...existingItem, quantity: existingItem.quantity + 1 });
    } else {
      append({
        productId: product.id,
        productName: product.name,
        quantity: 1,
        cost: product.cost || 0,
        sellingPrice: product.price || 0,
        discount: 0,
        discountType: 'amount',
        vatSubject: product.vatStatus === 'Vatable' || product.vatStatus === 'Yes' || false,
        barcode: product.barcode || '',
        currentStock: product.stock || 0,
        avgDailySales: product.avgDailySales || 0,
        reorderPoint: product.reorderPoint || 0,
        expirationDate: '',
      });
    }
  }

  // ---- submit --------------------------------------------------------------

  async function onSubmit(values: PurchaseOrderFormValues) {
    if (systemSettings?.requirePurchaseOrderConfirmation) {
      setConfirmValues(values);
      setIsConfirmOpen(true);
    } else {
      await processSubmit(values);
    }
  }

  async function processSubmit(values: PurchaseOrderFormValues) {
    setIsSubmitting(true);
    try {
      const supplier = suppliers.find((s) => s.id === values.supplierId);
      if (!supplier) throw new Error('Supplier not found');

      const calculations = calculatePurchaseCosts(
        (values.items || []).map((item: any) => ({
          ...item,
          quantity: toSafeNumber(item.quantity),
          cost: toSafeNumber(item.cost),
          discount: toSafeNumber(item.discount),
          sellingPrice: toSafeNumber(item.sellingPrice),
        })),
        toSafeNumber(values.shipping),
        activeTaxRate ? toSafeNumber(activeTaxRate.rate) : 12,
      );

      const orderData = {
        supplierId: values.supplierId,
        supplierName: supplier.name,
        date: new Date(values.issueDate).toISOString(),
        items: calculations.items,
        total: calculations.grandTotal,
        vatAmount: calculations.vatAmount,
        paymentMethod: values.paymentMethod,
        status: editOrder ? undefined : 'Pending',
        reference: values.reference,
        shipping: values.shipping,
        note: values.note,
        purchaseType: values.purchaseType,
        receiveToWarehouse: values.receiveToWarehouse,
        receiveToWarehouseName: warehouses.find(
          (w) => w.id.toString() === values.receiveToWarehouse.toString(),
        )?.name,
        orderedBy: editOrder ? editOrder.orderedBy : user?.email || 'System',
        userId: user?.uid || 'system',
        deliveryDate: values.deliveryDate ? new Date(values.deliveryDate).toISOString() : null,
      };

      let result;
      if (editOrder) {
        const response = await fetch(getApiUrl(`/purchase-orders/${editOrder.id}`), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(orderData),
        });
        result = await response.json();
      } else {
        const response = await fetch(getApiUrl('/purchase-orders'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(orderData),
        });
        result = await response.json();
      }

      if (!result.success) throw new Error(result.error || 'Failed to save purchase order');

      if (onAddOrder) onAddOrder(result.data);

      await logActivity({
        action: editOrder ? 'UPDATE' : 'CREATE',
        module: 'PURCHASES',
        description: `${editOrder ? 'Updated' : 'Created'} purchase order: PO ${values.reference} — Supplier: ${suppliers.find((s: any) => s.id === values.supplierId)?.name || values.supplierId}`,
        referenceId: result.data?.id || values.reference,
      });

      toast({
        title: editOrder ? 'Purchase Order Updated' : 'Purchase Order Added',
        description: `PO ${values.reference} has been successfully saved.`,
      });

      if (!editOrder) form.reset();
      dispatchStockUpdate();
      setOpen(false);
      setIsConfirmOpen(false);
    } catch (error) {
      console.error('Error saving purchase order:', error);
      toast({
        variant: 'destructive',
        title: 'Uh oh! Something went wrong.',
        description:
          error instanceof Error
            ? error.message
            : 'There was a problem saving the purchase order. Please try again.',
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return {
    // open state
    isOpen, setOpen,
    // submit state
    isSubmitting,
    isConfirmOpen, setIsConfirmOpen,
    confirmValues,
    // form
    form,
    fields, append, remove, update,
    // data
    warehouses, isLoadingWarehouses,
    suppliers,
    paymentMethods,
    products,
    priceLevels,
    categories, brands, subcategories,
    taxRates, activeTaxRate,
    systemSettings,
    // totals
    total, vatTotal, purchaseResults,
    // handlers
    handleAddProduct,
    fetchSuppliers,
    fetchWarehouses,
    refetchPaymentMethods,
    onSubmit,
    processSubmit,
  };
}

export type AddPurchaseOrderController = ReturnType<typeof useAddPurchaseOrder>;
