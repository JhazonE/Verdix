'use client';

import { useState } from 'react';
import { DateRange } from 'react-day-picker';
import type { SalesSourceFilter } from '@/lib/sales-source';

export function useByDateFilters() {
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [terminal, setTerminal] = useState<string>('all');
  // eslint-disable-next-line no-shadow
  const [interval, setInterval] = useState<string>('daily');
  const [paymentType, setPaymentType] = useState<string>('all');
  // All / POS / Backoffice. See lib/sales-source.ts.
  const [sourceFilter, setSourceFilterState] = useState<SalesSourceFilter>('all');
  const [transactionReference, setTransactionReference] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');

  const [currentPage, setCurrentPage] = useState(1);
  const [limit, setLimit] = useState(10);

  const [filterDialogOpen, setFilterDialogOpen] = useState(false);
  const [tempTerminal, setTempTerminal] = useState<string>('all');
  const [tempInterval, setTempInterval] = useState<string>('daily');
  const [tempPaymentType, setTempPaymentType] = useState<string>('all');

  const hasActiveFilters = !!(
    dateRange || terminal !== 'all' || interval !== 'daily' || paymentType !== 'all' || searchTerm || sourceFilter !== 'all'
  );

  const setSourceFilter = (v: SalesSourceFilter) => { setSourceFilterState(v); setCurrentPage(1); };

  const resetFilters = () => {
    setDateRange(undefined);
    setTerminal('all');
    setInterval('daily');
    setPaymentType('all');
    setSourceFilterState('all');
    setTransactionReference('');
    setSearchTerm('');
    setCurrentPage(1);
  };

  const applyAdvancedFilters = () => {
    setTerminal(tempTerminal);
    setInterval(tempInterval);
    setPaymentType(tempPaymentType);
    setFilterDialogOpen(false);
  };

  return {
    dateRange, setDateRange,
    terminal, setTerminal,
    interval, setInterval,
    paymentType, setPaymentType,
    sourceFilter, setSourceFilter,
    transactionReference, setTransactionReference,
    searchTerm, setSearchTerm,
    currentPage, setCurrentPage,
    limit, setLimit,
    filterDialogOpen, setFilterDialogOpen,
    tempTerminal, setTempTerminal,
    tempInterval, setTempInterval,
    tempPaymentType, setTempPaymentType,
    hasActiveFilters,
    resetFilters,
    applyAdvancedFilters,
  };
}
