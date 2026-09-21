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

  useEffect(() => {
    if (!loading && !error) {
      let filtered = products;
      if (selectedBrand) filtered = filtered.filter(p => p.brand === selectedBrand);
      if (selectedCategory) filtered = filtered.filter(p => p.category === selectedCategory);
      setDisplayedProducts(filtered);
    }
  }, [products, loading, error, selectedBrand, selectedCategory]);

  const displayedRows = useMemo<ProductUnitRow[]>(
    () => explodeToUnitRows(displayedProducts),
    [displayedProducts]
  );

  const stableRefresh = useCallback(() => { refetchProducts(); }, [refetchProducts]);
  useLiveRefresh(stableRefresh);

  useEffect(() => {
    if (isOpen) {
      setSearchTerm('');
      setSelectedBrand('');
      setSelectedCategory('');
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
    loading, error,
    handleSelect, stockTone,
    brands, categories,
  };
}
