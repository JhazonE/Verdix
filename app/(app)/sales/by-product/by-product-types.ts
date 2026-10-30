export type ProductSalesData = {
  product: {
    id: string;
    name: string;
    sku: string;
    barcode: string | null;
    category: string;
    brand: string;
    unitOfMeasure: string;
  };
  unitsSold: number;
  totalRevenue: number;
  totalDiscount: number;
  totalCost: number;
  totalProfit: number;
  numberOfSales: number;
  avgPricePerUnit: number;
};

export type TransactionData = {
  /**
   * The sale ID. NOT unique across rows: a return shares the sale_id of the
   * sale it reverses, so a sale and its return both carry this same value.
   * Use `posTransactionId` when a unique identifier is needed.
   */
  id: string;
  /** Unique per transaction row — the sale and its return differ here. */
  posTransactionId: string;
  orderNumber: string;
  /** BIR sales invoice number. Nullable on historical rows. */
  siNumber: string | null;
  date: string;
  customer: { name: string };
  quantity: number;
  price: number;
  total: number;
  paymentMethod: string;
  cashier: string;
  items: TransactionItem[];
};

export type TransactionItem = {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  /** Per selling unit, to sit beside `cost` on the same footing. */
  price: number;
  /** Line total for this item — net of any line discount. */
  total: number;
  /**
   * Cost per SELLING unit, NOT per line: the API resolves it through
   * lib/cost-of-sale so a case is never costed as a bottle. Multiply by
   * `quantity` before comparing it against `total`.
   */
  cost: number;
  discount: number;
};
