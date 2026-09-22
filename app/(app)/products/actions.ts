'use server';

import { query, withTransaction } from '@/lib/mysql';
import { generateBatchId } from '@/lib/batch-utils';
import { checkApprovalRequired, submitToApprovalQueue } from '@/lib/approvals';
import { PriceLevel, Category, Brand, Supplier, Warehouse, Department, UnitOfMeasure, ShelfLocation, Account, TaxRate, SupplierProductMapping } from '@/lib/types';
import { v4 as uuidv4 } from 'uuid';
import { isValidMarkupValue, MARKUP_MAX } from '@/lib/markup-validation';
import { updateStockAndRecordMovement } from '@/lib/stock-movements';


export type ProductFormData = {
  name: string;
  brand: string;
  sku: string;
  barcode?: string;
  description: string;
  additionalDescription?: string;
  category: string;
  department?: string;
  subcategory?: string;
  supplier?: string;
  warehouse?: string;
  shelfLocationIds?: string[];
  image?: string;
  imageFile?: File;
  unitOfMeasure: string;
  stock?: number;
  reorderPoint: number;
  price: number;
  cost?: number;
  incomeAccount?: string;
  expenseAccount?: string;
  parentId?: string;
  conversionFactor?: number;
  conversionFactors?: { unit: string; factor: number }[];
  priceLevels?: { levelId: string; price: number; minQuantity?: number }[];
  supplierMappings?: {
    supplierId: string;
    leadTime: number;
    rop: number;
    cost?: number;
    supplierSku?: string;
    isPrimary: boolean;
  }[];
  vatStatus?: string;
  availability?: string;
  earnsPoints?: boolean;
  isPerishable?: boolean;
  itemType?: 'standard' | 'service';
  /**
   * Extra ways this product is sold, beyond its base unit. The base unit is not
   * listed here — it is derived from unitOfMeasure/price/cost and written with
   * factor 1, is_base 1, matching what migration 119 gave every existing product.
   */
  sellingUnits?: SellingUnitInput[];
};

export type SellingUnitInput = {
  /** Present only when editing an existing row. */
  id?: string;
  name: string;
  factor: number;
  barcode?: string;
  cost?: number;
  price: number;
  priceLevels?: { levelId: string; price: number; minQuantity?: number }[];
};

/** Thrown for a selling-unit problem we can describe to the user by name. */
class SellingUnitError extends Error {}

/**
 * Validate the selling units the form submitted, before any SQL runs.
 *
 * Rejects a zero or negative factor outright: a 0 factor would convert every
 * quantity to zero, so a sale of that unit would deduct no stock at all.
 */
function validateSellingUnits(units: SellingUnitInput[] | undefined, baseUnitName: string) {
  if (!units || units.length === 0) return [];

  const cleaned = units
    .map(u => ({
      ...u,
      name: String(u.name ?? '').trim(),
      barcode: String(u.barcode ?? '').trim(),
    }))
    .filter(u => u.name !== '');

  const seenNames = new Set<string>();
  const seenBarcodes = new Set<string>();
  const base = String(baseUnitName ?? '').trim().toLowerCase();

  for (const u of cleaned) {
    const key = u.name.toLowerCase();
    if (key === base) {
      throw new SellingUnitError(
        `"${u.name}" is already this product's base unit. Remove it from the selling units list — the base unit is added automatically.`,
      );
    }
    if (seenNames.has(key)) {
      throw new SellingUnitError(`Duplicate selling unit "${u.name}". Each unit name must be unique for a product.`);
    }
    seenNames.add(key);

    if (!Number.isFinite(u.factor) || u.factor <= 0) {
      throw new SellingUnitError(`Selling unit "${u.name}" must have a quantity greater than 0.`);
    }
    if (!Number.isFinite(u.price) || u.price < 0) {
      throw new SellingUnitError(`Selling unit "${u.name}" must have a price of 0 or more.`);
    }
    if (u.cost !== undefined && u.cost !== null && (!Number.isFinite(u.cost) || u.cost < 0)) {
      throw new SellingUnitError(`Selling unit "${u.name}" must have a cost of 0 or more.`);
    }

    if (u.barcode) {
      if (seenBarcodes.has(u.barcode)) {
        throw new SellingUnitError(`Barcode "${u.barcode}" is used by more than one selling unit on this product.`);
      }
      seenBarcodes.add(u.barcode);
    }
  }

  return cleaned;
}

/**
 * Turn a UNIQUE(name) collision on one of the simple lookup tables (brands,
 * categories, departments, units of measure, warehouses, shelf locations,
 * suppliers) into a message naming the value that collided, instead of the
 * generic "Error adding X." every one of those actions' catch blocks used to
 * return. The collation on these columns is case-insensitive, so "n/a" and
 * "N/A" collide even though they aren't the same string — that surprise is
 * exactly why this needs to be said explicitly rather than left generic.
 */
function describeAddError(error: any, label: string): string {
  if (error?.code === 'ER_DUP_ENTRY') {
    const match = String(error.message || '').match(/Duplicate entry '([^']*)'/);
    const value = match ? match[1] : undefined;
    return value
      ? `A ${label} named "${value}" already exists.`
      : `A ${label} with that name already exists.`;
  }
  return `Error adding ${label}.`;
}

/**
 * Turn a UNIQUE-barcode collision into a message naming the offending barcode.
 *
 * product_selling_units.barcode is UNIQUE across all ~16,000 rows, so a
 * collision with another product's unit is likely rather than theoretical. It
 * must never reach the user as a raw SQL error, and must never be dropped.
 */
function rethrowSellingUnitDupe(error: any): never {
  if (error?.code === 'ER_DUP_ENTRY') {
    const message = String(error.message || '');
    if (message.includes('uniq_selling_unit_barcode')) {
      const match = message.match(/Duplicate entry '([^']*)'/);
      const barcode = match ? match[1] : 'this barcode';
      throw new SellingUnitError(
        `Barcode "${barcode}" is already assigned to another selling unit. Barcodes must be unique across all products.`,
      );
    }
    if (message.includes('uniq_product_unit_name')) {
      throw new SellingUnitError('This product already has a selling unit with that name.');
    }
  }
  throw error;
}

/**
 * Replace a single selling unit's price-level rows: delete whatever is there,
 * then reinsert what was submitted. Used by updateProduct for every unit
 * present in the submitted form data — a unit the user deleted is handled by
 * the selling-units deletion logic instead, whose ON DELETE CASCADE cleans up
 * its price-level rows automatically.
 */
async function replaceSellingUnitPriceLevels(
  connection: any,
  sellingUnitId: string,
  priceLevels: { levelId: string; price: number; minQuantity?: number }[] | undefined,
) {
  await connection.query(
    'DELETE FROM product_selling_unit_price_levels WHERE selling_unit_id = ?',
    [sellingUnitId],
  );
  if (priceLevels && priceLevels.length > 0) {
    for (const pl of priceLevels) {
      await connection.query(
        'INSERT INTO product_selling_unit_price_levels (selling_unit_id, price_level_id, price, min_quantity) VALUES (?, ?, ?, ?)',
        [sellingUnitId, pl.levelId, pl.price, pl.minQuantity || 0],
      );
    }
  }
}

/**
 * Write the base unit plus every extra selling unit for a product.
 *
 * The base unit always exists and always has factor 1 — checkout resolves
 * quantities through it, so a product without one is unsellable.
 */
