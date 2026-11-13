'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useSalesByProduct } from './use-sales-by-product';
import { ByProductSummaryCards } from './ByProductSummaryCards';
import { ByProductFilterBar } from './ByProductFilterBar';
import { ByProductTable } from './ByProductTable';
import { ByProductPagination } from './ByProductPagination';
import {
  DateRangeFilterDialog,
  TerminalFilterDialog,
  CategoryFilterDialog,
  BrandFilterDialog,
  CashierFilterDialog,
  ReferenceFilterDialog,
} from './ByProductFilterDialogs';

export default function SalesByProductPage() {
  const {
    searchTerm, setSearchTerm,
    dateRange, terminal,
    categoryFilter, brandFilter, cashierFilter, referenceFilter,
    sourceFilter, setSourceFilter,
    currentPage, setCurrentPage,
    limit, setLimit,
    activeFilterCount,
    dateRangeDialogOpen, setDateRangeDialogOpen,
    terminalDialogOpen, setTerminalDialogOpen,
    categoryDialogOpen, setCategoryDialogOpen,
    brandDialogOpen, setBrandDialogOpen,
    cashierDialogOpen, setCashierDialogOpen,
    referenceDialogOpen, setReferenceDialogOpen,
    tempDateRange, setTempDateRange,
    tempTerminal, setTempTerminal,
    tempCategory, setTempCategory,
    tempBrand, setTempBrand,
    tempCashier, setTempCashier,
    tempReference, setTempReference,
    resetFilters,
    applyDateRange, applyTerminal, applyCategory, applyBrand, applyCashier, applyReference,
    isLoading, totalPages,
    categories, brands, cashiers,
    summaryTotals, exportToCSV, exportToPDF,
    table, expandedRows, transactions, loadingTransactions, toggleRow,
  } = useSalesByProduct();

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Sales by Product/Service</CardTitle>
          <CardDescription>A summary of sales performance for each product.</CardDescription>
        </CardHeader>

        <CardContent>
          <ByProductSummaryCards summaryTotals={summaryTotals} />

          <ByProductFilterBar
            searchTerm={searchTerm}
            setSearchTerm={setSearchTerm}
            setCurrentPage={setCurrentPage}
            activeFilterCount={activeFilterCount}
            dateRange={dateRange}
            terminal={terminal}
            categoryFilter={categoryFilter}
            brandFilter={brandFilter}
            cashierFilter={cashierFilter}
            referenceFilter={referenceFilter}
            sourceFilter={sourceFilter}
            setSourceFilter={setSourceFilter}
            resetFilters={resetFilters}
            exportToCSV={exportToCSV}
            exportToPDF={exportToPDF}
            table={table}
            onOpenDateRange={() => { setTempDateRange(dateRange); setDateRangeDialogOpen(true); }}
            onOpenTerminal={() => { setTempTerminal(terminal); setTerminalDialogOpen(true); }}
            onOpenCategory={() => { setCategoryDialogOpen(true); }}
            onOpenBrand={() => { setBrandDialogOpen(true); }}
            onOpenCashier={() => { setCashierDialogOpen(true); }}
            onOpenReference={() => { setReferenceDialogOpen(true); }}
          />

          <ByProductTable
            table={table}
            isLoading={isLoading}
            expandedRows={expandedRows}
            transactions={transactions}
            loadingTransactions={loadingTransactions}
            toggleRow={toggleRow}
          />
        </CardContent>

        <ByProductPagination
          currentPage={currentPage}
          totalPages={totalPages}
          limit={limit}
          onPageChange={setCurrentPage}
          onLimitChange={(val) => { setLimit(val); setCurrentPage(1); }}
        />
      </Card>

      <DateRangeFilterDialog
        open={dateRangeDialogOpen}
        onOpenChange={setDateRangeDialogOpen}
        tempDateRange={tempDateRange}
        setTempDateRange={setTempDateRange}
        onApply={applyDateRange}
      />
      <TerminalFilterDialog
        open={terminalDialogOpen}
        onOpenChange={setTerminalDialogOpen}
        tempTerminal={tempTerminal}
        setTempTerminal={setTempTerminal}
        onApply={applyTerminal}
      />
      <CategoryFilterDialog
        open={categoryDialogOpen}
        onOpenChange={setCategoryDialogOpen}
        tempCategory={tempCategory}
        setTempCategory={setTempCategory}
        categories={categories}
        onApply={applyCategory}
      />
      <BrandFilterDialog
        open={brandDialogOpen}
        onOpenChange={setBrandDialogOpen}
        tempBrand={tempBrand}
        setTempBrand={setTempBrand}
        brands={brands}
        onApply={applyBrand}
      />
      <CashierFilterDialog
        open={cashierDialogOpen}
        onOpenChange={setCashierDialogOpen}
        tempCashier={tempCashier}
        setTempCashier={setTempCashier}
        cashiers={cashiers}
        onApply={applyCashier}
      />
      <ReferenceFilterDialog
        open={referenceDialogOpen}
        onOpenChange={setReferenceDialogOpen}
        tempReference={tempReference}
        setTempReference={setTempReference}
        onApply={applyReference}
      />
    </div>
  );
}
