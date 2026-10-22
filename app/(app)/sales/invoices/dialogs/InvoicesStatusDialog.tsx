'use client';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';

type Props = { open: boolean; onClose: () => void; tempStatus: string; setTempStatus: (v: string) => void; onApply: () => void };

export function InvoicesStatusDialog({ open, onClose, tempStatus, setTempStatus, onApply }: Props) {
  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Filter by Status</DialogTitle>
          <DialogDescription>Select the status to filter by.</DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <Label>Status</Label>
          <Select value={tempStatus} onValueChange={setTempStatus}>
            <SelectTrigger className="mt-2"><SelectValue placeholder="Select status" /></SelectTrigger>
            <SelectContent>
              {['all', 'Paid', 'Partially Paid', 'Pending', 'Voided', 'Shipped', 'Delivered'].map(s => (
                <SelectItem key={s} value={s}>{s === 'all' ? 'All' : s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={onApply}>Apply</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
