'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Product } from '@/lib/types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { formatCurrency } from '@/lib/utils';
import { clearStockAndReassign, reassignParent } from '../actions';
import { getIllegalChildTargets, getIllegalReassignTargets, type TreeProduct } from '@/lib/product-tree';
import { buildProductQuery, PRODUCT_SEARCH_DEBOUNCE_MS } from '@/lib/product-search';
import { getApiUrl } from '@/lib/api-config';

/**
 * Two framings share this one picker:
 *
 * - 'add' (default): `subject` is the PARENT. We're picking a product to
 *   attach as its child. Illegal targets = the parent + its ancestors
 *   (getIllegalChildTargets), because attaching an ancestor under its own
 *   descendant would create a loop. The candidate may already carry stock,
 *   which clearStockAndReassign must zero before it can become a child.
 * - 'move': `subject` is the CHILD being relocated. We're picking a new
 *   parent for it. Illegal targets = the child + its descendants
 *   (getIllegalReassignTargets), for the same loop reason mirrored. The
 *   subject is already a child, so its stock is already zero (enforced
 *   server-side when it first became a child) — clearStockAndReassign is
 *   never needed here, reassignParent alone is correct.
 *
 * Either way the conversion factor means the same thing: how many of the
 * FIXED side's unit equal one unit of the OTHER (candidate) side.
 */
