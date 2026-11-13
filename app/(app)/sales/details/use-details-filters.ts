'use client';

import { useState } from 'react';
import { DateRange } from 'react-day-picker';
import type { SalesSourceFilter } from '@/lib/sales-source';

export function useDetailsFilters() {
  const [searchTerm, setSearchTerm] = useState('');
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [terminalId, setTerminalId] = useState<string>('all');
  const [paymentTypeFilter, setPaymentTypeFilter] = useState<string>('all');
  const [salesStatusFilter, setSalesStatusFilter] = useState<string>('all');
  // All / POS / Backoffice. See lib/sales-source.ts.
  const [sourceFilter, setSourceFilterState] = useState<SalesSourceFilter>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const [paymentTypeDialogOpen, setPaymentTypeDialogOpen] = useState(false);
  const [terminalDialogOpen, setTerminalDialogOpen] = useState(false);
  const [dateRangeDialogOpen, setDateRangeDialogOpen] = useState(false);
  const [tempPaymentType, setTempPaymentType] = useState<string>('all');
  const [tempTerminalId, setTempTerminalId] = useState<string>('all');
  const [tempDateRange, setTempDateRange] = useState<DateRange | undefined>(undefined);

  const hasActiveFilters = !!(
    searchTerm || dateRange || terminalId !== 'all' ||
    paymentTypeFilter !== 'all' || salesStatusFilter !== 'all' || sourceFilter !== 'all'
  );

  const resetFilters = () => {
    setSearchTerm('');
    setDateRange(undefined);
    setTerminalId('all');
    setPaymentTypeFilter('all');
    setSalesStatusFilter('all');
    setSourceFilterState('all');
    setCurrentPage(1);
    setExpandedRows(new Set());
  };

  const setSourceFilter = (v: SalesSourceFilter) => { setSourceFilterState(v); setCurrentPage(1); };

  const toggleRowExpansion = (id: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  };

  const handlePageChange = (page: number) => {
    if (page >= 1) setCurrentPage(page);
  };

  const applyPaymentType = () => { setPaymentTypeFilter(tempPaymentType); setPaymentTypeDialogOpen(false); };
  const applyTerminal = () => { setTerminalId(tempTerminalId); setTerminalDialogOpen(false); };
  const applyDateRange = () => { setDateRange(tempDateRange); setDateRangeDialogOpen(false); };

  const handleSearchChange = (value: string) => {
    setSearchTerm(value);
    setCurrentPage(1);
  };

  return {
    searchTerm, setSearchTerm: handleSearchChange,
    dateRange, setDateRange,
    terminalId, setTerminalId,
    paymentTypeFilter, setPaymentTypeFilter,
    salesStatusFilter, setSalesStatusFilter,
    sourceFilter, setSourceFilter,
    currentPage, setCurrentPage,
    limit, setLimit,
    expandedRows,
    paymentTypeDialogOpen, setPaymentTypeDialogOpen,
    terminalDialogOpen, setTerminalDialogOpen,
    dateRangeDialogOpen, setDateRangeDialogOpen,
    tempPaymentType, setTempPaymentType,
    tempTerminalId, setTempTerminalId,
    tempDateRange, setTempDateRange,
    hasActiveFilters,
    resetFilters,
    toggleRowExpansion,
    handlePageChange,
    applyPaymentType,
    applyTerminal,
    applyDateRange,
  };
}
