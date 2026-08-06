'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useSalesPage } from './sales-transactions/use-sales-page';
import { SalesSummaryCards } from './sales-transactions/SalesSummaryCards';
import { SalesFilterToolbar } from './sales-transactions/SalesFilterToolbar';
import { SalesFilterDialogs } from './sales-transactions/SalesFilterDialogs';
import { SalesTable } from './sales-transactions/SalesTable';

export default function SalesPage() {
  const p = useSalesPage();

  return (
    <>
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <div>
                <CardTitle>Sales Transactions</CardTitle>
                <CardDescription>A list of all POS sales to customers.</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <SalesSummaryCards totals={p.summaryTotals} />

            <SalesFilterToolbar
              searchTerm={p.searchTerm}
              onSearchChange={p.setSearchTerm}
              table={p.table}
              paymentTypeFilter={p.paymentTypeFilter}
              terminalId={p.terminalId}
              dateRange={p.dateRange}
              salesStatusFilter={p.salesStatusFilter}
              customerFilter={p.customerFilter}
              cashierFilter={p.cashierFilter}
              referenceNumberFilter={p.referenceNumberFilter}
              onOpenPaymentType={p.openPaymentTypeDialog}
              onOpenTerminal={p.openTerminalDialog}
              onOpenDateRange={p.openDateRangeDialog}
              onOpenSalesStatus={p.openSalesStatusDialog}
              onOpenCustomer={p.openCustomerDialog}
              onOpenCashier={p.openCashierDialog}
              onOpenReferenceNumber={p.openReferenceNumberDialog}
              onClearFilterValues={p.clearFilterValues}
              onExportCSV={p.exportToCSV}
              onExportPDF={p.exportToPDF}
              hasActiveFilters={p.hasActiveFilters}
              onResetFilters={p.resetFilters}
            />

            <SalesTable
              table={p.table}
              isLoading={p.isLoading}
              expandedRows={p.expandedRows}
              toggleRowExpansion={p.toggleRowExpansion}
              salesCount={p.sales.length}
              currentPage={p.currentPage}
              setCurrentPage={p.setCurrentPage}
              limit={p.limit}
              setLimit={p.setLimit}
              totalPages={p.totalPages}
            />
          </CardContent>
        </Card>
      </div>

      <SalesFilterDialogs
        paymentTypeDialogOpen={p.paymentTypeDialogOpen} setPaymentTypeDialogOpen={p.setPaymentTypeDialogOpen}
        tempPaymentType={p.tempPaymentType} setTempPaymentType={p.setTempPaymentType} onApplyPaymentType={p.applyPaymentType}
        terminalDialogOpen={p.terminalDialogOpen} setTerminalDialogOpen={p.setTerminalDialogOpen}
        tempTerminalId={p.tempTerminalId} setTempTerminalId={p.setTempTerminalId} onApplyTerminal={p.applyTerminal}
        dateRangeDialogOpen={p.dateRangeDialogOpen} setDateRangeDialogOpen={p.setDateRangeDialogOpen}
        tempDateRange={p.tempDateRange} setTempDateRange={p.setTempDateRange} onApplyDateRange={p.applyDateRange}
        salesStatusDialogOpen={p.salesStatusDialogOpen} setSalesStatusDialogOpen={p.setSalesStatusDialogOpen}
        tempSalesStatus={p.tempSalesStatus} setTempSalesStatus={p.setTempSalesStatus} onApplySalesStatus={p.applySalesStatus}
        customerDialogOpen={p.customerDialogOpen} setCustomerDialogOpen={p.setCustomerDialogOpen}
        tempCustomer={p.tempCustomer} setTempCustomer={p.setTempCustomer} onApplyCustomer={p.applyCustomer}
        cashierDialogOpen={p.cashierDialogOpen} setCashierDialogOpen={p.setCashierDialogOpen}
        tempCashier={p.tempCashier} setTempCashier={p.setTempCashier} onApplyCashier={p.applyCashier}
        users={p.users}
        referenceNumberDialogOpen={p.referenceNumberDialogOpen} setReferenceNumberDialogOpen={p.setReferenceNumberDialogOpen}
        tempReferenceNumber={p.tempReferenceNumber} setTempReferenceNumber={p.setTempReferenceNumber} onApplyReferenceNumber={p.applyReferenceNumber}
      />
    </>
  );
}
