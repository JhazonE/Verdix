'use client';

import { useRef, useEffect, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Undo, Clock, Loader2 } from 'lucide-react';
import { AdminAuthDialog } from '../admin-auth/AdminAuthDialog';
import { TransactionPickRow } from './TransactionPickRow';
import { SelectItemsView } from './SelectItemsView';
import { ReturnSuccessView } from './ReturnSuccessView';
import { ExchangeBalanceView } from './ExchangeBalanceView';
import { ExchangeSuccessView } from './ExchangeSuccessView';
import { CreditSlipView } from '../credit-slip/CreditSlipView';
import { ProductSearchDialog } from '../product-search/ProductSearchDialog';
import { useReturnSales } from './use-return-sales';
import type { ReturnSalesDialogProps } from './return-sales-types';
import { format } from 'date-fns';
import { TransactionSearchBar } from '../transaction-search/TransactionSearchBar';

export function ReturnSalesDialog({
  isOpen,
  onOpenChange,
  currentUser,
  terminalId,
  printMode,
  paymentMethods,
  warehouseId,
  activeLevelId
}: ReturnSalesDialogProps) {
  const creditSlipRef = useRef<HTMLDivElement>(null);
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null);

  const {
    step,
    setStep,
    isLoading,
    searchText,
    setSearchText,
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
    clearSearch,
    searchError,
    selectedSale,
    returnedItems,
    returnedTotal,
    mcNumber,
    recentSales,
    isRecentLoading,
    posSettings,
    exchangeReturnItem,
    replacementItem,
    exchangeBalance,
    exchangeResult,
    handlePickSale,
    handleAuthSuccess,
    handleAuthClose,
    handleReturnItems,
    handleBackToSearch,
    handleCloseSuccess,
    handlePrintCredit,
    handleStartExchange,
    handleBackFromReplacement,
    handlePickReplacement,
    handleSettleBalance,
  } = useReturnSales({
    isOpen,
    onOpenChange,
    currentUser,
    terminalId,
    printMode,
    creditSlipRef,
  });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen || step !== 'input_so' || isRecentLoading || selectedSale) return;

      switch (e.key) {
        case 'ArrowDown':
          if (recentSales.length === 0) return;
          e.preventDefault();
          setHighlightedIndex(prev => (prev === null ? 0 : (prev + 1) % recentSales.length));
          break;
        case 'ArrowUp':
          if (recentSales.length === 0) return;
          e.preventDefault();
          setHighlightedIndex(prev => (prev === null ? recentSales.length - 1 : (prev - 1 + recentSales.length) % recentSales.length));
          break;
        case 'Enter':
          e.preventDefault();
          if (highlightedIndex !== null) {
            handlePickSale(recentSales[highlightedIndex]);
          }
          break;
      }
    };

    if (isOpen && step === 'input_so') {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, step, recentSales, highlightedIndex, isRecentLoading, selectedSale, handlePickSale]);

  useEffect(() => {
    if (!isOpen || step !== 'input_so') {
      setHighlightedIndex(null);
    }
  }, [isOpen, step]);

  return (
    <>
      <Sheet open={isOpen && (step === 'input_so' || step === 'select_items' || step === 'settle_balance' || step === 'exchange_success' || step === 'success')} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="sm:max-w-xl w-full flex flex-col">
          {step === 'exchange_success' && exchangeResult ? (
            <ExchangeSuccessView
              mcNumber={exchangeResult.mcNumber}
              siNumber={exchangeResult.siNumber}
              balance={exchangeResult.balance}
              onClose={handleCloseSuccess}
              onPrint={() => { /* Task 7 wires real printing */ }}
            />
          ) : step === 'settle_balance' && exchangeReturnItem && replacementItem ? (
            <ExchangeBalanceView
              returnItemLabel={exchangeReturnItem.product.name}
              returnTotal={exchangeReturnItem.price * exchangeReturnItem.quantity}
              newItemLabel={replacementItem.product.name}
              newTotal={replacementItem.product.price * replacementItem.quantity}
              balance={exchangeBalance ?? 0}
              hasCustomer={!!(selectedSale?.customer?.id && selectedSale.customer.id !== 'walk-in')}
              paymentMethods={paymentMethods}
              isLoading={isLoading}
              onConfirm={handleSettleBalance}
              onBack={() => setStep('pick_replacement')}
            />
          ) : step === 'success' ? (
            <ReturnSuccessView
              returnedTotal={returnedTotal}
              saleId={String(selectedSale?.orderNumber || selectedSale?.id || '')}
              onClose={handleCloseSuccess}
              onPrint={handlePrintCredit}
            />
          ) : step === 'select_items' && selectedSale ? (
            <SelectItemsView
              sale={selectedSale}
              onReturnItems={handleReturnItems}
              onBack={handleBackToSearch}
              onExchangeItem={handleStartExchange}
            />
          ) : (
            <div className="flex h-full flex-col">
              <SheetHeader className="shrink-0">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 text-amber-600 dark:bg-amber-950">
                    <Undo className="h-5 w-5" />
                  </div>
                  <div>
                    <SheetTitle>Merchandise Credit</SheetTitle>
                    <SheetDescription>Search by SO number or pick a recent transaction</SheetDescription>
                  </div>
                </div>
              </SheetHeader>

              <div className="mt-4 shrink-0">
                <TransactionSearchBar
                  searchText={searchText}
                  onSearchTextChange={(v) => { setSearchText(v); setHighlightedIndex(null); }}
                  dateFrom={dateFrom}
                  dateTo={dateTo}
                  onDateFromChange={setDateFrom}
                  onDateToChange={setDateTo}
                  onClear={clearSearch}
                  autoFocus
                />
              </div>

              <div className="mt-5 flex items-center gap-2 shrink-0">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-semibold">Recent Transactions</span>
              </div>
              <div className="mt-2 flex-1 overflow-hidden rounded-xl border">
                <ScrollArea className="h-full">
                  {isRecentLoading ? (
                    <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                    </div>
                  ) : recentSales.length > 0 ? (
                    recentSales.map((sale: any, index: number) => (
                      <TransactionPickRow key={sale.id} sale={sale} onPick={handlePickSale} isHighlighted={highlightedIndex === index} />
                    ))
                  ) : (
                    <div className="p-6 text-center text-sm text-muted-foreground">No recent transactions.</div>
                  )}
                </ScrollArea>
              </div>

              <SheetFooter className="mt-4 shrink-0">
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
              </SheetFooter>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <AdminAuthDialog
        isOpen={isOpen && step === 'auth'}
        onOpenChange={handleAuthClose}
        onSuccess={handleAuthSuccess}
        requiredCredentials={posSettings?.enableReturnAuth ? {
          username: posSettings.returnAuthUsername,
          password: posSettings.returnAuthPassword
        } : null}
        title="Return Authorization"
        description="Enter authorized credentials to access return functions."
      />

      <ProductSearchDialog
        isOpen={isOpen && step === 'pick_replacement'}
        onOpenChange={(open) => { if (!open) handleBackFromReplacement(); }}
        onSelectProduct={(product) => {
          handlePickReplacement(product, 1);
          setStep('settle_balance');
        }}
        warehouseId={warehouseId}
        activeLevelId={activeLevelId}
      />

      <div style={{ position: 'absolute', top: '-9999px', left: '-9999px' }}>
        {selectedSale && returnedItems.length > 0 && (
          <CreditSlipView
            ref={creditSlipRef}
            creditDetails={{
              // Server-issued MC number; legacy timestamp format only as fallback.
              creditSlipId: mcNumber
                || `MC-${selectedSale.orderNumber || selectedSale.id.slice(-6)}-${format(new Date(), 'yyMMddHHmm')}`.toUpperCase(),
              originalSoNumber: String(selectedSale.orderNumber || selectedSale.id),
              customerName: selectedSale.customer?.name || 'Walk-in Customer',
              date: new Date().toISOString(),
              expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
              cashierName: currentUser?.name || currentUser?.displayName || currentUser?.username || 'Cashier',
              items: returnedItems,
              totalAmount: returnedTotal
            }}
            settings={posSettings}
          />
        )}
      </div>
    </>
  );
}
