'use client';

import { useState } from 'react';
import { DateRange } from 'react-day-picker';
import type { SalesSourceFilter } from '@/lib/sales-source';

export function useAnalysisFilters() {
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [terminal, setTerminal] = useState<string>('all');
  const [interval, setInterval] = useState<string>('daily');
  const [paymentType, setPaymentType] = useState<string>('all');
  // All / POS / Backoffice — applies immediately, like the other sales reports.
  const [sourceFilter, setSourceFilter] = useState<SalesSourceFilter>('all');

  const [filterDialogOpen, setFilterDialogOpen] = useState(false);
  const [tempDateRange, setTempDateRange] = useState<DateRange | undefined>(undefined);
  const [tempTerminal, setTempTerminal] = useState<string>('all');
  const [tempInterval, setTempInterval] = useState<string>('daily');
  const [tempPaymentType, setTempPaymentType] = useState<string>('all');

  const hasActiveFilters = !!(
    dateRange || terminal !== 'all' || interval !== 'daily' || paymentType !== 'all' || sourceFilter !== 'all'
  );

  const resetFilters = () => {
    setDateRange(undefined);
    setTerminal('all');
    setInterval('daily');
    setPaymentType('all');
    setSourceFilter('all');
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
    filterDialogOpen, setFilterDialogOpen,
    tempDateRange, setTempDateRange,
    tempTerminal, setTempTerminal,
    tempInterval, setTempInterval,
    tempPaymentType, setTempPaymentType,
    hasActiveFilters,
    resetFilters,
    applyAdvancedFilters,
  };
}
