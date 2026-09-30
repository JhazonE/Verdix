'use client';

import { useEffect, useMemo, useState } from 'react';

import { useToast } from '@/hooks/use-toast';
import { dispatchStockUpdate } from '@/hooks/use-live-refresh';
import { formatUnitBreakdown, repackOutcome } from '@/lib/unit-quantity';

import { searchProducts } from '../../products/actions';
import { repackSellingUnits } from './actions';

export type RepackUnit = { id: string; name: string; factor: number; isBase: boolean };

export type RepackProduct = {
  id: string;
  name: string;
  barcode: string;
  stock: number;
  sellingUnits: RepackUnit[];
};

/**
 * Controller for the single-product repackaging form: search a product, pick the
 * unit being opened and the unit it becomes, and (optionally) the count actually
 * obtained. Only products with more than one selling unit can be repackaged —
 * there is nothing to convert between otherwise.
 */
export function useUnitRepackForm({ onSuccess }: { onSuccess?: () => void }) {
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<RepackProduct[]>([]);
  const [product, setProduct] = useState<RepackProduct | null>(null);
  const [fromUnitId, setFromUnitId] = useState('');
  const [toUnitId, setToUnitId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [actualProduced, setActualProduced] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (product || search.trim().length < 2) {
      setResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const found = await searchProducts(search);
        setResults(found.filter((r: any) => (r.sellingUnits?.length ?? 0) > 1));
      } catch (err) {
        console.error('Search error:', err);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [search, product]);

  const selectProduct = (p: RepackProduct) => {
    const ordered = [...p.sellingUnits].sort((a, b) => b.factor - a.factor);
    setProduct(p);
    setFromUnitId(ordered[0].id);
    setToUnitId(ordered[ordered.length - 1].id);
    setQuantity('1');
    setActualProduced('');
    setResults([]);
  };

  const clearProduct = () => {
    setProduct(null);
    setSearch('');
    setActualProduced('');
  };

  const fromUnit = product?.sellingUnits.find((u) => u.id === fromUnitId);
  const toUnit = product?.sellingUnits.find((u) => u.id === toUnitId);

  // Live preview. `error` is the reason the current inputs can't be submitted,
  // null when they can; `outcome` is null until the inputs form a valid conversion.
  const preview = useMemo(() => {
    if (!product || !fromUnit || !toUnit) return { outcome: null, error: null as string | null };
    if (fromUnit.id === toUnit.id) return { outcome: null, error: 'Choose two different units.' };
    const qty = parseFloat(quantity);
    if (!qty || qty <= 0) return { outcome: null, error: null };
    try {
      const outcome = repackOutcome({
        quantity: qty,
        fromFactor: fromUnit.factor,
        toFactor: toUnit.factor,
        actualProduced: actualProduced === '' ? null : parseFloat(actualProduced),
      });
      if (outcome.baseUsed > product.stock) {
        return {
          outcome,
          error: `Only ${formatUnitBreakdown(product.stock, product.sellingUnits)} in stock.`,
        };
      }
      return { outcome, error: null };
    } catch (err: any) {
      return { outcome: null, error: err.message as string };
    }
  }, [product, fromUnit, toUnit, quantity, actualProduced]);

  const canSubmit = Boolean(product && preview.outcome && !preview.error) && !isLoading;

  const handleSubmit = async () => {
    if (!product || !canSubmit) return;
    setIsLoading(true);
    try {
      const userSession = localStorage.getItem('mock-user-session');
      const userId = userSession ? JSON.parse(userSession).uid : 'system';
      const result = await repackSellingUnits(
        {
          productId: product.id,
          fromUnitId,
          toUnitId,
          quantity: parseFloat(quantity),
          actualProduced: actualProduced === '' ? null : parseFloat(actualProduced),
        },
        userId,
      );
      if (result.success) {
        if (result.pendingApproval) {
          toast({ title: 'Submitted for Approval', description: result.message });
        } else {
          toast({ title: 'Repackaging Complete', description: result.message });
          dispatchStockUpdate();
        }
        onSuccess?.();
      } else {
        toast({ variant: 'destructive', title: 'Error', description: result.message });
      }
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to process repackaging.' });
    } finally {
      setIsLoading(false);
    }
  };

  return {
    search,
    setSearch,
    results,
    product,
    selectProduct,
    clearProduct,
    fromUnitId,
    setFromUnitId,
    toUnitId,
    setToUnitId,
    fromUnit,
    toUnit,
    quantity,
    setQuantity,
    actualProduced,
    setActualProduced,
    preview,
    canSubmit,
    isLoading,
    handleSubmit,
  };
}
