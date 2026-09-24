'use client';

import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { useLiveRefresh } from '@/hooks/use-live-refresh';
import { matchesNormalizedSearch, normalizeSearchTerm } from '@/lib/product-search';
import type { Product } from '@/lib/types';

import { getProducts } from '../products/actions';
import type { ProductWithChildren } from './product-list-types';

export function useInventoryPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'stock' | 'barcode'>('name');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [typeFilter, setTypeFilter] = useState<'all' | 'standard' | 'service'>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(10);
  const [isBatchDrawerOpen, setIsBatchDrawerOpen] = useState(false);

  const { data: allLoadedProducts = [], isLoading, refetch } = useQuery({
    queryKey: ['inventoryProducts'],
    queryFn: () => getProducts(),
  });

  const { data: posSettings } = useQuery({
    queryKey: ['posSettings'],
    queryFn: async () => {
      const response = await fetch('/api/pos-settings');
      if (!response.ok) throw new Error('Failed to fetch POS settings');
      return response.json();
    }
  });

  const loadProducts = useCallback(() => {
    refetch();
  }, [refetch]);

  useLiveRefresh(refetch);

  const products = useMemo(() => {
    // Normalize once rather than re-lowercasing the term for every product on
    // every keystroke. Matching covers the base selling unit's barcode as well
    // as name — see lib/product-search.ts.
    const term = normalizeSearchTerm(searchTerm);

    const matchesType = (p: Product) =>
      typeFilter === 'all' || (p.type ?? 'standard') === typeFilter;

    // One product, one row. The parent/child family model is gone — a product's
    // packaging now lives in its selling units, not in separate child products,
    // so there is no tree to build and nothing to keep grouped.
    const visible: ProductWithChildren[] = allLoadedProducts
      .filter((p: Product) => matchesNormalizedSearch(p, term) && matchesType(p))
      .map((p: Product) => ({ ...p, children: [] }));

    visible.sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'stock') return b.stock - a.stock;
      if (sortBy === 'barcode') {
        const aBarcode = a.sellingUnits?.find((su) => su.isBase)?.barcode ?? a.barcode ?? '';
        const bBarcode = b.sellingUnits?.find((su) => su.isBase)?.barcode ?? b.barcode ?? '';
        return aBarcode.localeCompare(bBarcode);
      }
      return 0;
    });

    return visible;
  }, [allLoadedProducts, searchTerm, sortBy, typeFilter]);

  const totalProducts = products.length;
  const pagedProducts = useMemo(() =>
    products.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [products, currentPage, pageSize]
  );

  const handleSearch = (value: string) => {
    setSearchTerm(value);
    setCurrentPage(1);
  };

  const handleClearSearch = () => {
    setSearchTerm('');
    setCurrentPage(1);
  };

  const handleTypeFilterChange = (value: 'all' | 'standard' | 'service') => {
    setTypeFilter(value);
    setCurrentPage(1);
  };

  return {
    searchTerm,
    handleSearch,
    handleClearSearch,
    sortBy,
    setSortBy,
    viewMode,
    setViewMode,
    typeFilter,
    setTypeFilter,
    handleTypeFilterChange,
    currentPage,
    setCurrentPage,
    pageSize,
    isBatchDrawerOpen,
    setIsBatchDrawerOpen,
    isLoading,
    products,
    pagedProducts,
    totalProducts,
    loadProducts,
    posSettings,
  };
}
