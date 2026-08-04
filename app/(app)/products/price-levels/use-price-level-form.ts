'use client';

import { useState } from 'react';

import { useToast } from '@/hooks/use-toast';
import type { PriceLevel } from '@/lib/types';

export type PriceLevelSaveHandler = (
  name: string,
  description: string,
  isDefault: boolean,
  percentageAdjustment: number,
  calculationBase: 'retail' | 'cost',
  adjustmentType: 'percentage' | 'fixed'
) => Promise<boolean>;

export interface UsePriceLevelFormProps {
  initialData?: PriceLevel;
  onSave: PriceLevelSaveHandler;
}

/**
 * Controller for the price level add/edit form: field state and the validated
 * save flow (clears the form after a successful add).
 */
export function usePriceLevelForm({ initialData, onSave }: UsePriceLevelFormProps) {
  const [name, setName] = useState(initialData?.name || '');
  const [description, setDescription] = useState(initialData?.description || '');
  const [isDefault, setIsDefault] = useState(initialData?.isDefault || false);
  const [calculationBase, setCalculationBase] = useState<'retail' | 'cost'>(initialData?.calculationBase || 'retail');
  const [adjustmentType, setAdjustmentType] = useState<'percentage' | 'fixed'>(initialData?.adjustmentType || 'percentage');
  const [percentageAdjustment, setPercentageAdjustment] = useState(initialData?.percentageAdjustment?.toString() || '0');
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  const handleSave = async () => {
    if (!name.trim()) {
      toast({
        variant: 'destructive',
        title: 'Validation Error',
        description: 'Price level name cannot be empty.',
      });
      return;
    }
    const adjustment = parseFloat(percentageAdjustment);

    if (isNaN(adjustment) || adjustment < 0) {
      toast({
        variant: 'destructive',
        title: 'Validation Error',
        description: adjustmentType === 'fixed'
          ? 'Fixed amount must be a valid positive number.'
          : 'Markup percentage must be a valid positive number.',
      });
      return;
    }

    setIsSaving(true);
    try {
      const success = await onSave(name, description, isDefault, adjustment, calculationBase, adjustmentType);
      if (success) {
        toast({
          title: initialData ? 'Price Level Updated' : 'Price Level Added',
          description: `Price level "${name}" has been successfully saved.`,
        });
        if (!initialData) {
          setName('');
          setDescription('');
          setIsDefault(false);
          setCalculationBase('retail');
          setAdjustmentType('percentage');
          setPercentageAdjustment('0');
        }
      }
    } catch (error) {
      console.error('Failed to save price level', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to save price level. Please try again.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  return {
    name,
    setName,
    description,
    setDescription,
    isDefault,
    setIsDefault,
    calculationBase,
    setCalculationBase,
    adjustmentType,
    setAdjustmentType,
    percentageAdjustment,
    setPercentageAdjustment,
    isSaving,
    handleSave,
  };
}
