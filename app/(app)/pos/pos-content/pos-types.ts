import type { Product } from '@/lib/types';
import type { CartSellingUnit } from '@/lib/pos-cart-units';

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
};

export function mapVatStatusToTaxType(vatStatus?: string): 'VAT' | 'NON_VAT' | 'ZERO_RATED' | 'VAT_EXEMPT' {
  if (!vatStatus) return 'VAT';
  const status = vatStatus.toUpperCase();
  if (status.includes('SUBJECT TO 12% VAT') || status.includes('YES')) return 'VAT';
  if (status.includes('EXEMPT')) return 'VAT_EXEMPT';
  if (status.includes('ZERO RATED') || status.includes('ZERO-RATED') || status.includes('0%')) return 'ZERO_RATED';
  if (status.includes('NON-VAT') || status.includes('NON VAT') || status.includes('NO VAT')) return 'NON_VAT';
  if (status.startsWith('NO') || status.startsWith('NON')) return 'NON_VAT';
  return 'VAT';
}
