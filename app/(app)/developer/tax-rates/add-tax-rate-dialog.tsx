'use client';

import { useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, Plus } from 'lucide-react';
import { useAddTaxRate } from './use-add-tax-rate';
import { TaxRateFormFields } from './TaxRateFormFields';

interface Props { onTaxRateAdded: () => void; }

export function AddTaxRateDialog({ onTaxRateAdded }: Props) {
  const [open, setOpen] = useState(false);
  const { formData, set, isLoading, handleSubmit } = useAddTaxRate(onTaxRateAdded);

  const onSubmit = async (e: React.FormEvent) => {
    const ok = await handleSubmit(e);
    if (ok) setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Add Tax Rate
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Add Tax Rate</DialogTitle>
          <DialogDescription>Create a new tax rate configuration.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <TaxRateFormFields formData={formData} set={set} idPrefix="add-" />
          <DialogFooter>
            <Button type="submit" disabled={isLoading}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Tax Rate
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
