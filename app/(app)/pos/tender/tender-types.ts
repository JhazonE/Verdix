import type { SaleItem } from '../pos-content/pos-types';
import type { Customer, SystemSettings } from '@/lib/types';

export interface TenderDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  paymentMethod: string;
  totalDue: number;
  items: SaleItem[];
  customer: Customer | null;
  currentUser: any;
  onSuccess: (paymentMethod: string, amount: number) => void;
  shiftId: string | null;
  terminalId: string;
  terminalMin?: string;
  terminalSerialNumber?: string;
  terminalPermitNo?: string;
  terminalAccreditationNo?: string;
  terminalPermitDateIssued?: string;
  terminalName?: string;
  isTrainingMode?: boolean;
  paymentMethods: { id: string; name: string; isReferenceRequired?: boolean; pointsAmount?: number; currencyEquivalent?: number }[];
  printMode: 'browser' | 'escpos' | 'usb' | 'native';
  settings?: SystemSettings | null;
  onTriggerCustomerSelection?: () => void;
  onCheckoutComplete?: (change: number, orNumber: string) => void;
}

export type ViewType = 'tender' | 'receipt' | 'change' | 'print_prompt';

export interface Payment {
  id: string;
  method: string;
  amount: number;
  reference?: string;
}

export interface CompletedSale {
  items: SaleItem[];
  customer: Customer | null;
  totalDue: number;
  change: number;
  paymentMethod: string;
  payments: Payment[];
  orderNumber: string;
  siNumber?: string;
  amountTendered: number;
  transactionDate: Date;
  cashierName: string;
  pointsEarned: number;
  pointsUsedCount: number;
  pointsUsedValue: number;
  pointsBalance: number;
  terminalMin?: string;
  terminalSerialNumber?: string;
  terminalPermitNo?: string;
  terminalAccreditationNo?: string;
  terminalPermitDateIssued?: string;
  terminalName?: string;
  isTrainingMode?: boolean;
  taxBreakdown: {
    vatableSales: number;
    vatAmount: number;
    vatExemptSales: number;
    zeroRatedSales: number;
    nonVatSales: number;
  };
}
