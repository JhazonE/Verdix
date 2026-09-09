'use client';

import { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getChildProducts } from '../actions';
import { calculateMarkupPercentage, calculateSuggestedPrice } from '@/lib/purchase-utils';
import { getApiUrl } from '@/lib/api-config';
import type { Product, SystemSettings } from '@/lib/types';

export type ChildUnitRow = {
  id: string;
  name: string;
  unitOfMeasure?: string;
  conversionFactor?: number;
  stock?: number;
  cost?: number;
  price?: number;
  childCount: number;
  /** Saved override. null = inherits. */
  markupPercentage: number | null;
};

export function useChildUnits({
  product,
  open,
  productOptions,
}: {
  product?: Product | null;
  open: boolean;
  productOptions?: any;
}) {
  // The products page has neither systemSettings nor priceLevels in scope, so
  // this hook sources them the same way use-edit-product-form.ts does: price
  // levels ride along on productOptions, settings are fetched here.
  const priceLevels: any[] = productOptions?.priceLevels ?? [];

  // Same fetch as use-edit-product-form.ts:103 — one settings endpoint, one shape.
  const [systemSettings, setSystemSettings] = useState<SystemSettings | null>(null);
  useEffect(() => {
    fetch(getApiUrl('/pos-settings'))
      .then(res => res.json())
      .then(data => {
        if (data.success) setSystemSettings(data.data);
      })
      .catch(err => console.error('Failed to fetch settings', err));
  }, []);

  // The dialog can re-target itself at a child that has its own children, so
  // the parent being viewed is state, not just the prop. `trail` is the way
  // back up.
  const [viewedParent, setViewedParent] = useState<Product | null>(product ?? null);
  const [trail, setTrail] = useState<Product[]>([]);

  useEffect(() => {
    if (open) {
      setViewedParent(product ?? null);
      setTrail([]);
    }
  }, [open, product]);

  const { data: children = [], isLoading, refetch } = useQuery({
    queryKey: ['child-units', viewedParent?.id],
    queryFn: () => getChildProducts(viewedParent!.id),
    enabled: open && !!viewedParent?.id,
  });

  const rows: ChildUnitRow[] = (children as any[]).map((c) => ({
    id: c.id,
    name: c.name,
    unitOfMeasure: c.unitOfMeasure ?? c.unit_of_measure,
    conversionFactor: c.conversionFactor ?? undefined,
    stock: c.stock === null || c.stock === undefined ? undefined : Number(c.stock),
    cost: c.cost,
    price: c.price,
    childCount: c.childCount ?? 0,
    markupPercentage: c.markupPercentage ?? null,
  }));

  /**
   * What this row would inherit if its override were cleared — shown as a hint
   * under an empty markup field so the user knows what "blank" actually means.
   */
  const inheritedFor = useCallback(
    (row: ChildUnitRow, raw: any) => {
      const { markup, source } = calculateMarkupPercentage(
        {
          markupPercentage: null, // deliberately ignore the override
          category: raw?.category,
          subcategory: raw?.subcategory,
          brand: raw?.brand,
          supplierId: raw?.supplier_id,
        },
        systemSettings,
        productOptions?.categories ?? [],
        productOptions?.subcategories ?? [],
        productOptions?.brands ?? [],
        productOptions?.suppliers ?? []
      );
      return { markup, source };
    },
    [systemSettings, productOptions]
  );

  /** Suggested price for a given markup. Never written to products.price. */
  const suggestedPrice = useCallback(
    (cost: number | undefined, markup: number) => {
      if (cost === undefined || cost === null) return undefined;
      const defaultLevel = (priceLevels ?? []).find((l: any) => l.isDefault) ?? (priceLevels ?? [])[0];
      return calculateSuggestedPrice(cost, markup, 0, defaultLevel);
    },
    [priceLevels]
  );

  const drillInto = useCallback((child: Product) => {
    setTrail((t) => [...t, viewedParent!].filter(Boolean) as Product[]);
    setViewedParent(child);
  }, [viewedParent]);

  const goBack = useCallback(() => {
    setTrail((t) => {
      const next = [...t];
      const previous = next.pop();
      if (previous) setViewedParent(previous);
      return next;
    });
  }, []);

  return {
    viewedParent,
    rows,
    rawChildren: children as any[],
    isLoading,
    refetch,
    inheritedFor,
    suggestedPrice,
    drillInto,
    goBack,
    canGoBack: trail.length > 0,
  };
}
