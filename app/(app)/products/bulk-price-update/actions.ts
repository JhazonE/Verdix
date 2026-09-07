'use server';

import { checkApprovalRequired, submitToApprovalQueue } from '@/lib/approvals';
import { addProduct } from '@/app/(app)/products/actions';
import {
  applyMatchedItems,
  type PriceUpdateItem, type PriceListRow, type NewProductFromExcel, type PriceListPreviewResult,
} from '@/lib/price-list-import';

export type {
  PriceUpdateItem, PriceListRow, NewProductFromExcel, PriceListPreviewResult,
} from '@/lib/price-list-import';

export interface PriceUpdateResult {
  success: boolean;
  pendingApproval?: boolean;
  queueId?: string | null;
  applied?: number;
  skipped?: { productId: string; productName: string; reason: string }[];
  message?: string;
}

export async function submitPriceUpdateBatch(
  warehouseId: string,
  items: PriceUpdateItem[],
  userId: string,
  isInternalFinalization: boolean = false,
): Promise<PriceUpdateResult> {
  if (!items || items.length === 0) {
    return { success: false, message: 'No products selected.' };
  }

  if (!isInternalFinalization) {
    const isApprovalRequired = await checkApprovalRequired('PRICE_UPDATE');
    if (isApprovalRequired) {
      const { queueId, pendingApproval } = await submitToApprovalQueue(
        'PRICE_UPDATE',
        { warehouseId, items },
        userId,
      );
      if (pendingApproval) {
        return {
          success: true,
          pendingApproval: true,
          queueId,
          message: `Price update for ${items.length} product(s) submitted for approval.`,
        };
      }
      // All steps auto-skipped (creator can approve their own step) -> fall through to immediate apply.
    }
  }

  return applyPriceUpdateBatch(items);
}

async function applyPriceUpdateBatch(items: PriceUpdateItem[]): Promise<PriceUpdateResult> {
  const { applied, skipped } = await applyMatchedItems(items);
  return {
    success: true,
    applied,
    skipped,
    message: `Updated ${applied} product(s).${skipped.length ? ` ${skipped.length} skipped.` : ''}`,
  };
}

export interface CreateProductsResult {
  created: number;
  pendingApproval: number;
  failed: { row: NewProductFromExcel; reason: string }[];
}

// The drawer path keeps per-row addProduct() so each new product still routes
// through PRODUCT_CREATE approvals. The bulk Excel route uses
// insertNewProducts() instead, which is why it refuses to run while product
// approvals are on.
export async function createProductsFromExcel(
  warehouseId: string,
  rows: NewProductFromExcel[],
  userId: string,
): Promise<CreateProductsResult> {
  let created = 0;
  let pendingApproval = 0;
  const failed: CreateProductsResult['failed'] = [];

  for (const row of rows) {
    try {
      const result = await addProduct({
        name: row.name,
        brand: row.brand,
        sku: row.sku,
        barcode: row.barcode || undefined,
        description: row.name,
        category: row.category,
        warehouse: warehouseId,
        unitOfMeasure: row.unitOfMeasure,
        stock: 0,
        reorderPoint: 0,
        price: row.price,
        cost: row.cost,
      } as any, userId);

      if (!result.success) {
        failed.push({ row, reason: (result as any).message || 'Failed to create product' });
      } else if ((result as any).pendingApproval) {
        pendingApproval++;
      } else {
        created++;
      }
    } catch (error: any) {
      failed.push({ row, reason: error.message || 'Failed to create product' });
    }
  }

  return { created, pendingApproval, failed };
}
