import type { Product } from '@/lib/types';
import type { CartSellingUnit } from '@/lib/pos-cart-units';

export { mapVatStatusToTaxType } from '@/lib/tax-utils';

export type QueuedOrder = {
  id: string;
  queueNumber: number;
  dailyQueueNumber: number;
  items: SaleItem[];
  customerId?: string;
  customerName: string;
  queueNotes?: string;
  fronlinerId: string;
  frontlinerName: string;
  terminalId?: string;
  terminalName?: string;
  shiftId?: string;
  status: 'pending' | 'claimed';
  createdAt: string;
};

export type SuspendedTransaction = {
  id: string;
  items: SaleItem[];
  note: string;
  timestamp: string;
};

export type SaleItem = Product & {
  quantity: number;
  discount: number;
  discountType?: string;
  discountIdNumber?: string;
  discountHolderName?: string;
  name: string;
  taxType?: 'VAT' | 'NON_VAT' | 'ZERO_RATED' | 'VAT_EXEMPT';
  /**
   * The selling unit this line is priced and will be sold as. Defaults to
   * the product's base unit on add (see `resolveSellingUnitForAdd`).
   * Undefined for a service line, which carries no selling units at all.
   */
  selectedSellingUnit?: CartSellingUnit;
  /**
   * Unique per cart LINE, not per product — `id` is the product id and is
   * shared by two lines of the same product on different selling units.
   * Generated once when a line is created; never recomputed or reused.
   */
  lineId: string;
};

