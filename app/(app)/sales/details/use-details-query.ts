'use client';

import { format } from 'date-fns';
import { DateRange } from 'react-day-picker';
import { useQuery } from '@tanstack/react-query';
import type { SummaryTotals } from './use-details-utils';

type QueryParams = {
  dateRange: DateRange | undefined;
  terminalId: string;
  paymentTypeFilter: string;
  currentPage: number;
  limit: number;
};

export function useDetailsQuery({ dateRange, terminalId, paymentTypeFilter, currentPage, limit }: QueryParams) {
  const { data: salesResult, isLoading } = useQuery({
    queryKey: ['salesDetails', dateRange?.from?.toISOString(), dateRange?.to?.toISOString(), terminalId, paymentTypeFilter, currentPage, limit],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (dateRange?.from) params.append('startDate', format(dateRange.from, 'yyyy-MM-dd'));
      if (dateRange?.to) params.append('endDate', format(dateRange.to, 'yyyy-MM-dd'));
      if (terminalId && terminalId !== 'all') params.append('terminalId', terminalId);
      if (paymentTypeFilter && paymentTypeFilter !== 'all') params.append('paymentMethod', paymentTypeFilter);
      params.append('page', currentPage.toString());
      params.append('limit', limit.toString());
      const res = await fetch(`/api/sales/transactions?${params.toString()}`);
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const result = await res.json();
      if (!result.success) throw new Error(result.error || 'Failed to fetch sales');
      return result;
    },
    placeholderData: (prev) => prev,
  });

  const sales: any[] = salesResult?.data || [];
  const totalPages: number = salesResult?.pagination?.totalPages ?? 1;
  const totalRecords: number = salesResult?.pagination?.totalRecords ?? 0;
  const totals: SummaryTotals | undefined = salesResult?.totals;

  return { sales, isLoading, totalPages, totalRecords, totals };
}
