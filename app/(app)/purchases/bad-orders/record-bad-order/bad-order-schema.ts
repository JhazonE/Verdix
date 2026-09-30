import { z } from 'zod';

export const badOrderItemSchema = z.object({
  productId: z.string().min(1),
  productName: z.string().min(1),
  quantity: z.coerce.number().positive(),
  cost: z.coerce.number().nonnegative(),
  reason: z.string().min(1, 'Reason is required'),
  description: z.string().optional().default(''),
  barcode: z.string().optional(),
  currentStock: z.coerce.number().optional(),
  sellingUnitId: z.string().optional(),
  sellingUnitName: z.string().optional(),
  sellingUnitFactor: z.coerce.number().positive().optional(),
});

export const badOrderSchema = z.object({
  reportedBy: z.string().min(1, 'Reported by is required'),
  supplierId: z.string().optional().nullable(),
  supplierName: z.string().optional().nullable(),
  warehouseId: z.string().optional().nullable(),
  shelfId: z.string().optional().nullable(),
  notes: z.string().optional(),
  items: z.array(badOrderItemSchema).min(1, 'At least one item is required'),
});

export type BadOrderFormValues = z.infer<typeof badOrderSchema>;
