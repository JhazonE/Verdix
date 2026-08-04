'use server';

import { query, withTransaction } from '@/lib/mysql';
import { checkApprovalRequired, submitToApprovalQueue } from '@/lib/approvals';
import { applyAdjustment, isValidPriceValue, type AdjustmentType } from '@/lib/price-update-math';
import { addProduct } from '@/app/(app)/products/actions';
import { generateSku } from '@/lib/sku';

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
    const [defaultLevelRows]: any = await connection.query(
      'SELECT id FROM price_levels WHERE is_default = 1 LIMIT 1',
    );
    const defaultLevelId: string | undefined = defaultLevelRows?.[0]?.id;

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

      // Defense in depth: no matter which caller produced this item (drawer or
      // Excel path), and no matter whether it was valid at preview-time — cost
      // can drift between preview and apply for markup-based items — a NaN or
      // negative value must never reach the DB. Skip just this one item rather
      // than throwing and aborting the whole transaction.
      if (!isValidPriceValue(newValue)) {
        skipped.push({ productId: item.productId, productName: item.productName, reason: 'Computed price is invalid' });
        continue;
      }

      if (item.field === 'price') {
        await connection.query('UPDATE products SET price = ? WHERE id = ?', [newValue, item.productId]);
        // Keep an existing default-level price-level row in sync with the base
        // price it's meant to mirror — otherwise the Edit Product dialog's
        // Price Levels tab (and any other reader of product_price_levels)
        // shows a stale value after this update. A no-op if no such row
        // exists yet; this never creates one — that's the drawer's explicit
        // Price Level target field, not an implicit side effect of updating
        // the base price.
        if (defaultLevelId) {
          await connection.query(
            'UPDATE product_price_levels SET price = ? WHERE product_id = ? AND price_level_id = ?',
            [newValue, item.productId, defaultLevelId],
          );
        }
      } else if (item.field === 'cost') {
        await connection.query('UPDATE products SET cost = ? WHERE id = ?', [newValue, item.productId]);
      } else if (item.field === 'priceLevel' && item.priceLevelId) {
        // product_price_levels' primary key is (product_id, price_level_id) —
        // min_quantity is NOT part of it. A SELECT-then-branch existence check
        // filtered on min_quantity can miss an existing row (e.g. one with a
        // non-zero min_quantity set via the product's Price Levels tab), take
        // the INSERT branch, and hit a duplicate-PK error that aborts the
        // whole batch. Upsert on the real PK instead; only touch `price` on
        // conflict so an existing row's min_quantity is never silently reset.
        await connection.query(
          `INSERT INTO product_price_levels (product_id, price_level_id, price, min_quantity)
           VALUES (?, ?, ?, 0)
           ON DUPLICATE KEY UPDATE price = VALUES(price)`,
          [item.productId, item.priceLevelId, newValue],
        );
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
  name?: string;
  brand?: string;
  category?: string;
  unitOfMeasure?: string;
  newPrice?: number;
  newCost?: number;
  newMarkupPct?: number;
}

export interface NewProductFromExcel {
  sku: string;
  barcode: string;
  name: string;
  brand: string;
  category: string;
  unitOfMeasure: string;
  price: number;
  cost?: number;
}

export interface PriceListPreviewResult {
  matched: PriceUpdateItem[];
  toCreate: NewProductFromExcel[];
  skipped: { row: PriceListRow; reason: string }[];
}

export async function previewPriceListUpload(
  warehouseId: string,
  rows: PriceListRow[],
): Promise<PriceListPreviewResult> {
  const matched: PriceUpdateItem[] = [];
  const toCreate: NewProductFromExcel[] = [];
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
      // Unmatched: with enough identity data + a price, treat this as a new
      // product to create rather than an unconditional skip. Reusing
      // `newPrice` as the initial price — a to-create row has no "old"
      // value to update from.
      const missing: string[] = [];
      if (!row.name) missing.push('name');
      if (!row.brand) missing.push('brand');
      if (!row.category) missing.push('category');
      if (!row.unitOfMeasure) missing.push('unit_of_measure');
      if (row.newPrice == null) missing.push('new_price');

      if (missing.length > 0) {
        skipped.push({ row, reason: `Product not found and missing required fields to create it: ${missing.join(', ')}` });
        continue;
      }
      if (!isValidPriceValue(row.newPrice!)) {
        skipped.push({ row, reason: 'new_price must be a non-negative number' });
        continue;
      }
      if (row.newCost != null && !isValidPriceValue(row.newCost)) {
        skipped.push({ row, reason: 'new_cost must be a non-negative number' });
        continue;
      }
      // A blank sku is common for a genuinely new product the uploader
      // doesn't have a code for yet — auto-generate one instead of skipping,
      // using the same generator (brand/name prefix + random suffix) the
      // Add Product dialog's own "Generate SKU" button uses.
      const newSku = sku || generateSku(row.brand, row.name);
      if (seenSkus.has(newSku)) {
        skipped.push({ row, reason: `Duplicate SKU "${newSku}" (earlier row in this file superseded)` });
        continue;
      }
      seenSkus.add(newSku);
      toCreate.push({
        sku: newSku, barcode, name: row.name!, brand: row.brand!, category: row.category!, unitOfMeasure: row.unitOfMeasure!,
        price: row.newPrice!, cost: row.newCost,
      });
      continue;
    }
    if (sku) seenSkus.add(sku);

    if (row.newPrice != null) {
      if (!isValidPriceValue(row.newPrice)) {
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
      if (!isValidPriceValue(row.newCost)) {
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
      // Unlike price/cost, a markup % can legitimately be negative (a
      // markdown), so the bar here is "is it a real number" rather than
      // "is it non-negative" — but NaN (a non-numeric Excel cell) must never
      // reach `matched`.
      if (!Number.isFinite(row.newMarkupPct)) {
        skipped.push({ row, reason: 'new_markup_pct must be a number' });
      } else {
        const liveCost = parseFloat(product.cost || 0);
        const newPrice = applyAdjustment('markup', 0, row.newMarkupPct, liveCost);
        // Guards a corrupt/NaN product.cost (or any other non-finite/negative
        // result of the markup computation) from ever reaching `matched`.
        if (!isValidPriceValue(newPrice)) {
          skipped.push({ row, reason: 'Computed price from new_markup_pct is invalid (check product cost)' });
        } else {
          matched.push({
            productId: product.id, sku: product.sku, barcode: product.barcode || '', productName: product.name,
            field: 'price', oldValue: parseFloat(product.price), newValue: newPrice,
            adjustmentType: 'markup', adjustmentValue: row.newMarkupPct,
          });
        }
      }
    }
  }

  return { matched, toCreate, skipped };
}

export interface CreateProductsResult {
  created: number;
  pendingApproval: number;
  failed: { row: NewProductFromExcel; reason: string }[];
}

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
