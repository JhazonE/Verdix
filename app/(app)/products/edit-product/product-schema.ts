import { z } from 'zod';

/**
 * Only name, barcode, description, unit of measure and price are required on
 * this form. Cost, brand, category and warehouse are all optional now, and
 * none of them differ by item type any more, so `isService` no longer changes
 * the shape — the parameter and the builder are kept so the many call sites
 * (and `ProductFormValues`) stay unchanged, and so a future type-dependent
 * rule has somewhere to go.
 */
export function buildProductSchema(_isService: boolean) {
  const costField = z.coerce.number().nonnegative('Cost cannot be negative').optional();

  return z.object({
    name: z.string().min(1, 'Product name is required'),
    brand: z.string().optional(),
    department: z.string().optional(),
    barcode: z.string().min(1, 'Barcode is required'),
    description: z.string().min(1, 'Description is required'),
    additionalDescription: z.string().optional(),
    category: z.string().optional(),
    subcategory: z.string().optional(),
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
    priceLevels: z.array(z.object({
      levelId: z.string().min(1, 'Level is required'),
      price: z.coerce.number().nonnegative('Price must be non-negative'),
      minQuantity: z.coerce.number().int('Minimum quantity must be a whole number').nonnegative('Minimum quantity cannot be negative').optional(),
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
