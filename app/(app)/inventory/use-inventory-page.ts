'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { useLiveRefresh } from '@/hooks/use-live-refresh';
import { resolveDefaultWarehouseId, shouldSeedWarehouseFilter } from '@/lib/default-warehouse';
import { matchesNormalizedSearch, normalizeSearchTerm } from '@/lib/product-search';
import type { Product } from '@/lib/types';

import { getProducts, getWarehouses } from '../products/actions';
import type { ProductWithChildren } from './product-list-types';

export function useInventoryPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'stock' | 'barcode'>('name');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [typeFilter, setTypeFilter] = useState<'all' | 'standard' | 'service'>('all');
  const [warehouseFilter, setWarehouseFilter] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(10);
  const [isBatchDrawerOpen, setIsBatchDrawerOpen] = useState(false);

  const { data: allLoadedProducts = [], isLoading, refetch } = useQuery({
    queryKey: ['inventoryProducts'],
    queryFn: () => getProducts(),
  });

  const { data: warehouses = [] } = useQuery({
    queryKey: ['inventoryWarehouses'],
    queryFn: () => getWarehouses(),
  });

  // Open on the main warehouse rather than on every one of them. A product row
  // is warehouse-specific, so "All Warehouses" lists the same item once per
  // location — see lib/default-warehouse.ts for why that reads as duplicate
  // data. The warehouse list arrives after first render, so the default is
  // seeded here instead of in useState.
  //
  // Seeded exactly ONCE: picking "All Warehouses" is a deliberate choice, and
  // re-applying the default on a later refetch of the warehouse list would
  // snap the filter back under the user mid-browse.
  const hasSeededWarehouseFilter = useRef(false);
  useEffect(() => {
    if (!shouldSeedWarehouseFilter(hasSeededWarehouseFilter.current, warehouses)) return;
    hasSeededWarehouseFilter.current = true;
    const defaultWarehouseId = resolveDefaultWarehouseId(warehouses);
    // No default resolvable (none configured, or all retired) leaves the filter
    // on 'all' — filtering to a warehouse that does not exist would empty the
    // table instead of defaulting it.
    if (defaultWarehouseId) setWarehouseFilter(defaultWarehouseId);
  }, [warehouses]);

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

    const matchesWarehouse = (p: Product) =>
      warehouseFilter === 'all' || (p.warehouseId ?? p.warehouse) === warehouseFilter;

    // One product, one row. The parent/child family model is gone — a product's
    // packaging now lives in its selling units, not in separate child products,
    // so there is no tree to build and nothing to keep grouped.
    const visible: ProductWithChildren[] = allLoadedProducts
      .filter((p: Product) => matchesNormalizedSearch(p, term) && matchesType(p) && matchesWarehouse(p))
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
  }, [allLoadedProducts, searchTerm, sortBy, typeFilter, warehouseFilter]);

  // Counted from the rows already in memory rather than fetched: this page
  // loads every product client-side anyway, so a separate count query would be
  // a round trip for an answer we are holding. Counts ignore the search and
  // type filters on purpose — the scope control answers "how much is in that
  // warehouse", not "how much of my current search is".
  const warehouseCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const product of allLoadedProducts) {
      const id = product.warehouseId ?? product.warehouse;
      if (id) counts[String(id)] = (counts[String(id)] ?? 0) + 1;
    }
    return counts;
  }, [allLoadedProducts]);

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

  const handleWarehouseFilterChange = (value: string) => {
    // Marked here as well as in the effect: a user who picks a warehouse
    // before the list finishes loading must not have it overwritten by the
    // seed that follows.
    hasSeededWarehouseFilter.current = true;
    setWarehouseFilter(value);
    setCurrentPage(1);
  };

  return {
    warehouses,
    warehouseFilter,
    warehouseCounts,
    warehouseTotal: allLoadedProducts.length,
    handleWarehouseFilterChange,
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
