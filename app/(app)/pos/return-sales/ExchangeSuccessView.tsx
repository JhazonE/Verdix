'use client';

import { Button } from '@/components/ui/button';
import { SheetFooter } from '@/components/ui/sheet';
import { Printer, CheckCircle2 } from 'lucide-react';
import { peso } from './return-sales-utils';

interface ExchangeSuccessViewProps {
  mcNumber: string;
  siNumber: string | null;
  balance: number;
  onClose: () => void;
  onPrint: () => void;
}

export function ExchangeSuccessView({ mcNumber, siNumber, balance, onClose, onPrint }: ExchangeSuccessViewProps) {
  const isEven = Math.abs(balance) < 0.005;
  const isUpsell = balance > 0.005;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-950">
          <CheckCircle2 className="h-9 w-9 text-green-600" />
        </div>
        <h2 className="mt-4 text-xl font-bold">Exchange Complete</h2>
        <div className="mt-4 space-y-1 text-sm text-muted-foreground">
          <p>MC No.: <span className="font-mono font-medium text-foreground">{mcNumber}</span></p>
          {siNumber && <p>SI No.: <span className="font-mono font-medium text-foreground">{siNumber}</span></p>}
        </div>
        {!isEven && (
          <p className="mt-3 text-sm">
            {isUpsell ? 'Payment Collected: ' : 'Credited to Customer: '}
            <span className="font-mono font-bold">{peso(Math.abs(balance))}</span>
          </p>
        )}
      </div>
      <SheetFooter className="shrink-0 flex-col gap-2 sm:flex-row">
        <Button className="w-full sm:w-auto" variant="outline" onClick={onPrint}>
          <Printer className="mr-2 h-4 w-4" />
          Print Exchange Slip
        </Button>
        <Button className="w-full sm:w-auto" onClick={onClose}>Close</Button>
      </SheetFooter>
    </div>
  );
}
