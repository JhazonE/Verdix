import { z } from 'zod';

/**
 * Fields shared by every product type.
 *
 * Note the field is `itemType`, not `productType` — `productType` is already
 * taken by the parent/child family selector in use-add-product-form.ts.
 */
const baseProductSchema = z.object({
  name: z.string().min(1, 'Product name is required'),
  brand: z.string().optional(),
  barcode: z.string().min(1, 'Barcode is required'),
  department: z.string().optional(),
  description: z.string().min(1, 'Description is required'),
  additionalDescription: z.string().optional(),
  category: z.string().optional(),
  subcategory: z.string().optional(),
  unitOfMeasure: z.string().min(1, 'Unit of measure is required'),
  price: z.coerce.number().positive('Price must be a positive number'),
  incomeAccount: z.string().optional(),
  expenseAccount: z.string().optional(),
  priceLevels: z.array(z.object({
    levelId: z.string().min(1, 'Price level is required'),
    price: z.number().min(0, 'Price cannot be negative'),
    minQuantity: z.coerce.number().int('Minimum quantity must be a whole number').nonnegative('Minimum quantity cannot be negative').optional(),
  })).optional(),
  vatStatus: z.string().default('YES (Subject to 12% VAT)'),
  availability: z.string().default('Available'),
  earnsPoints: z.boolean().default(true),
});

/** Stocked goods — the existing behaviour, unchanged. */
const standardProductSchema = baseProductSchema.extend({
  itemType: z.literal('standard'),
  warehouse: z.string().optional(),
  /**
   * Extra warehouses to stock this same item in, each with its own opening
   * quantity. Verdix keeps ONE `products` row per warehouse (see
   * TransferStockService), so each entry here becomes a sibling product row
   * rather than a column on this one.
   *
   * `warehouse` above stays the primary row: it owns the base selling unit's
   * barcode, because `product_selling_units.barcode` is UNIQUE globally.
   */
  additionalWarehouses: z.array(z.object({
    warehouseId: z.string().min(1, 'Pick a warehouse'),
    stock: z.coerce.number().int().nonnegative('Initial stock must be a non-negative integer').optional().default(0),
  })).optional(),
  shelfLocationIds: z.array(z.string()).optional(),
  /**
   * Blank means zero, not "missing" — the field shows a `0` placeholder
   * rather than a pre-filled 0 so the user can type over it without first
   * clearing it, and leaving it alone creates the product with no stock.
   */
  stock: z.coerce.number().int().nonnegative('Initial stock must be a non-negative integer').optional().default(0),
  reorderPoint: z.coerce.number().int().nonnegative().optional().default(0),
  cost: z.coerce.number().nonnegative('Cost cannot be negative').optional(),
  parentId: z.string().optional(),
  conversionFactor: z.coerce.number().positive('Conversion factor must be positive').optional(),
  /**
   * Legacy repackaging conversions. Kept because inventory repackaging and the
   * view-product dialog still read `conversion_factors`; Task 7d retires them
   * after auditing the raw-SQL readers.
   */
  conversionFactors: z.array(z.object({
    unit: z.string().min(1, 'Unit is required'),
    factor: z.coerce.number().positive('Factor must be positive'),
  })).optional(),
  /**
   * Extra ways this product can be sold, beyond its base unit.
   *
   * The base unit itself is NOT in this list — it is derived from
   * `unitOfMeasure`/`price`/`cost` and written with factor 1 by addProduct, the
   * same shape migration 119 gave every existing product.
   *
   * `factor` must be strictly positive: a 0 factor would make every quantity
   * converted through it zero, silently deducting no stock.
   */
  sellingUnits: z.array(z.object({
    name: z.string().min(1, 'Unit name is required'),
    factor: z.coerce.number().positive('Quantity must be greater than 0'),
    barcode: z.string().optional(),
    cost: z.coerce.number().nonnegative('Cost cannot be negative').optional(),
    price: z.coerce.number().nonnegative('Price must be non-negative'),
    /**
     * This unit's own price-level overrides. A blank price on the form means
     * no override at all — never a coerced 0 — so this array simply omits
     * that level's entry rather than carrying a 0-valued row.
     *
     * `minQuantity` is the quantity tier the override applies from, counted
     * in THIS unit's terms (3 Cases, not 180 pieces). Blank or 0 means no
     * tier, so the override applies from quantity 1.
     */
    priceLevels: z.array(z.object({
      levelId: z.string(),
      price: z.number().min(0).optional(),
      minQuantity: z.coerce.number().int('Minimum quantity must be a whole number').nonnegative('Minimum quantity cannot be negative').optional(),
    })).optional(),
  })).optional(),
  isPerishable: z.boolean().optional(),
  /**
   * Suppliers this product can be sourced from, beyond the single `supplier`
   * field above. `supplier` still drives markup precedence (see purchase-utils.ts);
   * these are additional per-supplier SKU/lead-time/ROP/cost records written
   * to supplier_product_mapping by addProduct in the same transaction as the
   * product itself. At most one entry may have `isPrimary: true`.
   */
  supplierMappings: z.array(z.object({
    supplierId: z.string().min(1, 'Supplier is required'),
    supplierSku: z.string().optional(),
    leadTime: z.coerce.number().int().nonnegative(),
    rop: z.coerce.number().int().nonnegative(),
    cost: z.coerce.number().nonnegative().optional(),
    isPrimary: z.boolean().default(false),
  })).optional(),
});

/**
 * Services — no stock, no batches, no family.
 *
 * `cost` is optional here, same as for a standard product: a pure-margin
 * service with no input cost is a real case, and a blank cost is stored as
 * NULL rather than being blocked at the form.
 *
 * Stock and family fields are pinned to constants rather than omitted so a
 * service with stock is unrepresentable even if the UI is bypassed.
 */
const serviceProductSchema = baseProductSchema.extend({
  itemType: z.literal('service'),
  cost: z.coerce.number().nonnegative('Cost cannot be negative').optional(),
  stock: z.literal(0).default(0),
  reorderPoint: z.literal(0).default(0),
  warehouse: z.undefined(),
  additionalWarehouses: z.undefined(),
  shelfLocationIds: z.undefined(),
  parentId: z.undefined(),
  conversionFactor: z.undefined(),
  conversionFactors: z.undefined(),
  sellingUnits: z.undefined(),
  isPerishable: z.undefined(),
  supplierMappings: z.undefined(),
});

export const productSchema = z.discriminatedUnion('itemType', [
  standardProductSchema,
  serviceProductSchema,
]);

export type ProductFormValues = z.infer<typeof productSchema>;
export type StandardProductValues = z.infer<typeof standardProductSchema>;
export type ServiceProductValues = z.infer<typeof serviceProductSchema>;
