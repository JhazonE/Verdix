'use client';

import { useByDateFilters } from './use-by-date-filters';
import { useByDateQuery } from './use-by-date-query';
import { useByDateUtils } from './use-by-date-utils';
import { useByDateTable } from './use-by-date-table';

export function useSalesByDate() {
  const filters = useByDateFilters();

  const { salesData, isLoading, totalPages, totals } = useByDateQuery({
    dateRange: filters.dateRange,
    terminal: filters.terminal,
    interval: filters.interval,
    paymentType: filters.paymentType,
    sourceFilter: filters.sourceFilter,
    currentPage: filters.currentPage,
    limit: filters.limit,
  });

  const utils = useByDateUtils({
    salesData,
    totals,
    interval: filters.interval,
    dateRange: filters.dateRange,
    terminal: filters.terminal,
    paymentType: filters.paymentType,
    searchTerm: filters.searchTerm,
  });

  const tableState = useByDateTable({
    filteredSalesData: utils.filteredSalesData,
    totalPages,
    formatDate: utils.formatDate,
    formatCurrency: utils.formatCurrency,
    terminal: filters.terminal,
    interval: filters.interval,
    sourceFilter: filters.sourceFilter,
  });

  return {
    ...filters,
    ...utils,
    ...tableState,
    isLoading,
    totalPages,
  };
}
