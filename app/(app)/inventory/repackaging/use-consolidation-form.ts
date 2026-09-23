'use client';

import { useCallback, useEffect, useState } from 'react';

import { useToast } from '@/hooks/use-toast';

import { consolidatePack, getUnitsOfMeasure, searchProducts } from '../../products/actions';

export type Step = 'source' | 'target' | 'calculate';

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
 * Controller for the consolidation wizard (pack units → bulk product): owns the
 * per-step state, the debounced source/target search, unit loading, the live
 * bulk-quantity preview, and the consolidate submit flow.
 */
export function useConsolidationForm({ onSuccess }: { onSuccess?: () => void }) {
  const [step, setStep] = useState<Step>('source');
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  // Source (Pack) State
  const [sourceSearch, setSourceSearch] = useState('');
  const [sourceResults, setSourceResults] = useState<SearchResult[]>([]);
  const [selectedSource, setSelectedSource] = useState<SearchResult | null>(null);
  const [packQtyUsed, setPackQtyUsed] = useState('1');

  // Target (Bulk) State
  const [targetType, setTargetType] = useState<'search' | 'create'>('search');
  const [targetSearch, setTargetSearch] = useState('');
  const [targetResults, setTargetResults] = useState<SearchResult[]>([]);
  const [selectedTarget, setSelectedTarget] = useState<SearchResult | null>(null);

  // New Bulk Product State
  const [newName, setNewName] = useState('');
  const [newUnit, setNewUnit] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [newCost, setNewCost] = useState('');
  const [newBarcode, setNewBarcode] = useState('');
  const [units, setUnits] = useState<{ id: string; name: string }[]>([]);

  // Conversion factor: how many pack units = 1 bulk unit
  const [factor, setFactor] = useState('');

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

  // Auto-suggest name for quick create
  useEffect(() => {
    if (targetType === 'create' && newUnit && selectedSource) {
      if (!newName) {
        setNewName(`${selectedSource.name} Bulk (${newUnit})`);
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
        const filtered = results.filter((r: SearchResult) => r.id !== selectedSource?.id);
        if (step === 'source') setSourceResults(filtered);
        else setTargetResults(filtered);
      } catch (err) {
        console.error('Search error:', err);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [sourceSearch, targetSearch, step, selectedSource?.id]);

  // Compute preview: bulkQtyProduced = packQtyUsed / factor
  const packQty = parseFloat(packQtyUsed) || 0;
  const factorNum = parseFloat(factor) || 0;
  const bulkQtyPreview = factorNum > 0 ? (packQty / factorNum) : 0;

  const handleProcess = async () => {
    if (!selectedSource) return;

    const pQty = parseFloat(packQtyUsed);
    const f = parseFloat(factor);

    if (!pQty || pQty <= 0) {
      toast({ variant: 'destructive', title: 'Invalid Quantity', description: 'Enter how many pack units to consolidate.' });
      return;
    }
    if (!f || f <= 0) {
      toast({ variant: 'destructive', title: 'Invalid Factor', description: 'Enter how many pack units equal 1 bulk unit.' });
      return;
    }

    setIsLoading(true);
    try {
      let result;
      if (targetType === 'search' && selectedTarget) {
        result = await consolidatePack(selectedSource.id, selectedTarget.id, pQty, f);
      } else if (targetType === 'create') {
        result = await consolidatePack(selectedSource.id, null, pQty, f, {
          name: newName,
          unitOfMeasure: newUnit,
          conversionFactor: f,
          price: parseFloat(newPrice),
          cost: newCost ? parseFloat(newCost) : undefined,
          barcode: newBarcode,
        });
      } else {
        toast({ variant: 'destructive', title: 'Target Missing', description: 'Please select or create a bulk target product.' });
        setIsLoading(false);
        return;
      }

      if (result.success) {
        if ((result as any).pendingApproval) {
          toast({ title: '⏳ Submitted for Approval', description: result.message });
        } else {
          toast({ title: '✅ Consolidation Complete', description: result.message });
          onSuccess?.();
        }
        // Reset
        setStep('source');
        setSelectedSource(null);
        setSelectedTarget(null);
        setPackQtyUsed('1');
        setFactor('');
        setSourceSearch('');
        setTargetSearch('');
        setNewName('');
        setNewUnit('');
        setNewPrice('');
        setNewCost('');
        setNewBarcode('');
      } else {
        toast({ variant: 'destructive', title: 'Error', description: result.message });
      }
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to process consolidation.' });
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
    setSourceResults,
    selectedSource,
    setSelectedSource,
    packQtyUsed,
    setPackQtyUsed,
    targetType,
    setTargetType,
    targetSearch,
    setTargetSearch,
    targetResults,
    setTargetResults,
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
    factor,
    setFactor,
    bulkQtyPreview,
    generateBarcode,
    handleProcess,
  };
}
