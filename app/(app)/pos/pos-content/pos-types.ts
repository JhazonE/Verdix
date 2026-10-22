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
  /**
   * Set when a cashier picks a price level for THIS line. It overrides the
   * cart-wide `activeLevelId` and ignores quantity tiers entirely — a picked
   * level applies at any quantity, which is the whole point of the picker.
   *
   * `undefined` means "follow the cart", which is both the default and the
   * correct reading for a cart held before this feature shipped.
   *
   * A plain string, deliberately: the cart crosses JSON four times (the
   * localStorage draft, hold/restore, and the queue claim/recall round trips
   * through app/api/pos/queue), and a scalar survives all of them for free.
   */
  pickedPriceLevelId?: string;
};

