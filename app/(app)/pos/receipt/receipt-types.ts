import type { SaleItem } from '../pos-content/pos-types';
import type { Customer, SystemSettings } from '@/lib/types';

export interface ReceiptViewProps {
  saleDetails: {
    items: SaleItem[];
    customer: Customer | null;
    totalDue: number;
    change: number;
    paymentMethod: string;
    payments?: { method: string; amount: number; reference?: string }[];
    orderNumber?: string;
    siNumber?: number | string;
    birOrNumber?: string;
    amountTendered?: number;
    transactionDate?: Date;
    pointsUsedCount?: number;
    pointsUsedValue?: number;
    pointsBalance?: number;
    cashierName?: string;
    pointsEarned?: number;
    pointsUsed?: number;
    terminalMin?: string;
    terminalSerialNumber?: string;
    terminalPermitNo?: string;
    terminalAccreditationNo?: string;
    terminalPermitDateIssued?: string;
    terminalName?: string;
    isTrainingMode?: boolean;
    isReprint?: boolean;
    paymentReference?: string;
    taxBreakdown?: {
      vatableSales: number;
      vatAmount: number;
      vatExemptSales: number;
      zeroRatedSales: number;
      nonVatSales: number;
    };
  };
  settings?: SystemSettings | null;
}
