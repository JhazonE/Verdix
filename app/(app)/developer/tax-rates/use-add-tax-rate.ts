'use client';

import { useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { getApiUrl } from '@/lib/api-config';
import { type TaxRateFormData, FORM_DEFAULTS } from './tax-rates-types';

export function useAddTaxRate(onTaxRateAdded: () => void) {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState<TaxRateFormData>(FORM_DEFAULTS);

  const set = <K extends keyof TaxRateFormData>(key: K, value: TaxRateFormData[K]) =>
    setFormData(prev => ({ ...prev, [key]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const res = await fetch(getApiUrl('/settings/tax-rates'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formData, rate: parseFloat(formData.rate) }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to create tax rate');
      toast({ title: 'Success', description: 'Tax rate created successfully' });
      setFormData(FORM_DEFAULTS);
      onTaxRateAdded();
      return true;
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: e instanceof Error ? e.message : 'Failed to create tax rate' });
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  return { formData, set, isLoading, handleSubmit };
}
