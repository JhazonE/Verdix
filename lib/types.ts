export interface Product {
  id: string;
  name: string;
  description: string;
  additionalDescription?: string;
  category: string;
  brand: string;
  department?: string;
  subcategory?: string;
  supplier?: string;
  supplierName?: string;
  stock: number;
  reorderPoint: number;
  avgDailySales: number;
  price: number;
  cost?: number;
  sku: string;
  barcode?: string;
  imageUrl: string;
  imageHint: string;
  unitOfMeasure: string;
  vatStatus?: string;
  availability?: string;
  taxType?: 'VAT' | 'NON_VAT' | 'ZERO_RATED' | 'VAT_EXEMPT';
  earnsPoints?: boolean;
  expirationDate?: string;
  isPerishable?: boolean;
  type?: 'standard' | 'service';

  // Accounting
  incomeAccount?: string;
  expenseAccount?: string;

  // Warehouse
  warehouse?: string;
  warehouseName?: string;
  warehouseId?: string;

  // Shelf Location
  shelfLocationId?: string | null; // @deprecated: Use shelfLocationIds
  shelfLocationIds?: string[];
  shelfLocationName?: string | null; // @deprecated: Use shelfLocationNames
  shelfLocationNames?: string | null;
  shelfQuantities?: Record<string, number>;

  // Parent/Child relationship
  parentId?: string | null;
  conversionFactor?: number;

  // Conversion factors for different units
  conversionFactors?: { unit: string; factor: number }[];

  // Timestamps
  createdAt?: string;
  updatedAt?: string;

  // Price Levels
  priceLevels?: { levelId: string; price: number; minQuantity?: number }[];

  // Supplier Mapping
  primarySupplierRop?: number;
  mappings?: SupplierProductMapping[];

  // Approval status
  hasPendingApproval?: boolean;
}


