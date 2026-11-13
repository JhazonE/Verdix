'use client';

import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { DateRange } from 'react-day-picker';
import { useQuery } from '@tanstack/react-query';
import type { SalesData, ByDateTotals } from './by-date-types';
import type { SalesSourceFilter } from '@/lib/sales-source';

type QueryParams = {
  dateRange: DateRange | undefined;
  terminal: string;
  interval: string;
  paymentType: string;
  sourceFilter: SalesSourceFilter;
  currentPage: number;
  limit: number;
};

export function useByDateQuery({ dateRange, terminal, interval, paymentType, sourceFilter, currentPage, limit }: QueryParams) {
  const [totalPages, setTotalPages] = useState(1);

  const { data: rawData, isLoading } = useQuery({
    queryKey: [
      'salesByDate',
      dateRange?.from?.toISOString(),
      dateRange?.to?.toISOString(),
      terminal,
      interval,
      paymentType,
      sourceFilter,
      currentPage,
      limit,
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (dateRange?.from) params.append('startDate', format(dateRange.from, 'yyyy-MM-dd'));
      if (dateRange?.to) params.append('endDate', format(dateRange.to, 'yyyy-MM-dd'));
      if (terminal && terminal !== 'all') params.append('terminalId', terminal);
      if (interval) params.append('interval', interval);
      if (paymentType && paymentType !== 'all') params.append('paymentType', paymentType);
      if (sourceFilter !== 'all') params.append('source', sourceFilter);
      params.append('page', currentPage.toString());
      params.append('limit', limit.toString());
      const res = await fetch(`/api/sales/by-date?${params.toString()}`);
      return res.json();
    },
    placeholderData: (prev) => prev,
  });

  useEffect(() => {
    if (rawData?.success && rawData.pagination) {
      if (rawData.pagination.totalPages !== totalPages)
        setTotalPages(rawData.pagination.totalPages);
    }
  }, [rawData]);

  const salesData: SalesData[] = rawData?.success ? rawData.data : [];
  // Range-wide totals from the server: the cards must cover every page.
  const totals: ByDateTotals | undefined = rawData?.success ? rawData.totals : undefined;

  return { salesData, isLoading, totalPages, totals };
}
