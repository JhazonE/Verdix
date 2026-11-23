'use client';

import { format } from 'date-fns';
import { DateRange } from 'react-day-picker';
import { useQuery } from '@tanstack/react-query';
import { getApiUrl } from '@/lib/api-config';
import type { SalesData, HourlyData, CategoryData } from './analysis-types';
import type { SalesSourceFilter } from '@/lib/sales-source';

type QueryParams = {
  dateRange: DateRange | undefined;
  terminal: string;
  interval: string;
  paymentType: string;
  sourceFilter: SalesSourceFilter;
};

export function useAnalysisQueries({ dateRange, terminal, interval, paymentType, sourceFilter }: QueryParams) {
  // Sent as ?source= to all three endpoints (lib/sales-source.ts).
  const sourceParam = sourceFilter !== 'all' ? sourceFilter : null;
  const { data: salesData = [], isLoading: isLoadingSales } = useQuery<SalesData[]>({
    queryKey: ['analysisSalesData', dateRange?.from?.toISOString(), dateRange?.to?.toISOString(), terminal, interval, paymentType, sourceFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (dateRange?.from) params.append('startDate', format(dateRange.from, 'yyyy-MM-dd'));
      if (dateRange?.to) params.append('endDate', format(dateRange.to, 'yyyy-MM-dd'));
      if (terminal && terminal !== 'all') params.append('terminalId', terminal);
      if (interval) params.append('interval', interval);
      if (paymentType && paymentType !== 'all') params.append('paymentType', paymentType);
      // Every bucket in the range. by-date paginates at 10 by default, so
      // without this the cards and charts covered only the 10 latest days and
      // disagreed with every other report on any longer range.
      params.append('limit', '100000');
      if (sourceParam) params.append('source', sourceParam);
      const res = await fetch(getApiUrl(`/sales/by-date?${params.toString()}`));
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const result = await res.json();
      return result.success ? result.data : [];
    },
  });

  const { data: hourlyData = [], isLoading: isLoadingHourly } = useQuery<HourlyData[]>({
    queryKey: ['analysisHourlyData', dateRange?.from?.toISOString(), sourceFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (dateRange?.from) params.append('date', format(dateRange.from, 'yyyy-MM-dd'));
      if (sourceParam) params.append('source', sourceParam);
      const res = await fetch(getApiUrl(`/sales/hourly?${params.toString()}`));
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const result = await res.json();
      return result.success ? result.data : [];
    },
  });

  const { data: categoryData = [], isLoading: isLoadingCategory } = useQuery<CategoryData[]>({
    queryKey: ['analysisCategoryData', sourceFilter],
    queryFn: async () => {
      const res = await fetch(getApiUrl(`/sales/monthly-category${sourceParam ? `?source=${sourceParam}` : ''}`));
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const result = await res.json();
      return result.success ? result.data : [];
    },
    staleTime: 5 * 60 * 1000,
  });

  return {
    salesData, isLoadingSales,
    hourlyData, isLoadingHourly,
    categoryData, isLoadingCategory,
  };
}
