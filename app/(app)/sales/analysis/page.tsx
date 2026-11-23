'use client';

import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useSalesAnalysis } from './use-sales-analysis';
import { AnalysisSummaryCards } from './AnalysisSummaryCards';
import { AnalysisFilterBar } from './AnalysisFilterBar';
import { AnalysisChartsGrid } from './AnalysisChartsGrid';
import { AnalysisFiltersDialog } from './AnalysisFiltersDialog';

export default function SalesAnalysisPage() {
  const {
    dateRange, setDateRange,
    interval, setInterval,
    sourceFilter, setSourceFilter,
    filterDialogOpen, setFilterDialogOpen,
    tempTerminal, setTempTerminal,
    tempInterval, setTempInterval,
    tempPaymentType, setTempPaymentType,
    salesData, hourlyData, categoryData,
    isLoadingSales, isLoadingHourly, isLoadingCategory,
    hasActiveFilters, summaryTotals, avgTransactionValue,
    resetFilters, applyAdvancedFilters,
    formatCurrency, formatDate,
    exportToCSV, exportToPDF,
  } = useSalesAnalysis();

  return (
    <div className="grid gap-6 auto-rows-max">
      <Card>
        <CardHeader className="py-4">
          <CardTitle>Sales Analysis</CardTitle>
          <CardDescription>
            Comprehensive sales performance analytics across multiple dimensions.
          </CardDescription>
        </CardHeader>
      </Card>

      <AnalysisSummaryCards
        summaryTotals={summaryTotals}
        avgTransactionValue={avgTransactionValue}
        formatCurrency={formatCurrency}
      />

      <AnalysisFilterBar
        dateRange={dateRange}
        setDateRange={setDateRange}
        interval={interval}
        sourceFilter={sourceFilter}
        setSourceFilter={setSourceFilter}
        setInterval={setInterval}
        hasActiveFilters={hasActiveFilters}
        resetFilters={resetFilters}
        onOpenAdvancedFilters={() => setFilterDialogOpen(true)}
        exportToCSV={exportToCSV}
        exportToPDF={exportToPDF}
      />

      <AnalysisChartsGrid
        salesData={salesData}
        hourlyData={hourlyData}
        categoryData={categoryData}
        isLoadingSales={isLoadingSales}
        isLoadingHourly={isLoadingHourly}
        isLoadingCategory={isLoadingCategory}
        interval={interval}
        formatDate={formatDate}
      />

      <AnalysisFiltersDialog
        open={filterDialogOpen}
        onOpenChange={setFilterDialogOpen}
        tempInterval={tempInterval}
        setTempInterval={setTempInterval}
        tempTerminal={tempTerminal}
        setTempTerminal={setTempTerminal}
        tempPaymentType={tempPaymentType}
        setTempPaymentType={setTempPaymentType}
        onApply={applyAdvancedFilters}
      />
    </div>
  );
}
