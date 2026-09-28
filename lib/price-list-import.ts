import { applyAdjustment, isValidPriceValue, type AdjustmentType } from '@/lib/price-update-math';
import { query, withTransaction } from '@/lib/mysql';

export interface PriceUpdateItem {
  productId: string;
  baseUnitBarcode: string;
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

/** A product row as loaded by the batched lookup queries, keyed by its base selling unit's barcode. */
export interface ProductLookup {
  id: string;
  name: string;
  baseUnitBarcode: string | null;
  barcode: string | null;
  price: string | number;
  cost: string | number | null;
}

/** Pre-loaded lookups replacing the per-row SELECT pair. */
export interface MatchMaps {
  byBaseUnitBarcode: Map<string, ProductLookup>;
}

export function matchPriceListRows(rows: PriceListRow[], maps: MatchMaps): PriceListPreviewResult {
  const matched: PriceUpdateItem[] = [];
  const toCreate: NewProductFromExcel[] = [];
  const skipped: PriceListPreviewResult['skipped'] = [];
  const seenBarcodes = new Set<string>();

  for (const row of rows) {
    const barcode = (row.barcode || '').trim();

    if (!barcode) {
      skipped.push({ row, reason: 'Missing barcode' });
      continue;
    }
    if (seenBarcodes.has(barcode)) {
      skipped.push({ row, reason: `Duplicate barcode "${barcode}" (earlier row in this file superseded)` });
      continue;
    }

    const product = maps.byBaseUnitBarcode.get(barcode);

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

      seenBarcodes.add(barcode);
      toCreate.push({
        barcode, name: row.name!, brand: row.brand!, category: row.category!,
        unitOfMeasure: row.unitOfMeasure!, price: row.newPrice!, cost: row.newCost,
      });
      continue;
    }
    seenBarcodes.add(barcode);

    if (row.newPrice != null) {
      if (!isValidPriceValue(row.newPrice)) {
        skipped.push({ row, reason: 'new_price must be a non-negative number' });
      } else {
        matched.push({
          productId: product.id, baseUnitBarcode: product.baseUnitBarcode || '', barcode: product.barcode || '', productName: product.name,
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
          productId: product.id, baseUnitBarcode: product.baseUnitBarcode || '', barcode: product.barcode || '', productName: product.name,
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
            productId: product.id, baseUnitBarcode: product.baseUnitBarcode || '', barcode: product.barcode || '', productName: product.name,
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
 * Matches against the base selling unit's barcode (`product_selling_units`
 * with `is_base = 1`), not the legacy `products.barcode` column — this is
 * the one identifier the rest of the sku-retirement effort standardized on.
 */
export async function loadMatchMaps(warehouseId: string, rows: PriceListRow[]): Promise<MatchMaps> {
  const barcodes = [...new Set(rows.map(r => (r.barcode || '').trim()).filter(Boolean))];

  const byBaseUnitBarcode = new Map<string, ProductLookup>();

  for (const part of chunk(barcodes, LOOKUP_CHUNK_SIZE)) {
    const rowsOut: any = await query(
      `SELECT p.id, p.name, su.barcode as baseUnitBarcode, p.barcode, p.price, p.cost
       FROM products p
       JOIN product_selling_units su ON su.product_id = p.id AND su.is_base = 1
       WHERE p.warehouse_id = ? AND su.barcode IN (${part.map(() => '?').join(',')})`,
      [warehouseId, ...part],
    );
    for (const p of rowsOut ?? []) if (p.baseUnitBarcode) byBaseUnitBarcode.set(p.baseUnitBarcode, p);
  }

  return { byBaseUnitBarcode };
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
                `UPDATE product_selling_unit_price_levels sulp
                 JOIN product_selling_units su ON su.id = sulp.selling_unit_id
                 SET sulp.price = ?
                 WHERE su.product_id = ? AND su.is_base = 1 AND sulp.price_level_id = ?`,
                [newValue, item.productId, defaultLevelId],
              );
            }
          } else if (item.field === 'cost') {
            await connection.query('UPDATE products SET cost = ? WHERE id = ?', [newValue, item.productId]);
          } else if (item.field === 'priceLevel' && item.priceLevelId) {
            // Upsert on the real PK (selling_unit_id, price_level_id). Price
            // levels are per selling unit now (product_selling_unit_price_levels);
            // write onto the product's base selling unit, matching every other
            // write path in this codebase.
            const [baseUnitRows]: any = await connection.query(
              'SELECT id FROM product_selling_units WHERE product_id = ? AND is_base = 1 LIMIT 1',
              [item.productId],
            );
            if (baseUnitRows.length > 0) {
              await connection.query(
                `INSERT INTO product_selling_unit_price_levels (selling_unit_id, price_level_id, price)
                 VALUES (?, ?, ?)
                 ON DUPLICATE KEY UPDATE price = VALUES(price)`,
                [baseUnitRows[0].id, item.priceLevelId, newValue],
              );
            } else {
              skipped.push({ productId: item.productId, productName: item.productName, reason: 'Product has no base selling unit' });
              continue;
            }
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
 * Overhead beyond the barcode is fixed: '-' + 13-digit Date.now() + '-' + a
 * 6-char base36 suffix = 21 chars. Truncating the barcode portion to 29 chars
 * keeps the total at 50 even for a barcode at its own column's max length.
 * Truncating here (not the barcode column itself) means a long barcode still
 * saves correctly — only this synthetic id is shortened.
 */
function buildProductId(barcode: string): string {
  const suffix = `-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  const maxLen = 50 - suffix.length;
  return `${barcode.slice(0, maxLen)}${suffix}`;
}

/**
 * Column values for one products row, in PRODUCTS_COLUMNS order.
 *
 * `sku` is mirrored from `barcode` rather than left blank — Sub-project A of
 * the sku-retirement effort established that every write path keeps
 * products.sku in sync with the base unit's barcode so any not-yet-migrated
 * reader keeps seeing a matching value.
 */
function buildProductValues(r: NewProductFromExcel, warehouseId: string, productId: string): any[] {
  return [
    productId, r.name, r.name, r.category, r.brand, warehouseId, 0, 0,
    0, r.price, r.cost ?? null, r.barcode, r.barcode,
    r.name.toLowerCase().replace(/\s+/g, '-'), r.unitOfMeasure, 1,
    'YES (Subject to 12% VAT)', 'Available', 1, 0, 'standard',
  ];
}

/**
 * Inserts new products with multi-row INSERTs instead of one addProduct() call
 * (and therefore one transaction) per row, plus one base selling-unit row per
 * product (factor 1, is_base = 1, barcode = the product's own barcode) —
 * matching the convention `actions.ts`'s writeSellingUnits() established,
 * since a product without a base unit is unsellable and unmatchable by a
 * later price-list upload (loadMatchMaps only matches on the base unit's
 * barcode).
 *
 * Safe because the Excel path supplies none of addProduct's other optional
 * sub-entities — no shelf locations, extra selling units, price levels or
 * supplier mappings — and stock 0.
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

  const insertOne = async (connection: any, r: NewProductFromExcel, productId: string) => {
    await connection.query(`INSERT INTO products (${PRODUCTS_COLUMNS}) VALUES ${PRODUCTS_PLACEHOLDERS}`, buildProductValues(r, warehouseId, productId));
    await connection.query(
      `INSERT INTO product_selling_units (id, product_id, name, barcode, factor, cost, price, is_base)
       VALUES (?, ?, 'Piece', ?, 1, ?, ?, 1)`,
      [`psu_base_${productId}`, productId, r.barcode, r.cost ?? null, r.price],
    );
  };

  for (const part of chunk(rows, APPLY_CHUNK_SIZE)) {
    const productIds = part.map(r => buildProductId(r.barcode));

    try {
      await withTransaction(async (connection) => {
        for (let i = 0; i < part.length; i++) await insertOne(connection, part[i], productIds[i]);
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
      const barcodesInPart = part.map(r => r.barcode);
      const existingRows: any = await query(
        `SELECT barcode FROM products WHERE warehouse_id = ? AND barcode IN (${barcodesInPart.map(() => '?').join(',')})`,
        [warehouseId, ...barcodesInPart],
      );
      const alreadyLanded = new Set<string>((existingRows ?? []).map((row: any) => row.barcode));

      for (let i = 0; i < part.length; i++) {
        const r = part[i];
        if (alreadyLanded.has(r.barcode)) {
          // The chunk insert actually succeeded for this row before the
          // connection-level failure; count it as created, do not re-insert.
          created++;
          continue;
        }
        try {
          const productId = buildProductId(r.barcode);
          await withTransaction(async (connection) => insertOne(connection, r, productId));
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
