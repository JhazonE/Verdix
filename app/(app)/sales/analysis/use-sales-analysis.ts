'use client';

export type { SalesData, HourlyData, CategoryData } from './analysis-types';
export { chartConfig, COLORS } from './analysis-types';

import { useAnalysisFilters } from './use-analysis-filters';
import { useAnalysisQueries } from './use-analysis-queries';
import { useAnalysisUtils } from './use-analysis-utils';

export function useSalesAnalysis() {
  const filters = useAnalysisFilters();

  const queries = useAnalysisQueries({
    dateRange: filters.dateRange,
    terminal: filters.terminal,
    interval: filters.interval,
    paymentType: filters.paymentType,
    sourceFilter: filters.sourceFilter,
  });

  const utils = useAnalysisUtils({
    salesData: queries.salesData,
    interval: filters.interval,
  });

  return {
    ...filters,
    ...queries,
    ...utils,
  };
}
