import { applyAdjustment, isValidPriceValue, type AdjustmentType } from '@/lib/price-update-math';
import { query, withTransaction } from '@/lib/mysql';
import { ensureCategoryExists, ensureBrandExists, ensureUnitOfMeasureExists } from '@/lib/ensure-lookup-values';

export interface PriceUpdateItem {
  productId: string;
  /**
   * The selling unit this change targets. Omitted means the product's BASE
   * unit, which is what the Excel price-list path always means (it matches
   * rows on the base unit's barcode) and what every caller meant before
   * selling units became selectable here.
   *
   * A non-base unit has no `products.price`/`products.cost` of its own to
   * write to — those columns are per product, in base units — so a targeted
   * unit writes to its own `product_selling_units` row instead.
   */
  sellingUnitId?: string;
  /** Display label for the targeted unit (e.g. "Case"); base unit when absent. */
  sellingUnitName?: string;
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

          // Resolve which selling unit this item writes to. An item with no
          // sellingUnitId means the base unit (the Excel path, and every
          // caller that predates per-unit targeting).
          const [targetUnitRows]: any = item.sellingUnitId
            ? await connection.query(
                'SELECT id, cost, is_base FROM product_selling_units WHERE id = ? AND product_id = ? LIMIT 1',
                [item.sellingUnitId, item.productId],
              )
            : await connection.query(
                'SELECT id, cost, is_base FROM product_selling_units WHERE product_id = ? AND is_base = 1 LIMIT 1',
                [item.productId],
              );
          const targetUnit = targetUnitRows?.[0];
          if (item.sellingUnitId && !targetUnit) {
            // The unit was deleted or re-parented between preview and apply.
            // Falling back to the base unit would silently reprice the WRONG
            // unit, so skip instead.
            skipped.push({
              productId: item.productId,
              productName: item.productName,
              reason: 'Selling unit no longer exists',
            });
            continue;
          }
          const isBaseTarget = !targetUnit || targetUnit.is_base === 1;

          // Recompute markup-derived prices at apply time: cost may have drifted
          // since preview (e.g. a new PO landed). A non-base unit marks up its
          // OWN cost (per case), not the product's per-base-unit cost — marking
          // a case up off the piece cost would price it at a fraction of cost.
          let newValue = item.newValue;
          if (item.adjustmentType === 'markup') {
            // A non-base unit with no cost of its own is UNKNOWN, not the
            // product's cost: products.cost is per base unit, so marking a
            // 12-piece Case up off it would price the case at a twelfth of
            // what it cost.
            //
            // Skip rather than compute. isValidPriceValue accepts 0 (it means
            // "sell at cost"), so letting an unknown cost through would
            // silently mark the unit down to ₱0.00 and report it as applied.
            if (!isBaseTarget && (targetUnit.cost === null || targetUnit.cost === undefined)) {
              skipped.push({
                productId: item.productId,
                productName: item.productName,
                reason: `${item.sellingUnitName || 'Selling unit'} has no cost to mark up`,
              });
              continue;
            }
            const liveCost = isBaseTarget
              ? parseFloat(rows[0].cost ?? 0)
              : parseFloat(targetUnit.cost);
            newValue = applyAdjustment('markup', 0, item.adjustmentValue, liveCost);
          }

          if (!isValidPriceValue(newValue)) {
            skipped.push({ productId: item.productId, productName: item.productName, reason: 'Computed price is invalid' });
            continue;
          }

          if (item.field === 'price') {
            if (isBaseTarget) {
              await connection.query('UPDATE products SET price = ? WHERE id = ?', [newValue, item.productId]);
              // The base unit's own row mirrors the shelf price, so keep it in
              // step with products.price rather than letting the two drift.
              if (targetUnit) {
                await connection.query(
                  'UPDATE product_selling_units SET price = ? WHERE id = ?',
                  [newValue, targetUnit.id],
                );
              }
            } else {
              // A non-base unit's price lives only on its own row. products.price
              // is the BASE unit's price and must not be touched here — writing
              // a case price into it would reprice every piece on the shelf.
              await connection.query(
                'UPDATE product_selling_units SET price = ? WHERE id = ?',
                [newValue, targetUnit.id],
              );
            }
            // Keep an existing default-level price-level row in sync with the
            // price it mirrors, for whichever unit was targeted. Never creates one.
            if (defaultLevelId && targetUnit) {
              await connection.query(
                `UPDATE product_selling_unit_price_levels
                 SET price = ?
                 WHERE selling_unit_id = ? AND price_level_id = ? AND min_quantity <= 0`,
                [newValue, targetUnit.id, defaultLevelId],
              );
            }
          } else if (item.field === 'cost') {
            if (isBaseTarget) {
              await connection.query('UPDATE products SET cost = ? WHERE id = ?', [newValue, item.productId]);
              if (targetUnit) {
                await connection.query(
                  'UPDATE product_selling_units SET cost = ? WHERE id = ?',
                  [newValue, targetUnit.id],
                );
              }
            } else {
              // products.cost is per base unit and is what FIFO batch costing
              // feeds on — a per-case cost must stay on the unit's own row.
              await connection.query(
                'UPDATE product_selling_units SET cost = ? WHERE id = ?',
                [newValue, targetUnit.id],
              );
            }
          } else if (item.field === 'priceLevel' && item.priceLevelId) {
            // Upsert on the real PK (selling_unit_id, price_level_id). Price
            // levels are per selling unit, so this writes onto whichever unit
            // the item targeted — the base unit when none was given, which is
            // what the Excel path and every pre-existing caller mean.
            if (targetUnit) {
              // min_quantity is deliberately absent from both branches: a new
              // row takes the column's DEFAULT 0 (no tier), and an existing
              // row KEEPS whatever tier it already carries. A price list
              // carries prices, not thresholds, so applying one must not
              // silently clear a tier someone set on the product form — nor
              // invent one. Tiers are edited on the Selling Units tab.
              await connection.query(
                `INSERT INTO product_selling_unit_price_levels (selling_unit_id, price_level_id, price)
                 VALUES (?, ?, ?)
                 ON DUPLICATE KEY UPDATE price = VALUES(price)`,
                [targetUnit.id, item.priceLevelId, newValue],
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

  // Excel-created rows carry category/brand/unit as free text, same as the
  // JSON/CSV product-import routes. Without this they land on
  // products.category/.brand/.unit_of_measure but never appear in the
  // categories/brands/units_of_measure lookup tables the Manage
  // Categories/Brands/Units dialogs (and category-markup precedence) read
  // from. Deduped up front so a 15,000-row file does one lookup per distinct
  // name instead of one per row.
  const distinctBy = (values: (string | undefined)[]) =>
    [...new Set(values.filter((v): v is string => Boolean(v && v.trim())))];
  await Promise.all([
    ...distinctBy(rows.map(r => r.category)).map(ensureCategoryExists),
    ...distinctBy(rows.map(r => r.brand)).map(ensureBrandExists),
    ...distinctBy(rows.map(r => r.unitOfMeasure)).map(ensureUnitOfMeasureExists),
  ]);

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
