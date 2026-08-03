'use server';

import { query, withTransaction } from '@/lib/mysql';
import { checkApprovalRequired, submitToApprovalQueue } from '@/lib/approvals';
import { applyAdjustment, type AdjustmentType } from '@/lib/price-update-math';

export interface PriceUpdateItem {
  productId: string;
  sku: string;
  barcode: string;
  productName: string;
  field: 'price' | 'cost' | 'priceLevel';
  priceLevelId?: string;
  priceLevelName?: string;
  oldValue: number;
  newValue: number;
  adjustmentType: AdjustmentType;
  adjustmentValue: number;
}

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
  const skipped: { productId: string; productName: string; reason: string }[] = [];
  let applied = 0;

  await withTransaction(async (connection) => {
    for (const item of items) {
      const [rows]: any = await connection.query(
        'SELECT id, cost FROM products WHERE id = ?',
        [item.productId],
      );
      if (!rows || rows.length === 0) {
        skipped.push({ productId: item.productId, productName: item.productName, reason: 'Product no longer exists' });
        continue;
      }

      // Recompute at apply-time for markup-based price changes: cost may have
      // drifted since the batch was submitted (e.g. a new PO landed).
      // Percentage/fixed/exact changes are not cost-dependent, so they apply
      // the value that was already previewed.
      let newValue = item.newValue;
      if (item.adjustmentType === 'markup') {
        const liveCost = parseFloat(rows[0].cost ?? 0);
        newValue = applyAdjustment('markup', 0, item.adjustmentValue, liveCost);
      }

      if (item.field === 'price') {
        await connection.query('UPDATE products SET price = ? WHERE id = ?', [newValue, item.productId]);
      } else if (item.field === 'cost') {
        await connection.query('UPDATE products SET cost = ? WHERE id = ?', [newValue, item.productId]);
      } else if (item.field === 'priceLevel' && item.priceLevelId) {
        const [existing]: any = await connection.query(
          'SELECT product_id FROM product_price_levels WHERE product_id = ? AND price_level_id = ? AND (min_quantity IS NULL OR min_quantity = 0)',
          [item.productId, item.priceLevelId],
        );
        if (existing && existing.length > 0) {
          await connection.query(
            'UPDATE product_price_levels SET price = ? WHERE product_id = ? AND price_level_id = ? AND (min_quantity IS NULL OR min_quantity = 0)',
            [newValue, item.productId, item.priceLevelId],
          );
        } else {
          await connection.query(
            'INSERT INTO product_price_levels (product_id, price_level_id, price, min_quantity) VALUES (?, ?, ?, 0)',
            [item.productId, item.priceLevelId, newValue],
          );
        }
      }
      applied++;
    }
  });

  return {
    success: true,
    applied,
    skipped,
    message: `Updated ${applied} product(s).${skipped.length ? ` ${skipped.length} skipped.` : ''}`,
  };
}

export interface PriceListRow {
  sku: string;
  barcode: string;
  newPrice?: number;
  newCost?: number;
  newMarkupPct?: number;
}

export interface PriceListPreviewResult {
  matched: PriceUpdateItem[];
  skipped: { row: PriceListRow; reason: string }[];
}

export async function previewPriceListUpload(
  warehouseId: string,
  rows: PriceListRow[],
): Promise<PriceListPreviewResult> {
  const matched: PriceUpdateItem[] = [];
  const skipped: PriceListPreviewResult['skipped'] = [];
  const seenSkus = new Set<string>();

  for (const row of rows) {
    const sku = (row.sku || '').trim();
    const barcode = (row.barcode || '').trim();

    if (!sku && !barcode) {
      skipped.push({ row, reason: 'Missing SKU and barcode' });
      continue;
    }
    if (sku && seenSkus.has(sku)) {
      skipped.push({ row, reason: `Duplicate SKU "${sku}" (earlier row in this file superseded)` });
      continue;
    }

    let product: any;
    if (sku) {
      const bySku: any = await query(
        'SELECT id, name, sku, barcode, price, cost FROM products WHERE sku = ? AND warehouse_id = ? LIMIT 1',
        [sku, warehouseId],
      );
      product = bySku?.[0];
    }
    if (!product && barcode) {
      const byBarcode: any = await query(
        'SELECT id, name, sku, barcode, price, cost FROM products WHERE barcode = ? AND warehouse_id = ? LIMIT 1',
        [barcode, warehouseId],
      );
      product = byBarcode?.[0];
    }
    if (!product) {
      skipped.push({ row, reason: `No product found for SKU "${sku || '—'}" / barcode "${barcode || '—'}" in this warehouse` });
      continue;
    }
    if (sku) seenSkus.add(sku);

    if (row.newPrice != null) {
      if (!(row.newPrice >= 0)) {
        skipped.push({ row, reason: 'new_price must be a non-negative number' });
      } else {
        matched.push({
          productId: product.id, sku: product.sku, barcode: product.barcode || '', productName: product.name,
          field: 'price', oldValue: parseFloat(product.price), newValue: row.newPrice,
          adjustmentType: 'exact', adjustmentValue: row.newPrice,
        });
      }
    }
    if (row.newCost != null) {
      if (!(row.newCost >= 0)) {
        skipped.push({ row, reason: 'new_cost must be a non-negative number' });
      } else {
        matched.push({
          productId: product.id, sku: product.sku, barcode: product.barcode || '', productName: product.name,
          field: 'cost', oldValue: parseFloat(product.cost || 0), newValue: row.newCost,
          adjustmentType: 'exact', adjustmentValue: row.newCost,
        });
      }
    }
    if (row.newMarkupPct != null) {
      const liveCost = parseFloat(product.cost || 0);
      const newPrice = applyAdjustment('markup', 0, row.newMarkupPct, liveCost);
      matched.push({
        productId: product.id, sku: product.sku, barcode: product.barcode || '', productName: product.name,
        field: 'price', oldValue: parseFloat(product.price), newValue: newPrice,
        adjustmentType: 'markup', adjustmentValue: row.newMarkupPct,
      });
    }
  }

  return { matched, skipped };
}
