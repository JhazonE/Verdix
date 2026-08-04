'use client';

import { useEffect, useState } from 'react';

import { useToast } from '@/hooks/use-toast';
import type { PriceLevel } from '@/lib/types';

import { addPriceLevel, deletePriceLevel, getPriceLevels, updatePriceLevel } from '../actions';

export interface UseManagePriceLevelsProps {
  onLevelAdded?: () => void;
}

/**
 * Controller for the Manage Price Levels list: loads levels and exposes the
 * add/update/delete handlers (each returns success so the dialog can switch
 * back to the list view).
 */
export function useManagePriceLevels({ onLevelAdded }: UseManagePriceLevelsProps) {
  const [levels, setLevels] = useState<PriceLevel[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  const refreshLevels = async () => {
    try {
      const loadedLevels = await getPriceLevels();
      setLevels(loadedLevels);
    } catch (error) {
      console.error('Error loading price levels', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    refreshLevels();
  }, []);

  const addLevel = async (
    name: string,
    description: string,
    isDefault: boolean,
    percentageAdjustment: number,
    calculationBase: 'retail' | 'cost',
    adjustmentType: 'percentage' | 'fixed'
  ): Promise<boolean> => {
    const result = await addPriceLevel(name, description, isDefault, percentageAdjustment, 0, calculationBase, adjustmentType);
    if (result.success) {
      await refreshLevels();
      onLevelAdded?.();
      return true;
    }
    toast({ variant: 'destructive', title: 'Error', description: result.message });
    return false;
  };

  const updateLevel = async (
    id: string,
    name: string,
    description: string,
    isDefault: boolean,
    percentageAdjustment: number,
    calculationBase: 'retail' | 'cost',
    adjustmentType: 'percentage' | 'fixed'
  ): Promise<boolean> => {
    const result = await updatePriceLevel(id, name, description, isDefault, percentageAdjustment, 0, calculationBase, adjustmentType);
    if (result.success) {
      await refreshLevels();
      onLevelAdded?.();
      return true;
    }
    toast({ variant: 'destructive', title: 'Error', description: result.message });
    return false;
  };

  const deleteLevel = async (id: string) => {
    const result = await deletePriceLevel(id);
    if (result.success) {
      toast({ title: 'Price Level Deleted', description: result.message });
      await refreshLevels();
      onLevelAdded?.();
    } else {
      toast({ variant: 'destructive', title: 'Error', description: result.message });
    }
  };

  return {
    levels,
    isLoading,
    addLevel,
    updateLevel,
    deleteLevel,
  };
}
