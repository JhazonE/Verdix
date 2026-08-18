export interface EndShiftDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onShiftEnd: (data: { actualCash: number; cashDifference: number; notes: string; cashDenominations: any[] }) => void;
  startingCash: number;
  cashSales: number;
  otherPaymentMethods?: { name: string; amount: number }[];
  membershipCash?: number;
  cashIn?: number;
  cashOut?: number;
}

export const billDenominations = [
  { value: 1000, label: '₱1,000' },
  { value: 500,  label: '₱500' },
  { value: 200,  label: '₱200' },
  { value: 100,  label: '₱100' },
  { value: 50,   label: '₱50' },
  { value: 20,   label: '₱20' },
];

export const coinDenominations = [
  { value: 10,   label: '₱10 Coin' },
  { value: 5,    label: '₱5 Coin' },
  { value: 1,    label: '₱1 Coin' },
  { value: 0.25, label: '₱0.25 Coin' },
  { value: 0.05, label: '₱0.05 Coin' },
  { value: 0.01, label: '₱0.01 Coin' },
];
