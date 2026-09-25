export interface ReturnSalesDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  currentUser?: any;
  terminalId?: string;
  printMode: 'browser' | 'escpos' | 'usb' | 'native';
  paymentMethods: { id: string; name: string; isReferenceRequired?: boolean }[];
  warehouseId?: string;
  activeLevelId?: string;
}

export interface ExchangeReplacementItem {
  product: import('@/lib/types').Product;
  quantity: number;
  sellingUnitId?: string;
}

export interface ExchangeResult {
  /** null in training mode — the route skips the real MC series, as for SI. */
  mcNumber: string | null;
  siNumber: string | null;
  balance: number;
}
