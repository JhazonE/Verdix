'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useSalesDetails } from './use-sales-details';
import { DetailsSummaryCards } from './DetailsSummaryCards';
import { DetailsFilterBar } from './DetailsFilterBar';
import { DetailsTable } from './DetailsTable';
import { DetailsPagination } from './DetailsPagination';
import { PaymentTypeFilterDialog, TerminalFilterDialog, DateRangeFilterDialog } from './DetailsFilterDialogs';

export default function SalesDetailsPage() {
  const {
    searchTerm, setSearchTerm,
    dateRange,
    terminalId,
    paymentTypeFilter,
    currentPage, limit, setLimit,
    expandedRows,
    paymentTypeDialogOpen, setPaymentTypeDialogOpen,
    terminalDialogOpen, setTerminalDialogOpen,
    dateRangeDialogOpen, setDateRangeDialogOpen,
    tempPaymentType, setTempPaymentType,
    tempTerminalId, setTempTerminalId,
    tempDateRange, setTempDateRange,
    hasActiveFilters, resetFilters,
    toggleRowExpansion, handlePageChange,
    applyPaymentType, applyTerminal, applyDateRange,
    filteredSales,
    summaryTotals,
    exportToCSV, exportToPDF,
    isLoading, totalPages, totalRecords,
    table,
  } = useSalesDetails();

  return (
    <div className="flex-1 space-y-4 p-8 pt-6">
      <div className="flex items-center justify-between space-y-2">
        <h2 className="text-3xl font-bold tracking-tight">Sales Details</h2>
      </div>

      <DetailsSummaryCards totals={summaryTotals} transactionCount={totalRecords} />

      <Card>
        <CardHeader>
          <CardTitle>Transaction Records</CardTitle>
          <CardDescription>Detailed breakdown of all sales transactions.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            <DetailsFilterBar
              searchTerm={searchTerm}
              setSearchTerm={setSearchTerm}
              dateRange={dateRange}
              paymentTypeFilter={paymentTypeFilter}
              terminalId={terminalId}
              hasActiveFilters={hasActiveFilters}
              resetFilters={resetFilters}
              onOpenPaymentType={() => { setTempPaymentType(paymentTypeFilter); setPaymentTypeDialogOpen(true); }}
              onOpenTerminal={() => { setTempTerminalId(terminalId); setTerminalDialogOpen(true); }}
              onOpenDateRange={() => { setTempDateRange(dateRange); setDateRangeDialogOpen(true); }}
              exportToCSV={exportToCSV}
              exportToPDF={exportToPDF}
              table={table}
            />

            <DetailsTable
              table={table}
              isLoading={isLoading}
              expandedRows={expandedRows}
              onToggleRow={toggleRowExpansion}
            />

            {!isLoading && filteredSales.length > 0 && (
              <DetailsPagination
                currentPage={currentPage}
                totalPages={totalPages}
                limit={limit}
                onPageChange={handlePageChange}
                onLimitChange={setLimit}
              />
            )}
          </div>
        </CardContent>
      </Card>

      <PaymentTypeFilterDialog
        open={paymentTypeDialogOpen}
        onClose={() => setPaymentTypeDialogOpen(false)}
        tempPaymentType={tempPaymentType}
        setTempPaymentType={setTempPaymentType}
        onApply={applyPaymentType}
      />
      <TerminalFilterDialog
        open={terminalDialogOpen}
        onClose={() => setTerminalDialogOpen(false)}
        tempTerminalId={tempTerminalId}
        setTempTerminalId={setTempTerminalId}
        onApply={applyTerminal}
      />
      <DateRangeFilterDialog
        open={dateRangeDialogOpen}
        onClose={() => setDateRangeDialogOpen(false)}
        tempDateRange={tempDateRange}
        setTempDateRange={setTempDateRange}
        onApply={applyDateRange}
      />
    </div>
  );
}
