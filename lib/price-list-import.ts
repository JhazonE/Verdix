import { applyAdjustment, isValidPriceValue, type AdjustmentType } from '@/lib/price-update-math';
import { generateSku } from '@/lib/sku';
import { query, withTransaction } from '@/lib/mysql';

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

/**
 * Splits a list into fixed-size chunks. Used for both the 1,000-identifier
 * IN (...) lookup batches and the 500-item apply transactions.
 */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Identifiers-per-IN() for the batched lookups. */
export const LOOKUP_CHUNK_SIZE = 1000;
/** Rows-per-transaction for applying updates and inserting new products. */
export const APPLY_CHUNK_SIZE = 500;

/**
 * Loads every product this file could match, in chunked IN (...) queries
 * instead of one or two SELECTs per row. A 15,000-row file goes from up to
 * 30,000 sequential round-trips to roughly 30.
 *
 * `allSkus` additionally loads every SKU in the warehouse (not just the ones
 * named in the file) so generateUniqueSku can avoid colliding with a product
 * the file never mentions.
 */
export async function loadMatchMaps(warehouseId: string, rows: PriceListRow[]): Promise<MatchMaps> {
  const skus = [...new Set(rows.map(r => (r.sku || '').trim()).filter(Boolean))];
  const barcodes = [...new Set(rows.map(r => (r.barcode || '').trim()).filter(Boolean))];

  const bySku = new Map<string, ProductLookup>();
  const byBarcode = new Map<string, ProductLookup>();

  for (const part of chunk(skus, LOOKUP_CHUNK_SIZE)) {
    const rowsOut: any = await query(
      `SELECT id, name, sku, barcode, price, cost FROM products
       WHERE warehouse_id = ? AND sku IN (${part.map(() => '?').join(',')})`,
      [warehouseId, ...part],
    );
    for (const p of rowsOut ?? []) if (p.sku) bySku.set(p.sku, p);
  }

  for (const part of chunk(barcodes, LOOKUP_CHUNK_SIZE)) {
    const rowsOut: any = await query(
      `SELECT id, name, sku, barcode, price, cost FROM products
       WHERE warehouse_id = ? AND barcode IN (${part.map(() => '?').join(',')})`,
      [warehouseId, ...part],
    );
    for (const p of rowsOut ?? []) if (p.barcode) byBarcode.set(p.barcode, p);
  }

  const allSkuRows: any = await query('SELECT sku FROM products WHERE warehouse_id = ? AND sku IS NOT NULL', [warehouseId]);
  const allSkus = new Set<string>((allSkuRows ?? []).map((r: any) => r.sku));

  return { bySku, byBarcode, allSkus };
}

/**
 * Applies matched items in APPLY_CHUNK_SIZE transactions rather than one.
 *
 * This deliberately trades all-or-nothing atomicity for liveness: holding
 * 15,000 row locks in a single transaction blocks POS checkout for minutes and
 * risks innodb_lock_wait_timeout. A mid-run failure leaves earlier chunks
 * committed; re-running the same file is idempotent, since it sets the same
 * prices again.
 */
