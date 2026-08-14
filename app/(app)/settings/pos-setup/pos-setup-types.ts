export interface PosSettings {
  businessName: string;
  operatedBy?: string | null;
  logoPath: string | null;
  transactionPrefix: string;
  address: string | null;
  contactNumber: string | null;
  tin: string | null;
  email: string | null;
  vatRegistration?: 'VAT' | 'NON_VAT';
  currentTerminalId?: string | null;
  currentTerminalName?: string | null;
  enableLineVoidAuth?: boolean;
  lineVoidAuthUsername?: string | null;
  lineVoidAuthPassword?: string | null;
  enableVoidReturnAuth?: boolean;
  voidAuthUsername?: string | null;
  voidAuthPassword?: string | null;
  enableReturnAuth?: boolean;
  returnAuthUsername?: string | null;
  returnAuthPassword?: string | null;
  enableRecentSalesAuth?: boolean;
  recentSalesAuthUsername?: string | null;
  recentSalesAuthPassword?: string | null;
  paperSize?: '58mm' | '80mm';
  printMode?: 'browser' | 'escpos' | 'usb' | 'native';
  enableNegativeInventory?: boolean;
  enableCashCountAuth?: boolean;
  cashCountAuthUsername?: string | null;
  cashCountAuthPassword?: string | null;
  showQuantityInSearch?: boolean;
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
  enableTaxRatesAuth?: boolean;
  taxRatesAuthUsername?: string | null;
  taxRatesAuthPassword?: string | null;
  isTrainingMode?: boolean;
  printTwoReceipts?: boolean;
  nativePrinterName?: string | null;
  requireAdjustmentConfirmation?: boolean;
  requireTransferConfirmation?: boolean;
  requirePurchaseOrderConfirmation?: boolean;
  requireReceiveConfirmation?: boolean;
  requireBadOrderConfirmation?: boolean;
  requireStockCountApproval?: boolean;
  requireRepackagingConfirmation?: boolean;
  requireShelfTransferApproval?: boolean;
  requireProductConfirmation?: boolean;
  requirePriceUpdateConfirmation?: boolean;
  requireZReadingConfirmation?: boolean;
  enforceZReadingLockout?: boolean;
  batchCostingRepackInherit?: boolean;
  batchCostingOversellBlock?: boolean;
  enableOverallReadingAuth?: boolean;
  overallReadingAuthUsername?: string | null;
  overallReadingAuthPassword?: string | null;
  enableCashTransferAuth?: boolean;
  cashTransferAuthUsername?: string | null;
  cashTransferAuthPassword?: string | null;
  enableCustomerDisplay?: boolean;
  customerDisplayMessage?: string | null;
  customerDisplayShowLogo?: boolean;
  salesOrderTerms?: string | null;
  posMode?: 'default' | 'pharmacy';
  membershipFee?: number;
  membershipDurationMonths?: number;
}

export const DEFAULT_POS_SETTINGS: PosSettings = {
  businessName: '',
  operatedBy: '',
  logoPath: null,
  transactionPrefix: 'TXN',
  address: '',
  contactNumber: '',
  tin: '',
  email: '',
  vatRegistration: 'VAT',
  currentTerminalId: null,
  currentTerminalName: null,
  enableLineVoidAuth: false,
  lineVoidAuthUsername: '',
  lineVoidAuthPassword: '',
  enableVoidReturnAuth: false,
  voidAuthUsername: '',
  voidAuthPassword: '',
  enableReturnAuth: false,
  returnAuthUsername: '',
  returnAuthPassword: '',
  enableRecentSalesAuth: false,
  recentSalesAuthUsername: '',
  recentSalesAuthPassword: '',
  paperSize: '58mm',
  printMode: 'browser',
  enableNegativeInventory: false,
  enableCashCountAuth: false,
  cashCountAuthUsername: '',
  cashCountAuthPassword: '',
  showQuantityInSearch: true,
  enablePriceEditAuth: false,
  priceEditAuthUsername: '',
  priceEditAuthPassword: '',
  enableEditItemAuth: false,
  editItemAuthUsername: '',
  editItemAuthPassword: '',
  enableSuspendAuth: false,
  suspendAuthUsername: '',
  suspendAuthPassword: '',
  enableSuspendedAuth: false,
  suspendedAuthUsername: '',
  suspendedAuthPassword: '',
  enableTaxRatesAuth: false,
  taxRatesAuthUsername: '',
  taxRatesAuthPassword: '',
  isTrainingMode: false,
  printTwoReceipts: false,
  nativePrinterName: 'XP-58-P',
  requireAdjustmentConfirmation: false,
  requireTransferConfirmation: false,
  requirePurchaseOrderConfirmation: false,
  requireReceiveConfirmation: false,
  requireBadOrderConfirmation: false,
  requireStockCountApproval: false,
  requireRepackagingConfirmation: false,
  requireShelfTransferApproval: false,
  requireProductConfirmation: false,
  requirePriceUpdateConfirmation: false,
  requireZReadingConfirmation: true,
  enforceZReadingLockout: true,
  batchCostingRepackInherit: true,
  batchCostingOversellBlock: false,
  enableOverallReadingAuth: false,
  overallReadingAuthUsername: '',
  overallReadingAuthPassword: '',
  enableCashTransferAuth: false,
  cashTransferAuthUsername: '',
  cashTransferAuthPassword: '',
  enableCustomerDisplay: false,
  customerDisplayMessage: 'Welcome! Thank you for shopping.',
  customerDisplayShowLogo: true,
  salesOrderTerms: '',
  posMode: 'default',
  membershipFee: 0,
  membershipDurationMonths: 12,
};
