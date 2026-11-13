'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useSalesByDate } from './use-sales-by-date';
import { ByDateSummaryCards } from './ByDateSummaryCards';
import { ByDateFilterBar } from './ByDateFilterBar';
import { ByDateTable } from './ByDateTable';
import { ByDatePagination } from './ByDatePagination';
import { ByDateFiltersDialog } from './ByDateFiltersDialog';

export default function SalesByDatePage() {
  const {
    dateRange, setDateRange,
    interval, setInterval,
    sourceFilter, setSourceFilter,
    searchTerm, setSearchTerm,
    currentPage, setCurrentPage,
    limit, setLimit,
    totalPages,
    filterDialogOpen, setFilterDialogOpen,
    tempTerminal, setTempTerminal,
    tempInterval, setTempInterval,
    tempPaymentType, setTempPaymentType,
    transactionReference, setTransactionReference,
    hasActiveFilters,
    resetFilters,
    applyAdvancedFilters,
    formatCurrency,
    formatDate,
    filteredSalesData,
    summaryTotals,
    exportToCSV,
    exportToPDF,
    isLoading,
    table,
    expandedRows,
    transactionsByDate,
    loadingTransactions,
    toggleRowExpansion,
  } = useSalesByDate();

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="py-4">
        <CardTitle>Sales By Date</CardTitle>
        <CardDescription>
          Comprehensive sales report aggregated by {interval}.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col gap-4 overflow-auto">
        <ByDateSummaryCards
          summaryTotals={summaryTotals}
          formatCurrency={formatCurrency}
        />

        <ByDateFilterBar
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          dateRange={dateRange}
          setDateRange={setDateRange}
          interval={interval}
          setInterval={setInterval}
          hasActiveFilters={hasActiveFilters}
          resetFilters={resetFilters}
          sourceFilter={sourceFilter}
          setSourceFilter={setSourceFilter}
          onOpenAdvancedFilters={() => setFilterDialogOpen(true)}
          exportToCSV={exportToCSV}
          exportToPDF={exportToPDF}
          table={table}
        />

        <ByDateTable
          table={table}
          isLoading={isLoading}
          expandedRows={expandedRows}
          transactionsByDate={transactionsByDate}
          loadingTransactions={loadingTransactions}
          toggleRowExpansion={toggleRowExpansion}
          formatDate={formatDate}
          formatCurrency={formatCurrency}
        />

        {!isLoading && filteredSalesData.length > 0 && (
          <ByDatePagination
            currentPage={currentPage}
            totalPages={totalPages}
            limit={limit}
            onPageChange={(page) => setCurrentPage(page)}
            onLimitChange={(val) => { setLimit(val); setCurrentPage(1); }}
          />
        )}
      </CardContent>

      <ByDateFiltersDialog
        open={filterDialogOpen}
        onOpenChange={setFilterDialogOpen}
        tempInterval={tempInterval}
        setTempInterval={setTempInterval}
        tempTerminal={tempTerminal}
        setTempTerminal={setTempTerminal}
        tempPaymentType={tempPaymentType}
        setTempPaymentType={setTempPaymentType}
        transactionReference={transactionReference}
        setTransactionReference={setTransactionReference}
        onApply={applyAdvancedFilters}
      />
    </Card>
  );
}