export function AddExistingChildDialog({
  subject,
  mode = 'add',
  open,
  onOpenChange,
  onAdded,
}: {
  subject: Product;
  mode?: 'add' | 'move';
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: () => void;
}) {
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [candidates, setCandidates] = useState<Product[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const latestRequest = useRef(0);

  const [selectedId, setSelectedId] = useState<string>('');
  const [factor, setFactor] = useState<string>('');
  const [autoDetected, setAutoDetected] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Whole-catalogue search, same as reassign-parent-dialog: the products
  // list here is never a complete page, so matching must happen in SQL
  // against the full ~15,000-row catalogue.
  useEffect(() => {
    if (!open) return;
    const requestId = ++latestRequest.current;
    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await fetch(getApiUrl(buildProductQuery(search)));
        const data = await res.json();
        // Ignore a response overtaken by a newer keystroke.
        if (requestId !== latestRequest.current) return;
        if (data.success) setCandidates(data.data);
      } catch {
        if (requestId === latestRequest.current) setCandidates([]);
      } finally {
        if (requestId === latestRequest.current) setIsSearching(false);
      }
    }, PRODUCT_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search, open]);

  // Reset local state whenever the dialog is (re)opened for a subject, so a
  // stale selection from a previous open doesn't survive into this one.
  useEffect(() => {
    if (!open) return;
    setSearch('');
    setCandidates([]);
    setSelectedId('');
    setFactor('');
    setAutoDetected(false);
  }, [open, subject.id]);

  // Convenience filter only, over one page of search results — not an
  // authority. Both helpers walk ancestors/descendants from what's on the
  // page, so a true illegal target absent from this page won't be caught
  // here; reassignParent/clearStockAndReassign re-run the real check
  // server-side against the full table and reject with a clear message if
  // this filter missed something.
  const legalCandidates = useMemo(() => {
    const treeProducts: TreeProduct[] = candidates.map((p) => ({ id: p.id, parentId: p.parentId }));
    const illegal =
      mode === 'move'
        ? getIllegalReassignTargets(subject.id, treeProducts)
        : getIllegalChildTargets(subject.id, treeProducts);
    return candidates
      .filter((p) => !illegal.has(p.id))
      // In 'add' mode, a product already a direct child of this parent is
      // already in the table — no need to offer it again. In 'move' mode the
      // subject's current parent is a legal (if pointless) target, so this
      // filter doesn't apply.
      .filter((p) => mode === 'move' || p.parentId !== subject.id)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [candidates, subject.id, mode]);

  const selected = useMemo(
    () => candidates.find((p) => p.id === selectedId) ?? null,
    [candidates, selectedId],
  );

  const handleSelect = (id: string) => {
    setSelectedId(id);
    const product = candidates.find((p) => p.id === id);
    // 'add': the candidate is the future child — look up its unit among the
    // (fixed) parent's known conversion factors.
    // 'move': the candidate is the future parent — look up the (fixed)
    // child's unit among the candidate's conversion factors.
    const match =
      mode === 'move'
        ? subject.unitOfMeasure
          ? product?.conversionFactors?.find((cf) => cf.unit === subject.unitOfMeasure)
          : undefined
        : product?.unitOfMeasure
          ? subject.conversionFactors?.find((cf) => cf.unit === product.unitOfMeasure)
          : undefined;
    if (match) {
      setFactor(String(match.factor));
      setAutoDetected(true);
    } else {
      setFactor('');
      setAutoDetected(false);
    }
  };

  // Stock only matters in 'add' mode: the candidate there may be any product
  // and could be holding stock. In 'move' mode the subject is already a
  // child, so its stock is already zero (enforced server-side when it first
  // became a child) — there's nothing to clear.
  const hasStock = mode === 'add' && (selected?.stock ?? 0) > 0;
  const canSave = selected !== null && Number(factor) > 0;

  const resetAndClose = () => {
    setSearch('');
    setCandidates([]);
    setSelectedId('');
    setFactor('');
    setAutoDetected(false);
    onOpenChange(false);
  };

  const handleConfirm = async () => {
    if (!selected || !canSave) return;
    setIsSaving(true);
    try {
      const result =
        mode === 'move'
          ? await reassignParent(subject.id, selected.id, Number(factor))
          : hasStock
            ? await clearStockAndReassign(selected.id, subject.id, Number(factor))
            : await reassignParent(selected.id, subject.id, Number(factor));
      if (result.success) {
        toast({ title: mode === 'move' ? 'Moved' : 'Added', description: result.message });
        onAdded();
        resetAndClose();
      } else {
        toast({
          variant: 'destructive',
          title: mode === 'move' ? 'Could not move product' : 'Could not add child',
          description: result.message,
        });
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(next) : resetAndClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === 'move' ? 'Move to Another Parent' : 'Add Existing Product'}</DialogTitle>
          <DialogDescription>
            {mode === 'move' ? (
              <>
                Move <span className="font-medium">{subject.name}</span> under a different parent product.
              </>
            ) : (
              <>
                Attach an existing product as a child of{' '}
                <span className="font-medium">{subject.name}</span>.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="add-existing-search">Search products</Label>
            <Input
              id="add-existing-search"
              placeholder="Search by name, SKU or barcode..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="max-h-48 overflow-y-auto rounded-md border">
              {legalCandidates.length === 0 && (
                <p className="px-3 py-3 text-sm text-muted-foreground">
                  {isSearching ? 'Searching...' : 'No matching products.'}
                </p>
              )}
              {legalCandidates.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  onClick={() => handleSelect(p.id)}
                  className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted ${
                    selectedId === p.id ? 'bg-muted' : ''
                  }`}
                >
                  <span>{p.name}</span>
                  {p.sku ? <span className="ml-2 text-xs text-muted-foreground">{p.sku}</span> : null}
                </button>
              ))}
            </div>
          </div>

          {selected && (
            <div className="space-y-3 rounded-md border p-3 text-sm">
              <div className="font-medium">{selected.name}</div>
              <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                <div>Unit: {selected.unitOfMeasure ?? '—'}</div>
                <div>Stock: {selected.stock ?? 0}</div>
                <div>
                  Cost: {typeof selected.cost === 'number' ? formatCurrency(selected.cost) : '—'}
                </div>
              </div>

              {hasStock && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                  ⚠️ <strong>{selected.name}</strong> has{' '}
                  <strong>
                    {selected.stock} {selected.unitOfMeasure}
                  </strong>{' '}
                  in stock. Adding it as a child clears that stock, because a child&apos;s stock is
                  derived from its parent.
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="add-existing-factor">
                  {mode === 'move' ? (
                    <>
                      Conversion factor ({subject.unitOfMeasure ?? 'unit'} per 1 {selected.unitOfMeasure ?? 'unit'} of{' '}
                      {selected.name})
                    </>
                  ) : (
                    <>
                      Conversion factor ({selected.unitOfMeasure ?? 'unit'} per 1 {subject.unitOfMeasure} of{' '}
                      {subject.name})
                    </>
                  )}
                </Label>
                <Input
                  id="add-existing-factor"
                  type="number"
                  step="0.0001"
                  min="0"
                  value={factor}
                  onChange={(e) => {
                    setFactor(e.target.value);
                    setAutoDetected(false);
                  }}
                  placeholder="e.g., 12"
                />
                {autoDetected && (
                  <p className="text-xs text-muted-foreground">
                    Auto-detected from {mode === 'move' ? selected.name : subject.name}. You can override it.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={resetAndClose}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!canSave || isSaving}>
            {isSaving
              ? 'Saving...'
              : mode === 'move'
                ? 'Move'
                : hasStock
                  ? 'Clear stock and add as child'
                  : 'Add as child'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
