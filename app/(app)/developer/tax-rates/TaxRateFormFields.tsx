'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { type TaxRateFormData } from './tax-rates-types';

type Props = {
  formData: TaxRateFormData;
  set: <K extends keyof TaxRateFormData>(key: K, value: TaxRateFormData[K]) => void;
  idPrefix?: string;
};

export function TaxRateFormFields({ formData, set, idPrefix = '' }: Props) {
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}name`}>Tax Name</Label>
        <Input
          id={`${idPrefix}name`}
          placeholder="e.g., VAT, Sales Tax"
          value={formData.name}
          onChange={e => set('name', e.target.value)}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}rate`}>Rate (%)</Label>
        <Input
          id={`${idPrefix}rate`}
          type="number"
          step="0.01"
          placeholder="e.g., 12"
          value={formData.rate}
          onChange={e => set('rate', e.target.value)}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}description`}>Description (Optional)</Label>
        <Textarea
          id={`${idPrefix}description`}
          placeholder="Additional details about this tax rate"
          value={formData.description}
          onChange={e => set('description', e.target.value)}
        />
      </div>
      <div className="flex items-center space-x-2">
        <Checkbox
          id={`${idPrefix}isDefault`}
          checked={formData.isDefault}
          onCheckedChange={checked => set('isDefault', checked as boolean)}
        />
        <Label htmlFor={`${idPrefix}isDefault`}>Set as default tax rate</Label>
      </div>
    </>
  );
}