export async function applyMatchedItems(
  items: PriceUpdateItem[],
  onProgress?: (done: number) => void,
): Promise<{ applied: number; skipped: { productId: string; productName: string; reason: string }[]; error?: string }> {
  const skipped: { productId: string; productName: string; reason: string }[] = [];
  let applied = 0;
  let done = 0;

  // query() (lib/mysql.ts) already destructures the mysql2 result tuple
  // internally and returns the row array directly — destructuring it again
  // here would bind the first row object, not the array.
  const defaultLevelRows: any = await query('SELECT id FROM price_levels WHERE is_default = 1 LIMIT 1');
  const defaultLevelId: string | undefined = defaultLevelRows?.[0]?.id;

  // A chunk that throws (deadlock, connection loss, etc.) stops the loop
  // rather than propagating: the chunks before it already committed real
  // money changes (prices, costs), so the caller must be able to report what
  // actually landed instead of the whole apply being reported as a bare
  // "Error" while thousands of prices silently changed underneath it.
  // Continuing past the failure is deliberately not attempted — a systemic
  // failure (e.g. lost DB connection) would just repeat on every later chunk.
  let error: string | undefined;
  for (const part of chunk(items, APPLY_CHUNK_SIZE)) {
    try {
      await withTransaction(async (connection) => {
        for (const item of part) {
          // connection.query() is raw mysql2 and DOES return [rows, fields] —
          // unlike query() above, this destructuring is correct.
          const [rows]: any = await connection.query('SELECT id, cost FROM products WHERE id = ?', [item.productId]);
          if (!rows || rows.length === 0) {
            skipped.push({ productId: item.productId, productName: item.productName, reason: 'Product no longer exists' });
            continue;
          }

          // Recompute markup-derived prices at apply time: cost may have drifted
          // since preview (e.g. a new PO landed).
          let newValue = item.newValue;
          if (item.adjustmentType === 'markup') {
            const liveCost = parseFloat(rows[0].cost ?? 0);
            newValue = applyAdjustment('markup', 0, item.adjustmentValue, liveCost);
          }

          if (!isValidPriceValue(newValue)) {
            skipped.push({ productId: item.productId, productName: item.productName, reason: 'Computed price is invalid' });
            continue;
          }

          if (item.field === 'price') {
            await connection.query('UPDATE products SET price = ? WHERE id = ?', [newValue, item.productId]);
            // Keep an existing default-level price-level row in sync with the
            // base price it mirrors. Never creates one.
            if (defaultLevelId) {
              await connection.query(
                'UPDATE product_price_levels SET price = ? WHERE product_id = ? AND price_level_id = ?',
                [newValue, item.productId, defaultLevelId],
              );
            }
          } else if (item.field === 'cost') {
            await connection.query('UPDATE products SET cost = ? WHERE id = ?', [newValue, item.productId]);
          } else if (item.field === 'priceLevel' && item.priceLevelId) {
            // Upsert on the real PK (product_id, price_level_id); min_quantity is
            // not part of it, so an existence check filtered on min_quantity can
            // miss a row and hit a duplicate-PK error.
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
    } catch (err: any) {
      error = err?.message || 'Failed to apply price changes.';
      break;
    }
    done += part.length;
    onProgress?.(done);
  }

  return { applied, skipped, ...(error ? { error } : {}) };
}

const PRODUCTS_COLUMNS = `id, name, description, category, brand, warehouse_id, stock, reorder_point,
    avg_daily_sales, price, cost, sku, barcode, image_hint, unit_of_measure, conversion_factor,
    vat_status, availability, earns_points, is_perishable, type`;
const PRODUCTS_PLACEHOLDERS = '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';

/**
 * Builds a products.id that can never exceed the column's VARCHAR(50) limit.
 *
 * Overhead beyond the SKU is fixed: '-' + 13-digit Date.now() + '-' + a 6-char
 * base36 suffix = 21 chars. Truncating the SKU portion to 29 chars keeps the
 * total at 50 even for a SKU at its own column's max length (VARCHAR(100)).
 * Truncating here (not the SKU column itself) means a long SKU still saves
 * correctly — only this synthetic id is shortened.
 */
function buildProductId(sku: string): string {
  const suffix = `-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  const maxSkuLen = 50 - suffix.length;
  return `${sku.slice(0, maxSkuLen)}${suffix}`;
}

/** Column values for one products row, in PRODUCTS_COLUMNS order. */
function buildProductValues(r: NewProductFromExcel, warehouseId: string, productId: string): any[] {
  return [
    productId, r.name, r.name, r.category, r.brand, warehouseId, 0, 0,
    0, r.price, r.cost ?? null, r.sku, r.barcode || null,
    r.name.toLowerCase().replace(/\s+/g, '-'), r.unitOfMeasure, 1,
    'YES (Subject to 12% VAT)', 'Available', 1, 0, 'standard',
  ];
}

/**
 * Inserts new products with multi-row INSERTs instead of one addProduct() call
 * (and therefore one transaction) per row.
 *
 * Safe because the Excel path supplies none of addProduct's optional
 * sub-entities — no shelf locations, conversion factors, price levels or
 * supplier mappings — and stock 0, so addProduct reduces to this single INSERT.
 * If addProduct's column defaults change, change them here too.
 */
export async function insertNewProducts(
  warehouseId: string,
  rows: NewProductFromExcel[],
  onProgress?: (done: number) => void,
): Promise<{ created: number; failed: { row: NewProductFromExcel; reason: string }[] }> {
  let created = 0;
  let done = 0;
  const failed: { row: NewProductFromExcel; reason: string }[] = [];

  for (const part of chunk(rows, APPLY_CHUNK_SIZE)) {
    const values: any[] = [];
    const placeholders: string[] = [];
    for (const r of part) {
      placeholders.push(PRODUCTS_PLACEHOLDERS);
      values.push(...buildProductValues(r, warehouseId, buildProductId(r.sku)));
    }

    try {
      await withTransaction(async (connection) => {
        await connection.query(`INSERT INTO products (${PRODUCTS_COLUMNS}) VALUES ${placeholders.join(', ')}`, values);
      });
      created += part.length;
    } catch {
      // The chunk's transaction threw, but that does not prove nothing landed:
      // a connection loss or a failure inside commit() itself (PROTOCOL_CONNECTION_LOST,
      // a server-side timeout) can throw AFTER the commit already succeeded, and the
      // following rollback() on a dead connection is then a no-op. Find out what is
      // actually in the DB before retrying anything, so an already-committed row is
      // never re-inserted (which would otherwise hit the sku+warehouse unique index
      // and get misreported as failed even though it succeeded).
      const skusInPart = part.map(r => r.sku);
      const existingSkuRows: any = await query(
        `SELECT sku FROM products WHERE warehouse_id = ? AND sku IN (${skusInPart.map(() => '?').join(',')})`,
        [warehouseId, ...skusInPart],
      );
      const alreadyLanded = new Set<string>((existingSkuRows ?? []).map((row: any) => row.sku));

      for (const r of part) {
        if (alreadyLanded.has(r.sku)) {
          // The chunk insert actually succeeded for this row before the
          // connection-level failure; count it as created, do not re-insert.
          created++;
          continue;
        }
        try {
          const productId = buildProductId(r.sku);
          await query(
            `INSERT INTO products (${PRODUCTS_COLUMNS}) VALUES ${PRODUCTS_PLACEHOLDERS}`,
            buildProductValues(r, warehouseId, productId),
          );
          created++;
        } catch (rowError: any) {
          failed.push({ row: r, reason: rowError.message || 'Failed to create product' });
        }
      }
    }
    done += part.length;
    onProgress?.(done);
  }

  return { created, failed };
}
