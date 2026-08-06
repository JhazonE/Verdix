import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { TerminalSelector } from '@/components/TerminalSelector';
import { usePaymentMethods } from '@/hooks/use-api';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tempInterval: string;
  setTempInterval: (v: string) => void;
  tempTerminal: string;
  setTempTerminal: (v: string) => void;
  tempPaymentType: string;
  setTempPaymentType: (v: string) => void;
  transactionReference: string;
  setTransactionReference: (v: string) => void;
  onApply: () => void;
};

export function ByDateFiltersDialog({
  open, onOpenChange,
  tempInterval, setTempInterval,
  tempTerminal, setTempTerminal,
  tempPaymentType, setTempPaymentType,
  transactionReference, setTransactionReference,
  onApply,
}: Props) {
  const { paymentMethods } = usePaymentMethods();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Filter Options</DialogTitle>
          <DialogDescription className="sr-only">
            Filter sales by date, terminal, and payment method
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Interval</Label>
            <Select value={tempInterval} onValueChange={setTempInterval}>
              <SelectTrigger className="col-span-3">
                <SelectValue placeholder="Select interval" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="hourly">Hourly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Terminal</Label>
            <div className="col-span-3">
              <TerminalSelector
                terminalId={tempTerminal}
                onTerminalChange={setTempTerminal}
                showAllOption={true}
              />
            </div>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Payment</Label>
            <Select value={tempPaymentType} onValueChange={setTempPaymentType}>
              <SelectTrigger className="col-span-3">
                <SelectValue placeholder="Select payment type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Payment Types</SelectItem>
                {paymentMethods.map((pm) => <SelectItem key={pm.id} value={pm.name}>{pm.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Reference</Label>
            <Input
              placeholder="Transaction Reference"
              className="col-span-3"
              value={transactionReference}
              onChange={(e) => setTransactionReference(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={onApply}>Apply Filters</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
