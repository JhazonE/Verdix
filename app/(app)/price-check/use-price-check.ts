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

  // `error` is read deliberately: on a failed fetch `useProducts` returns an
  // EMPTY array with loading already false, so a naive `notFound` would tell
  // the customer their product does not exist when in fact the terminal is
  // offline. A customer who reads "no product found" may put the item back.
  const { products, loading, error } = useProducts(searchTerm);

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
  // Gated on `!loading`: mid-flight, `candidates` still holds the PREVIOUS
  // search's results, and matching against those would briefly show the last
  // customer's product.
  const exactBarcodeMatch = useMemo(() => {
    const term = searchTerm.trim();
    if (!term || loading) return null;
    return (
      candidates.find((p) =>
        p.sellingUnits?.some((su) => su.barcode && su.barcode === term),
      ) ||
      candidates.find((p) => p.barcode && p.barcode === term) ||
      null
    );
  }, [candidates, searchTerm, loading]);

  const selected = useMemo(() => {
    if (selectedId) return candidates.find((p) => p.id === selectedId) ?? null;
    if (exactBarcodeMatch) return exactBarcodeMatch;
    // Deliberately NO auto-select on a single fuzzy match. The server search is
    // a LIKE over name/SKU/barcode, so a partially-read barcode ("480001664111"
    // with the last digit dropped) can match exactly one product — and a guess
    // rendered full-screen with a big price is indistinguishable from a
    // confirmed hit. A torn barcode is the expected input here, so a single
    // fuzzy match goes to the pick-list for the customer to confirm.
    return null;
  }, [selectedId, candidates, exactBarcodeMatch]);

  // The scanned code decides WHICH unit is quoted: a Case barcode must show
  // the Case price, as POS does. Only pass it when it actually matched a
  // barcode — a name search must not be read as a code.
  const scannedCode = exactBarcodeMatch && exactBarcodeMatch.id === selected?.id
    ? searchTerm.trim()
    : undefined;

  const result: KioskResult | null = useMemo(
    () => (selected ? resolveKioskPrice(selected, defaultLevelId, scannedCode) : null),
    [selected, defaultLevelId, scannedCode],
  );

  /**
   * A STABLE identifier for "which result is on screen", for the idle timer to
   * key on.
   *
   * The timer must not depend on `result` itself: `useProducts` refetches every
   * 30s AND on every `stock-updated` event (i.e. every sale anywhere in the
   * store), and its queryFn re-maps the payload, so `result`'s identity changes
   * whenever `stock` moves. A timer keyed on that identity is cleared and
   * re-armed on every refetch and never expires — leaving the previous
   * customer's price on display indefinitely.
   */
  const resultToken = result ? `${result.product.id}:${result.price}` : '';

  // A fetch failure is NOT "no such product" — see the `error` note above.
  const notFound = useMemo(
    () => Boolean(searchTerm.trim()) && !loading && !error && candidates.length === 0,
    [searchTerm, loading, error, candidates.length],
  );

  const offline = useMemo(
    () => Boolean(searchTerm.trim()) && !loading && Boolean(error),
    [searchTerm, loading, error],
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
    resultToken,
    candidates,
    notFound,
    offline,
    loading,
    select,
    clear,
  };
}
