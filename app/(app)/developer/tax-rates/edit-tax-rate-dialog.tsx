'use client';

import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { TaxRate } from '@/lib/types';
import { useEditTaxRate } from './use-edit-tax-rate';
import { TaxRateFormFields } from './TaxRateFormFields';

interface Props {
  taxRate: TaxRate;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTaxRateUpdated: () => void;
}

export function EditTaxRateDialog({ taxRate, open, onOpenChange, onTaxRateUpdated }: Props) {
  const { formData, set, isLoading, handleSubmit } = useEditTaxRate(taxRate, onTaxRateUpdated);

  const onSubmit = async (e: React.FormEvent) => {
    const ok = await handleSubmit(e);
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Edit Tax Rate</DialogTitle>
          <DialogDescription>Update tax rate configuration.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <TaxRateFormFields formData={formData} set={set} idPrefix="edit-" />
          <DialogFooter>
            <Button type="submit" disabled={isLoading}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
