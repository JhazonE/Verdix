import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getApiUrl } from '@/lib/api-config';
import { PurchaseOrder, SystemSettings } from '@/lib/types';
import { toSafeNumber } from '@/lib/utils';
import { dispatchStockUpdate } from '@/hooks/use-live-refresh';

export function useSystemSettings() {
  const { data, isLoading } = useQuery<SystemSettings>({
    queryKey: ['systemSettings'],
    queryFn: async () => {
      const res = await fetch(getApiUrl('/pos-settings'));
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const result = await res.json();
      if (!result.success) throw new Error(result.error || 'Failed to fetch settings');
      return result.data;
    },
    staleTime: 5 * 60 * 1000,
  });
  return { settings: data ?? null, isLoading };
}

export function useUpdatePurchaseOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<PurchaseOrder> }) => {
      const response = await fetch(getApiUrl(`/purchase-orders/${id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || result.message || 'Failed to update status');
      if (!result.success) throw new Error(result.error || 'Failed to update');
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] });
      dispatchStockUpdate();
    },
  });
}

type ReceiveMutationArgs = {
  order: PurchaseOrder;
  receivedItems: { productId: string; quantity: number; expirationDate?: string; sellingPrice?: number }[];
  badItems?: { productId: string; productName: string; quantity: number; cost: number; reason: string; description: string }[];
  allocationStrategy?: 'equal' | 'proportional';
};

type ReceiveMutationResult = {
  pendingApproval?: boolean;
  badItemCount: number;
};

export function useReceivePurchaseOrder() {
  const queryClient = useQueryClient();
  return useMutation<ReceiveMutationResult, Error, ReceiveMutationArgs>({
    mutationFn: async ({ order, receivedItems, badItems, allocationStrategy }) => {
      const enrichedReceivedItems = receivedItems.map(item => {
        const originalItem = order.items.find(i =>
          String(i.productId).trim().toLowerCase() === String(item.productId).trim().toLowerCase()
        );
        const cost = originalItem ? toSafeNumber(originalItem.cost) : 0;
        return {
          ...item,
          productName: originalItem?.productName || (originalItem as any)?.name || 'Unknown Product',
          sku: originalItem?.productSku || (originalItem as any)?.sku || '',
          barcode: (originalItem as any)?.barcode || (originalItem as any)?.productBarcode || '',
          cost,
          subtotal: cost * toSafeNumber(item.quantity),
        };
      });

      const receivedTotalValue = enrichedReceivedItems.reduce((acc, item) => acc + (item.subtotal || 0), 0);
      const userId = localStorage.getItem('mock-user-session')
        ? JSON.parse(localStorage.getItem('mock-user-session')!).uid
        : 'system';

      const response = await fetch(getApiUrl(`/purchase-orders/${order.id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'Received',
          receivedTotal: receivedTotalValue,
          receivedItems: enrichedReceivedItems,
          allocationStrategy,
          userId,
          supplierName: order.supplierName || 'N/A',
          referenceNumber: order.referenceNumber || order.id,
        }),
      });

      if (!response.ok) throw new Error('Failed to update status');
      const result = await response.json();

      if (result.pendingApproval) {
        return { pendingApproval: true, badItemCount: 0 };
      }

      if (!result.success) throw new Error(result.error || 'Failed to update order');

      if (badItems && badItems.length > 0) {
        const badOrderResponse = await fetch(getApiUrl('/bad-orders'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            purchaseOrderId: order.id,
            supplierId: order.supplierId,
            supplierName: order.supplierName,
            reportedBy: userId,
            reportDate: new Date().toISOString(),
            status: 'Reported',
            items: badItems,
            notes: `Automatically created during receipt of PO #${order.referenceNumber || order.id}`,
            userId,
          }),
        });
        if (!badOrderResponse.ok) {
          console.error('Failed to create bad order record');
        }
      }

      return { pendingApproval: false, badItemCount: badItems?.length ?? 0 };
    },
    onSuccess: (data) => {
      if (!data.pendingApproval) {
        queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] });
        dispatchStockUpdate();
      }
    },
  });
}

export function useInvalidatePurchaseOrders() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] });
}
