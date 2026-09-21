export interface SaleEntity {
  id: string;
  customerId: string;
  reference?: string;
  receiptNumber?: string;
  invoiceDate: string;
  dueDate?: string;
  total: number;
  /** 12% VAT summed across this sale's vatable lines. Already folded into `total`. */
  vatAmount?: number;
  paymentMethod: string;
  paymentReference?: string;
  status: 'Paid' | 'Pending' | 'Failed' | 'Shipped' | 'Delivered' | 'Returned' | 'Voided' | 'To Deliver' | 'Fully Delivered';
  transactionSource: 'POS' | 'Backoffice';
  notes?: string;
  orderNumber?: number;
  items: SaleItemEntity[];
  createdAt?: string;
  updatedAt?: string;
}

export interface SaleItemEntity {
  id: string;
  saleId: string;
  productId: string;
  productName: string;
  quantity: number;
  price: number;
  sku?: string;
  barcode?: string;
  createdAt?: string;
  /** The selling unit this line was sold in. Undefined/null means base unit. */
  sellingUnitId?: string | null;
  sellingUnitName?: string | null;
  sellingUnitFactor?: number | null;
  /** Whether this line charged 12% VAT — the submitted per-line override, not re-derived from the product. */
  vatable?: boolean;
}
