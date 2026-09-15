import { z } from 'zod';

/**
 * A service product's cost may legitimately be 0 (a pure-margin service with
 * no input cost) — a standard product's may not (every stocked good has a
 * real acquisition cost). Since this form has no `itemType` field of its own
 * (the product's type is immutable after creation and lives outside the
 * form's values, read straight from the `product` prop), the schema is built
 * per-instance by `buildProductSchema`, called once at `useForm` setup where
 * that type is already known, rather than baked in as a static constant.
 */
export function buildProductSchema(isService: boolean) {
  const costField = isService
    ? z.coerce.number().nonnegative('Cost is required for services (enter 0 if there is no input cost)')
    : z.coerce.number().positive('Cost is required and must be a positive number');

  return z.object({
    name: z.string().min(1, 'Product name is required'),
    brand: z.string().min(1, 'Brand is required'),
    department: z.string().optional(),
    sku: z.string().min(1, 'SKU is required'),
    barcode: z.string().optional(),
    description: z.string().min(1, 'Description is required'),
    additionalDescription: z.string().optional(),
    category: z.string().min(1, 'Category is required'),
    subcategory: z.string().optional(),
    supplier: z.string().optional(),
    warehouse: z.string().optional(),
    shelfLocationIds: z.array(z.string()).optional(),
    isSerialized: z.boolean().default(false),
    unitOfMeasure: z.string().min(1, 'Unit of measure is required'),
    reorderPoint: z.coerce.number().int().nonnegative().optional().default(0),
    price: z.coerce.number().positive("Price must be a positive number"),
    cost: costField,
    incomeAccount: z.string().optional(),
    expenseAccount: z.string().optional(),
    conversionFactor: z.coerce.number().positive('Conversion factor must be positive').optional(),
    conversionFactors: z.array(z.object({
      unit: z.string(),
      factor: z.coerce.number().positive('Conversion factor must be positive'),
    })).transform(arr => arr.filter(cf => cf.unit.trim() !== '')),
    /**
     * Extra ways this product can be sold, beyond its base unit.
     *
     * The base unit is excluded here and edited through the product's own
     * unit/price/cost fields; updateProduct keeps its factor at 1 and is_base at 1.
     */
    sellingUnits: z.array(z.object({
      id: z.string().optional(),
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
    priceLevels: z.array(z.object({
      levelId: z.string().min(1, 'Level is required'),
      price: z.coerce.number().nonnegative('Price must be non-negative'),
      minQuantity: z.number().min(0).optional(),
    })).optional(),
    vatStatus: z.string().default('YES (Subject to 12% VAT)'),
    availability: z.string().default('Available'),
    earnsPoints: z.boolean().default(true),
    isPerishable: z.boolean().optional(),
  });
}

/**
 * A service product has no sellingUnits (the tab that manages them is
 * standard-only), so this static schema — used wherever the caller doesn't
 * yet know the product's type, or genuinely doesn't need the service/standard
 * cost distinction — is the standard-product shape. Prefer
 * `buildProductSchema` directly when the product's type is known.
 */
export const productSchema = buildProductSchema(false);

export type ProductFormValues = z.infer<ReturnType<typeof buildProductSchema>>;
