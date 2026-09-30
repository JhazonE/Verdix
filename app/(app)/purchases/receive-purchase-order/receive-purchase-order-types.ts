import { PurchaseOrder } from '@/lib/types';

export interface BadItemInput {
  quantity: number;
  reason: string;
  description: string;
}

export interface ReceivePurchaseOrderDialogProps {
  order: PurchaseOrder;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (
    receivedItems: {
      productId: string;
      quantity: number;
      expirationDate?: string;
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
  ) => Promise<void>;
  requireConfirmation?: boolean;
}

/**
 * A PO line's own identity for map keys in the receive flow. Two lines for the
 * same product (e.g. a Piece line and a Case line) share a productId but never
 * an id — keying by id (falling back to productId only for pre-feature/transient
 * lines that lack one) is what keeps such lines from colliding in state.
 */
export function lineKey(item: { id?: string; productId: string }): string {
  return item.id || item.productId;
}
