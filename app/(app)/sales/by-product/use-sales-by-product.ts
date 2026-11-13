'use client';

import { useByProductFilters } from './use-by-product-filters';
import { useByProductQuery } from './use-by-product-query';
import { useByProductUtils } from './use-by-product-utils';
import { useByProductTable } from './use-by-product-table';

export function useSalesByProduct() {
  const filters = useByProductFilters();

  const query = useByProductQuery({
    searchTerm: filters.searchTerm,
    dateRange: filters.dateRange,
    terminal: filters.terminal,
    categoryFilter: filters.categoryFilter,
    brandFilter: filters.brandFilter,
    cashierFilter: filters.cashierFilter,
    referenceFilter: filters.referenceFilter,
    sourceFilter: filters.sourceFilter,
    currentPage: filters.currentPage,
    limit: filters.limit,
  });

  const utils = useByProductUtils({
    productSales: query.productSales,
    dateRange: filters.dateRange,
    terminal: filters.terminal,
    categoryFilter: filters.categoryFilter,
    brandFilter: filters.brandFilter,
    cashierFilter: filters.cashierFilter,
    referenceFilter: filters.referenceFilter,
    searchTerm: filters.searchTerm,
    sourceFilter: filters.sourceFilter,
    totals: query.totals,
  });

  const tableState = useByProductTable({
    productSales: query.productSales,
    totalPages: query.totalPages,
    dateRange: filters.dateRange,
    terminal: filters.terminal,
    sourceFilter: filters.sourceFilter,
  });

  return {
    ...filters,
    ...query,
    ...utils,
    ...tableState,
  };
}
