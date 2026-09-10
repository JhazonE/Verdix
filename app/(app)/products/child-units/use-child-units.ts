'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getChildProducts, updateChildConversions } from '../actions';
import type { Product } from '@/lib/types';

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

  /** unit -> raw input text. Absent = untouched. '' = cleared (delete the factor). */
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) setDrafts({});
  }, [open, viewedParent?.id]);

  const setDraft = useCallback((unit: string, text: string) => {
    setDrafts((d) => ({ ...d, [unit]: text }));
  }, []);

  /** The value a unit would save: null when blank, else the parsed number. */
  const draftValue = useCallback((row: ChildUnitRow): number | null => {
    const unit = row.unitOfMeasure ?? '';
    const text = drafts[unit];
    if (text === undefined) return row.conversionFactor ?? null;
    if (text.trim() === '') return null;
    return Number(text);
  }, [drafts]);

  const isRowValid = useCallback((row: ChildUnitRow) => {
    const v = draftValue(row);
    if (v === null) return true;
    return Number.isFinite(v) && v > 0;
  }, [draftValue]);

  const allValid = rows.every(isRowValid);

  /** unit -> how many rows use it. Anything > 1 shares a single factor row. */
  const unitCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const unit = row.unitOfMeasure ?? '';
      if (!unit) continue;
      counts.set(unit, (counts.get(unit) ?? 0) + 1);
    }
    return counts;
  }, [rows]);

  const [isSaving, setIsSaving] = useState(false);

  const save = useCallback(async () => {
    if (!allValid) {
      return { success: false, message: 'Fix the highlighted conversion factors first.' };
    }

    // One entry per CHANGED unit (not per row) — two rows sharing a unit are
    // one factor, so sending both would write the same row twice.
    const byUnit = new Map<string, number | null>();
    for (const row of rows) {
      const unit = row.unitOfMeasure ?? '';
      // ChildUnitsDialog renders the Conversion cell read-only for a row with
      // no unit, so this should be unreachable via the UI. Kept as a backstop
      // (a factor is keyed by unit, so an empty key must never be written) —
      // do not remove even though the dialog already prevents the case.
      if (!unit) continue;
      const text = drafts[unit];
      if (text === undefined) continue;
      const next = draftValue(row);
      if (next !== (row.conversionFactor ?? null)) byUnit.set(unit, next);
    }

    // Saving with nothing changed is a normal success — the button is always enabled.
    if (byUnit.size === 0) return { success: true, message: '' };

    setIsSaving(true);
    try {
      const result = await updateChildConversions(
        viewedParent!.id,
        [...byUnit.entries()].map(([unit, factor]) => ({ unit, factor })),
      );
      if (result.success) {
        setDrafts({});
        await refetch();
      }
      return result;
    } finally {
      setIsSaving(false);
    }
  }, [allValid, rows, drafts, draftValue, viewedParent, refetch]);

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
    drillInto,
    goBack,
    canGoBack: trail.length > 0,
    drafts,
    setDraft,
    draftValue,
    isRowValid,
    unitCounts,
    allValid,
    isSaving,
    save,
  };
}
