export interface EJSettings {
  businessName?: string;
  address?: string;
  contactNumber?: string;
  tin?: string;
  vatRegistration?: string;   // 'NON_VAT' | 'VAT' | undefined
  minNumber?: string;
  serialNumber?: string;
  paperSize?: string;         // '58mm' | '80mm'
}

export interface EJItem {
  name: string;
  quantity: number;
  price: number;
  discount?: number;          // amount, not percent
  unitOfMeasure?: string;
}

export interface EJSale {
  siNumber: string | number | null;
  birOrNumber: string | null;
  cashierName?: string;
  customerName?: string;
  terminalName?: string;
  dateTime: string;           // ISO
  paymentMethod?: string;
  items: EJItem[];
  total: number;
  vatAmount?: number;
}

export interface EJVoided extends EJSale {
  voidReason?: string;
}

export interface EJCredit {
  creditSiNumber: string | number | null;   // the return transaction's SI
  originalSiNumber: string | number | null;  // the original sale's SI
  cashierName?: string;
  customerName?: string;
  dateTime: string;
  items: EJItem[];
  total: number;
}

export interface EJReading {
  readingNumber: string | number;
  type: 'X' | 'Z';
  reportDate: string;
  terminalId?: string;
  cashierName?: string;
  grossSales: number;
  returns: number;
  discounts: number;
  netSales: number;
  vatAmount: number;
  transactionCount: number;
}

export interface EJournalData {
  settings: EJSettings;
  salesInvoices: EJSale[];
  voided: EJVoided[];
  merchandiseCredits: EJCredit[];
  xReadings: EJReading[];
  zReadings: EJReading[];
}
