export type OverallReadingData = {
  terminalId: string;
  terminalName: string;
  startDate: string | null;
  endDate: string;
  grossSales: number;
  netSales: number;
  totalDiscounts: number;
  transactionCount: number;
  vatSales: number;
  vatAmount: number;
  vatExempt: number;
  zeroRated: number;
  nonVat: number;
  voidAmount: number;
  voidCount: number;
  returnAmount: number;
  returnCount: number;
  vatAdjustment: number;
  startingCash: number;
  cashSales: number;
  cashInDrawer: number;
  actualCash: number;
  variance: number;
  paymentMethods: Array<{ name: string; amount: number }>;
  discountSummary: Array<{ type: string; amount: number; count: number; itemCount: number }>;
  salesAdjustment: {
    void: { count: number; amount: number };
    return: { count: number; amount: number };
  };
  terminals: Array<{
    terminalId: string;
    terminalName: string;
    netSales: number;
    transactionCount: number;
  }>;
  cashiers: Array<{
    cashierName: string;
    cashierId: string;
    netSales: number;
    transactionCount: number;
  }>;
  businessSettings: {
    businessName: string;
    address: string;
    tin: string;
    contactNumber: string;
    vatRegistration?: 'VAT' | 'NON_VAT';
  };
  terminalInfo: {
    min: string;
    sn: string;
    permitNo?: string;
    accreditationNo?: string;
  };
};

export type PrinterFormat = '58mm' | '80mm' | 'A4';

export interface OverallReadingPreviewProps {
  data: OverallReadingData;
  printerFormat?: PrinterFormat;
}

export const formatCurrency = (amount: number) =>
  (amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
