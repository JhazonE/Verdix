'use client';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useInvoicesPage } from './use-invoices-page';
import { InvoicesSummaryCards } from './InvoicesSummaryCards';
import { InvoicesFilterBar } from './InvoicesFilterBar';
import { InvoicesTable } from './InvoicesTable';
import { InvoicesPagination } from './InvoicesPagination';
import { SalesInvoicePrintView } from './SalesInvoicePrintView';
import { InvoicesStatusDialog } from './dialogs/InvoicesStatusDialog';
import { InvoicesDateRangeDialog } from './dialogs/InvoicesDateRangeDialog';
import { InvoicesSalesPersonDialog } from './dialogs/InvoicesSalesPersonDialog';
import { InvoicesCustomerDialog } from './dialogs/InvoicesCustomerDialog';
import { InvoicesTransactionSourceDialog } from './dialogs/InvoicesTransactionSourceDialog';
import { InvoicesReferenceTypeDialog } from './dialogs/InvoicesReferenceTypeDialog';
import { InvoicesReferenceNumberDialog } from './dialogs/InvoicesReferenceNumberDialog';
import { InvoicesReceiptNumberDialog } from './dialogs/InvoicesReceiptNumberDialog';
import { InvoicesVoidDialog } from './dialogs/InvoicesVoidDialog';

