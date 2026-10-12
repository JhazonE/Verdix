'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { dispatchStockUpdate } from '@/hooks/use-live-refresh';
import { useToast } from '@/hooks/use-toast';
import { logActivity } from '@/lib/client-activity-logger';
import { computeUntrackedQuantity } from '@/lib/batch-expiration-edit';
import type { Product } from '@/lib/types';
import { toSafeNumber } from '@/lib/utils';

export interface ExpirationBatchRow {
  id: string;
  receivedDate: string;
  quantityRemaining: number;
  poReference: string | null;
  /** The date as currently edited in the form (YYYY-MM-DD, or '' for none). */
  expirationDate: string;
  /** The date as stored, so an unchanged row can be left out of the save. */
  originalExpirationDate: string;
}

export interface UseSetExpirationProps {
  product: Product;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

/**
 * Controller for the Set Expiration dialog.
 *
 * Expiry belongs to inventory_batches, so this edits batch rows — one date per
 * batch — and never touches stock. Only batches with stock remaining are shown:
 * an exhausted batch drives neither the expiring-soon report nor
 * products.expiration_date, so dating it would be a silent no-op (and the API
 * rejects it).
 */
export function useSetExpiration({ product, open, onOpenChange, onSuccess }: UseSetExpirationProps) {
  const { toast } = useToast();

  const [batches, setBatches] = useState<ExpirationBatchRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [untrackedExpiration, setUntrackedExpiration] = useState('');
  const [untrackedQuantity, setUntrackedQuantity] = useState(0);

  const loadBatches = useCallback(async () => {
    setIsLoading(true);
    try {
      // status=active because only batches holding stock are editable targets.
      const params = new URLSearchParams({
        productId: String(product.id),
        status: 'active',
        pageSize: '200',
      });
      const res = await fetch(`/api/inventory-batches?${params}`);
      if (!res.ok) throw new Error('Failed to fetch batches');
      const data = await res.json();
      const rows: any[] = data.data ?? [];

      const mapped: ExpirationBatchRow[] = rows.map((r) => ({
        id: String(r.id),
        receivedDate: r.received_date,
        quantityRemaining: toSafeNumber(r.quantity_remaining),
        poReference: r.po_reference || r.purchase_order_id || null,
        expirationDate: r.expirationDate || '',
        originalExpirationDate: r.expirationDate || '',
      }));

      setBatches(mapped);
      setUntrackedQuantity(computeUntrackedQuantity(toSafeNumber(product.stock), mapped));
    } catch {
      setBatches([]);
      setUntrackedQuantity(0);
      toast({
        variant: 'destructive',
        title: 'Could not load batches',
        description: 'Please close the dialog and try again.',
      });
    } finally {
      setIsLoading(false);
    }
  }, [product.id, product.stock, toast]);

  useEffect(() => {
    if (open) {
      setUntrackedExpiration('');
      loadBatches();
    }
  }, [open, loadBatches]);

  const setBatchExpiration = (batchId: string, value: string) => {
    setBatches((prev) =>
      prev.map((b) => (b.id === batchId ? { ...b, expirationDate: value } : b))
    );
  };

  /** Applies one date to every batch shown, plus any untracked stock. */
  const applyDateToAll = (value: string) => {
    setBatches((prev) => prev.map((b) => ({ ...b, expirationDate: value })));
    if (untrackedQuantity > 0) setUntrackedExpiration(value);
  };

  const changedBatches = useMemo(
    () => batches.filter((b) => b.expirationDate !== b.originalExpirationDate),
    [batches]
  );

  const hasChanges = changedBatches.length > 0 || Boolean(untrackedExpiration);

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  // Dating stock that has already expired is legitimate — it is how expired
  // stock gets flagged for pull-out — so this warns without blocking.
  const pastDateCount = useMemo(() => {
    const dates = batches.map((b) => b.expirationDate).concat(untrackedExpiration);
    return dates.filter((d) => d && d < today).length;
  }, [batches, untrackedExpiration, today]);

  const save = async () => {
    if (!hasChanges) {
      onOpenChange(false);
      return;
    }

    setIsSaving(true);
    try {
      const res = await fetch('/api/inventory-batches/expiration', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: product.id,
          updates: changedBatches.map((b) => ({
            batchId: b.id,
            expirationDate: b.expirationDate || null,
          })),
          untrackedExpiration: untrackedExpiration || null,
        }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        toast({
          variant: 'destructive',
          title: 'Could not save expiration dates',
          description: data.error || 'Please try again.',
        });
        return;
      }

      await logActivity({
        action: 'UPDATE',
        module: 'INVENTORY',
        description:
          `Expiration dates updated for "${product.name}": ${data.updated} batch(es)` +
          (data.openingBatchId
            ? `, opening batch ${data.openingBatchId} created for ${untrackedQuantity} untracked unit(s)`
            : ''),
        referenceId: String(product.id),
      });

      toast({
        title: 'Expiration Updated',
        description: `Expiration dates saved for ${product.name}. Stock was not changed.`,
      });

      onOpenChange(false);
      onSuccess?.();
      // The expiring-soon report and the product's cached expiry both changed.
      dispatchStockUpdate();
    } catch {
      toast({
        variant: 'destructive',
        title: 'Could not save expiration dates',
        description: 'An error occurred while saving.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  return {
    batches,
    isLoading,
    isSaving,
    untrackedQuantity,
    untrackedExpiration,
    setUntrackedExpiration,
    setBatchExpiration,
    applyDateToAll,
    hasChanges,
    pastDateCount,
    save,
  };
}
