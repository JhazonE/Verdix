'use client';

import { DateRange } from 'react-day-picker';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { TerminalSelector } from '@/components/TerminalSelector';
import { usePaymentMethods } from '@/hooks/use-api';

type PaymentTypeDialogProps = {
  open: boolean;
  onClose: () => void;
  tempPaymentType: string;
  setTempPaymentType: (v: string) => void;
  onApply: () => void;
};
export function PaymentTypeFilterDialog({ open, onClose, tempPaymentType, setTempPaymentType, onApply }: PaymentTypeDialogProps) {
  const { paymentMethods } = usePaymentMethods();
  const options = ['all', ...paymentMethods.map(pm => pm.name)];
  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-xs">
        <DialogHeader><DialogTitle>Filter by Payment Type</DialogTitle></DialogHeader>
        <RadioGroup value={tempPaymentType} onValueChange={setTempPaymentType} className="gap-3 mt-2">
          {options.map(t => (
            <div key={t} className="flex items-center gap-2">
              <RadioGroupItem value={t} id={`pt-${t}`} />
              <Label htmlFor={`pt-${t}`} className="cursor-pointer capitalize">{t === 'all' ? 'All Types' : t}</Label>
            </div>
          ))}
        </RadioGroup>
        <DialogFooter className="mt-4">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={onApply}>Apply</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type TerminalDialogProps = {
  open: boolean;
  onClose: () => void;
  tempTerminalId: string;
  setTempTerminalId: (v: string) => void;
  onApply: () => void;
};
export function TerminalFilterDialog({ open, onClose, tempTerminalId, setTempTerminalId, onApply }: TerminalDialogProps) {
  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-xs">
        <DialogHeader><DialogTitle>Filter by Terminal</DialogTitle></DialogHeader>
        <div className="mt-2">
          <TerminalSelector terminalId={tempTerminalId} onTerminalChange={setTempTerminalId} showAllOption />
        </div>
        <DialogFooter className="mt-4">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={onApply}>Apply</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type DateRangeDialogProps = {
  open: boolean;
  onClose: () => void;
  tempDateRange: DateRange | undefined;
  setTempDateRange: (v: DateRange | undefined) => void;
  onApply: () => void;
};
export function DateRangeFilterDialog({ open, onClose, tempDateRange, setTempDateRange, onApply }: DateRangeDialogProps) {
  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Filter by Date Range</DialogTitle></DialogHeader>
        <Calendar
          mode="range"
          selected={tempDateRange}
          onSelect={setTempDateRange}
          numberOfMonths={1}
          className="mt-2"
        />
        <DialogFooter className="mt-2">
          <Button variant="outline" size="sm" onClick={() => setTempDateRange(undefined)}>Clear</Button>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={onApply}>Apply</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
