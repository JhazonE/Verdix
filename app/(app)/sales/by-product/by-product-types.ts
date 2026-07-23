export type ProductSalesData = {
  product: {
    id: string;
    name: string;
    sku: string;
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
  date: string;
  customer: { name: string };
  quantity: number;
  price: number;
  total: number;
  paymentMethod: string;
  cashier: string;
  items: any[];
};
