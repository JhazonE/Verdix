'use client';

import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { useLiveRefresh } from '@/hooks/use-live-refresh';
import type { Product } from '@/lib/types';

import { getProducts } from '../products/actions';
import type { ProductWithChildren } from './product-list-types';

export function useInventoryPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'stock' | 'sku'>('name');
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
    const lower = searchTerm.toLowerCase().trim();
    const matches = (p: Product) =>
      (p.name?.toLowerCase() ?? '').includes(lower) ||
      (p.sku?.toLowerCase() ?? '').includes(lower) ||
      (p.barcode?.toLowerCase() ?? '').includes(lower);

    const matchesType = (p: Product) =>
      typeFilter === 'all' || (p.type ?? 'standard') === typeFilter;

    // Build the parent → child tree from the FULL product list, not from the
    // filtered one. Filtering first would strip a parent whose child matched
    // (leaving the child rendered as a bogus top-level card) or strip the
    // children of a matching parent (hiding its expander entirely).
    const grouped: ProductWithChildren[] = [];
    const parentMap = new Map<string, ProductWithChildren>();

    allLoadedProducts.forEach((p: Product) => {
      if (!p.parentId) {
        const parentItem: ProductWithChildren = { ...p, children: [] };
        grouped.push(parentItem);
        parentMap.set(p.id, parentItem);
      }
    });

    allLoadedProducts.forEach((p: Product) => {
      const parent = p.parentId ? parentMap.get(p.parentId) : undefined;
      if (parent?.children) {
        parent.children.push(p);
      } else if (p.parentId) {
        // Child whose parent is missing from the data set entirely.
        const orphan: ProductWithChildren = { ...p, children: [] };
        grouped.push(orphan);
        parentMap.set(p.id, orphan);
      }
    });

    // Keep a group when the parent OR any of its children satisfies the
    // active search/type filter, so a family is never split apart.
    const visible = grouped.reduce<ProductWithChildren[]>((acc, group) => {
      const children = group.children ?? [];
      const parentHit = (!lower || matches(group)) && matchesType(group);
      const matchedChildren = children.filter(
        (c) => (!lower || matches(c)) && matchesType(c)
      );

      if (!parentHit && matchedChildren.length === 0) return acc;

      // A group surfaced only because a child matched opens expanded, so the
      // hit is visible without the user having to click the chevron.
      acc.push({
        ...group,
        children: parentHit ? children : matchedChildren,
        defaultExpanded: !parentHit && matchedChildren.length > 0,
      });
      return acc;
    }, []);

    visible.sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'stock') return b.stock - a.stock;
      if (sortBy === 'sku') return a.sku.localeCompare(b.sku);
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
