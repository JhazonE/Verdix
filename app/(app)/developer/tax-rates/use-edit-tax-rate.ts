'use client';

import { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { getApiUrl } from '@/lib/api-config';
import { TaxRate } from '@/lib/types';
import { type TaxRateFormData } from './tax-rates-types';

export function useEditTaxRate(taxRate: TaxRate, onTaxRateUpdated: () => void) {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState<TaxRateFormData>({
    name: taxRate.name,
    rate: taxRate.rate.toString(),
    description: taxRate.description || '',
    isDefault: Boolean(taxRate.isDefault),
  });

  useEffect(() => {
    setFormData({
      name: taxRate.name,
      rate: taxRate.rate.toString(),
      description: taxRate.description || '',
      isDefault: Boolean(taxRate.isDefault),
    });
  }, [taxRate]);

  const set = <K extends keyof TaxRateFormData>(key: K, value: TaxRateFormData[K]) =>
    setFormData(prev => ({ ...prev, [key]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const res = await fetch(getApiUrl(`/settings/tax-rates/${taxRate.id}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formData, rate: parseFloat(formData.rate) }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to update tax rate');
      toast({ title: 'Success', description: 'Tax rate updated successfully' });
      onTaxRateUpdated();
      return true;
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: e instanceof Error ? e.message : 'Failed to update tax rate' });
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  return { formData, set, isLoading, handleSubmit };
}
