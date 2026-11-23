export interface VoidRecord {
  refNo: string;
  siNo: string;
  /** Where the SALE came from — what the POS / Backoffice filter selects. */
  saleSource: 'pos' | 'backoffice';
  /** Where the void happened: at a POS terminal, or from Sales → Invoices. */
  source: 'POS' | 'Back Office';
  transDate: string;
  customer: string;
  cashier: string;
  voidDate: string;
  voidedBy: string;
  overrideBy: string;
  salesAmount: number;
  cost: number;
  profit: number;
  vatableSales: number;
  vatAmount: number;
  note: string;
}

export const formatCurrency = (value: number) =>
  `₱${value.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
