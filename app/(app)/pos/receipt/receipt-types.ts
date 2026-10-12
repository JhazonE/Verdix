import type { SaleItem } from '../pos-content/pos-types';
import type { Customer, SystemSettings } from '@/lib/types';

/**
 * What a receipt line actually needs to render. Deliberately NOT `SaleItem`:
 * that is the POS *cart* line type and carries `lineId`, a cart-only identity
 * that a receipt never prints. Reprints map a persisted `Sale` back into
 * receipt lines (see `mapSaleToReceiptDetails`) and have no cart line to
 * borrow an id from, so requiring `lineId` here only forced that path to
 * invent one. A live cart's `SaleItem` structurally satisfies this.
 */
export type ReceiptLineItem = Pick<
  SaleItem,
  'name' | 'price' | 'quantity' | 'discount'
> &
  Partial<
    Pick<
      SaleItem,
      // Tax + statutory-discount fields read by `useReceipt` to compute the
      // VAT breakdown and the senior/PWD ID block.
      | 'taxType'
      | 'vatStatus'
      | 'discountType'
      | 'discountIdNumber'
      | 'discountHolderName'
      // Read by `receiptLineQuantity` to show a non-base unit as an equivalence.
      | 'selectedSellingUnit'
      | 'unitOfMeasure'
      | 'sellingUnits'
    >
  >;

export interface ReceiptViewProps {
  saleDetails: {
    items: ReceiptLineItem[];
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
