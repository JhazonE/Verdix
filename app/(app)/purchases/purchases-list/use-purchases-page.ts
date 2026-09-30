'use client';

import { useState, useEffect } from 'react';
import { format as formatFns } from 'date-fns';
import { DateRange } from 'react-day-picker';

import { PurchaseOrder } from '@/lib/types';
import {
  usePurchaseOrders,
  useProducts,
  useBusinessProfile,
  useSuppliers,
} from '@/hooks/use-api';
import {
  useSystemSettings,
  useUpdatePurchaseOrder,
  useReceivePurchaseOrder,
  useInvalidatePurchaseOrders,
} from '@/hooks/use-purchase-order-mutations';
import { useToast } from '@/hooks/use-toast';
import { logActivity } from '@/lib/client-activity-logger';
import { getApiUrl } from '@/lib/api-config';

import { exportToCSV, exportToPDF } from '../purchase-order-export-utils';
import { printPurchaseOrder } from '../purchase-order-print-utils';

export function usePurchasesPage() {
  const { products } = useProducts();
  const { profile } = useBusinessProfile();
  const { settings } = useSystemSettings();
  const { toast } = useToast();

  // ---- filter/search state -------------------------------------------------

  const [searchTerm, setSearchTerm] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [supplierFilter, setSupplierFilter] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  // ---- dialog state --------------------------------------------------------

  const [editingOrder, setEditingOrder] = useState<PurchaseOrder | null>(null);
  const [isEditOpen, setIsEditOpen] = useState(false);

  const [reorderData, setReorderData] = useState<PurchaseOrder | null>(null);
  const [isReorderOpen, setIsReorderOpen] = useState(false);

  const [isReceiveDialogOpen, setIsReceiveDialogOpen] = useState(false);
  const [orderToReceive, setOrderToReceive] = useState<PurchaseOrder | null>(null);

  const [viewingOrder, setViewingOrder] = useState<PurchaseOrder | null>(null);

  const [isScheduledOrderOpen, setIsScheduledOrderOpen] = useState(false);
  const [scheduledSupplierId, setScheduledSupplierId] = useState<string | undefined>(undefined);

  // ---- data ----------------------------------------------------------------

  const { suppliers } = useSuppliers('', 1, 100);

  const { purchaseOrders, loading, pagination } = usePurchaseOrders(
    searchTerm,
    statusFilter,
    currentPage,
    pageSize,
    dateRange?.from ? formatFns(dateRange.from, 'yyyy-MM-dd') : undefined,
    dateRange?.to ? formatFns(dateRange.to, 'yyyy-MM-dd') : undefined,
    supplierFilter,
  );

  const updateOrderMutation = useUpdatePurchaseOrder();
  const receiveMutation = useReceivePurchaseOrder();
  const invalidatePurchaseOrders = useInvalidatePurchaseOrders();

  // ---- effects -------------------------------------------------------------

  useEffect(() => {
    setCurrentPage(1);
  }, [pageSize]);

  // ---- handlers ------------------------------------------------------------

  const updatePurchaseOrder = (id: string, updates: Partial<PurchaseOrder>) => {
    updateOrderMutation.mutate(
      { id, updates },
      {
        onError: (error: any) => {
          console.error('Failed to update purchase order:', error);
          toast({
            variant: 'destructive',
            title: 'Update Failed',
            description: error.message || 'An unexpected error occurred.',
          });
        },
      },
    );
  };

  const handleReceiveConfirm = (
    receivedItems: {
      productId: string;
      quantity: number;
      expirationDate?: string;
      sellingPrice?: number;
      sellingUnitId?: string;
      sellingUnitName?: string;
      sellingUnitFactor?: number;
    }[],
    badItems?: {
      productId: string;
      productName: string;
      quantity: number;
      cost: number;
      reason: string;
      description: string;
      sellingUnitFactor?: number;
    }[],
    allocationStrategy?: 'equal' | 'proportional',
  ): Promise<void> => {
    if (!orderToReceive) return Promise.resolve();

    return new Promise((resolve, reject) => {
      receiveMutation.mutate(
        { order: orderToReceive, receivedItems, badItems, allocationStrategy },
        {
          onSuccess: async (data) => {
            if (data.pendingApproval) {
              await logActivity({
                action: 'RECEIVE',
                module: 'PURCHASES',
                description: `Purchase receipt submitted for approval — PO: ${orderToReceive?.id}`,
                referenceId: orderToReceive?.id,
              });
              toast({ title: 'Approval Required', description: 'Purchase receipt has been submitted for approval.' });
            } else {
              await logActivity({
                action: 'RECEIVE',
                module: 'PURCHASES',
                description: `Received stock for PO: ${orderToReceive?.id}${data.badItemCount > 0 ? ` — ${data.badItemCount} bad items recorded` : ''}`,
                referenceId: orderToReceive?.id,
              });
              toast({
                title: 'Stock Received',
                description:
                  data.badItemCount > 0
                    ? `Inventory updated and ${data.badItemCount} bad items recorded.`
                    : 'Inventory has been updated successfully.',
              });
            }
            setIsReceiveDialogOpen(false);
            setOrderToReceive(null);
            resolve();
          },
          onError: (error) => {
            console.error('Failed to receive items:', error);
            toast({ title: 'Error', description: 'Failed to update stock items.', variant: 'destructive' });
            reject(error);
          },
        },
      );
    });
  };

  const addPurchaseOrder = (_order: PurchaseOrder) => {
    invalidatePurchaseOrders();
    setEditingOrder(null);
  };

  const handleSearch = () => {
    setSearchTerm(searchQuery);
    setCurrentPage(1);
  };

  const resetFilters = () => {
    setSearchTerm('');
    setSearchQuery('');
    setDateRange(undefined);
    setStatusFilter('all');
    setSupplierFilter('all');
    setCurrentPage(1);
  };

  const handlePrint = (order: PurchaseOrder) => {
    printPurchaseOrder(order, profile, products);
  };

  const handleExport = async (format: 'csv' | 'pdf') => {
    try {
      const params = new URLSearchParams();
      if (searchTerm) params.append('search', searchTerm);
      if (statusFilter !== 'all') params.append('status', statusFilter);
      if (supplierFilter !== 'all') params.append('supplierId', supplierFilter);
      if (dateRange?.from) params.append('startDate', formatFns(dateRange.from, 'yyyy-MM-dd'));
      if (dateRange?.to) params.append('endDate', formatFns(dateRange.to, 'yyyy-MM-dd'));

      const response = await fetch(getApiUrl(`/purchase-orders/export?${params.toString()}`));
      if (!response.ok) throw new Error(`API error ${response.status}`);
      const result = await response.json();
      if (!result.success) throw new Error(result.error || 'Export failed');

      const fileName = `purchase_orders_${formatFns(new Date(), 'yyyyMMdd_HHmm')}`;
      if (format === 'csv') {
        await exportToCSV(result.data, fileName);
      } else {
        await exportToPDF(result.data, fileName, profile);
      }

      toast({ title: 'Export Successful', description: `Your ${format.toUpperCase()} file has been generated.` });
    } catch (error) {
      console.error('Export error:', error);
      toast({ title: 'Export Failed', description: 'An error occurred during export.', variant: 'destructive' });
    }
  };

  const handleEdit = (order: PurchaseOrder) => {
    setEditingOrder(order);
    setIsEditOpen(true);
  };

  const handleReorder = (order: PurchaseOrder) => {
    setReorderData(order);
    setIsReorderOpen(true);
  };

  const handleViewDetails = (order: PurchaseOrder) => {
    setViewingOrder(order);
  };

  const handleReceiveOpen = (order: PurchaseOrder) => {
    setOrderToReceive(order);
    setIsReceiveDialogOpen(true);
  };

  const hasActiveFilters = !!(searchTerm || dateRange);

  return {
    // data
    purchaseOrders,
    loading,
    pagination,
    suppliers,
    settings,
    products,
    profile,

    // filter state
    searchQuery, setSearchQuery,
    dateRange, setDateRange,
    statusFilter, setStatusFilter,
    supplierFilter, setSupplierFilter,
    currentPage, setCurrentPage,
    pageSize, setPageSize,
    hasActiveFilters,

    // dialog state
    editingOrder,
    isEditOpen, setIsEditOpen,
    reorderData,
    isReorderOpen, setIsReorderOpen,
    isReceiveDialogOpen, setIsReceiveDialogOpen,
    orderToReceive,
    viewingOrder, setViewingOrder,
    isScheduledOrderOpen, setIsScheduledOrderOpen,
    scheduledSupplierId, setScheduledSupplierId,

    // handlers
    updatePurchaseOrder,
    handleReceiveConfirm,
    handleReceiveOpen,
    addPurchaseOrder,
    handleSearch,
    resetFilters,
    handlePrint,
    handleExport,
    handleEdit,
    handleReorder,
    handleViewDetails,
  };
}

export type PurchasesPageController = ReturnType<typeof usePurchasesPage>;
