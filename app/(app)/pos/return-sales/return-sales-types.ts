export interface ReturnSalesDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  currentUser?: any;
  terminalId?: string;
  printMode: 'browser' | 'escpos' | 'usb' | 'native';
}

export interface ExchangeReplacementItem {
  product: import('@/lib/types').Product;
  quantity: number;
  sellingUnitId?: string;
}

export interface ExchangeResult {
  mcNumber: string;
  siNumber: string | null;
  balance: number;
}