export default function SalesInvoicesPage() {
  const {
    searchQuery, setSearchQuery,
    statusFilter, dateRangeFilter, salesPersonFilter, customerFilter,
    transactionSourceFilter, referenceTypeFilter, referenceNumberFilter, receiptNumberFilter,
    expandedRows, toggleRowExpansion,
    voidDialogOpen, setVoidDialogOpen,
    invoiceToPrint, setInvoiceToPrint, printTitle, handlePrint,
    statusDialogOpen, setStatusDialogOpen,
    dateRangeDialogOpen, setDateRangeDialogOpen,
    salesPersonDialogOpen, setSalesPersonDialogOpen,
    customerDialogOpen, setCustomerDialogOpen,
    transactionSourceDialogOpen, setTransactionSourceDialogOpen,
    referenceTypeDialogOpen, setReferenceTypeDialogOpen,
    referenceNumberDialogOpen, setReferenceNumberDialogOpen,
    receiptNumberDialogOpen, setReceiptNumberDialogOpen,
    tempStatus, setTempStatus,
    tempDateRange, setTempDateRange,
    tempSalesPerson, setTempSalesPerson,
    tempCustomer, setTempCustomer,
    tempTransactionSource, setTempTransactionSource,
    tempReferenceType, setTempReferenceType,
    tempReferenceNumber, setTempReferenceNumber,
    tempReceiptNumber, setTempReceiptNumber,
    hasActiveFilters, resetFilters,
    applyStatus, applyDateRange, applySalesPerson, applyCustomer,
    applyTransactionSource, applyReferenceType, applyReferenceNumber, applyReceiptNumber,
    loading, error, settings,
    voidMutation, invalidateInvoices,
    uniqueSalesPersons, summaryTotals,
    table,
  } = useInvoicesPage();

  return (
    <Card>
      <CardHeader className="non-printable">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Sales Invoice / Delivery</CardTitle>
            <CardDescription>View and print invoices or delivery receipts for your sales.</CardDescription>
          </div>
          <InvoicesFilterBar
            searchQuery={searchQuery} setSearchQuery={setSearchQuery}
            statusFilter={statusFilter} dateRangeFilter={dateRangeFilter}
            salesPersonFilter={salesPersonFilter} customerFilter={customerFilter}
            transactionSourceFilter={transactionSourceFilter} referenceTypeFilter={referenceTypeFilter}
            referenceNumberFilter={referenceNumberFilter} receiptNumberFilter={receiptNumberFilter}
            hasActiveFilters={hasActiveFilters} resetFilters={resetFilters}
            onOpenStatus={() => { setTempStatus(statusFilter); setStatusDialogOpen(true); }}
            onOpenDateRange={() => { setTempDateRange(dateRangeFilter); setDateRangeDialogOpen(true); }}
            onOpenSalesPerson={() => { setTempSalesPerson(salesPersonFilter); setSalesPersonDialogOpen(true); }}
            onOpenCustomer={() => { setTempCustomer(customerFilter); setCustomerDialogOpen(true); }}
            onOpenTransactionSource={() => { setTempTransactionSource(transactionSourceFilter); setTransactionSourceDialogOpen(true); }}
            onOpenReferenceType={() => { setTempReferenceType(referenceTypeFilter); setReferenceTypeDialogOpen(true); }}
            onOpenReferenceNumber={() => { setTempReferenceNumber(referenceNumberFilter); setReferenceNumberDialogOpen(true); }}
            onOpenReceiptNumber={() => { setTempReceiptNumber(receiptNumberFilter); setReceiptNumberDialogOpen(true); }}
            table={table}
          />
        </div>
      </CardHeader>
      <CardContent>
        <InvoicesSummaryCards {...summaryTotals} />
        <div className="space-y-4">
          <InvoicesTable table={table} loading={loading} expandedRows={expandedRows} onToggleRow={toggleRowExpansion} />
          <InvoicesPagination table={table} />
        </div>
      </CardContent>

      <InvoicesStatusDialog open={statusDialogOpen} onClose={() => setStatusDialogOpen(false)} tempStatus={tempStatus} setTempStatus={setTempStatus} onApply={applyStatus} />
      <InvoicesDateRangeDialog open={dateRangeDialogOpen} onClose={() => setDateRangeDialogOpen(false)} tempDateRange={tempDateRange} setTempDateRange={setTempDateRange} onApply={applyDateRange} />
      <InvoicesSalesPersonDialog open={salesPersonDialogOpen} onClose={() => setSalesPersonDialogOpen(false)} tempSalesPerson={tempSalesPerson} setTempSalesPerson={setTempSalesPerson} uniqueSalesPersons={uniqueSalesPersons} onApply={applySalesPerson} />
      <InvoicesCustomerDialog open={customerDialogOpen} onClose={() => setCustomerDialogOpen(false)} tempCustomer={tempCustomer} setTempCustomer={setTempCustomer} onApply={applyCustomer} />
      <InvoicesTransactionSourceDialog open={transactionSourceDialogOpen} onClose={() => setTransactionSourceDialogOpen(false)} tempTransactionSource={tempTransactionSource} setTempTransactionSource={setTempTransactionSource} onApply={applyTransactionSource} />
      <InvoicesReferenceTypeDialog open={referenceTypeDialogOpen} onClose={() => setReferenceTypeDialogOpen(false)} tempReferenceType={tempReferenceType} setTempReferenceType={setTempReferenceType} onApply={applyReferenceType} />
      <InvoicesReferenceNumberDialog open={referenceNumberDialogOpen} onClose={() => setReferenceNumberDialogOpen(false)} tempReferenceNumber={tempReferenceNumber} setTempReferenceNumber={setTempReferenceNumber} onApply={applyReferenceNumber} />
      <InvoicesReceiptNumberDialog open={receiptNumberDialogOpen} onClose={() => setReceiptNumberDialogOpen(false)} tempReceiptNumber={tempReceiptNumber} setTempReceiptNumber={setTempReceiptNumber} onApply={applyReceiptNumber} />
      <InvoicesVoidDialog open={!!voidDialogOpen} onClose={() => setVoidDialogOpen(null)} onConfirm={() => voidDialogOpen && voidMutation.mutate(voidDialogOpen)} isPending={voidMutation.isPending} />

      <Dialog open={!!invoiceToPrint} onOpenChange={open => !open && setInvoiceToPrint(null)}>
        <DialogContent className="sm:max-w-none max-w-full w-full h-screen max-h-screen flex flex-col p-0 gap-0 bg-background border-none rounded-none m-0 shadow-none print:h-auto print:max-h-none print:overflow-visible print:static">
          <DialogTitle className="sr-only">Print Invoice</DialogTitle>
          {invoiceToPrint && <SalesInvoicePrintView order={invoiceToPrint} title={printTitle} settings={settings} onBack={() => setInvoiceToPrint(null)} />}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
