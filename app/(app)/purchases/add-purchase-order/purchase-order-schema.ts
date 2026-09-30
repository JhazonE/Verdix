import { z } from 'zod';

export const purchaseOrderItemSchema = z.object({
  productId: z.string().min(1),
  productName: z.string().min(1),
  quantity: z.coerce.number().positive(),
  cost: z.coerce.number().nonnegative(),
  sellingPrice: z.coerce.number().nonnegative().optional(),
  discount: z.coerce.number().nonnegative().optional(),
  discountType: z.enum(['amount', 'percentage']).optional(),
  vatSubject: z.boolean().optional(),
  barcode: z.string().optional(),
  currentStock: z.coerce.number().optional(),
  avgDailySales: z.coerce.number().optional(),
  reorderPoint: z.coerce.number().optional(),
  expirationDate: z.string().optional(),
  sellingUnitId: z.string().optional(),
  sellingUnitName: z.string().optional(),
  sellingUnitFactor: z.coerce.number().positive().optional(),
});

export const purchaseOrderSchema = z.object({
  purchaseType: z.string().min(1, 'Purchase type is required'),
  issueDate: z.string().min(1, 'Issue date is required'),
  deliveryDate: z.string().optional(),
  reference: z.string().optional(),
  supplierId: z.string().min(1, 'Supplier is required'),
  shipping: z.coerce.number().nonnegative().optional(),
  receiveToWarehouse: z.string().min(1, 'Reception warehouse is required'),
  deliveryAddress: z.string().optional(),
  paymentMethod: z.string().min(1, 'Payment method is required'),
  note: z.string().optional(),
  items: z.array(purchaseOrderItemSchema).min(1, 'At least one item is required'),
});

export type PurchaseOrderFormValues = z.infer<typeof purchaseOrderSchema>;
