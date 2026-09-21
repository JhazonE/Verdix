import { z } from 'zod';

export const salesInvoiceItemSchema = z.object({
  product: z.any(),
  quantity: z.coerce.number().positive(),
  price: z.coerce.number().nonnegative(),
  sellingUnitId: z.string().optional(),
  sellingUnitName: z.string().optional(),
  sellingUnitFactor: z.coerce.number().positive().optional(),
  /**
   * Whether this specific line charges VAT. Defaults from the product's own
   * vatStatus when added to the cart, but staff can override it per line
   * (e.g. a normally-VATable product sold VAT-exempt for a special case).
   */
  vatable: z.boolean(),
});

export const salesInvoiceSchema = z.object({
  customer: z.any().refine(val => val && typeof val === 'object' && val.id, 'Customer is required'),
  invoiceDate: z.string().min(1, 'Invoice date is required'),
  deliveryDate: z.string().optional(),
  dueDate: z.string().optional(),
  reference: z.string().optional(),
  paymentReference: z.string().optional(),
  deliveryAddress: z.string().optional(),
  paymentMethod: z.string().min(1, 'Payment method is required'),
  shipping: z.coerce.number().nonnegative().optional(),
  warehouse: z.string().optional(),
  note: z.string().optional(),
  items: z.array(salesInvoiceItemSchema).min(1, 'At least one item is required'),
});

export type SalesInvoiceFormValues = z.infer<typeof salesInvoiceSchema>;
