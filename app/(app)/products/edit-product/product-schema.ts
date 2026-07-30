import { z } from 'zod';

export const productSchema = z.object({
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
  cost: z.coerce.number().nonnegative("Cost must be non-negative").optional(),
  incomeAccount: z.string().optional(),
  expenseAccount: z.string().optional(),
  conversionFactor: z.coerce.number().positive('Conversion factor must be positive').optional(),
  conversionFactors: z.array(z.object({
    unit: z.string(),
    factor: z.coerce.number().positive('Conversion factor must be positive'),
  })).transform(arr => arr.filter(cf => cf.unit.trim() !== '')),
  priceLevels: z.array(z.object({
    levelId: z.string().min(1, 'Level is required'),
    calculationBase: z.enum(['retail', 'cost']).default('retail'),
    price: z.coerce.number().positive('Price must be positive'),
    minQuantity: z.number().min(0).optional(),
  })).optional(),
  vatStatus: z.string().default('YES (Subject to 12% VAT)'),
  availability: z.string().default('Available'),
  earnsPoints: z.boolean().default(true),
  isPerishable: z.boolean().optional(),
});

export type ProductFormValues = z.infer<typeof productSchema>;
