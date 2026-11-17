'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { Product } from '@/lib/types';
import { useProducts } from '@/hooks/use-api';
import { useLiveRefresh } from '@/hooks/use-live-refresh';
import { useDebounce } from '@/hooks/use-debounce';
import { explodeToUnitRows, type ProductUnitRow } from '@/lib/selling-unit-rows';

export type { ProductUnitRow };

type Options = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectProduct: (product: Product, explicitUnitId?: string) => void;
  activeLevelId?: string;
  warehouseId?: string;
  allProducts?: Product[];
};

export function useProductSearch({
  isOpen,
  onOpenChange,
  onSelectProduct,
  activeLevelId,
  warehouseId,
  allProducts = [],
}: Options) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedBrand, setSelectedBrand] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');

  const debouncedSearchTerm = useDebounce(searchTerm, 300);
  const { products, loading, error, refetch: refetchProducts } = useProducts(
    debouncedSearchTerm,
    'Available',
    undefined,
    warehouseId
  );

  const [displayedProducts, setDisplayedProducts] = useState<Product[]>([]);
  // The search term the rows on screen were actually fetched for. While the
  // cashier is typing (debounce) or the server is still answering, the list
  // still shows the PREVIOUS term's rows — and cmdk highlights the first one.
  // A barcode scanner types the code and presses Enter in a few milliseconds,
  // so without this guard Enter added whatever product sat in the first row
  // of the stale list instead of the scanned one.
  const [resultsTerm, setResultsTerm] = useState('');
  const [pendingEnter, setPendingEnter] = useState(false);

  useEffect(() => {
    if (!loading && !error) {
      let filtered = products;
      if (selectedBrand) filtered = filtered.filter(p => p.brand === selectedBrand);
      if (selectedCategory) filtered = filtered.filter(p => p.category === selectedCategory);
      setDisplayedProducts(filtered);
      setResultsTerm(debouncedSearchTerm);
    }
  }, [products, loading, error, selectedBrand, selectedCategory, debouncedSearchTerm]);

  const displayedRows = useMemo<ProductUnitRow[]>(
    () => explodeToUnitRows(displayedProducts),
    [displayedProducts]
  );

  const isStale = searchTerm.trim() !== resultsTerm.trim();

  const stableRefresh = useCallback(() => { refetchProducts(); }, [refetchProducts]);
  useLiveRefresh(stableRefresh);

  useEffect(() => {
    if (isOpen) {
      setSearchTerm('');
      setSelectedBrand('');
      setSelectedCategory('');
      setPendingEnter(false);
    }
  }, [isOpen, activeLevelId]);

  useEffect(() => {
    if (isOpen) {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'F9') {
          e.preventDefault();
          e.stopPropagation();
          onOpenChange(false);
        }
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, onOpenChange]);

  const handleSelect = useCallback((rowKey: string) => {
    const row = displayedRows.find(r => r.key === rowKey);
    if (row) {
      onSelectProduct(row.product, row.unit?.id);
      onOpenChange(false);
    }
  }, [displayedRows, onSelectProduct, onOpenChange]);

  // Enter pressed before the results for the typed term arrived: hold it,
  // and keep it from reaching cmdk (which would select the stale first row).
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && isStale && searchTerm.trim()) {
      e.preventDefault();
      setPendingEnter(true);
    }
  }, [isStale, searchTerm]);

  // Once the fresh results land, resolve the held Enter: an exact barcode/SKU
  // match wins (that's what a scan means), otherwise the first fresh row.
  useEffect(() => {
    if (!pendingEnter || isStale || loading) return;
    setPendingEnter(false);
    const term = searchTerm.trim().toLowerCase();
    if (!term || displayedRows.length === 0) return;
    const exact = displayedRows.find(r =>
      (r.unit?.barcode || '').toLowerCase() === term ||
      (!r.unit && (r.product.barcode || '').toLowerCase() === term) ||
      (r.product.sku || '').toLowerCase() === term
    );
    handleSelect((exact ?? displayedRows[0]).key);
  }, [pendingEnter, isStale, loading, searchTerm, displayedRows, handleSelect]);

  const stockTone = useCallback((product: Product) => {
    if (product.stock <= 0) return 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300';
    if (product.reorderPoint && product.stock <= product.reorderPoint) return 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300';
    return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300';
  }, []);

  // Derive unique brands and categories from the full product list
  const brands = useMemo(() => {
    const source = allProducts.length > 0 ? allProducts : products;
    return [...new Set(source.map(p => p.brand).filter(Boolean))].sort() as string[];
  }, [allProducts, products]);

  const categories = useMemo(() => {
    const source = allProducts.length > 0 ? allProducts : products;
    return [...new Set(source.map(p => p.category).filter(Boolean))].sort() as string[];
  }, [allProducts, products]);

  return {
    searchTerm, setSearchTerm,
    selectedBrand, setSelectedBrand,
    selectedCategory, setSelectedCategory,
    displayedRows,
    loading, error, isStale,
    handleSelect, handleKeyDown, stockTone,
    brands, categories,
  };
}
