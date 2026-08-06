'use client';

import { useDetailsFilters } from './use-details-filters';
import { useDetailsQuery } from './use-details-query';
import { useDetailsUtils } from './use-details-utils';
import { useDetailsTable } from './use-details-table';

export function useSalesDetails() {
  const filters = useDetailsFilters();
  const { sales, isLoading, totalPages } = useDetailsQuery({
    dateRange: filters.dateRange,
    terminalId: filters.terminalId,
    paymentTypeFilter: filters.paymentTypeFilter,
    currentPage: filters.currentPage,
    limit: filters.limit,
  });
  const { filteredSales, summaryTotals, exportToCSV, exportToPDF } = useDetailsUtils({
    sales,
    searchTerm: filters.searchTerm,
    dateRange: filters.dateRange,
    terminalId: filters.terminalId,
    paymentTypeFilter: filters.paymentTypeFilter,
  });
  const { table } = useDetailsTable({ filteredSales, totalPages, expandedRows: filters.expandedRows });

  return {
    ...filters,
    sales,
    isLoading,
    totalPages,
    filteredSales,
    summaryTotals,
    exportToCSV,
    exportToPDF,
    table,
  };
}