async function writeSellingUnits(
  connection: any,
  productId: string,
  baseUnitName: string,
  basePrice: number,
  baseCost: number | null,
  baseBarcode: string | null,
  extras: SellingUnitInput[],
  basePriceLevels?: { levelId: string; price: number; minQuantity?: number }[],
) {
  const baseName = String(baseUnitName ?? '').trim() || 'Piece';
  try {
    const baseUnitId = `psu_base_${productId}`;
    await connection.query(
      `INSERT INTO product_selling_units (id, product_id, name, barcode, factor, cost, price, is_base)
       VALUES (?, ?, ?, ?, 1, ?, ?, 1)`,
      [baseUnitId, productId, baseName, baseBarcode || null, baseCost, basePrice],
    );

    if (basePriceLevels && basePriceLevels.length > 0) {
      for (const pl of basePriceLevels) {
        await connection.query(
          'INSERT INTO product_selling_unit_price_levels (selling_unit_id, price_level_id, price, min_quantity) VALUES (?, ?, ?, ?)',
          [baseUnitId, pl.levelId, pl.price, pl.minQuantity || 0],
        );
      }
    }

    for (const unit of extras) {
      const sellingUnitId = `psu_${uuidv4()}`;
      await connection.query(
        `INSERT INTO product_selling_units (id, product_id, name, barcode, factor, cost, price, is_base)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
        [
          sellingUnitId,
          productId,
          unit.name,
          unit.barcode ? unit.barcode : null,
          unit.factor,
          unit.cost ?? null,
          unit.price,
        ],
      );

      if (unit.priceLevels && unit.priceLevels.length > 0) {
        for (const pl of unit.priceLevels) {
          await connection.query(
            'INSERT INTO product_selling_unit_price_levels (selling_unit_id, price_level_id, price, min_quantity) VALUES (?, ?, ?, ?)',
            [sellingUnitId, pl.levelId, pl.price, pl.minQuantity || 0],
          );
        }
      }
    }
  } catch (error) {
    rethrowSellingUnitDupe(error);
  }
}

export type ProductFilters = {
  search?: string;
  brand?: string;
  category?: string;
  department?: string;
  supplier?: string;
  warehouse?: string;
  shelfLocation?: string;
  status?: 'in-stock' | 'low-stock' | 'out-of-stock' | 'all' | string;
  /** Exact product id. Used to resolve a single product without paging. */
  id?: string;
};

export async function getProducts(limit?: number, offset?: number, filters?: ProductFilters) {
  try {
    let sql = `
      SELECT p.*,
             s_legacy.name as legacy_supplier_name,
             w.name as warehouse_name,
             (SELECT GROUP_CONCAT(sl.name) FROM product_shelves ps JOIN shelf_locations sl ON ps.shelf_id = sl.id WHERE ps.product_id = p.id) as shelf_location_names,
             (SELECT GROUP_CONCAT(ps.shelf_id) FROM product_shelves ps WHERE ps.product_id = p.id) as shelf_location_ids,
             (SELECT GROUP_CONCAT(CONCAT(ps.shelf_id, ':', ps.quantity)) FROM product_shelves ps WHERE ps.product_id = p.id) as shelf_id_quantities,
             spm.supplier_id as primary_supplier_id,
             spm.supplier_specific_rop as primary_supplier_rop,
             s_primary.name as primary_supplier_name,
             EXISTS (SELECT 1 FROM approval_queue aq WHERE (JSON_UNQUOTE(JSON_EXTRACT(aq.transaction_data, '$.productId')) = p.id OR JSON_UNQUOTE(JSON_EXTRACT(aq.transaction_data, '$.sourceProductId')) = p.id) AND aq.status = 'Pending') as has_pending_approval
      FROM products p
      LEFT JOIN suppliers s_legacy ON p.supplier_id = s_legacy.id
      LEFT JOIN warehouses w ON p.warehouse_id = w.id
      LEFT JOIN supplier_product_mapping spm ON p.id = spm.product_id AND spm.is_primary = 1
      LEFT JOIN suppliers s_primary ON spm.supplier_id = s_primary.id
    `;

    const whereClauses: string[] = [];
    const params: any[] = [];

    if (filters) {
      if (filters.id) {
        whereClauses.push(`p.id = ?`);
        params.push(filters.id);
      }
      if (filters.search) {
        // A selling unit's own barcode (e.g. a Pack of 12) lives only in
        // product_selling_units, never on products.barcode — without this,
        // searching by it here finds nothing.
        whereClauses.push(`(p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ? OR EXISTS (
          SELECT 1 FROM product_selling_units su WHERE su.product_id = p.id AND su.barcode LIKE ?
        ))`);
        const searchParam = `%${filters.search}%`;
        params.push(searchParam, searchParam, searchParam, searchParam);
      }
      if (filters.brand && filters.brand !== 'all') {
        whereClauses.push(`p.brand = ?`);
        params.push(filters.brand);
      }
      if (filters.category && filters.category !== 'all') {
        whereClauses.push(`p.category = ?`);
        params.push(filters.category);
      }
      if (filters.department && filters.department !== 'all') {
        whereClauses.push(`p.department = ?`);
        params.push(filters.department);
      }
      if (filters.supplier && filters.supplier !== 'all') {
        whereClauses.push(`(p.supplier_id = ? OR EXISTS (SELECT 1 FROM supplier_product_mapping spm_check WHERE spm_check.product_id = p.id AND spm_check.supplier_id = ?))`);
        params.push(filters.supplier, filters.supplier);
      }
      if (filters.warehouse && filters.warehouse !== 'all') {
        whereClauses.push(`p.warehouse_id = ?`);
        params.push(filters.warehouse);
      }
      if (filters.shelfLocation && filters.shelfLocation !== 'all') {
        whereClauses.push(`EXISTS (SELECT 1 FROM product_shelves ps_filter WHERE ps_filter.product_id = p.id AND ps_filter.shelf_id = ?)`);
        params.push(filters.shelfLocation);
      }
      if (filters.status && filters.status !== 'all') {
        if (filters.status === 'out-of-stock') {
          whereClauses.push(`p.stock <= 0`);
        } else if (filters.status === 'low-stock') {
          whereClauses.push(`p.stock > 0 AND (p.stock < p.reorder_point OR p.stock < (SELECT COALESCE(low_stock_threshold, 0) FROM pos_settings LIMIT 1))`);
        } else if (filters.status === 'in-stock') {
           whereClauses.push(`p.stock > 0 AND p.stock >= p.reorder_point AND p.stock >= (SELECT COALESCE(low_stock_threshold, 0) FROM pos_settings LIMIT 1)`);
        }
      }
    }

    if (whereClauses.length > 0) {
      sql += ` WHERE ${whereClauses.join(' AND ')}`;
    }

    sql += ` ORDER BY p.created_at DESC`;

    if (limit !== undefined && offset !== undefined) {
      sql += ` LIMIT ? OFFSET ?`;
      params.push(limit, offset);
    }

    const pagedProducts = await query(sql, params.length > 0 ? params : undefined);
    
    let products = pagedProducts;

    const conversionFactorsSql = `SELECT * FROM conversion_factors ORDER BY product_id, created_at`;
    const allConversionFactors = await query(conversionFactorsSql);

    const cfMap = new Map();
    allConversionFactors.forEach((cf: any) => {
      if (!cfMap.has(cf.product_id)) {
        cfMap.set(cf.product_id, []);
      }
      cfMap.get(cf.product_id).push({
        unit: cf.unit,
        factor: cf.factor,
      });
    });
    
    const allSellingUnits = await query(
      `SELECT id, product_id, name, barcode, factor, cost, price, is_base
       FROM product_selling_units ORDER BY product_id, is_base DESC, name`,
    );
    const suMap = new Map<string, any[]>();
    allSellingUnits.forEach((su: any) => {
      if (!suMap.has(su.product_id)) suMap.set(su.product_id, []);
      suMap.get(su.product_id)!.push({
        id: su.id,
        name: su.name,
        barcode: su.barcode ?? '',
        factor: Number(su.factor),
        cost: su.cost === null || su.cost === undefined ? undefined : Number(su.cost),
        price: Number(su.price),
        isBase: su.is_base === 1,
      });
    });

    const sulpSql = `SELECT * FROM product_selling_unit_price_levels`;
    const allSulp = await query(sulpSql);
    const sulpByUnit = new Map<string, any[]>();
    for (const row of allSulp) {
      if (!sulpByUnit.has(row.selling_unit_id)) sulpByUnit.set(row.selling_unit_id, []);
      sulpByUnit.get(row.selling_unit_id)!.push({
        levelId: row.price_level_id,
        price: Number(row.price),
        minQuantity: row.min_quantity ?? 0,
      });
    }

    const defaultPriceLevelSql = `SELECT id FROM price_levels WHERE is_default = 1 LIMIT 1`;
    const defaultPriceLevelResult = await query(defaultPriceLevelSql);
    const defaultLevelId = defaultPriceLevelResult.length > 0 ? defaultPriceLevelResult[0].id : 'retail-level';

    return products.map((product: any) => {
      const productSellingUnits: any[] = suMap.get(product.id) || [];
      const baseUnit = productSellingUnits.find((su: any) => su.isBase);
      const basePriceLevels = (baseUnit ? sulpByUnit.get(baseUnit.id) : undefined) || [];
      const retailPriceOverrides = basePriceLevels
        .filter((pl: any) => pl.levelId === defaultLevelId)
        .sort((a: any, b: any) => (a.minQuantity || 0) - (b.minQuantity || 0));

      const effectivePrice = retailPriceOverrides.length > 0
        ? retailPriceOverrides[0].price
        : (parseFloat(product.price) || 0);

      return {
        ...product,
        department: product.inherited_department || product.department,
        shelfLocationId: product.shelf_location_ids ? product.shelf_location_ids.split(',')[0] : product.shelf_location_id,
        shelfLocationIds: product.shelf_location_ids ? product.shelf_location_ids.split(',') : (product.shelf_location_id ? [product.shelf_location_id] : []),
        shelfLocationName: product.shelf_location_names || product.shelf_location_name,
        shelfLocationNames: product.shelf_location_names ? product.shelf_location_names.split(',') : (product.shelf_location_name ? [product.shelf_location_name] : []),
        shelfQuantities: product.shelf_id_quantities ? Object.fromEntries(product.shelf_id_quantities.split(',').map((s: string) => {
          const [id, qty] = s.split(':');
          return [id, parseInt(qty) || 0];
        })) : {},
        additionalDescription: product.additional_description,
        reorderPoint: product.reorder_point,
        primarySupplierRop: product.primary_supplier_rop,
        avgDailySales: product.avg_daily_sales,
        price: effectivePrice,
        cost: product.cost ? parseFloat(product.cost) : undefined,
        imageUrl: product.image_url,
        imageHint: product.image_hint,
        unitOfMeasure: product.unit_of_measure,
        markupPercentage: product.markup_percentage === null || product.markup_percentage === undefined
          ? null
          : Number(product.markup_percentage),
        conversionFactor: product.conversion_factor,
        conversionFactors: cfMap.get(product.id) || [],
        sellingUnits: productSellingUnits.map((su: any) => ({
          ...su,
          priceLevels: sulpByUnit.get(su.id) ?? [],
        })),
        incomeAccount: product.income_account,
        expenseAccount: product.expense_account,
        supplier: product.primary_supplier_id || product.supplier_id,
        supplierName: product.primary_supplier_name || product.legacy_supplier_name,
        warehouse: product.inherited_warehouse_id || product.warehouse_id,
        warehouseId: product.inherited_warehouse_id || product.warehouse_id,
        warehouseName: product.warehouse_name,
        vatStatus: product.inherited_vat_status || product.vat_status,
        availability: product.availability,
        earns_points: product.earns_points === 1,
        expirationDate: product.expiration_date,
        isPerishable: Boolean(product.is_perishable),
        createdAt: product.created_at,
        updatedAt: product.updated_at,
        hasPendingApproval: product.has_pending_approval === 1,
      };
    });
  } catch (error) {
    console.error('Error fetching products:', error);
    return [];
  }
}

export async function getProductsCount(filters?: ProductFilters) {
  try {
    let sql = `
        SELECT COUNT(*) as count 
        FROM products p
        LEFT JOIN supplier_product_mapping spm ON p.id = spm.product_id AND spm.is_primary = 1
    `;
    
    const whereClauses: string[] = [];
    const params: any[] = [];

    if (filters) {
       if (filters.search) {
        // A selling unit's own barcode (e.g. a Pack of 12) lives only in
        // product_selling_units, never on products.barcode — without this,
        // searching by it here finds nothing.
        whereClauses.push(`(p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ? OR EXISTS (
          SELECT 1 FROM product_selling_units su WHERE su.product_id = p.id AND su.barcode LIKE ?
        ))`);
        const searchParam = `%${filters.search}%`;
        params.push(searchParam, searchParam, searchParam, searchParam);
      }
      if (filters.brand && filters.brand !== 'all') {
        whereClauses.push(`p.brand = ?`);
        params.push(filters.brand);
      }
      if (filters.category && filters.category !== 'all') {
        whereClauses.push(`p.category = ?`);
        params.push(filters.category);
      }
      if (filters.department && filters.department !== 'all') {
        whereClauses.push(`p.department = ?`);
        params.push(filters.department);
      }
      if (filters.supplier && filters.supplier !== 'all') {
        whereClauses.push(`(p.supplier_id = ? OR EXISTS (SELECT 1 FROM supplier_product_mapping spm_check WHERE spm_check.product_id = p.id AND spm_check.supplier_id = ?))`);
        params.push(filters.supplier, filters.supplier);
      }
      if (filters.warehouse && filters.warehouse !== 'all') {
        whereClauses.push(`p.warehouse_id = ?`);
        params.push(filters.warehouse);
      }
      if (filters.shelfLocation && filters.shelfLocation !== 'all') {
        whereClauses.push(`EXISTS (SELECT 1 FROM product_shelves ps_filter WHERE ps_filter.product_id = p.id AND ps_filter.shelf_id = ?)`);
        params.push(filters.shelfLocation);
      }
      if (filters.status && filters.status !== 'all') {
        if (filters.status === 'out-of-stock') {
          whereClauses.push(`p.stock <= 0`);
        } else if (filters.status === 'low-stock') {
          whereClauses.push(`p.stock > 0 AND (p.stock < p.reorder_point OR p.stock < (SELECT COALESCE(low_stock_threshold, 0) FROM pos_settings LIMIT 1))`);
        } else if (filters.status === 'in-stock') {
           whereClauses.push(`p.stock > 0 AND p.stock >= p.reorder_point AND p.stock >= (SELECT COALESCE(low_stock_threshold, 0) FROM pos_settings LIMIT 1)`);
        }
      }
    }

    if (whereClauses.length > 0) {
      sql += ` WHERE ${whereClauses.join(' AND ')}`;
    }

    const result = await query(sql, params);
    return result[0].count;
  } catch (error) {
    console.error('Error fetching products count:', error);
    return 0;
  }
}

export async function getLowStockAlerts() {
  try {
    const settingsResult = await query('SELECT low_stock_threshold FROM pos_settings LIMIT 1');
    const globalThreshold = settingsResult.length > 0 ? settingsResult[0].low_stock_threshold : 10;

    // Services are excluded: they have no stock, so they would otherwise sit
    // permanently in the notification bell as a low-stock alert.
    const sql = `
      SELECT id, name, stock, reorder_point
      FROM products
      WHERE type = 'standard' AND (stock < reorder_point OR stock < ?)
    `;
    const products = await query(sql, [globalThreshold]);
    return products.map((p: any) => ({
      id: p.id,
      name: p.name,
      stock: p.stock,
      reorderPoint: Math.max(p.reorder_point || 0, globalThreshold)
    }));
  } catch (error) {
    console.error('Error fetching low stock alerts:', error);
    return [];
  }
}

export async function addProduct(
  formData: ProductFormData,
  userId: string = 'system',
  isInternalFinalization: boolean = false,
) {
  try {
    // --- Check if approval is required ---
    if (!isInternalFinalization) {
      const isApprovalRequired = await checkApprovalRequired('PRODUCT_CREATE');
      if (isApprovalRequired) {
        const items = [{
          productId: 'NEW',
          productName: formData.name,
          sku: formData.sku,
          barcode: formData.barcode || '',
          price: formData.price,
          cost: formData.cost || 0,
          quantity: formData.stock || 0,
          unit: formData.unitOfMeasure,
        }];
        // Strip the non-serializable File; keep the base64 `image` string.
        const { imageFile, ...serializable } = formData;
        const { queueId, pendingApproval } = await submitToApprovalQueue(
          'PRODUCT_CREATE',
          { ...serializable, items },
          userId,
        );
        if (pendingApproval) {
          return {
            success: true,
            pendingApproval: true,
            queueId,
            message: 'Product creation submitted for approval.',
          };
        }
        // pendingApproval === false (all steps auto-skipped) → fall through to immediate insert.
      }
    }

    if (formData.conversionFactors && formData.conversionFactors.length > 0) {
      const units = formData.conversionFactors.map(cf => cf.unit.toLowerCase());
      const uniqueUnits = new Set(units);
      if (units.length !== uniqueUnits.size) {
        return { success: false, message: 'Duplicate conversion factor units detected. Each unit must be unique.' };
      }
    }

    // Validate before opening the transaction so a bad row costs nothing.
    let sellingUnits: SellingUnitInput[];
    try {
      sellingUnits = validateSellingUnits(formData.sellingUnits, formData.unitOfMeasure);
    } catch (error: any) {
      if (error instanceof SellingUnitError) return { success: false, message: error.message };
      throw error;
    }

    const productId = `${formData.sku}-${Date.now()}`;
    const isServiceProduct = formData.itemType === 'service';

    // Services are performed at the store, not stocked in a warehouse the user
    // picks — so the field is hidden on the form and the main warehouse is
    // assigned here instead. Without this they would land with a NULL
    // warehouse and show a blank column in the product list.
    let resolvedWarehouseId = formData.warehouse || null;
    if (isServiceProduct) {
      const [mainWarehouse]: any = await query(
        `SELECT id FROM warehouses
         WHERE is_active = 1
         ORDER BY is_main DESC, (id = 'wh_main') DESC, created_at ASC
         LIMIT 1`,
      );
      resolvedWarehouseId = mainWarehouse?.id ?? null;
    }

    await withTransaction(async (connection) => {
      const productData = {
        id: productId,
        name: formData.name,
        description: formData.description,
        additional_description: formData.additionalDescription || null,
        category: formData.category,
        brand: formData.brand,
        // Department groups stocked goods for markup and reporting; it does not
        // apply to services, so it is never written for one.
        department: isServiceProduct ? null : (formData.department || null),
        subcategory: formData.subcategory || null,
        supplier_id: null,
        warehouse_id: resolvedWarehouseId,
        stock: formData.stock || 0,
        reorder_point: formData.reorderPoint || formData.supplierMappings?.find(m => m.isPrimary)?.rop || 0,
        avg_daily_sales: 0,
        price: formData.price,
        // `|| null` would turn a deliberate 0 into NULL. That matters for
        // services: cost is required at creation precisely so cost_at_sale is
        // never NULL, and 0 is a legitimate answer for a pure-margin service.
        cost: formData.cost ?? null,
        sku: formData.sku,
        barcode: formData.barcode || null,
        image_url: formData.image || null,
        image_hint: formData.name.toLowerCase().replace(/\s+/g, '-'),
        unit_of_measure: formData.unitOfMeasure,
        parent_id: formData.parentId || null,
        conversion_factor: formData.conversionFactor || 1,
        expense_account: formData.expenseAccount || null,
        income_account: formData.incomeAccount || null,
        vat_status: formData.vatStatus || 'YES (Subject to 12% VAT)',
        availability: formData.availability || 'Available',
        earns_points: formData.earnsPoints !== false,
        is_perishable: formData.isPerishable ? 1 : 0,
        type: formData.itemType === 'service' ? 'service' : 'standard',
      };

      const sql = `
        INSERT INTO products (
          id, name, description, additional_description, category, brand, department,
          subcategory, supplier_id, warehouse_id, stock, reorder_point, avg_daily_sales, price, cost,
          sku, barcode, image_url, image_hint,
          unit_of_measure, parent_id, conversion_factor, income_account, expense_account,
          vat_status, availability, earns_points, shelf_location_id, is_perishable, type
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const legacyShelfId = formData.shelfLocationIds && formData.shelfLocationIds.length > 0 ? formData.shelfLocationIds[0] : null;

      const values_array = [
        productData.id, productData.name, productData.description, productData.additional_description,
        productData.category, productData.brand, productData.department, productData.subcategory,
        productData.supplier_id, productData.warehouse_id, productData.stock, productData.reorder_point,
        productData.avg_daily_sales, productData.price, productData.cost, productData.sku,
        productData.barcode, productData.image_url, productData.image_hint, productData.unit_of_measure,
        productData.parent_id, productData.conversion_factor, productData.income_account,
        productData.expense_account, productData.vat_status, productData.availability, productData.earns_points,
        legacyShelfId, productData.is_perishable, productData.type
      ];

      await connection.query(sql, values_array);

      // --- BATCH COSTING: Auto-create batch for initial stock ---
      // Services never get a batch: they have no stock, and an empty batch
      // would make them appear in FIFO deduction and valuation reports.
      if (productData.type === 'standard' && formData.stock && formData.stock > 0) {
        try {
          const batchId = generateBatchId();
          await connection.query(`
            INSERT INTO inventory_batches
              (id, product_id, received_date, quantity_in, quantity_remaining, unit_cost, selling_price, source_type, notes)
            VALUES (?, ?, CURDATE(), ?, ?, ?, ?, 'adjustment', 'Initial Stock')
          `, [
            batchId, 
            productId, 
            formData.stock, 
            formData.stock, 
            formData.cost || 0, 
            formData.price || 0
          ]);
        } catch (batchErr) {
          console.warn('[BatchCosting] Could not create batch for initial product stock:', batchErr);
        }
      }

      if (formData.shelfLocationIds && formData.shelfLocationIds.length > 0) {
        for (let i = 0; i < formData.shelfLocationIds.length; i++) {
          const shelfId = formData.shelfLocationIds[i];
          const qty = i === 0 ? (formData.stock || 0) : 0;
          await connection.query('INSERT INTO product_shelves (product_id, shelf_id, quantity) VALUES (?, ?, ?)', [productId, shelfId, qty]);
        }
      }

      if (formData.conversionFactors && formData.conversionFactors.length > 0) {
        for (const cf of formData.conversionFactors) {
          const cfId = `${productId}-cf-${cf.unit}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          await connection.query('INSERT INTO conversion_factors (id, product_id, unit, factor) VALUES (?, ?, ?, ?)', [cfId, productId, cf.unit, cf.factor]);
        }
      }

      // Every product needs its base selling unit, or checkout has nothing to
      // resolve a scan to and the product cannot be sold at all. Price levels
      // are now per selling unit (product_selling_unit_price_levels), not
      // per product: the base unit's own overrides still come from
      // formData.priceLevels (the field the product's own price/cost form
      // controls populate), and each extra unit carries its own on
      // sellingUnits[i].priceLevels.
      await writeSellingUnits(
        connection,
        productId,
        formData.unitOfMeasure,
        productData.price,
        productData.cost,
        productData.barcode,
        sellingUnits,
        formData.priceLevels,
      );

      if (formData.supplierMappings && formData.supplierMappings.length > 0) {
        for (const mapping of formData.supplierMappings) {
          const mappingId = `${productId}-sm-${mapping.supplierId}-${Date.now()}`;
          await connection.query('INSERT INTO supplier_product_mapping (id, product_id, supplier_id, supplier_sku, supplier_lead_time, supplier_specific_rop, supplier_cost, is_primary) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [mappingId, productId, mapping.supplierId, mapping.supplierSku || null, mapping.leadTime, mapping.rop, mapping.cost || null, mapping.isPrimary ? 1 : 0]);
        }
      }
    });

    // No auto-child is created any more. Extra ways to sell this product are
    // rows in product_selling_units against this one product, written inside the
    // transaction above — there is no second product, and no stock to keep in sync.
    return { success: true, message: `${formData.name} has been added to the inventory.`, productId };
  } catch (error: any) {
    console.error('Error saving product:', error);
    if (error instanceof SellingUnitError) {
      return { success: false, message: error.message };
    }
    if (error.code === 'ER_DUP_ENTRY' && error.message.includes('unique_product_unit')) {
      return { success: false, message: 'A conversion factor with this unit already exists for this product.' };
    }
    return { success: false, message: 'There was an error saving the product.' };
  }
}

export async function updateProduct(id: string, formData: ProductFormData) {
  try {
    if (formData.conversionFactors && formData.conversionFactors.length > 0) {
      const units = formData.conversionFactors.map(cf => cf.unit.toLowerCase());
      const uniqueUnits = new Set(units);
      if (units.length !== uniqueUnits.size) {
        return { success: false, message: 'Duplicate conversion factor units detected. Each unit must be unique.' };
      }
    }

    // Validate before opening the transaction so a bad row costs nothing.
    // `undefined` means the caller did not manage selling units at all, and the
    // existing rows are left untouched; an empty array means "remove the extras".
    const managesSellingUnits = formData.sellingUnits !== undefined;
    let sellingUnits: SellingUnitInput[] = [];
    if (managesSellingUnits) {
      try {
        sellingUnits = validateSellingUnits(formData.sellingUnits, formData.unitOfMeasure);
      } catch (error: any) {
        if (error instanceof SellingUnitError) return { success: false, message: error.message };
        throw error;
      }
    }

    await withTransaction(async (connection) => {
      // Fetch existing product to preserve fields not in the form
      const [existingRows]: any = await connection.query('SELECT * FROM products WHERE id = ?', [id]);
      if (!existingRows || existingRows.length === 0) {
        throw new Error('Product not found');
      }
      const existing = existingRows[0];

      const productData = {
        name: formData.name ?? existing.name,
        description: formData.description ?? existing.description,
        additional_description: (formData.additionalDescription !== undefined ? formData.additionalDescription : existing.additional_description) || null,
        category: formData.category ?? existing.category,
        brand: formData.brand ?? existing.brand,
        department: (formData.department !== undefined ? formData.department : existing.department) || null,
        subcategory: (formData.subcategory !== undefined ? formData.subcategory : existing.subcategory) || null,
        supplier_id: (formData.supplier !== undefined ? formData.supplier : existing.supplier_id) || null,
        warehouse_id: (formData.warehouse !== undefined ? formData.warehouse : existing.warehouse_id) || null,
        stock: formData.stock !== undefined ? formData.stock : existing.stock,
        reorder_point: formData.reorderPoint !== undefined ? formData.reorderPoint : existing.reorder_point,
        price: formData.price !== undefined ? formData.price : existing.price,
        cost: (formData.cost !== undefined ? formData.cost : existing.cost) || null,
        sku: formData.sku ?? existing.sku,
        barcode: (formData.barcode !== undefined ? formData.barcode : existing.barcode) || null,
        image_url: (formData.image !== undefined ? formData.image : existing.image_url) || null,
        image_hint: formData.name ? formData.name.toLowerCase().replace(/\s+/g, '-') : existing.image_hint,
        unit_of_measure: formData.unitOfMeasure ?? existing.unit_of_measure,
        income_account: (formData.incomeAccount !== undefined ? formData.incomeAccount : existing.income_account) || null,
        expense_account: (formData.expenseAccount !== undefined ? formData.expenseAccount : existing.expense_account) || null,
        vat_status: formData.vatStatus ?? existing.vat_status,
        availability: formData.availability ?? existing.availability,
        earns_points: formData.earnsPoints !== undefined ? formData.earnsPoints : (existing.earns_points === 1),
        is_perishable: formData.isPerishable !== undefined ? (formData.isPerishable ? 1 : 0) : existing.is_perishable,
      };

      const sql = `
        UPDATE products SET
          name = ?, description = ?, additional_description = ?, category = ?, brand = ?,
          department = ?, subcategory = ?, supplier_id = ?, warehouse_id = ?, stock = ?,
          reorder_point = ?, price = ?, cost = ?, sku = ?, barcode = ?,
          image_url = ?, image_hint = ?, unit_of_measure = ?,
          income_account = ?, expense_account = ?, vat_status = ?,
          availability = ?, earns_points = ?, shelf_location_id = ?, is_perishable = ?
        WHERE id = ?
      `;

      const legacyShelfId = formData.shelfLocationIds && formData.shelfLocationIds.length > 0 ? formData.shelfLocationIds[0] : existing.shelf_location_id;

      // --- Movement record for manual stock edits ---
      // The typed figure is this product's own stock, already in base units, so
      // the delta applies directly and signed. Nothing cascades to another
      // product. The UPDATE below writes productData.stock outright, so this call
      // exists to record the movement (and sync batches/shelves) — it must not be
      // allowed to double-count, which it cannot, because it writes the same
      // absolute figure the UPDATE then re-writes.
      if (productData.stock !== undefined) {
        const originalStock = Number(existing.stock || 0);
        const newStock = Number(productData.stock);
        const delta = newStock - originalStock;

        if (Number.isFinite(delta) && delta !== 0) {
          await updateStockAndRecordMovement(
            id,
            delta,
            'adjustment',
            `adj_edit_${Date.now()}`,
            'adjustment',
            `Manual edit of ${existing.name}`,
            connection as any
          );
        }
      }

      const values_array = [
        productData.name, productData.description, productData.additional_description,
        productData.category, productData.brand, productData.department, productData.subcategory,
        productData.supplier_id, productData.warehouse_id, productData.stock, productData.reorder_point,
        productData.price, productData.cost, productData.sku, productData.barcode,
        productData.image_url, productData.image_hint, productData.unit_of_measure,
        productData.income_account, productData.expense_account, productData.vat_status,
        productData.availability, productData.earns_points, legacyShelfId, productData.is_perishable, id
      ];

      await connection.query(sql, values_array);

      // Handle shelf assignments with quantity preservation
      const [currentShelves]: any = await connection.query('SELECT shelf_id, quantity FROM product_shelves WHERE product_id = ?', [id]);
      const currentQtyMap = new Map(currentShelves.map((s: any) => [s.shelf_id, s.quantity]));

      await connection.query('DELETE FROM product_shelves WHERE product_id = ?', [id]);
      if (formData.shelfLocationIds && formData.shelfLocationIds.length > 0) {
        for (let i = 0; i < formData.shelfLocationIds.length; i++) {
          const shelfId = formData.shelfLocationIds[i];
          let qty = currentQtyMap.get(shelfId) || 0;
          
          // If product was previously unassigned to any shelf, move all stock to the first assigned shelf
          if (currentShelves.length === 0 && i === 0) {
            qty = productData.stock || 0;
          }
          
          await connection.query('INSERT INTO product_shelves (product_id, shelf_id, quantity) VALUES (?, ?, ?)', [id, shelfId, qty]);
        }
      }

      await connection.query('DELETE FROM conversion_factors WHERE product_id = ?', [id]);
      if (formData.conversionFactors && formData.conversionFactors.length > 0) {
        for (const cf of formData.conversionFactors) {
          const cfId = `${id}-cf-${cf.unit}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          await connection.query('INSERT INTO conversion_factors (id, product_id, unit, factor) VALUES (?, ?, ?, ?)', [cfId, id, cf.unit, cf.factor]);
        }
      }

      // --- Selling units ---
      // The base row is never deleted or re-keyed: line items reference it, and
      // a product without one cannot be sold. Its barcode/cost/price follow the
      // product's own fields, but its factor stays 1 and is_base stays 1.
      const [baseRows]: any = await connection.query(
        'SELECT id, barcode FROM product_selling_units WHERE product_id = ? AND is_base = 1 LIMIT 1',
        [id],
      );
      const baseName = String(productData.unit_of_measure ?? '').trim() || 'Piece';

      try {
        if (baseRows.length > 0) {
          // Only touch the base barcode when it actually changed. Rewriting it
          // unconditionally made an unrelated save (one that never opened the
          // Selling Units tab) fail with ER_DUP_ENTRY whenever some other
          // product's unit already held the same barcode.
          const currentBarcode = baseRows[0].barcode ?? null;
          const nextBarcode = productData.barcode || null;

          if (currentBarcode === nextBarcode) {
            await connection.query(
              `UPDATE product_selling_units
               SET name = ?, cost = ?, price = ?, factor = 1, is_base = 1
               WHERE id = ?`,
              [baseName, productData.cost, productData.price, baseRows[0].id],
            );
          } else {
            // A genuine change. Name the conflict rather than reporting it as a
            // generic selling-unit failure, since the user edited the product's
            // own barcode field, not a row in the Selling Units tab.
            if (nextBarcode) {
              const [clash]: any = await connection.query(
                `SELECT u.product_id, p.name AS product_name
                 FROM product_selling_units u
                 JOIN products p ON p.id = u.product_id
                 WHERE u.barcode = ? AND u.id <> ? LIMIT 1`,
                [nextBarcode, baseRows[0].id],
              );
              if (clash.length > 0) {
                throw new SellingUnitError(
                  `Barcode "${nextBarcode}" is already used by "${clash[0].product_name}". Barcodes must be unique across all products and their selling units.`,
                );
              }
            }
            await connection.query(
              `UPDATE product_selling_units
               SET name = ?, barcode = ?, cost = ?, price = ?, factor = 1, is_base = 1
               WHERE id = ?`,
              [baseName, nextBarcode, productData.cost, productData.price, baseRows[0].id],
            );
          }
        } else {
          // A product predating the backfill, or one whose base row was lost.
          await connection.query(
            `INSERT INTO product_selling_units (id, product_id, name, barcode, factor, cost, price, is_base)
             VALUES (?, ?, ?, ?, 1, ?, ?, 1)`,
            [`psu_base_${id}`, id, baseName, productData.barcode || null, productData.cost, productData.price],
          );
        }

        // Price levels are per selling unit now, not per product. The base
        // unit's own overrides still come from formData.priceLevels (the
        // field the product's own price/cost form controls populate).
        const baseUnitId = baseRows.length > 0 ? baseRows[0].id : `psu_base_${id}`;
        await replaceSellingUnitPriceLevels(connection, baseUnitId, formData.priceLevels);

        if (managesSellingUnits) {
          const [existingExtras]: any = await connection.query(
            'SELECT id FROM product_selling_units WHERE product_id = ? AND is_base = 0',
            [id],
          );
          const existingIds = new Set<string>(existingExtras.map((r: any) => String(r.id)));
          const keptIds = new Set<string>(
            sellingUnits.map(u => (u.id ? String(u.id) : '')).filter(v => v !== '' && existingIds.has(v)),
          );

          for (const rowId of Array.from(existingIds)) {
            if (!keptIds.has(rowId)) {
              await connection.query('DELETE FROM product_selling_units WHERE id = ?', [rowId]);
            }
          }

          for (const unit of sellingUnits) {
            const barcode = unit.barcode ? unit.barcode : null;
            const cost = unit.cost ?? null;
            if (unit.id && existingIds.has(String(unit.id))) {
              await connection.query(
                `UPDATE product_selling_units
                 SET name = ?, barcode = ?, factor = ?, cost = ?, price = ?
                 WHERE id = ? AND is_base = 0`,
                [unit.name, barcode, unit.factor, cost, unit.price, unit.id],
              );
              await replaceSellingUnitPriceLevels(connection, String(unit.id), unit.priceLevels);
            } else {
              const sellingUnitId = `psu_${uuidv4()}`;
              await connection.query(
                `INSERT INTO product_selling_units (id, product_id, name, barcode, factor, cost, price, is_base)
                 VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
                [sellingUnitId, id, unit.name, barcode, unit.factor, cost, unit.price],
              );
              await replaceSellingUnitPriceLevels(connection, sellingUnitId, unit.priceLevels);
            }
          }
        }
      } catch (error) {
        rethrowSellingUnitDupe(error);
      }

      if (formData.supplierMappings) {
        await connection.query('DELETE FROM supplier_product_mapping WHERE product_id = ?', [id]);
        for (const mapping of formData.supplierMappings) {
          const mappingId = `${id}-sm-${mapping.supplierId}-${Date.now()}`;
          await connection.query('INSERT INTO supplier_product_mapping (id, product_id, supplier_id, supplier_sku, supplier_lead_time, supplier_specific_rop, supplier_cost, is_primary) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [mappingId, id, mapping.supplierId, mapping.supplierSku || null, mapping.leadTime, mapping.rop, mapping.cost || null, mapping.isPrimary ? 1 : 0]);
        }
      }
    });

    return { success: true, message: `${formData.name} has been updated.` };
  } catch (error: any) {
    console.error('Error updating product:', error);
    if (error instanceof SellingUnitError) {
      return { success: false, message: error.message };
    }
    if (error.code === 'ER_DUP_ENTRY' && error.message.includes('unique_product_unit')) {
      return { success: false, message: 'A conversion factor with this unit already exists for this product.' };
    }
    return { success: false, message: 'There was an error updating the product.' };
  }
}

export async function deleteProduct(id: string) {
  try {
    await withTransaction(async (connection) => {
      await connection.query('DELETE FROM product_shelves WHERE product_id = ?', [id]);
      await connection.query('DELETE FROM conversion_factors WHERE product_id = ?', [id]);
      await connection.query('DELETE FROM supplier_product_mapping WHERE product_id = ?', [id]);
      // product_selling_units (and, via its own ON DELETE CASCADE,
      // product_selling_unit_price_levels) clean up automatically: both carry
      // ON DELETE CASCADE back to this row.
      await connection.query('DELETE FROM products WHERE id = ?', [id]);
    });
    return { success: true, message: 'Product deleted successfully.' };
  } catch (error) {
    console.error('Error deleting product:', error);
    return { success: false, message: 'Error deleting product. It might be referenced by other records.' };
  }
}

export async function updateProductPrice(id: string, newPrice: number) {
  try {
    const defaultPriceLevelSql = `SELECT id FROM price_levels WHERE is_default = 1 LIMIT 1`;
    const defaultPriceLevelResult = await query(defaultPriceLevelSql);
    const defaultLevelId = defaultPriceLevelResult.length > 0 ? defaultPriceLevelResult[0].id : 'retail-level';

    await withTransaction(async (connection) => {
      // Price levels are per selling unit now. products.price has always
      // described the BASE unit, so the default-tier override this function
      // maintains belongs to that unit's own price-level rows.
      const [baseRows]: any = await connection.query(
        'SELECT id FROM product_selling_units WHERE product_id = ? AND is_base = 1 LIMIT 1',
        [id],
      );
      const baseUnitId = baseRows.length > 0 ? baseRows[0].id : null;

      if (baseUnitId) {
        // Preserve a manually-edited default-tier row rather than blindly
        // overwriting it: only UPDATE an existing (min_quantity IS NULL OR 0)
        // row, else INSERT one. See
        // docs/superpowers/plans/2026-08-04-price-level-row-no-auto-recalc.md
        // for the bug this check prevents.
        const checkSql = `SELECT * FROM product_selling_unit_price_levels WHERE selling_unit_id = ? AND price_level_id = ? AND (min_quantity IS NULL OR min_quantity = 0)`;
        const existing = await connection.query(checkSql, [baseUnitId, defaultLevelId]);

        if (existing.length > 0) {
          await connection.query(
            'UPDATE product_selling_unit_price_levels SET price = ? WHERE selling_unit_id = ? AND price_level_id = ? AND (min_quantity IS NULL OR min_quantity = 0)',
            [newPrice, baseUnitId, defaultLevelId]
          );
        } else {
          await connection.query(
            'INSERT INTO product_selling_unit_price_levels (selling_unit_id, price_level_id, price, min_quantity) VALUES (?, ?, ?, 0)',
            [baseUnitId, defaultLevelId, newPrice]
          );
        }
      }

      await connection.query('UPDATE products SET price = ? WHERE id = ?', [newPrice, id]);
    });

    return { success: true };
  } catch (error) {
    console.error('Error updating product price:', error);
    return { success: false };
  }
}

export async function updateProductStock(id: string, newStock: number) {
  try {
    await query('UPDATE products SET stock = ? WHERE id = ?', [newStock, id]);
    return { success: true };
  } catch (error) {
    console.error('Error updating product stock:', error);
    return { success: false };
  }
}

export type BreakPackNewProductData = {
  name: string;
  unitOfMeasure: string;
  conversionFactor: number;
  price: number;
  cost?: number;
  barcode?: string;
};

export async function breakPack(
  parentId: string, 
  childId: string | null, 
  quantityToBreak: number, 
  manualFactor?: number,
  newProductData?: BreakPackNewProductData,
  userId: string = 'system',
  isInternalFinalization: boolean = false
) {
  try {
    // --- Check if approval is required ---
    if (!isInternalFinalization) {
      const isApprovalRequired = await checkApprovalRequired('REPACKAGING');
      if (isApprovalRequired) {
        // Enrich data for the approval card
        const parentRows: any = await query('SELECT p.name, p.stock, p.unit_of_measure, p.sku, p.barcode, p.price, p.cost, w.name as warehouse_name FROM products p LEFT JOIN warehouses w ON p.warehouse_id = w.id WHERE p.id = ? OR p.sku = ?', [parentId, parentId]);
        const parentInfo = (Array.isArray(parentRows) && parentRows.length > 0) ? parentRows[0] : null;
        
        let targetName = newProductData?.name || 'New Product';
        let targetUnit = newProductData?.unitOfMeasure || '';
        let targetBarcode = newProductData?.barcode || '';
        let targetSku = 'NEW';
        let targetPrice = newProductData?.price || 0;
        let targetCost = newProductData?.cost || 0;
        
        if (childId) {
          const childRows: any = await query('SELECT name, unit_of_measure, sku, barcode, price, cost FROM products WHERE id = ? OR sku = ?', [childId, childId]);
          const childInfo = (Array.isArray(childRows) && childRows.length > 0) ? childRows[0] : null;
          if (childInfo) {
            targetName = childInfo.name;
            targetUnit = childInfo.unit_of_measure;
            targetBarcode = childInfo.barcode;
            targetSku = childInfo.sku;
            targetPrice = childInfo.price;
            targetCost = childInfo.cost;
          }
        }

        const factor = manualFactor || newProductData?.conversionFactor || 1;
        const sourceName = parentInfo?.name || parentId;
        
        // Create an items array for standard UI rendering in approvals
        const items = [
          {
            productId: parentId,
            productName: sourceName,
            sku: parentInfo?.sku || '',
            barcode: parentInfo?.barcode || '',
            price: parentInfo?.price || 0,
            cost: parentInfo?.cost || 0,
            quantity: -quantityToBreak,
            unit: parentInfo?.unit_of_measure || ''
          },
          {
            productId: childId || 'NEW',
            productName: targetName,
            sku: targetSku,
            barcode: targetBarcode,
            price: targetPrice,
            cost: targetCost,
            quantity: quantityToBreak * factor,
            unit: targetUnit
          }
        ];

        const { queueId, pendingApproval } = await submitToApprovalQueue('REPACKAGING', {
          parentId,
          childId,
          quantityToBreak,
          manualFactor,
          newProductData,
          sourceProductName: sourceName,
          targetProductName: targetName,
          sourceUnit: parentInfo?.unit_of_measure || '',
          currentStock: parentInfo?.stock || 0,
          quantity: `${quantityToBreak} ${parentInfo?.unit_of_measure || ''}`.trim(),
          warehouseName: parentInfo?.warehouse_name || 'N/A',
          reason: 'Break Pack',
          items // Add items array for consistency with other transaction types
        }, userId);
        if (pendingApproval) {
          return { success: true, pendingApproval: true, queueId, message: `Repackaging request submitted for approval.` };
        }
        // If all steps auto-skipped, fall through to immediate execution
      }
    }

    return await withTransaction(async (connection) => {
      const repackagingId = `rpkg_${uuidv4()}`;
      // 1. Fetch parent info
      const [parentResult]: any = await connection.query(
        'SELECT id, name, stock, unit_of_measure, sku, brand, category, subcategory, department, supplier_id, warehouse_id, vat_status, income_account, expense_account FROM products WHERE id = ?', 
        [parentId]
      );
      const parent = parentResult[0];
      if (!parent) throw new Error('Parent product not found.');
      if (parent.stock < quantityToBreak) {
        throw new Error(`Insufficient stock of ${parent.name}. Available: ${parent.stock}`);
      }

      let resolvedChildId = childId;
      let childName: string;
      let childStock: number;
      let childUnit: string;
      let factor: number;

      // --- Scenario A: Auto-create a new child product ---
      if (!resolvedChildId && newProductData) {
        const newId = `product_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
        const newSku = `${parent.sku}-${newProductData.unitOfMeasure.replace(/\s+/g, '').toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
        factor = newProductData.conversionFactor;

        await connection.query(
          `INSERT INTO products (
            id, name, brand, sku, description, category, subcategory, 
            unit_of_measure, stock, reorder_point, price, cost, barcode, 
            warehouse_id, department, supplier_id, vat_status, 
            income_account, expense_account, availability
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            newId, newProductData.name, parent.brand, newSku,
            `Repackaged from ${parent.name}`,
            parent.category, parent.subcategory,
            newProductData.unitOfMeasure, 0, 0,
            newProductData.price, newProductData.cost || null, newProductData.barcode || null,
            parent.warehouse_id, parent.department, parent.supplier_id,
            parent.vat_status, parent.income_account, parent.expense_account,
            'Available'
          ]
        );

        resolvedChildId = newId;
        childName = newProductData.name;
        childStock = 0;
        childUnit = newProductData.unitOfMeasure;

      // --- Scenario B or C: Existing product ---
      } else if (resolvedChildId) {
        const [childResult]: any = await connection.query(
          'SELECT id, name, stock, unit_of_measure, conversion_factor, parent_id FROM products WHERE id = ?', 
          [resolvedChildId]
        );
        const child = childResult[0];
        if (!child) throw new Error('Target product not found.');

        childName = child.name;
        childStock = child.stock;
        childUnit = child.unit_of_measure;

        // Use manual factor provided in transaction
        factor = manualFactor || 1;
      } else {
        throw new Error('No target product specified for break pack.');
      }

      const childQuantityToAdd = quantityToBreak * factor;

      // 2. Perform the stock move: out of the source product, into the target.
      // These are two independent stock holders; `factor` (already applied to get
      // childQuantityToAdd) is the repack conversion the operator entered, and it
      // stays. What disappears is the old root-unit round trip — each product's
      // stock is its own figure in its own base units, with nothing to cascade.
      await updateStockAndRecordMovement(
        parentId,
        -quantityToBreak,
        'adjustment',
        repackagingId,
        'adjustment',
        `Repackaging: Break Pack from ${parentId}`,
        connection as any
      );

      await updateStockAndRecordMovement(
        resolvedChildId!,
        childQuantityToAdd,
        'adjustment',
        repackagingId,
        'adjustment',
        `Repackaging: Produced from ${parentId}`,
        connection as any
      );

      // 4. Record repackaging logs

      // 5. Log to repackaging_logs
      const logId = `rpkg_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      await connection.query(
        `INSERT INTO repackaging_logs (id, source_product_id, source_product_name, source_qty, target_product_id, target_product_name, target_qty_produced, factor, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)`,
        [logId, parentId, parent.name, quantityToBreak, resolvedChildId!, childName!, childQuantityToAdd, factor, userId]
      );

      // 6. --- BATCH COSTING: Create child batch (inherit parent cost or use current cost) ---
      try {
        const [bcsRows]: any = await connection.query(
          'SELECT batch_costing_repack_inherit FROM pos_settings LIMIT 1'
        );
        const repackInherit = !bcsRows || bcsRows.length === 0 || bcsRows[0].batch_costing_repack_inherit !== 0;

        let childUnitCost: number;
        let sourceType: string;

        if (repackInherit) {
          // Find the oldest batch for the parent with remaining qty
          const [parentBatches]: any = await connection.query(
            `SELECT unit_cost FROM inventory_batches
             WHERE product_id = ? AND quantity_remaining > 0
             ORDER BY received_date ASC, created_at ASC LIMIT 1`,
            [parentId]
          );
          if (parentBatches && parentBatches.length > 0) {
            // Cost per child unit = parent batch cost / conversion factor
            childUnitCost = parseFloat(parentBatches[0].unit_cost) / factor;
            sourceType = 'repack_inherit';
          } else {
            // Fallback: use parent product.cost
            const [parentCostRow]: any = await connection.query('SELECT cost FROM products WHERE id = ?', [parentId]);
            childUnitCost = parseFloat(parentCostRow?.[0]?.cost || 0) / factor;
            sourceType = 'repack_inherit';
          }
        } else {
          // Use current child product cost directly
          const [childCostRow]: any = await connection.query('SELECT cost FROM products WHERE id = ?', [resolvedChildId]);
          childUnitCost = parseFloat(childCostRow?.[0]?.cost || 0);
          sourceType = 'repack_new';
        }

        // Get child selling price
        const [childPriceRow]: any = await connection.query('SELECT price FROM products WHERE id = ?', [resolvedChildId]);
        const childSellingPrice = parseFloat(childPriceRow?.[0]?.price || 0);

        const childBatchId = generateBatchId();
        await connection.query(
          `INSERT INTO inventory_batches
             (id, product_id, purchase_order_id, received_date, quantity_in, quantity_remaining, unit_cost, selling_price, source_type, notes)
           VALUES (?, ?, NULL, CURDATE(), ?, ?, ?, ?, ?, ?)`,
          [childBatchId, resolvedChildId!, childQuantityToAdd, childQuantityToAdd, childUnitCost, childSellingPrice, sourceType, `Repackaged from ${parent.name} (${logId})`]
        );
      } catch (batchErr) {
        // Non-fatal (migration may not have run yet)
        console.warn('[BatchCosting] Could not create repack child batch:', batchErr);
      }
      // --- END BATCH COSTING ---

      return { success: true, message: `Successfully repackaged ${quantityToBreak} ${parent.unit_of_measure} into ${childQuantityToAdd} ${childUnit!}.` };

    });
  } catch (error: any) {
    console.error('Error in breakPack:', error);
    return { success: false, message: error.message || 'Internal server error during break pack operation.' };
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// CONSOLIDATE PACK  (Reverse of Break Pack: Pack/Small → Bulk/Large)
// Source = pack product (stock ↓)
// Target = bulk product (stock ↑)
// bulkQtyProduced = packQtyUsed / factor
// ──────────────────────────────────────────────────────────────────────────────

export type ConsolidatePackNewProductData = {
  name: string;
  unitOfMeasure: string;
  conversionFactor: number; // how many pack units make 1 bulk unit
  price: number;
  cost?: number;
  barcode?: string;
};

export async function consolidatePack(
  packId: string,
  bulkId: string | null,
  packQtyUsed: number,
  manualFactor?: number,
  newProductData?: ConsolidatePackNewProductData,
  userId: string = 'system',
  isInternalFinalization: boolean = false
) {
  try {
    // --- Check if approval is required ---
    if (!isInternalFinalization) {
      const isApprovalRequired = await checkApprovalRequired('REPACKAGING');
      if (isApprovalRequired) {
        const packRows: any = await query(
          'SELECT p.name, p.stock, p.unit_of_measure, p.sku, p.barcode, p.price, p.cost, w.name as warehouse_name FROM products p LEFT JOIN warehouses w ON p.warehouse_id = w.id WHERE p.id = ?',
          [packId]
        );
        const packInfo = Array.isArray(packRows) && packRows.length > 0 ? packRows[0] : null;

        let targetName = newProductData?.name || 'New Bulk Product';
        let targetUnit = newProductData?.unitOfMeasure || '';
        let targetBarcode = newProductData?.barcode || '';
        let targetSku = 'NEW';
        let targetPrice = newProductData?.price || 0;
        let targetCost = newProductData?.cost || 0;

        if (bulkId) {
          const bulkRows: any = await query(
            'SELECT name, unit_of_measure, sku, barcode, price, cost FROM products WHERE id = ?',
            [bulkId]
          );
          const bulkInfo = Array.isArray(bulkRows) && bulkRows.length > 0 ? bulkRows[0] : null;
          if (bulkInfo) {
            targetName = bulkInfo.name;
            targetUnit = bulkInfo.unit_of_measure;
            targetBarcode = bulkInfo.barcode;
            targetSku = bulkInfo.sku;
            targetPrice = bulkInfo.price;
            targetCost = bulkInfo.cost;
          }
        }

        const factor = manualFactor ?? newProductData?.conversionFactor ?? 1;
        const sourceName = packInfo?.name || packId;
        const bulkQtyProduced = packQtyUsed / factor;

        const items = [
          {
            productId: packId,
            productName: sourceName,
            sku: packInfo?.sku || '',
            barcode: packInfo?.barcode || '',
            price: packInfo?.price || 0,
            cost: packInfo?.cost || 0,
            quantity: -packQtyUsed,
            unit: packInfo?.unit_of_measure || '',
          },
          {
            productId: bulkId || 'NEW',
            productName: targetName,
            sku: targetSku,
            barcode: targetBarcode,
            price: targetPrice,
            cost: targetCost,
            quantity: bulkQtyProduced,
            unit: targetUnit,
          },
        ];

        const { queueId, pendingApproval } = await submitToApprovalQueue(
          'REPACKAGING',
          {
            direction: 'consolidate',
            packId,
            bulkId,
            packQtyUsed,
            manualFactor,
            newProductData,
            sourceProductName: sourceName,
            targetProductName: targetName,
            sourceUnit: packInfo?.unit_of_measure || '',
            currentStock: packInfo?.stock || 0,
            quantity: `${packQtyUsed} ${packInfo?.unit_of_measure || ''}`.trim(),
            warehouseName: packInfo?.warehouse_name || 'N/A',
            reason: 'Consolidate Pack',
            items,
          },
          userId
        );

        if (pendingApproval) {
          return {
            success: true,
            pendingApproval: true,
            queueId,
            message: 'Consolidation request submitted for approval.',
          };
        }
      }
    }

    return await withTransaction(async (connection) => {
      const repackagingId = `rpkg_${uuidv4()}`;
      // 1. Fetch pack (source) info
      const [packResult]: any = await connection.query(
        'SELECT id, name, stock, unit_of_measure, sku, brand, category, subcategory, department, supplier_id, warehouse_id, vat_status, income_account, expense_account FROM products WHERE id = ?',
        [packId]
      );
      const pack = packResult[0];
      if (!pack) throw new Error('Pack product not found.');
      if (pack.stock < packQtyUsed) {
        throw new Error(
          `Insufficient stock of ${pack.name}. Available: ${pack.stock}`
        );
      }

      let resolvedBulkId = bulkId;
      let bulkName: string;
      let bulkStock: number;
      let bulkUnit: string;
      let factor: number;

      // --- Scenario A: Auto-create a new bulk product ---
      if (!resolvedBulkId && newProductData) {
        const newId = `product_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
        const newSku = `${pack.sku}-BULK-${Date.now().toString(36).toUpperCase()}`;
        factor = newProductData.conversionFactor;

        await connection.query(
          `INSERT INTO products (
            id, name, brand, sku, description, category, subcategory,
            unit_of_measure, stock, reorder_point, price, cost, barcode,
            warehouse_id, department, supplier_id, vat_status,
            income_account, expense_account, availability
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            newId, newProductData.name, pack.brand, newSku,
            `Consolidated from ${pack.name}`,
            pack.category, pack.subcategory,
            newProductData.unitOfMeasure, 0, 0,
            newProductData.price, newProductData.cost || null, newProductData.barcode || null,
            pack.warehouse_id, pack.department, pack.supplier_id,
            pack.vat_status, pack.income_account, pack.expense_account,
            'Available',
          ]
        );

        resolvedBulkId = newId;
        bulkName = newProductData.name;
        bulkStock = 0;
        bulkUnit = newProductData.unitOfMeasure;

      // --- Scenario B: Existing bulk product ---
      } else if (resolvedBulkId) {
        const [bulkResult]: any = await connection.query(
          'SELECT id, name, stock, unit_of_measure, conversion_factor FROM products WHERE id = ?',
          [resolvedBulkId]
        );
        const bulk = bulkResult[0];
        if (!bulk) throw new Error('Bulk/target product not found.');

        bulkName = bulk.name;
        bulkStock = bulk.stock;
        bulkUnit = bulk.unit_of_measure;
        factor = manualFactor ?? 1;
      } else {
        throw new Error('No target bulk product specified for consolidation.');
      }

      const bulkQtyToAdd = packQtyUsed / factor;

      // 2. Perform the stock move: out of the packs, into the bulk product.
      // `factor` (already applied to get bulkQtyToAdd) is the consolidation
      // conversion the operator entered and stays; the old root-unit round trip
      // disappears, because each product's stock is its own figure in its own
      // base units with nothing to cascade.
      await updateStockAndRecordMovement(
        packId,
        -packQtyUsed,
        'adjustment',
        repackagingId,
        'adjustment',
        `Consolidation: Used ${packQtyUsed} of ${packId}`,
        connection as any
      );

      await updateStockAndRecordMovement(
        resolvedBulkId!,
        bulkQtyToAdd,
        'adjustment',
        repackagingId,
        'adjustment',
        `Consolidation: Produced from ${packId}`,
        connection as any
      );

      // 4. Record stock movements
      const movementId1 = `mov_cons_p_${Date.now()}`;
      const movementId2 = `mov_cons_b_${Date.now() + 1}`;

      await connection.query(
        `INSERT INTO stock_movements (id, product_id, product_name, movement_type, quantity_change, previous_stock, new_stock, reference_id, reference_type, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [movementId1, packId, pack.name, 'adjustment', -packQtyUsed, pack.stock, pack.stock - packQtyUsed, resolvedBulkId, 'consolidate_pack', `Consolidated ${packQtyUsed} ${pack.unit_of_measure} into ${bulkName!}`]
      );

      await connection.query(
        `INSERT INTO stock_movements (id, product_id, product_name, movement_type, quantity_change, previous_stock, new_stock, reference_id, reference_type, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [movementId2, resolvedBulkId!, bulkName!, 'adjustment', bulkQtyToAdd, bulkStock!, bulkStock! + bulkQtyToAdd, packId, 'consolidate_pack', `Received ${bulkQtyToAdd} ${bulkUnit!} from consolidating ${pack.name}`]
      );

      // 5. Log to repackaging_logs (reuses same table)
      const logId = `rpkg_cons_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      await connection.query(
        `INSERT INTO repackaging_logs (id, source_product_id, source_product_name, source_qty, target_product_id, target_product_name, target_qty_produced, factor, status, notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', 'consolidate', ?)`,
        [logId, packId, pack.name, packQtyUsed, resolvedBulkId!, bulkName!, bulkQtyToAdd, factor, userId]
      );

      return {
        success: true,
        message: `Successfully consolidated ${packQtyUsed} ${pack.unit_of_measure} into ${bulkQtyToAdd} ${bulkUnit!}.`,
      };
    });
  } catch (error: any) {
    console.error('Error in consolidatePack:', error);
    return {
      success: false,
      message: error.message || 'Internal server error during consolidation operation.',
    };
  }
}

export async function updateProductShelfLocations(updates: { 
  productId: string; 
  shelfLocationId?: string | null; 
  sourceShelfId?: string | null;
  targetShelfId?: string | null;
  quantity?: number;
}[], userId: string = 'system', isInternalFinalization: boolean = false) {
  try {
    if (!isInternalFinalization) {
      const isApprovalRequired = await checkApprovalRequired('SHELF_TRANSFER');
      if (isApprovalRequired) {
          // Enrich data for approval
          const enrichedUpdates = await Promise.all(updates.map(async u => {
              const pRows: any = await query('SELECT name, sku, barcode, stock FROM products WHERE id = ?', [u.productId]);
              const p = pRows[0];
              
              let sourceName = 'Unassigned';
              if (u.sourceShelfId && u.sourceShelfId !== 'unassigned') {
                  const sRows: any = await query('SELECT name FROM shelf_locations WHERE id = ?', [u.sourceShelfId]);
                  sourceName = sRows[0]?.name || u.sourceShelfId;
              }
              
              let targetName = 'Unassigned';
              if (u.targetShelfId && u.targetShelfId !== 'unassigned') {
                  const tRows: any = await query('SELECT name FROM shelf_locations WHERE id = ?', [u.targetShelfId]);
                  targetName = tRows[0]?.name || u.targetShelfId;
              }

              return {
                  ...u,
                  productName: p?.name || 'Unknown',
                  productSku: p?.sku || '',
                  productBarcode: p?.barcode || '',
                  sourceShelfName: sourceName,
                  targetShelfName: targetName,
              };
          }));

          const { queueId, pendingApproval } = await submitToApprovalQueue('SHELF_TRANSFER', {
              updates: enrichedUpdates,
              items: enrichedUpdates.map(u => ({
                  productId: u.productId,
                  productName: u.productName,
                  sku: u.productSku,
                  barcode: u.productBarcode,
                  quantity: u.quantity,
                  sourceShelfName: u.sourceShelfName,
                  targetShelfName: u.targetShelfName,
                  notes: `Transfer from ${u.sourceShelfName} to ${u.targetShelfName}`
              }))
          }, userId);

          if (pendingApproval) {
              return { success: true, pendingApproval: true, queueId, message: 'Shelf transfer submitted for approval.' };
          }
      }
    }

    await withTransaction(async (connection) => {
      for (const update of updates) {
        // Handle Legacy/Bulk move (entire stock to a new shelf or unassigned)
        if (update.shelfLocationId !== undefined) {
          // Clear all existing shelf assignments for this product
          await connection.query('DELETE FROM product_shelves WHERE product_id = ?', [update.productId]);
          
          // Update the legacy column as well for backward compatibility
          await connection.query('UPDATE products SET shelf_location_id = ? WHERE id = ?', [update.shelfLocationId, update.productId]);

          // Add new assignment if not unassigned
          if (update.shelfLocationId && update.shelfLocationId !== 'unassigned' && update.shelfLocationId !== 'none') {
            const [product]: any = await connection.query('SELECT stock FROM products WHERE id = ?', [update.productId]);
            const stock = (product as any[])[0]?.stock || 0;
            await connection.query('INSERT INTO product_shelves (product_id, shelf_id, quantity) VALUES (?, ?, ?)', [update.productId, update.shelfLocationId, stock]);
          }
          continue;
        }

        // Handle Partial Transfer
        const { productId, sourceShelfId, targetShelfId, quantity = 0 } = update;
        if (quantity <= 0) continue;

        // 1. Decrement from source (if not unassigned)
        if (sourceShelfId && sourceShelfId !== 'unassigned') {
          await connection.query(
            'UPDATE product_shelves SET quantity = quantity - ? WHERE product_id = ? AND shelf_id = ?',
            [quantity, productId, sourceShelfId]
          );
          // Clean up 0 quantity records
          await connection.query('DELETE FROM product_shelves WHERE product_id = ? AND shelf_id = ? AND quantity <= 0', [productId, sourceShelfId]);
        }

        // 2. Increment target (if not unassigned)
        if (targetShelfId && targetShelfId !== 'unassigned') {
          const [existingRows]: any = await connection.query(
            'SELECT quantity FROM product_shelves WHERE product_id = ? AND shelf_id = ?',
            [productId, targetShelfId]
          );

          if ((existingRows as any[]).length > 0) {
            await connection.query(
              'UPDATE product_shelves SET quantity = quantity + ? WHERE product_id = ? AND shelf_id = ?',
              [quantity, productId, targetShelfId]
            );
          } else {
            await connection.query(
              'INSERT INTO product_shelves (product_id, shelf_id, quantity) VALUES (?, ?, ?)',
              [productId, targetShelfId, quantity]
            );
          }
        }

        // 3. Update legacy shelf_location_id on products table
        // We'll set it to the shelf with the highest quantity, or null if no shelves remain
        const [remainingRows]: any = await connection.query(
          'SELECT shelf_id FROM product_shelves WHERE product_id = ? ORDER BY quantity DESC LIMIT 1',
          [productId]
        );
        const topShelf = (remainingRows as any[]).length > 0 ? (remainingRows as any[])[0].shelf_id : null;
        await connection.query('UPDATE products SET shelf_location_id = ? WHERE id = ?', [topShelf, productId]);

        // 4. Record stock movement for the transfer
        const movementId = `mov_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
        const [pInfo]: any = await connection.query('SELECT name FROM products WHERE id = ?', [productId]);
        const pName = (pInfo as any[])[0]?.name || 'Unknown Product';
        
        let sourceName = 'Unassigned';
        if (sourceShelfId && sourceShelfId !== 'unassigned') {
            const [sInfo]: any = await connection.query('SELECT name FROM shelf_locations WHERE id = ?', [sourceShelfId]);
            sourceName = (sInfo as any[])[0]?.name || sourceShelfId;
        }

        let targetName = 'Unassigned';
        if (targetShelfId && targetShelfId !== 'unassigned') {
            const [tInfo]: any = await connection.query('SELECT name FROM shelf_locations WHERE id = ?', [targetShelfId]);
            targetName = (tInfo as any[])[0]?.name || targetShelfId;
        }

        await connection.query(
          `INSERT INTO stock_movements (
            id, product_id, product_name, movement_type, quantity_change, previous_stock, new_stock,
            reference_id, reference_type, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            movementId, productId, pName, 'transfer', 0, 0, 0, 
            productId, 'shelf_transfer', `Shelf Transfer: ${sourceName} -> ${targetName} (${quantity} units)`
          ]
        );
      }
    });
    return { success: true };
  } catch (error) {
    console.error('Error updating product shelf locations:', error);
    return { success: false, message: 'Internal server error' };
  }
}

export async function getLowStockProducts() {
  try {
    const settingsResult = await query('SELECT low_stock_threshold FROM pos_settings LIMIT 1');
    const globalThreshold = settingsResult.length > 0 ? settingsResult[0].low_stock_threshold : 10;

    const sql = `
      SELECT p.*, w.name as warehouse_name
      FROM products p
      LEFT JOIN warehouses w ON p.warehouse_id = w.id
      WHERE p.stock > 0 AND (p.stock < p.reorder_point OR p.stock < ?)
      ORDER BY p.stock ASC
    `;
    return await query(sql, [globalThreshold]);
  } catch (error) {
    console.error('Error fetching low stock products:', error);
    return [];
  }
}

export async function getOutOfStockProducts() {
  try {
    const sql = `
      SELECT p.*, w.name as warehouse_name
      FROM products p
      LEFT JOIN warehouses w ON p.warehouse_id = w.id
      WHERE p.stock <= 0 AND p.type = 'standard'
      ORDER BY p.name ASC
    `;
    return await query(sql);
  } catch (error) {
    console.error('Error fetching out of stock products:', error);
    return [];
  }
}

// Lookup Functions
export async function getCategories() {
  try {
    const categories = await query('SELECT * FROM categories ORDER BY name');
    return categories.map((cat: any) => ({
      id: cat.id,
      name: cat.name,
      markupPercentage: cat.markup_percentage ? parseFloat(cat.markup_percentage) : undefined
    }));
  } catch (error) {
    console.error('Error fetching categories:', error);
    return [];
  }
}

export async function addCategory(name: string, markupPercentage?: number) {
  try {
    const id = `cat_${Date.now()}`;
    await query('INSERT INTO categories (id, name, markup_percentage) VALUES (?, ?, ?)', [id, name, markupPercentage || null]);
    return { success: true, message: 'Category added successfully.' };
  } catch (error) {
    console.error('Error adding category:', error);
    return { success: false, message: describeAddError(error, 'category') };
  }
}

export async function updateCategory(id: string, name: string, markupPercentage?: number) {
  try {
    await query('UPDATE categories SET name = ?, markup_percentage = ? WHERE id = ?', [name, markupPercentage || null, id]);
    return { success: true, message: 'Category updated successfully.' };
  } catch (error) {
    console.error('Error updating category:', error);
    return { success: false, message: 'Error updating category.' };
  }
}

export async function deleteCategory(id: string) {
  try {
    await query('DELETE FROM categories WHERE id = ?', [id]);
    return { success: true, message: 'Category deleted successfully.' };
  } catch (error) {
    console.error('Error deleting category:', error);
    return { success: false, message: 'Error deleting category.' };
  }
}

export async function getBrands() {
  try {
    const brands = await query('SELECT * FROM brands ORDER BY name');
    return brands.map((brand: any) => ({
      id: brand.id,
      name: brand.name,
      markupPercentage: brand.markup_percentage ? parseFloat(brand.markup_percentage) : undefined
    }));
  } catch (error) {
    console.error('Error fetching brands:', error);
    return [];
  }
}

export async function addBrand(name: string, markupPercentage?: number) {
  try {
    const id = `brand_${Date.now()}`;
    await query('INSERT INTO brands (id, name, markup_percentage) VALUES (?, ?, ?)', [id, name, markupPercentage || null]);
    return { success: true, message: 'Brand added successfully.' };
  } catch (error) {
    console.error('Error adding brand:', error);
    return { success: false, message: describeAddError(error, 'brand') };
  }
}

export async function updateBrand(id: string, name: string, markupPercentage?: number) {
  try {
    await query('UPDATE brands SET name = ?, markup_percentage = ? WHERE id = ?', [name, markupPercentage || null, id]);
    return { success: true, message: 'Brand updated successfully.' };
  } catch (error) {
    console.error('Error updating brand:', error);
    return { success: false, message: 'Error updating brand.' };
  }
}

export async function deleteBrand(id: string) {
  try {
    await query('DELETE FROM brands WHERE id = ?', [id]);
    return { success: true, message: 'Brand deleted successfully.' };
  } catch (error) {
    console.error('Error deleting brand:', error);
    return { success: false, message: 'Error deleting brand.' };
  }
}

/**
 * A subcategory name must be unique within its own category — or, for an
 * unassigned (categoryId: null) subcategory, unique among other unassigned
 * ones. MySQL's UNIQUE(category_id, name) index treats every NULL as
 * distinct, so it alone would allow duplicate names among unassigned rows;
 * this closes that gap explicitly.
 */
async function subcategoryNameConflicts(
  name: string,
  categoryId: string | null,
  excludeId?: string,
): Promise<boolean> {
  const params: any[] = [name];
  let sql = 'SELECT id FROM subcategories WHERE name = ?';
  if (categoryId === null) {
    sql += ' AND category_id IS NULL';
  } else {
    sql += ' AND category_id = ?';
    params.push(categoryId);
  }
  if (excludeId) {
    sql += ' AND id != ?';
    params.push(excludeId);
  }
  const rows: any = await query(sql, params);
  return rows.length > 0;
}

export async function getSubcategories() {
  try {
    const subcategories = await query('SELECT * FROM subcategories ORDER BY name');
    return subcategories.map((sub: any) => ({
      id: sub.id,
      name: sub.name,
      categoryId: sub.category_id ?? null,
      markupPercentage: sub.markup_percentage ? parseFloat(sub.markup_percentage) : undefined
    }));
  } catch (error) {
    console.error('Error fetching subcategories:', error);
    return [];
  }
}

export async function addSubcategory(name: string, categoryId: string | null, markupPercentage?: number) {
  try {
    if (await subcategoryNameConflicts(name, categoryId)) {
      return { success: false, message: `A subcategory named "${name}" already exists in this category.` };
    }
    const id = `subcat_${Date.now()}`;
    await query(
      'INSERT INTO subcategories (id, name, category_id, markup_percentage) VALUES (?, ?, ?, ?)',
      [id, name, categoryId, markupPercentage || null],
    );
    return { success: true, message: 'Subcategory added successfully.' };
  } catch (error) {
    console.error('Error adding subcategory:', error);
    return { success: false, message: 'Error adding subcategory.' };
  }
}

export async function updateSubcategory(id: string, name: string, categoryId: string | null, markupPercentage?: number) {
  try {
    if (await subcategoryNameConflicts(name, categoryId, id)) {
      return { success: false, message: `A subcategory named "${name}" already exists in this category.` };
    }
    await query(
      'UPDATE subcategories SET name = ?, category_id = ?, markup_percentage = ? WHERE id = ?',
      [name, categoryId, markupPercentage || null, id],
    );
    return { success: true, message: 'Subcategory updated successfully.' };
  } catch (error) {
    console.error('Error updating subcategory:', error);
    return { success: false, message: 'Error updating subcategory.' };
  }
}

export async function deleteSubcategory(id: string) {
  try {
    await query('DELETE FROM subcategories WHERE id = ?', [id]);
    return { success: true, message: 'Subcategory deleted successfully.' };
  } catch (error) {
    console.error('Error deleting subcategory:', error);
    return { success: false, message: 'Error deleting subcategory.' };
  }
}

export async function getUnitsOfMeasure(): Promise<UnitOfMeasure[]> {
  try {
    const units = await query('SELECT * FROM units_of_measure ORDER BY name');
    return units.map((u: any) => ({
      id: u.id,
      name: u.name,
      abbreviation: u.abbreviation
    }));
  } catch (error) {
    console.error('Error fetching units of measure:', error);
    return [];
  }
}

export async function addUnitOfMeasure(name: string, abbreviation: string) {
  try {
    const id = `uom_${Date.now()}`;
    await query('INSERT INTO units_of_measure (id, name, abbreviation) VALUES (?, ?, ?)', [id, name, abbreviation]);
    return { success: true, message: 'Unit of measure added successfully.' };
  } catch (error) {
    console.error('Error adding unit of measure:', error);
    return { success: false, message: describeAddError(error, 'unit of measure') };
  }
}

/**
 * Renaming a unit has to carry the products along with it. `products.
 * unit_of_measure` is free text with no FK — it stores the unit's name (and on
 * older rows, its abbreviation) rather than an id — so updating only
 * `units_of_measure` leaves every product pointing at a label that no longer
 * exists, and the products table falls back to showing the stale raw string.
 * Both writes share one transaction so the two can never diverge.
 */
export async function updateUnitOfMeasure(id: string, name: string, abbreviation: string) {
  try {
    const productsUpdated = await withTransaction(async (connection) => {
      const [rows]: any = await connection.query(
        'SELECT name, abbreviation FROM units_of_measure WHERE id = ?',
        [id]
      );
      const previous = rows[0];

      await connection.query(
        'UPDATE units_of_measure SET name = ?, abbreviation = ? WHERE id = ?',
        [name, abbreviation, id]
      );

      if (!previous) return 0;

      // Re-point products that referenced this unit by either of its old
      // labels. Rows already holding the new name are left alone.
      const oldLabels = [previous.name, previous.abbreviation].filter(
        (label): label is string => Boolean(label)
      );
      if (oldLabels.length === 0) return 0;

      const [result]: any = await connection.query(
        `UPDATE products SET unit_of_measure = ?
         WHERE unit_of_measure IN (${oldLabels.map(() => '?').join(', ')})
           AND unit_of_measure <> ?`,
        [name, ...oldLabels, name]
      );
      return result.affectedRows ?? 0;
    });

    return {
      success: true,
      message:
        productsUpdated > 0
          ? `Unit of measure updated. ${productsUpdated} product${productsUpdated === 1 ? '' : 's'} re-labelled.`
          : 'Unit of measure updated successfully.',
    };
  } catch (error) {
    console.error('Error updating unit of measure:', error);
    return { success: false, message: 'Error updating unit of measure.' };
  }
}

export async function deleteUnitOfMeasure(id: string) {
  try {
    await query('DELETE FROM units_of_measure WHERE id = ?', [id]);
    return { success: true, message: 'Unit of measure deleted successfully.' };
  } catch (error) {
    console.error('Error deleting unit of measure:', error);
    return { success: false, message: 'Error deleting unit of measure.' };
  }
}

export async function getSuppliers(): Promise<Supplier[]> {
  try {
    const suppliers = await query('SELECT * FROM suppliers ORDER BY name');
    return suppliers.map((s: any) => ({
      id: s.id,
      name: s.name,
      contactNumber: s.contact_number,
      telephone: s.telephone,
      mobilePhone: s.mobile_phone,
      email: s.email,
      address: s.address,
      company: s.company,
      tin: s.tin,
      paymentTerms: s.payment_terms,
      markupPercentage: s.markup_percentage ? parseFloat(s.markup_percentage) : undefined,
      orderSchedule: s.order_schedule
    }));
  } catch (error) {
    console.error('Error fetching suppliers:', error);
    return [];
  }
}

export async function addSupplier(data: any) {
  try {
    const id = `supplier_${Date.now()}`;
    const sql = `
      INSERT INTO suppliers (
        id, name, contact_number, telephone, mobile_phone, email, 
        address, company, tin, payment_terms, order_schedule
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    await query(sql, [
      id, 
      data.name, 
      data.contactNumber || null, 
      data.telephone || null, 
      data.mobilePhone || null, 
      data.email || null, 
      data.address || null, 
      data.company || null, 
      data.tin || null, 
      data.paymentTerms || null, 
      data.orderSchedule || null
    ]);
    return { success: true, message: 'Supplier added successfully.' };
  } catch (error) {
    console.error('Error adding supplier:', error);
    return { success: false, message: describeAddError(error, 'supplier') };
  }
}

export async function updateSupplier(id: string, data: any) {
  try {
    const sql = `
      UPDATE suppliers SET 
        name = ?, contact_number = ?, telephone = ?, mobile_phone = ?, 
        email = ?, address = ?, company = ?, tin = ?, 
        payment_terms = ?, order_schedule = ?
      WHERE id = ?
    `;
    await query(sql, [
      data.name, 
      data.contactNumber || null, 
      data.telephone || null, 
      data.mobilePhone || null, 
      data.email || null, 
      data.address || null, 
      data.company || null, 
      data.tin || null, 
      data.paymentTerms || null, 
      data.orderSchedule || null,
      id
    ]);
    return { success: true, message: 'Supplier updated successfully.' };
  } catch (error) {
    console.error('Error updating supplier:', error);
    return { success: false, message: 'Error updating supplier.' };
  }
}

export async function getPaymentTerms() {
  try {
    return await query('SELECT * FROM payment_terms ORDER BY description');
  } catch (error) {
    console.error('Error fetching payment terms:', error);
    return [];
  }
}

export async function deleteSupplier(id: string) {
  try {
    await query('DELETE FROM suppliers WHERE id = ?', [id]);
    return { success: true, message: 'Supplier deleted successfully.' };
  } catch (error) {
    console.error('Error deleting supplier:', error);
    return { success: false, message: 'Error deleting supplier.' };
  }
}

export async function getWarehouses(): Promise<Warehouse[]> {
  try {
    const warehouses = await query('SELECT * FROM warehouses ORDER BY name');
    return warehouses.map((w: any) => ({
      id: w.id,
      name: w.name,
      location: w.location,
      isActive: w.is_active === 1,
      createdAt: w.created_at
    }));
  } catch (error) {
    console.error('Error fetching warehouses:', error);
    return [];
  }
}

export async function addWarehouse(name: string, location?: string) {
  try {
    const id = `wh_${Date.now()}`;
    await query('INSERT INTO warehouses (id, name, location) VALUES (?, ?, ?)', [id, name, location || null]);
    return { success: true, message: 'Warehouse added successfully.' };
  } catch (error) {
    console.error('Error adding warehouse:', error);
    return { success: false, message: describeAddError(error, 'warehouse') };
  }
}

export async function updateWarehouse(id: string, name: string, location?: string) {
  try {
    await query('UPDATE warehouses SET name = ?, location = ? WHERE id = ?', [name, location || null, id]);
    return { success: true, message: 'Warehouse updated successfully.' };
  } catch (error) {
    console.error('Error updating warehouse:', error);
    return { success: false, message: 'Error updating warehouse.' };
  }
}

export async function deleteWarehouse(id: string) {
  try {
    await query('DELETE FROM warehouses WHERE id = ?', [id]);
    return { success: true, message: 'Warehouse deleted successfully.' };
  } catch (error) {
    console.error('Error deleting warehouse:', error);
    return { success: false, message: 'Error deleting warehouse.' };
  }
}

export async function getDepartments(): Promise<Department[]> {
  try {
    const departments = await query('SELECT * FROM departments ORDER BY name');
    return departments.map((d: any) => ({
      id: d.id,
      name: d.name,
      markupPercentage: d.markup_percentage ? parseFloat(d.markup_percentage) : undefined
    }));
  } catch (error) {
    console.error('Error fetching departments:', error);
    return [];
  }
}

export async function addDepartment(name: string, markupPercentage?: number) {
  try {
    const id = `dept_${Date.now()}`;
    await query('INSERT INTO departments (id, name, markup_percentage) VALUES (?, ?, ?)', [id, name, markupPercentage || null]);
    return { success: true, message: 'Department added successfully.' };
  } catch (error) {
    console.error('Error adding department:', error);
    return { success: false, message: describeAddError(error, 'department') };
  }
}

export async function updateDepartment(id: string, name: string, markupPercentage?: number) {
  try {
    await query('UPDATE departments SET name = ?, markup_percentage = ? WHERE id = ?', [name, markupPercentage || null, id]);
    return { success: true, message: 'Department updated successfully.' };
  } catch (error) {
    console.error('Error updating department:', error);
    return { success: false, message: 'Error updating department.' };
  }
}

export async function deleteDepartment(id: string) {
  try {
    await query('DELETE FROM departments WHERE id = ?', [id]);
    return { success: true, message: 'Department deleted successfully.' };
  } catch (error) {
    console.error('Error deleting department:', error);
    return { success: false, message: 'Error deleting department.' };
  }
}

export async function getShelfLocations(): Promise<ShelfLocation[]> {
  try {
    const locations = await query('SELECT * FROM shelf_locations ORDER BY name');
    return locations.map((loc: any) => ({
      id: loc.id,
      name: loc.name,
      description: loc.description,
      isActive: loc.is_active === 1,
      createdAt: loc.created_at,
      updatedAt: loc.updated_at
    }));
  } catch (error) {
    console.error('Error fetching shelf locations:', error);
    return [];
  }
}

export async function addShelfLocation(name: string, description?: string) {
  try {
    const id = `shelf_${Date.now()}`;
    await query('INSERT INTO shelf_locations (id, name, description) VALUES (?, ?, ?)', [id, name, description || null]);
    return { success: true, message: 'Shelf location added successfully.' };
  } catch (error) {
    console.error('Error adding shelf location:', error);
    return { success: false, message: describeAddError(error, 'shelf location') };
  }
}

export async function updateShelfLocation(id: string, name: string, description?: string) {
  try {
    await query('UPDATE shelf_locations SET name = ?, description = ? WHERE id = ?', [name, description || null, id]);
    return { success: true, message: 'Shelf location updated successfully.' };
  } catch (error) {
    console.error('Error updating shelf location:', error);
    return { success: false, message: 'Error updating shelf location.' };
  }
}

export async function deleteShelfLocation(id: string) {
  try {
    await query('DELETE FROM shelf_locations WHERE id = ?', [id]);
    return { success: true, message: 'Shelf location deleted successfully.' };
  } catch (error) {
    console.error('Error deleting shelf location:', error);
    return { success: false, message: 'Error deleting shelf location.' };
  }
}

export async function getAccounts(): Promise<Account[]> {
  try {
    const accounts = await query('SELECT * FROM accounts ORDER BY name');
    return accounts.map((acc: any) => ({
      id: acc.id,
      name: acc.name,
      type: acc.type,
      code: acc.code
    }));
  } catch (error) {
    console.error('Error fetching accounts:', error);
    return [];
  }
}

export async function addAccount(name: string, type: 'income' | 'expense', code?: string) {
  try {
    const id = `acc_${Date.now()}`;
    await query('INSERT INTO accounts (id, name, type, code) VALUES (?, ?, ?, ?)', [id, name, type, code || null]);
    const [account] = await query('SELECT * FROM accounts WHERE id = ?', [id]);
    return { success: true, message: 'Account added successfully.', account, accountId: id };
  } catch (error) {
    console.error('Error adding account:', error);
    return { success: false, message: 'Error adding account.' };
  }
}

export async function updateAccount(id: string, name: string, type: 'income' | 'expense', code?: string) {
  try {
    await query('UPDATE accounts SET name = ?, type = ?, code = ? WHERE id = ?', [name, type, code || null, id]);
    return { success: true, message: 'Account updated successfully.' };
  } catch (error) {
    console.error('Error updating account:', error);
    return { success: false, message: 'Error updating account.' };
  }
}

export async function deleteAccount(id: string) {
  try {
    await query('DELETE FROM accounts WHERE id = ?', [id]);
    return { success: true, message: 'Account deleted successfully.' };
  } catch (error) {
    console.error('Error deleting account:', error);
    return { success: false, message: 'Error deleting account.' };
  }
}

export async function getPriceLevels(): Promise<PriceLevel[]> {
  try {
    const levels = await query('SELECT * FROM price_levels ORDER BY name');
    return levels.map((level: any) => ({
      id: level.id,
      name: level.name,
      description: level.description,
      isDefault: level.is_default === 1,
      calculationBase: level.calculation_base,
      adjustmentType: level.adjustment_type === 'fixed' ? 'fixed' : 'percentage',
      percentageAdjustment: parseFloat(level.percentage_adjustment),
      minQuantity: level.min_quantity,
      createdAt: level.created_at,
      updatedAt: level.updated_at
    }));
  } catch (error) {
    console.error('Error fetching price levels:', error);
    return [];
  }
}

export async function addPriceLevel(name: string, description: string, isDefault: boolean, percentageAdjustment: number, minQuantity: number = 0, calculationBase: 'retail' | 'cost' = 'retail', adjustmentType: 'percentage' | 'fixed' = 'percentage') {
  try {
    const id = `pl_${Date.now()}`;
    if (isDefault) {
      await query('UPDATE price_levels SET is_default = 0', []);
    }
    await query('INSERT INTO price_levels (id, name, description, is_default, percentage_adjustment, min_quantity, calculation_base, adjustment_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [id, name, description || null, isDefault ? 1 : 0, percentageAdjustment, minQuantity, calculationBase, adjustmentType]);
    return { success: true, message: 'Price level added successfully.' };
  } catch (error) {
    console.error('Error adding price level:', error);
    return { success: false, message: 'Error adding price level.' };
  }
}

export async function updatePriceLevel(id: string, name: string, description: string, isDefault: boolean, percentageAdjustment: number, minQuantity: number = 0, calculationBase: 'retail' | 'cost' = 'retail', adjustmentType: 'percentage' | 'fixed' = 'percentage') {
  try {
    if (isDefault) {
      await query('UPDATE price_levels SET is_default = 0', []);
    }
    await query('UPDATE price_levels SET name = ?, description = ?, is_default = ?, percentage_adjustment = ?, min_quantity = ?, calculation_base = ?, adjustment_type = ? WHERE id = ?', [name, description || null, isDefault ? 1 : 0, percentageAdjustment, minQuantity, calculationBase, adjustmentType, id]);
    return { success: true, message: 'Price level updated successfully.' };
  } catch (error) {
    console.error('Error updating price level:', error);
    return { success: false, message: 'Error updating price level.' };
  }
}

export async function deletePriceLevel(id: string) {
  try {
    await query('DELETE FROM price_levels WHERE id = ?', [id]);
    return { success: true, message: 'Price level deleted successfully.' };
  } catch (error) {
    console.error('Error deleting price level:', error);
    return { success: false, message: 'Error deleting price level.' };
  }
}

export async function addSupplierMapping(productId: string, supplierId: string, leadTime: number, rop: number, cost?: number, supplierSku?: string, isPrimary: boolean = false) {
  try {
    const id = `spm_${Date.now()}`;

    const existingCount: any = await query(
      'SELECT COUNT(*) as count FROM supplier_product_mapping WHERE product_id = ?',
      [productId]
    );
    // A product's very first mapping is always primary — markup, reorder
    // point, and the selling-unit cost suggestion all read "the primary
    // mapping", and none of them should have to handle "one mapping exists
    // but none is primary" as a normal state.
    // Matches this file's own established unwrap convention for a
    // `COUNT(*) as count` query — see getProductsCount's `result[0].count`.
    const isFirstMapping = existingCount[0].count === 0;
    const resolvedIsPrimary = isFirstMapping ? true : isPrimary;

    if (resolvedIsPrimary) {
      await query('UPDATE supplier_product_mapping SET is_primary = 0 WHERE product_id = ?', [productId]);
    }
    await query('INSERT INTO supplier_product_mapping (id, product_id, supplier_id, supplier_lead_time, supplier_specific_rop, supplier_cost, supplier_sku, is_primary) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [id, productId, supplierId, leadTime, rop, cost || null, supplierSku || null, resolvedIsPrimary ? 1 : 0]);

    if (resolvedIsPrimary) {
      await query('UPDATE products SET reorder_point = ? WHERE id = ?', [rop, productId]);
    }

    return { success: true, message: 'Supplier mapping added successfully.' };
  } catch (error) {
    console.error('Error adding supplier mapping:', error);
    return { success: false, message: 'Error adding supplier mapping.' };
  }
}

export async function updateSupplierMapping(id: string, leadTime: number, rop: number, cost?: number, supplierSku?: string, isPrimary: boolean = false) {
  try {
    const [existing]: any = await query('SELECT product_id, is_primary FROM supplier_product_mapping WHERE id = ?', [id]);
    if (!existing) {
      return { success: false, message: 'Supplier mapping not found.' };
    }

    if (isPrimary) {
      await query('UPDATE supplier_product_mapping SET is_primary = 0 WHERE product_id = ?', [existing.product_id]);
    }
    await query('UPDATE supplier_product_mapping SET supplier_lead_time = ?, supplier_specific_rop = ?, supplier_cost = ?, supplier_sku = ?, is_primary = ? WHERE id = ?', [leadTime, rop, cost || null, supplierSku || null, isPrimary ? 1 : 0, id]);

    // The row being edited was already primary (is_primary=1 before this
    // update, and isPrimary wasn't explicitly turned off — this function has
    // no "demote" path, only "promote via isPrimary:true"), or was just
    // promoted by this call. Either way, if it is primary AFTER this update,
    // its rop must be what products.reorder_point reflects — otherwise
    // editing an already-primary row's ROP here would silently desync it
    // until someone re-triggered setPrimarySupplier.
    const isNowPrimary = isPrimary || !!existing.is_primary;
    if (isNowPrimary) {
      await query('UPDATE products SET reorder_point = ? WHERE id = ?', [rop, existing.product_id]);
    }

    return { success: true, message: 'Supplier mapping updated successfully.' };
  } catch (error) {
    console.error('Error updating supplier mapping:', error);
    return { success: false, message: 'Error updating supplier mapping.' };
  }
}

export async function deleteSupplierMapping(id: string) {
  try {
    await query('DELETE FROM supplier_product_mapping WHERE id = ?', [id]);
    return { success: true, message: 'Supplier mapping deleted successfully.' };
  } catch (error) {
    console.error('Error deleting supplier mapping:', error);
    return { success: false, message: 'Error deleting supplier mapping.' };
  }
}

export async function getSupplierMappings(productId: string): Promise<SupplierProductMapping[]> {
  try {
    const sql = `
      SELECT spm.*, s.name as supplierName
      FROM supplier_product_mapping spm
      JOIN suppliers s ON spm.supplier_id = s.id
      WHERE spm.product_id = ?
    `;
    const rows: any = await query(sql, [productId]);
    // Map DB snake_case to the camelCase shape SupplierProductMapping/the UI
    // expect — spm.* comes back raw (product_id, supplier_lead_time,
    // is_primary as 0/1), unlike supplierName which is already aliased above.
    return rows.map((r: any) => ({
      id: r.id,
      productId: r.product_id,
      supplierId: r.supplier_id,
      supplierName: r.supplierName,
      supplierSku: r.supplier_sku ?? undefined,
      supplierLeadTime: r.supplier_lead_time ?? 0,
      supplierSpecificRop: r.supplier_specific_rop ?? 0,
      supplierCost: r.supplier_cost != null ? parseFloat(r.supplier_cost) : undefined,
      isPrimary: !!r.is_primary,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  } catch (error) {
    console.error('Error fetching supplier mappings:', error);
    return [];
  }
}

export async function setPrimarySupplier(productId: string, mappingId: string) {
  try {
    await withTransaction(async (connection) => {
      // 1. Reset all primary flags for this product
      await connection.query('UPDATE supplier_product_mapping SET is_primary = 0 WHERE product_id = ?', [productId]);
      
      // 2. Set new primary mapping
      await connection.query('UPDATE supplier_product_mapping SET is_primary = 1 WHERE id = ?', [mappingId]);
      
      // 3. Get the ROP from the new primary mapping
      const [mapping]: any = await connection.query('SELECT supplier_specific_rop FROM supplier_product_mapping WHERE id = ?', [mappingId]);
      
      if (mapping) {
        // 4. Update the product's main reorder point
        await connection.query('UPDATE products SET reorder_point = ? WHERE id = ?', [mapping.supplier_specific_rop, productId]);
      }
    });
    return { success: true, message: 'Primary supplier updated successfully.' };
  } catch (error) {
    console.error('Error setting primary supplier:', error);
    return { success: false, message: 'Error setting primary supplier.' };
  }
}

export async function getTaxRates(): Promise<TaxRate[]> {
  try {
    const rates = await query('SELECT * FROM tax_rates ORDER BY name');
    return rates.map((rate: any) => ({
      id: rate.id,
      name: rate.name,
      rate: parseFloat(rate.rate),
      description: rate.description,
      isDefault: rate.is_default === 1,
      createdAt: rate.created_at,
      updatedAt: rate.updated_at
    }));
  } catch (error) {
    console.error('Error fetching tax rates:', error);
    return [];
  }
}

export async function getProductOptions() {
  try {
    const [
      brands,
      categories,
      subcategories,
      units,
      suppliers,
      accounts,
      warehouses,
      priceLevels,
      departments,
      shelfLocations,
      taxRates
    ] = await Promise.all([
      getBrands(),
      getCategories(),
      getSubcategories(),
      getUnitsOfMeasure(),
      getSuppliers(),
      getAccounts(),
      getWarehouses(),
      getPriceLevels(),
      getDepartments(),
      getShelfLocations(),
      getTaxRates()
    ]);

    return {
      brands,
      categories,
      subcategories,
      units,
      suppliers,
      accounts,
      warehouses,
      priceLevels,
      departments,
      shelfLocations,
      taxRates,
      errors: {}
    };
  } catch (error) {
    console.error('Error fetching product options:', error);
    return {
      brands: [],
      categories: [],
      subcategories: [],
      units: [],
      suppliers: [],
      accounts: [],
      warehouses: [],
      priceLevels: [],
      departments: [],
      shelfLocations: [],
      errors: { message: 'Failed to load options' }
    };
  }
}

export async function searchProducts(searchQuery: string) {
  try {
    if (!searchQuery || searchQuery.trim().length < 2) return [];
    const like = `%${searchQuery.trim()}%`;
    // Services are excluded: repackaging (break pack / consolidate) moves
    // physical stock between products, which services never have.
    const sql = `
      SELECT p.id, p.name, p.sku, p.barcode, p.stock, p.unit_of_measure, p.parent_id, p.conversion_factor, p.price, p.cost,
             (SELECT JSON_ARRAYAGG(JSON_OBJECT('unit', unit, 'factor', factor))
              FROM conversion_factors cf
              WHERE cf.product_id = p.id) as conversion_factors
      FROM products p
      WHERE (p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ? OR EXISTS (
        SELECT 1 FROM product_selling_units su WHERE su.product_id = p.id AND su.barcode LIKE ?
      )) AND p.type = 'standard'
      ORDER BY p.name ASC
      LIMIT 20
    `;
    const results = await query(sql, [like, like, like, like]);
    return results.map((r: any) => ({
      id: r.id,
      name: r.name,
      sku: r.sku,
      barcode: r.barcode,
      stock: r.stock,
      unitOfMeasure: r.unit_of_measure,
      parentId: r.parent_id,
      conversionFactor: r.conversion_factor,
      price: parseFloat(r.price) || 0,
      cost: r.cost ? parseFloat(r.cost) : undefined,
      conversionFactors: typeof r.conversion_factors === 'string' ? JSON.parse(r.conversion_factors) : (r.conversion_factors || []),
    }));
  } catch (error) {
    console.error('Error searching products:', error);
    return [];
  }
}
