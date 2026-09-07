import { applyAdjustment, isValidPriceValue, type AdjustmentType } from '@/lib/price-update-math';
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

/** A product row as loaded by the batched lookup queries. */
export interface ProductLookup {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  price: string | number;
  cost: string | number | null;
}

/**
 * Pre-loaded lookups replacing the per-row SELECT pair. `allSkus` covers every
 * SKU in the warehouse, not just the ones in the file — it is what makes the
 * generated-SKU collision check possible (see generateUniqueSku).
 */
export interface MatchMaps {
  bySku: Map<string, ProductLookup>;
  byBarcode: Map<string, ProductLookup>;
  allSkus: Set<string>;
}

/**
 * Generates a SKU that collides with neither an existing product nor one
 * already claimed by an earlier row in this file.
 *
 * The previous inline `generateSku()` call checked only the in-file set, so a
 * generated code could duplicate an existing product's SKU and produce either
 * a failed insert or a duplicate SKU in the catalogue. generateSku draws a
 * 6-char base36 suffix (~2.2 billion values), so a collision is already
 * unlikely; the retries make it bounded rather than merely improbable, and
 * returning null lets the caller skip the one row instead of failing the file.
 */
export function generateUniqueSku(
  brand: string | undefined,
  name: string | undefined,
  taken: Set<string>,
  attempts = 10,
): string | null {
  for (let i = 0; i < attempts; i++) {
    const candidate = generateSku(brand, name);
    if (!taken.has(candidate)) return candidate;
  }
  return null;
}

export function matchPriceListRows(rows: PriceListRow[], maps: MatchMaps): PriceListPreviewResult {
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

    let product: ProductLookup | undefined;
    if (sku) product = maps.bySku.get(sku);
    if (!product && barcode) product = maps.byBarcode.get(barcode);

    if (!product) {
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

      let newSku = sku;
      if (!newSku) {
        // Check against BOTH the catalogue and the SKUs this file already
        // claimed. `maps.allSkus` is the fix for the collision bug.
        const generated = generateUniqueSku(row.brand, row.name, new Set([...maps.allSkus, ...seenSkus]));
        if (!generated) {
          skipped.push({ row, reason: 'Could not generate a unique SKU for this product' });
          continue;
        }
        newSku = generated;
      }
      if (seenSkus.has(newSku) || maps.allSkus.has(newSku)) {
        skipped.push({ row, reason: `Duplicate SKU "${newSku}" (earlier row in this file superseded)` });
        continue;
      }
      seenSkus.add(newSku);
      toCreate.push({
        sku: newSku, barcode, name: row.name!, brand: row.brand!, category: row.category!,
        unitOfMeasure: row.unitOfMeasure!, price: row.newPrice!, cost: row.newCost,
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
          field: 'price', oldValue: parseFloat(String(product.price)), newValue: row.newPrice,
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
          field: 'cost', oldValue: parseFloat(String(product.cost || 0)), newValue: row.newCost,
          adjustmentType: 'exact', adjustmentValue: row.newCost,
        });
      }
    }
    if (row.newMarkupPct != null) {
      if (!Number.isFinite(row.newMarkupPct)) {
        skipped.push({ row, reason: 'new_markup_pct must be a number' });
      } else {
        const liveCost = parseFloat(String(product.cost || 0));
        const newPrice = applyAdjustment('markup', 0, row.newMarkupPct, liveCost);
        if (!isValidPriceValue(newPrice)) {
          skipped.push({ row, reason: 'Computed price from new_markup_pct is invalid (check product cost)' });
        } else {
          matched.push({
            productId: product.id, sku: product.sku, barcode: product.barcode || '', productName: product.name,
            field: 'price', oldValue: parseFloat(String(product.price)), newValue: newPrice,
            adjustmentType: 'markup', adjustmentValue: row.newMarkupPct,
          });
        }
      }
    }
  }

  return { matched, toCreate, skipped };
}
