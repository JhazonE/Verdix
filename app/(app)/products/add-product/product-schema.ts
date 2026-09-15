import { z } from 'zod';

/**
 * Fields shared by every product type.
 *
 * Note the field is `itemType`, not `productType` — `productType` is already
 * taken by the parent/child family selector in use-add-product-form.ts.
 */
const baseProductSchema = z.object({
  name: z.string().min(1, 'Product name is required'),
  brand: z.string().min(1, 'Brand is required'),
  sku: z.string().min(1, 'SKU is required'),
  barcode: z.string().optional(),
  department: z.string().optional(),
  description: z.string().min(1, 'Description is required'),
  additionalDescription: z.string().optional(),
  category: z.string().min(1, 'Category is required'),
  subcategory: z.string().optional(),
  unitOfMeasure: z.string().min(1, 'Unit of measure is required'),
  price: z.coerce.number().positive('Price must be a positive number'),
  incomeAccount: z.string().optional(),
  expenseAccount: z.string().optional(),
  priceLevels: z.array(z.object({
    levelId: z.string().min(1, 'Price level is required'),
    price: z.number().min(0, 'Price cannot be negative'),
    minQuantity: z.number().min(0).optional(),
  })).optional(),
  vatStatus: z.string().default('YES (Subject to 12% VAT)'),
  availability: z.string().default('Available'),
  earnsPoints: z.boolean().default(true),
});

/** Stocked goods — the existing behaviour, unchanged. */
const standardProductSchema = baseProductSchema.extend({
  itemType: z.literal('standard'),
  supplier: z.string().optional(),
  warehouse: z.string().optional(),
  shelfLocationIds: z.array(z.string()).optional(),
  stock: z.coerce.number().int().nonnegative('Initial stock must be a non-negative integer'),
  reorderPoint: z.coerce.number().int().nonnegative().optional().default(0),
  cost: z.coerce.number().positive('Cost is required and must be a positive number'),
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
    cost: z.coerce.number().positive('Cost is required and must be a positive number'),
    price: z.coerce.number().nonnegative('Price must be non-negative'),
    /**
     * This unit's own price-level overrides. A blank price on the form means
     * no override at all — never a coerced 0 — so this array simply omits
     * that level's entry rather than carrying a 0-valued row.
     */
    priceLevels: z.array(z.object({
      levelId: z.string(),
      price: z.number().min(0).optional(),
      minQuantity: z.number().min(0).optional(),
    })).optional(),
  })).optional(),
  isPerishable: z.boolean().optional(),
});

/**
 * Services — no stock, no batches, no family.
 *
 * `cost` is required here too (same as standard products), but unlike a
 * standard product's cost it is allowed to be 0 — a pure-margin service with
 * no input cost is a real, valid case, the user just has to say so
 * explicitly rather than leave the field blank.
 *
 * Stock and family fields are pinned to constants rather than omitted so a
 * service with stock is unrepresentable even if the UI is bypassed.
 */
const serviceProductSchema = baseProductSchema.extend({
  itemType: z.literal('service'),
  cost: z.coerce.number().nonnegative('Cost is required for services (enter 0 if there is no input cost)'),
  stock: z.literal(0).default(0),
  reorderPoint: z.literal(0).default(0),
  supplier: z.undefined(),
  warehouse: z.undefined(),
  shelfLocationIds: z.undefined(),
  parentId: z.undefined(),
  conversionFactor: z.undefined(),
  conversionFactors: z.undefined(),
  sellingUnits: z.undefined(),
  isPerishable: z.undefined(),
});

export const productSchema = z.discriminatedUnion('itemType', [
  standardProductSchema,
  serviceProductSchema,
]);

export type ProductFormValues = z.infer<typeof productSchema>;
export type StandardProductValues = z.infer<typeof standardProductSchema>;
export type ServiceProductValues = z.infer<typeof serviceProductSchema>;
