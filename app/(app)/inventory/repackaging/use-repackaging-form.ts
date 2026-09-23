'use client';

import { useCallback, useEffect, useState } from 'react';

import { useToast } from '@/hooks/use-toast';
import { dispatchStockUpdate } from '@/hooks/use-live-refresh';

import { breakPack, getUnitsOfMeasure, searchProducts } from '../../products/actions';

export type Step = 'source' | 'target' | 'calculate' | 'summary';

export type SearchResult = {
  id: string;
  name: string;
  barcode: string;
  baseUnitBarcode: string | null;
  stock: number;
  unitOfMeasure: string;
  price: number;
  cost?: number;
  conversionFactors?: { unit: string; factor: number }[];
};

/**
 * Controller for the repackaging wizard: owns the per-step state, the debounced
 * source/target product search, the unit loading + auto price/cost suggestion,
 * and the break-pack submit flow.
 */
export function useRepackagingForm({ onSuccess }: { onSuccess?: () => void }) {
  const [step, setStep] = useState<Step>('source');
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  // Source State
  const [sourceSearch, setSourceSearch] = useState('');
  const [sourceResults, setSourceResults] = useState<SearchResult[]>([]);
  const [selectedSource, setSelectedSource] = useState<SearchResult | null>(null);
  const [qtyToUse, setQtyToUse] = useState('1');

  // Target State
  const [targetType, setTargetType] = useState<'search' | 'create'>('search');
  const [targetSearch, setTargetSearch] = useState('');
  const [targetResults, setTargetResults] = useState<SearchResult[]>([]);
  const [selectedTarget, setSelectedTarget] = useState<SearchResult | null>(null);

  // New Product State
  const [newName, setNewName] = useState('');
  const [newUnit, setNewUnit] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [newCost, setNewCost] = useState('');
  const [newBarcode, setNewBarcode] = useState('');
  const [units, setUnits] = useState<{ id: string; name: string }[]>([]);

  // Counting State
  const [packsProduced, setPacksProduced] = useState('');

  // Fetch Units
  useEffect(() => {
    getUnitsOfMeasure().then(setUnits);
  }, []);

  const generateBarcode = useCallback(() => {
    const randomNumber = Math.floor(100000000000 + Math.random() * 900000000000).toString();
    setNewBarcode(randomNumber);
  }, []);

  // Auto-generate barcode when switching to create mode
  useEffect(() => {
    if (targetType === 'create' && !newBarcode) {
      generateBarcode();
    }
  }, [targetType, newBarcode, generateBarcode]);

  // Auto-calculate Price & Cost
  useEffect(() => {
    if (targetType === 'create' && newUnit && selectedSource) {
      const cf = selectedSource.conversionFactors?.find(f => f.unit === newUnit);
      if (cf && cf.factor > 0) {
        const factor = cf.factor;
        const suggestedPrice = (selectedSource.price / factor).toFixed(2);
        const suggestedCost = selectedSource.cost ? (selectedSource.cost / factor).toFixed(2) : '';

        setNewPrice(suggestedPrice);
        setNewCost(suggestedCost);

        // Also suggest a name if empty
        if (!newName) {
          setNewName(`${selectedSource.name} ${newUnit}`);
        }
      }
    }
  }, [newUnit, selectedSource, targetType, newName]);

  // Search Logic
  useEffect(() => {
    const query = step === 'source' ? sourceSearch : targetSearch;
    if (query.trim().length < 2) {
      if (step === 'source') setSourceResults([]);
      else setTargetResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const results = await searchProducts(query);
        const filteredResults = results.filter((r: SearchResult) => r.id !== selectedSource?.id);
        if (step === 'source') setSourceResults(filteredResults);
        else setTargetResults(filteredResults);
      } catch (err) {
        console.error('Search error:', err);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [sourceSearch, targetSearch, step, selectedSource?.id]);

  const handleProcess = async () => {
    if (!selectedSource) return;
    const bulkQty = parseFloat(qtyToUse);
    const producedQty = parseFloat(packsProduced);

    if (!bulkQty || bulkQty <= 0) {
      toast({ variant: 'destructive', title: 'Invalid Quantity', description: 'Please enter how many source units you used.' });
      return;
    }
    if (!producedQty || producedQty <= 0) {
      toast({ variant: 'destructive', title: 'Invalid Count', description: 'Please enter how many packs were produced.' });
      return;
    }

    const factor = producedQty / bulkQty;

    setIsLoading(true);
    try {
      let result;
      if (targetType === 'search' && selectedTarget) {
        result = await breakPack(selectedSource.id, selectedTarget.id, bulkQty, factor);
      } else if (targetType === 'create') {
        result = await breakPack(selectedSource.id, null, bulkQty, undefined, {
          name: newName,
          unitOfMeasure: newUnit,
          conversionFactor: factor,
          price: parseFloat(newPrice),
          cost: newCost ? parseFloat(newCost) : undefined,
          barcode: newBarcode
        });
      } else {
         toast({ variant: 'destructive', title: 'Target Missing', description: 'Please select or create a target product.' });
         setIsLoading(false);
         return;
      }

      if (result.success) {
        if ((result as any).pendingApproval) {
          toast({ title: '⏳ Submitted for Approval', description: result.message });
        } else {
          toast({ title: '✅ Repackaging Complete', description: result.message });
          dispatchStockUpdate();
          onSuccess?.();
        }
        setStep('source');
        setSelectedSource(null);
        setSelectedTarget(null);
        setQtyToUse('1');
        setPacksProduced('');
        setSourceSearch('');
        setTargetSearch('');
      } else {
        toast({ variant: 'destructive', title: 'Error', description: result.message });
      }
    } catch (err) {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to process repackaging.' });
    } finally {
      setIsLoading(false);
    }
  };

  return {
    step,
    setStep,
    isLoading,
    sourceSearch,
    setSourceSearch,
    sourceResults,
    selectedSource,
    setSelectedSource,
    qtyToUse,
    setQtyToUse,
    targetType,
    setTargetType,
    targetSearch,
    setTargetSearch,
    targetResults,
    selectedTarget,
    setSelectedTarget,
    newName,
    setNewName,
    newUnit,
    setNewUnit,
    newPrice,
    setNewPrice,
    newCost,
    setNewCost,
    newBarcode,
    setNewBarcode,
    units,
    packsProduced,
    setPacksProduced,
    generateBarcode,
    handleProcess,
  };
}
