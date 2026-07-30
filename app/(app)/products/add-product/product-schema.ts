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
    calculationBase: z.enum(['retail', 'cost']).default('retail'),
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
  cost: z.coerce.number().nonnegative('Cost must be non-negative').optional(),
  parentId: z.string().optional(),
  conversionFactor: z.coerce.number().positive('Conversion factor must be positive').optional(),
  conversionFactors: z.array(z.object({
    unit: z.string().min(1, 'Unit is required'),
    factor: z.coerce.number().positive('Factor must be positive'),
  })).optional(),
  isPerishable: z.boolean().optional(),
});

/**
 * Services — no stock, no batches, no family.
 *
 * `cost` is REQUIRED here even though it is optional for standard products:
 * standard products fall back to FIFO batch cost, services have no such
 * fallback, and a blank cost would write NULL to sale_items.cost_at_sale and
 * break profit reporting. Zero is allowed — a pure-margin service is valid,
 * the user just has to say so explicitly.
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
  isPerishable: z.undefined(),
});

export const productSchema = z.discriminatedUnion('itemType', [
  standardProductSchema,
  serviceProductSchema,
]);

export type ProductFormValues = z.infer<typeof productSchema>;
export type StandardProductValues = z.infer<typeof standardProductSchema>;
export type ServiceProductValues = z.infer<typeof serviceProductSchema>;
