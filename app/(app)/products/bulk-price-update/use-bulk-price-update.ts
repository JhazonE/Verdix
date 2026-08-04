'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getProducts } from '../actions';
import { submitPriceUpdateBatch, type PriceUpdateItem } from './actions';
import { applyAdjustment, type AdjustmentType } from '@/lib/price-update-math';
import { useToast } from '@/hooks/use-toast';

export type TargetField = 'price' | 'cost' | 'markup' | 'priceLevel';

export function useBulkPriceUpdate(onUpdated?: () => void) {
  const [warehouseId, setWarehouseId] = useState<string>('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [targetField, setTargetField] = useState<TargetField>('price');
  const [priceLevelId, setPriceLevelId] = useState<string>('');
  const [priceLevelName, setPriceLevelName] = useState<string>('');
  const [adjustmentType, setAdjustmentType] = useState<AdjustmentType>('percentage');
  const [adjustmentValue, setAdjustmentValue] = useState<number>(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  const { data: products, isLoading } = useQuery({
    queryKey: ['bulk-price-update-products', warehouseId],
    queryFn: () => getProducts(500, 0, { warehouse: warehouseId || undefined }),
    enabled: !!warehouseId,
  });

  const toggleSelected = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = (ids: string[]) => setSelectedIds(new Set(ids));
  const clearSelection = () => setSelectedIds(new Set());

  // markup only makes sense when targeting selling price
  const effectiveAdjustmentType: AdjustmentType = targetField === 'markup' ? 'markup' : adjustmentType;
  const effectiveField: 'price' | 'cost' | 'priceLevel' = targetField === 'markup' ? 'price' : targetField;

  const preview: PriceUpdateItem[] = useMemo(() => {
    if (!products) return [];
    // A priceLevel target with no level chosen has no valid field to write to —
    // the backend would silently skip these rows while still reporting them as
    // "applied", so exclude them here rather than preview/submit garbage values.
    if (effectiveField === 'priceLevel' && !priceLevelId) return [];
    return products
      .filter((p: any) => selectedIds.has(p.id))
      .map((p: any) => {
        const currentValue = effectiveField === 'price' ? Number(p.price)
          : effectiveField === 'cost' ? Number(p.cost || 0)
          : Number((p.priceLevels || []).find((pl: any) => pl.levelId === priceLevelId)?.price ?? 0);
        const newValue = applyAdjustment(effectiveAdjustmentType, currentValue, adjustmentValue, Number(p.cost || 0));
        return {
          productId: p.id, sku: p.sku, barcode: p.barcode || '', productName: p.name,
          field: effectiveField, priceLevelId: effectiveField === 'priceLevel' ? priceLevelId : undefined,
          priceLevelName: effectiveField === 'priceLevel' ? priceLevelName : undefined,
          oldValue: currentValue, newValue,
          adjustmentType: effectiveAdjustmentType, adjustmentValue,
        };
      });
  }, [products, selectedIds, effectiveField, effectiveAdjustmentType, adjustmentValue, priceLevelId, priceLevelName]);

  const submit = async (userId: string) => {
    if (!warehouseId || preview.length === 0) return null;
    setIsSubmitting(true);
    try {
      const result = await submitPriceUpdateBatch(warehouseId, preview, userId);
      if (result.success) {
        toast({
          title: result.pendingApproval ? 'Submitted for approval' : 'Prices updated',
          description: result.message,
        });
        clearSelection();
        onUpdated?.();
      } else {
        toast({ variant: 'destructive', title: 'Error', description: result.message || 'Failed to submit price update.' });
      }
      return result;
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message || 'Failed to submit price update.' });
      return null;
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    warehouseId, setWarehouseId,
    products: products || [], isLoading,
    selectedIds, toggleSelected, selectAll, clearSelection,
    targetField, setTargetField,
    priceLevelId, setPriceLevelId, priceLevelName, setPriceLevelName,
    adjustmentType, setAdjustmentType,
    adjustmentValue, setAdjustmentValue,
    preview, isSubmitting, submit,
  };
}