export interface PriceLevel {
  id: string;
  name: string;
  description?: string;
  isDefault: boolean;
  calculationBase?: 'retail' | 'cost';
  adjustmentType?: 'percentage' | 'fixed'; // 'percentage' (default) or 'fixed' peso amount
  percentageAdjustment?: number; // a percent when adjustmentType is 'percentage', a peso amount when 'fixed'
  minQuantity?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface Customer {
  id: string;
  name: string;
  contactNumber: string;
  active?: boolean;
  salesPerson?: string;
  salesArea?: string;
  salesGroup?: string;
  loyaltyPoints?: number;
  paymentTerms?: string;
  address?: string;
  billingAddress?: string;
  discount?: number;
  creditLimit?: number;
  priceLevelId?: string;
  tin?: string;
}

export interface Supplier {
  id: string;
  name: string;
  contactNumber: string;
  telephone?: string;
  mobilePhone?: string;
  email?: string;
  address?: string;
  company?: string;
  tin?: string;
  paymentTerms?: string;
  markupPercentage?: number;
  orderSchedule?: string;
}

export interface SaleItem {
  product: Product;
  quantity: number;
  /** Total originally sold (before any returns). */
  originalQuantity?: number;
  /** Quantity already returned on this sale. */
  returnedQuantity?: number;
  price: number;
  discount?: number;
}

export interface Sale {
  id: string;
  customer: Customer;
  invoiceDate?: string;
  date?: string;
  dueDate?: string;
  orderDate?: string;
  deliveryDate?: string;
  reference?: string;
  transactionSource?: 'POS' | 'Backoffice';
  deliveryAddress?: string;
  salesPerson?: string;
  salesPersonId?: string;
  items: SaleItem[];
  total: number;
  formattedTotal?: string;
  amountPaid?: number;
  balance?: number;
  paymentMethod: string;
  status: 'Paid' | 'Pending' | 'Failed' | 'Shipped' | 'Delivered' | 'Returned' | 'Voided' | 'To Deliver' | 'Fully Delivered' | 'Invoiced' | 'Cancelled';
  orderNumber?: number;
  siNumber?: number | string;
  notes?: string;
  shipping?: number;
  payments?: { method: string; amount: number; reference?: string }[];
  pointsEarned?: number;
  receiptNo?: string;
  amountTendered?: number;
  change?: number;
  cashierName?: string;
  terminalMin?: string;
  terminalSerialNumber?: string;
  terminalPermitNo?: string;
  terminalAccreditationNo?: string;
  terminalPermitDateIssued?: string;
  pointsUsedCount?: number;
  pointsBalance?: number;
  paymentReference?: string;
  hasInvoice?: boolean;
}

export interface PurchaseOrder {
  id: string;
  supplierId: string;
  supplierName: string;
  date: string;
  items: {
    productId: string;
    productName: string;
    quantity: number;
    cost: number;
    sellingPrice?: number;
    discount?: number;
    discountType?: 'amount' | 'percentage';
    vatSubject?: boolean;
    expirationDate?: string;
    barcode?: string;
    productBarcode?: string;
    sku?: string;
    productSku?: string;
    name?: string;
    currentStock?: number;
    // Landed cost fields (calculated, not stored)
    landedCostPerUnit?: number;
    shippingAllocation?: number;
    landedCostTotal?: number;
  }[];
  total: number;
  paymentMethod: string;
  status: string;
  // New tracking fields
  orderedBy?: string;
  shippingFee?: number;
  vatAmount?: number;
  deliveryDate?: string; // or Date
  receivedTotal?: number;
  referenceNumber?: string;
  grandTotal?: number;
  paidAmount: number;
}

export interface BadOrder {
  id: string;
  purchaseOrderId: string;
  supplierId: string;
  supplierName: string;
  reportedBy?: string;
  reportDate: string;
  status: 'Reported' | 'Return Requested' | 'Replaced' | 'Credited' | 'Resolved';
  totalAffectedValue: number;
  notes?: string;
  resolutionNotes?: string;
  items: BadOrderItem[];
  createdAt?: string;
  updatedAt?: string;
}

export interface BadOrderItem {
  id: string;
  badOrderId: string;
  productId: string;
  productName: string;
  quantity: number;
  cost: number;
  reason: 'Damaged' | 'Defective' | 'Expired' | 'Wrong Item' | 'Missing' | 'Other';
  description?: string;
  createdAt?: string;
}


export interface Category {
  id: string;
  name: string;
  markupPercentage?: number;
  productCount?: number;
}

export interface Department {
  id: string;
  name: string;
  markupPercentage?: number;
}

export interface Brand {
  id: string;
  name: string;
  markupPercentage?: number;
}

export interface PaymentMethod {
  id: string;
  name: string;
  isReferenceRequired?: boolean;
  pointsAmount?: number;
  currencyEquivalent?: number;
}

export interface Warehouse {
  id: string;
  name: string;
  location?: string;
  isActive?: boolean;
  createdAt?: string;
}

export interface ShelfLocation {
  id: string;
  name: string;
  description?: string;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface SalesPerson {
  id: string;
  name: string;
  contactNumber?: string;
  isActive?: boolean;
  createdAt?: string;
}

export interface StockAdjustment {
  id: string;
  productId: string;
  productName?: string;
  product?: Product;
  quantity: number;
  reason: string;
  date: string;
  newStock: number;
  status: 'Pending' | 'Approved' | 'Rejected' | 'Completed';
}

export interface Order {
  id: string;
  customerId: string;
  orderDate: string;
  status: 'Pending' | 'Shipped' | 'Delivered' | 'Canceled';
  total: number;
  items: {
    productId: string;
    productName: string;
    quantity: number;
    price: number;
  }[];
}

export interface SerialNumber {
  id: string; // The serial number itself
  productId: string;
  status: 'In Stock' | 'Sold' | 'Returned';
  dateAdded: string;
  saleId?: string;
}

export interface UnitOfMeasure {
  id: string;
  name: string;
  abbreviation: string;
}

export interface Account {
  id: string;
  name: string;
  type: 'income' | 'expense';
  code?: string;
}

export interface StockMovement {
  id: string;
  productId: string;
  productName: string;
  movementType: 'sale' | 'purchase' | 'adjustment' | 'return' | 'transfer';
  quantityChange: number;
  previousStock: number;
  newStock: number;
  referenceId?: string;
  referenceType?: 'sale' | 'purchase' | 'adjustment' | 'return' | 'transfer';
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}
export interface BusinessProfile {
  businessName: string;
  address: string;
  contactNumber: string;
  email: string;
  tin: string;
  logoPath: string;
}

// POS-specific interfaces
export interface SystemSettings {
  id?: string;
  businessName?: string;
  operatedBy?: string | null;
  address?: string;
  contactNumber?: string;
  tin?: string;
  email?: string;
  vatRegistration?: 'VAT' | 'NON_VAT';
  minNumber?: string | null;
  serialNumber?: string | null;
  logoPath?: string;
  printMode?: 'browser' | 'escpos' | 'usb';
  currencySymbol: string;
  currencyCode: string;
  timezone: string;
  dateFormat: string;
  enableAutomaticMarkup?: boolean;
  defaultMarkupPercentage?: number;
  markupPriority?: string[];
  enablePriceEditAuth?: boolean;
  priceEditAuthUsername?: string | null;
  priceEditAuthPassword?: string | null;
  enableEditItemAuth?: boolean;
  editItemAuthUsername?: string | null;
  editItemAuthPassword?: string | null;
  enableSuspendAuth?: boolean;
  suspendAuthUsername?: string | null;
  suspendAuthPassword?: string | null;
  enableSuspendedAuth?: boolean;
  suspendedAuthUsername?: string | null;
  suspendedAuthPassword?: string | null;
  enableRecentSalesAuth?: boolean;
  recentSalesAuthUsername?: string | null;
  recentSalesAuthPassword?: string | null;
  enableLineVoidAuth?: boolean;
  lineVoidAuthUsername?: string | null;
  lineVoidAuthPassword?: string | null;
  enableVoidReturnAuth?: boolean;
  voidAuthUsername?: string | null;
  voidAuthPassword?: string | null;
  printTwoReceipts?: boolean;
  nativePrinterName?: string;
  paperSize?: '58mm' | '80mm';
  requireAdjustmentConfirmation?: boolean;
  requireTransferConfirmation?: boolean;
  requirePurchaseOrderConfirmation?: boolean;
  requireReceiveConfirmation?: boolean;
  requireBadOrderConfirmation?: boolean;
  requireStockCountApproval?: boolean;
  enableOverallReadingAuth?: boolean;
  overallReadingAuthUsername?: string | null;
  overallReadingAuthPassword?: string | null;
  enableCashTransferAuth?: boolean;
  cashTransferAuthUsername?: string | null;
  cashTransferAuthPassword?: string | null;
  posMode?: 'default' | 'pharmacy';
}

export interface User {
  id: string;
  username: string;
  fullName: string;
  email?: string;
  role: 'admin' | 'cashier' | 'manager';
  isActive: boolean;
  lastLogin?: string;
  createdAt?: string;
  updatedAt?: string;
}


export interface PosTerminal {
  id: string;
  name?: string; // Standard name
  terminalDescription?: string; // Aliased from 'name' in API
  location?: string;
  inventoryLocation?: string; // Aliased from 'location' in API
  ipAddress?: string;
  serialNumber?: string;
  min?: string;
  permitNo?: string;
  printOfficialReceipt?: string; // 'Yes' or 'No'
  orNextReference?: string;
  isActive: boolean;
  zCounter?: number;
  resetCounter?: number;
  lastActive?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Shift {
  id: string;
  userId: string;
  user?: User;
  terminalId?: string;
  terminal?: PosTerminal;
  startTime: string;
  endTime?: string;
  startingCash: number;
  expectedCash: number;
  actualCash: number;
  cashDifference: number;
  status: 'active' | 'completed' | 'reconciled';
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface PosTransaction {
  id: string;
  saleId: string;
  shiftId?: string;
  shift?: Shift;
  userId: string;
  user?: User;
  terminalId?: string;
  terminal?: PosTerminal;
  transactionType: 'sale' | 'void' | 'return' | 'refund';
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  totalAmount: number;
  paymentMethod: string;
  paymentReference?: string;
  customerCount: number;
  transactionTime: string;
  voidReason?: string;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface PosTransactionItem {
  id: string;
  posTransactionId: string;
  saleItemId: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  discountPercentage: number;
  discountAmount: number;
  lineTotal: number;
  createdAt?: string;
}

export interface SupplierProductMapping {
  id: string;
  productId: string;
  supplierId: string;
  supplierName?: string;
  supplierSku?: string;
  supplierLeadTime: number;
  supplierSpecificRop: number;
  supplierCost?: number;
  isPrimary: boolean;
  createdAt?: string;
  updatedAt?: string;
}


export interface TaxRate {
  id: string;
  name: string;
  rate: number;
  description?: string;
  isDefault: boolean;
  createdAt?: string;
  updatedAt?: string;
}


export interface POSSaleItem extends Product {
    quantity: number;
    discount: number;
    name: string;
    discountType?: string;
    discountIdNumber?: string;
    discountHolderName?: string;
    taxType?: 'VAT' | 'NON_VAT' | 'ZERO_RATED' | 'VAT_EXEMPT';
}

export interface ZReadingData {
  id: string;
  date: string;
  reportDate: Date;
  businessName?: string;
  address?: string;
  grossSales: number;
  returns: number;
  discounts: number;
  netSales: number;
  vatSales: number;
  vatAmount: number;
  vatExempt: number;
  zeroRated: number;
  nonVat: number;
  paymentMethods: Array<{ name: string; amount: number; count?: number }>;
  transactionCount: number;
  startingCash: number;
  cashSales: number;
  cashInDrawer: number;
  cashierName?: string;
  terminalId?: string;
  terminalMin?: string;
  terminalSerialNumber?: string;
  terminalPermitNo?: string;
  terminalAccreditationNo?: string;
  terminalPermitDateIssued?: string;
  minSaleId?: string;
  maxSaleId?: string;
  minVoidId?: string;
  maxVoidId?: string;
  minReturnId?: string;
  maxReturnId?: string;
  previousReading?: number;
  runningTotal?: number;
  voidAmount?: number;
  vatAdjustment?: number;
  zCounter?: number;
  resetCounter?: number;
  terminalName?: string;
  intervalStartDate?: string | Date;
  discountSummary?: Array<{ type: string; amount: number; count: number; itemCount?: number }>;
  salesAdjustment?: {
    void: { count: number; amount: number };
    return: { count: number; amount: number };
  };
  vatAdjustmentDetails?: Array<{ type: string; amount: number; vatAmount: number }>;
}



export interface XReadingData {
  id: string;
  date: string;
  reportDate: string;
  shiftStart: string | null;
  shiftEnd: string | null;
  grossSales: number;
  returns: number;
  discounts: number;
  netSales: number;
  vatAmount: number;
  paymentMethods: Array<{ name: string; amount: number; count?: number }>;
  transactionCount: number;
  startingCash: number;
  cashSales: number;
  cashInDrawer: number;
  membershipCash?: number;
  membershipActivationCount?: number;
  membershipRenewalCount?: number;
  cashierName: string;
  cashierId: string;
  terminalId: string;
  shiftStatus: string;
  cashCountId?: string;
  cashDenominations?: Array<{
    amount: number;
    qty: number;
    total: number;
  }>;
  cashDeposit?: number;
  cashPickup?: number;
  cashCountTotal?: number;
  overShort?: number;
  readingNumber?: string;
  minSaleId?: string;
  maxSaleId?: string;
  voidAmount?: number;
  refundAmount?: number;
  min?: string;
  sn?: string;
  permitNo?: string;
  accreditationNo?: string;
  businessName?: string;
  operatedBy?: string | null;
  address?: string;
  tin?: string;
  vatRegistration?: 'VAT' | 'NON_VAT';
  contactNumber?: string;
  email?: string;
  zCounter?: number;
  resetCounter?: number;
  terminalName?: string;
}
