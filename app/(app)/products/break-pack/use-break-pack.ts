'use client';

import { useEffect, useState } from 'react';

import { useToast } from '@/hooks/use-toast';
import type { Product } from '@/lib/types';

import { breakPack, searchProducts } from '../actions';

export type Step = 'source' | 'target' | 'count';
export type TargetMode = 'search' | 'create';

export type SearchResult = {
  id: string;
  name: string;
  barcode: string;
  baseUnitBarcode: string | null;
  stock: number;
  unitOfMeasure: string;
  parentId: string | null;
  conversionFactor: number;
};

export interface UseBreakPackProps {
  parentProduct: Product;
  onPackBroken: () => void;
}

/**
 * Controller for the repackage/break-pack wizard: owns the open state, all the
 * per-step form state, the debounced product search, the reset-on-open effect,
 * and the finish/persist flow.
 */
export function useBreakPack({ parentProduct, onPackBroken }: UseBreakPackProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState<Step>('source');
  const [isBreaking, setIsBreaking] = useState(false);
  const { toast } = useToast();

  // Step 1: Source
  const [quantityToBreak, setQuantityToBreak] = useState('1');

  // Step 2: Target
  const [targetMode, setTargetMode] = useState<TargetMode>('search');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [selectedTarget, setSelectedTarget] = useState<SearchResult | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  // Quick Create State
  const [newName, setNewName] = useState('');
  const [newUnit, setNewUnit] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [newCost, setNewCost] = useState('');

  // Step 3: Counting
  const [packsProduced, setPacksProduced] = useState('');

  // Reset states when dialog opens
  useEffect(() => {
    if (isOpen) {
      setStep('source');
      setQuantityToBreak('1');
      setSearchQuery('');
      setSearchResults([]);
      setSelectedTarget(null);
      setTargetMode('search');
      setPacksProduced('');
      setNewName('');
      setNewUnit('');
      setNewPrice('');
      setNewCost('');
    }
  }, [isOpen]);

  // Debounced search
  useEffect(() => {
    if (step !== 'target' || targetMode !== 'search' || searchQuery.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const results = await searchProducts(searchQuery);
        setSearchResults(results.filter((r: SearchResult) => r.id !== parentProduct.id));
      } catch (err) {
        console.error('Search error:', err);
      } finally {
        setIsSearching(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [searchQuery, step, targetMode, parentProduct.id]);

  const handleFinish = async () => {
    const bulkQty = parseFloat(quantityToBreak);
    const producedQty = parseFloat(packsProduced);

    if (!bulkQty || bulkQty <= 0) {
      toast({ variant: 'destructive', title: 'Invalid Quantity', description: 'Please enter how much you used.' });
      return;
    }
    if (!producedQty || producedQty <= 0) {
      toast({ variant: 'destructive', title: 'Invalid Count', description: 'Please enter how many packs were produced.' });
      return;
    }

    const calculatedFactor = producedQty / bulkQty;

    setIsBreaking(true);
    try {
      let result;
      if (targetMode === 'search' && selectedTarget) {
        result = await breakPack(parentProduct.id, selectedTarget.id, bulkQty, calculatedFactor);
      } else if (targetMode === 'create') {
        result = await breakPack(parentProduct.id, null, bulkQty, undefined, {
          name: newName.trim(),
          unitOfMeasure: newUnit.trim(),
          conversionFactor: calculatedFactor,
          price: parseFloat(newPrice),
          cost: newCost ? parseFloat(newCost) : undefined,
        });
      } else {
        toast({ variant: 'destructive', title: 'Error', description: 'Target product missing.' });
        setIsBreaking(false);
        return;
      }

      if (result.success) {
        toast({ title: 'Repackaging Complete', description: result.message });
        onPackBroken();
        setIsOpen(false);
      } else {
        toast({ variant: 'destructive', title: 'Error', description: result.message });
      }
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to process repackaging.' });
    } finally {
      setIsBreaking(false);
    }
  };

  return {
    isOpen,
    setIsOpen,
    step,
    setStep,
    isBreaking,
    quantityToBreak,
    setQuantityToBreak,
    targetMode,
    setTargetMode,
    searchQuery,
    setSearchQuery,
    searchResults,
    selectedTarget,
    setSelectedTarget,
    isSearching,
    newName,
    setNewName,
    newUnit,
    setNewUnit,
    newPrice,
    setNewPrice,
    newCost,
    setNewCost,
    packsProduced,
    setPacksProduced,
    handleFinish,
  };
}
