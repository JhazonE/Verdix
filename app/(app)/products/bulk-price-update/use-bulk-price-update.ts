'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getProducts } from '../actions';
import { submitPriceUpdateBatch, type PriceUpdateItem } from './actions';
import { applyAdjustment, type AdjustmentType } from '@/lib/price-update-math';
import { useToast } from '@/hooks/use-toast';
import { useDebounce } from '@/hooks/use-debounce';

export type TargetField = 'price' | 'cost' | 'markup' | 'priceLevel';

/**
 * A selectable row. Selection is per SELLING UNIT, not per product: a Case and
 * the Piece it is packed from carry independent prices, so repricing one must
 * not touch the other.
 *
 * The key encodes both ids because a selling unit id alone is not enough to
 * find its product again, and a product id alone cannot distinguish its units.
 */
export interface PricingRow {
  key: string;
  productId: string;
  productName: string;
  sellingUnitId?: string;
  sellingUnitName?: string;
  isBase: boolean;
  factor: number;
  barcode: string;
  baseUnitBarcode: string;
  price: number;
  cost: number;
  priceLevels: { levelId: string; price: number; minQuantity?: number }[];
}

/**
 * Flattens products into one row per selling unit.
 *
 * A product with no selling-unit rows at all still yields a single base row so
 * it stays repriceable — that row carries no sellingUnitId, which the write
 * layer reads as "the base unit", exactly as it behaved before units were
 * selectable.
 */
export function toPricingRows(products: any[]): PricingRow[] {
  const rows: PricingRow[] = [];
  for (const p of products || []) {
    const units: any[] = Array.isArray(p.sellingUnits) ? p.sellingUnits : [];
    const productCost = Number(p.cost || 0);
    const baseUnitBarcode = p.baseUnitBarcode || p.barcode || '';

    if (units.length === 0) {
      rows.push({
        key: p.id,
        productId: p.id,
        productName: p.name,
        isBase: true,
        factor: 1,
        barcode: baseUnitBarcode,
        baseUnitBarcode,
        price: Number(p.price || 0),
        cost: productCost,
        priceLevels: p.priceLevels || [],
      });
      continue;
    }

    // Base unit first, then the rest, so a product reads as "the thing" and
    // its packs beneath it.
    const ordered = [...units].sort((a, b) => Number(b.isBase) - Number(a.isBase));
    for (const u of ordered) {
      rows.push({
        key: `${p.id}::${u.id}`,
        productId: p.id,
        productName: p.name,
        sellingUnitId: u.id,
        sellingUnitName: u.name,
        isBase: !!u.isBase,
        factor: Number(u.factor) || 1,
        barcode: u.barcode || '',
        baseUnitBarcode,
        // The base unit shows the product's effective (shelf) price, which
        // getProducts already resolved from any default-level override.
        price: u.isBase ? Number(p.price || 0) : Number(u.price || 0),
        // A unit with no cost of its own falls back to the product's only for
        // the base unit; a Case with no cost is genuinely unknown (0), not the
        // piece cost.
        cost: u.cost === undefined || u.cost === null
          ? (u.isBase ? productCost : 0)
          : Number(u.cost),
        priceLevels: u.priceLevels || [],
      });
    }
  }
  return rows;
}

export function useBulkPriceUpdate(onUpdated?: () => void) {
  const [warehouseId, setWarehouseIdState] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const debouncedSearchTerm = useDebounce(searchTerm, 500);

  // Switching warehouses starts a fresh product list — a stale search term
  // from the previous warehouse would otherwise silently filter it.
  const setWarehouseId = (id: string) => {
    setWarehouseIdState(id);
    setSearchTerm('');
  };
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [targetField, setTargetField] = useState<TargetField>('price');
  const [priceLevelId, setPriceLevelId] = useState<string>('');
  const [priceLevelName, setPriceLevelName] = useState<string>('');
  const [adjustmentType, setAdjustmentType] = useState<AdjustmentType>('percentage');
  const [adjustmentValue, setAdjustmentValue] = useState<number>(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  const { data: products, isLoading } = useQuery({
    queryKey: ['bulk-price-update-products', warehouseId, debouncedSearchTerm],
    queryFn: () => getProducts(500, 0, { warehouse: warehouseId || undefined, search: debouncedSearchTerm || undefined }),
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

  const rows: PricingRow[] = useMemo(() => toPricingRows(products || []), [products]);

  const preview: PriceUpdateItem[] = useMemo(() => {
    if (rows.length === 0) return [];
    // A priceLevel target with no level chosen has no valid field to write to —
    // the backend would silently skip these rows while still reporting them as
    // "applied", so exclude them here rather than preview/submit garbage values.
    if (effectiveField === 'priceLevel' && !priceLevelId) return [];
    return rows
      .filter(r => selectedIds.has(r.key))
      .map(r => {
        const currentValue = effectiveField === 'price' ? r.price
          : effectiveField === 'cost' ? r.cost
          : Number(r.priceLevels.find(pl => pl.levelId === priceLevelId)?.price ?? 0);
        // Markup is computed off THIS unit's cost, so a Case marks up the case
        // cost rather than the per-piece cost.
        const newValue = applyAdjustment(effectiveAdjustmentType, currentValue, adjustmentValue, r.cost);
        return {
          productId: r.productId,
          sellingUnitId: r.sellingUnitId,
          sellingUnitName: r.sellingUnitName,
          baseUnitBarcode: r.baseUnitBarcode, barcode: r.barcode,
          // Non-base units are labelled so the preview says which unit moved.
          productName: r.isBase ? r.productName : `${r.productName} — ${r.sellingUnitName}`,
          field: effectiveField, priceLevelId: effectiveField === 'priceLevel' ? priceLevelId : undefined,
          priceLevelName: effectiveField === 'priceLevel' ? priceLevelName : undefined,
          oldValue: currentValue, newValue,
          adjustmentType: effectiveAdjustmentType, adjustmentValue,
        };
      });
  }, [rows, selectedIds, effectiveField, effectiveAdjustmentType, adjustmentValue, priceLevelId, priceLevelName]);

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
    searchTerm, setSearchTerm,
    products: products || [], rows, isLoading,
    selectedIds, toggleSelected, selectAll, clearSelection,
    targetField, setTargetField,
    priceLevelId, setPriceLevelId, priceLevelName, setPriceLevelName,
    adjustmentType, setAdjustmentType,
    adjustmentValue, setAdjustmentValue,
    preview, isSubmitting, submit,
  };
}
