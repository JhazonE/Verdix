import { z } from 'zod';

export const salesOrderItemSchema = z.object({
  product: z.object({
    id: z.coerce.string().min(1, 'Product ID is required'),
    name: z.string().min(1, 'Product name is required'),
    sku: z.string().optional(),
    stock: z.coerce.number().optional(),
  }).passthrough(),
  quantity: z.coerce.number().positive('Quantity must be greater than 0'),
  price: z.coerce.number().nonnegative('Price cannot be negative'),
  sellingUnitId: z.string().optional(),
  sellingUnitName: z.string().optional(),
  sellingUnitFactor: z.coerce.number().positive().optional(),
  /**
   * Whether this specific line charges VAT. Defaults from the product's own
   * vatStatus when added to the cart, but staff can override it per line.
   */
  vatable: z.boolean(),
});

export const salesOrderSchema = z.object({
  customer: z.object({
    id: z.string().min(1, 'Customer is required'),
    name: z.string().min(1, 'Customer name is required'),
  }, { required_error: 'Please select a customer' }),
  orderDate: z.string().min(1, 'Order date is required'),
  deliveryDate: z.string().optional(),
  reference: z.string().optional(),
  deliveryAddress: z.string().optional(),
  paymentMethod: z.string().min(1, 'Payment method is required'),
  paymentReference: z.string().optional(),
  shipping: z.coerce.number().nonnegative().optional(),
  warehouse: z.string().optional(),
  salesPersonId: z.string().optional(),
  note: z.string().optional(),
  items: z.array(salesOrderItemSchema).min(1, 'At least one item is required'),
});

export type SalesOrderFormValues = z.infer<typeof salesOrderSchema>;
