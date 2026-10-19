'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import type { Product } from '@/lib/types';
import { useProducts } from '@/hooks/use-api';
import { getApiUrl } from '@/lib/api-config';
import { resolveKioskPrice, type KioskResult } from '@/lib/kiosk-price';

/**
 * State for the self-service price-checker kiosk.
 *
 * The scanner is the primary input: it types a barcode and sends Enter. The
 * search box exists only as a fallback for a torn or unreadable barcode, so a
 * customer is never left at a dead end.
 *
 * `useProducts` already subscribes to `useLiveRefresh` internally, so this
 * hook deliberately does NOT subscribe again — a second subscription would
 * refetch twice on every stock event.
 */
export function usePriceCheck() {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [priceLevels, setPriceLevels] = useState<any[]>([]);

  const { products, loading } = useProducts(searchTerm);

  // Price levels change rarely and the kiosk never switches level, so this is
  // fetched once on mount rather than per lookup.
  useEffect(() => {
    let cancelled = false;
    fetch(getApiUrl('/price-levels'), { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((result) => {
        if (!cancelled && result?.success && Array.isArray(result.data)) {
          setPriceLevels(result.data);
        }
      })
      .catch(() => {
        // A kiosk that cannot read its price levels still shows the product's
        // own price via the 'retail-level' fallback below. Silence is correct
        // here: there is nobody at the terminal to action an error.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Same expression POS uses (use-pos.ts:604), so the two agree on which level
  // is the default.
  const defaultLevelId = useMemo(
    () => priceLevels.find((l: any) => l.isDefault || l.is_default)?.id || 'retail-level',
    [priceLevels],
  );

  const candidates: Product[] = products;

  /**
   * A scan should land on the price with no further interaction, so an exact
   * barcode hit on any of a product's selling units auto-selects.
   */
  const exactBarcodeMatch = useMemo(() => {
    const term = searchTerm.trim();
    if (!term) return null;
    return (
      candidates.find((p) =>
        p.sellingUnits?.some((su) => su.barcode && su.barcode === term),
      ) ||
      candidates.find((p) => p.barcode && p.barcode === term) ||
      null
    );
  }, [candidates, searchTerm]);

  const selected = useMemo(() => {
    if (selectedId) return candidates.find((p) => p.id === selectedId) ?? null;
    if (exactBarcodeMatch) return exactBarcodeMatch;
    // A name search that narrows to exactly one product needs no extra tap.
    if (searchTerm.trim() && !loading && candidates.length === 1) return candidates[0];
    return null;
  }, [selectedId, candidates, exactBarcodeMatch, searchTerm, loading]);

  const result: KioskResult | null = useMemo(
    () => (selected ? resolveKioskPrice(selected, defaultLevelId) : null),
    [selected, defaultLevelId],
  );

  const notFound = useMemo(
    () => Boolean(searchTerm.trim()) && !loading && candidates.length === 0,
    [searchTerm, loading, candidates.length],
  );

  const select = useCallback((productId: string) => setSelectedId(productId), []);

  const clear = useCallback(() => {
    setSelectedId(null);
    setSearchTerm('');
  }, []);

  // A new search term must drop the previous pick, or the screen would keep
  // showing the last customer's product while a new barcode is being typed.
  const updateSearchTerm = useCallback((next: string) => {
    setSelectedId(null);
    setSearchTerm(next);
  }, []);

  return {
    searchTerm,
    setSearchTerm: updateSearchTerm,
    result,
    candidates,
    notFound,
    loading,
    select,
    clear,
  };
}
