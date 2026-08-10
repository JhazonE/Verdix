'use client';

import { useRef, useEffect, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Clock } from 'lucide-react';
import { format } from 'date-fns';
import { AdminAuthDialog } from '../admin-auth/AdminAuthDialog';
import { ReceiptPrintView } from './ReceiptPrintView';
import { SaleDetailView } from './SaleDetailView';
import { useRecentSales } from './use-recent-sales';
import type { RecentSalesDialogProps } from './recent-sales-types';
import { formatCurrency } from './recent-sales-utils';
import { formatSINumber } from '@/lib/si-number';
import { TransactionSearchBar } from '../transaction-search/TransactionSearchBar';

export function RecentSalesDialog({
  isOpen,
  onOpenChange,
  printMode,
  settings: initialSettings
}: RecentSalesDialogProps) {
  const {
    step,
    saleToPrint,
    selectedSale,
    recentSales,
    isLoading,
    posSettings,
    setSelectedSale,
    handleAuthSuccess,
    handleAuthClose,
    handlePrintReceiptAction,
    handlePrintReceipt,
    handleBackToList,
    handleOpenChange,
    searchText, setSearchText, dateFrom, setDateFrom, dateTo, setDateTo, clearSearch,
  } = useRecentSales({
    isOpen,
    onOpenChange,
    printMode,
    initialSettings,
  });

  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen || isLoading) return;

      // When viewing receipt preview
      if (saleToPrint) {
        switch (e.key) {
          case 'Enter':
            e.preventDefault();
            handlePrintReceiptAction(saleToPrint);
            break;
          case 'Escape':
            e.preventDefault();
            handleBackToList();
            break;
        }
        return;
      }

      // When in transaction list view
      if (step !== 'list') return;

      switch (e.key) {
        case 'ArrowDown':
          if (selectedSale) return;
          if (recentSales.length === 0) return;
          e.preventDefault();
          setHighlightedIndex(prev => (prev === null ? 0 : (prev + 1) % recentSales.length));
          break;
        case 'ArrowUp':
          if (selectedSale) return;
          if (recentSales.length === 0) return;
          e.preventDefault();
          setHighlightedIndex(prev => (prev === null ? recentSales.length - 1 : (prev - 1 + recentSales.length) % recentSales.length));
          break;
        case 'Enter':
          e.preventDefault();
          if (selectedSale) {
            handlePrintReceipt(selectedSale);
          } else if (highlightedIndex !== null) {
            setSelectedSale(recentSales[highlightedIndex]);
          }
          break;
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, step, recentSales, highlightedIndex, isLoading, selectedSale, saleToPrint, setSelectedSale, handlePrintReceipt, handlePrintReceiptAction, handleBackToList]);

  useEffect(() => {
    if (!isOpen) {
      setHighlightedIndex(null);
    }
  }, [isOpen]);

  return (
    <>
      <Sheet open={isOpen && (step === 'list')} onOpenChange={handleOpenChange}>
        <SheetContent side="right" className="sm:max-w-4xl w-full flex flex-col">
          {saleToPrint ? (
            <ReceiptPrintView
              sale={saleToPrint}
              onBack={handleBackToList}
              onPrint={() => handlePrintReceiptAction(saleToPrint)}
              settings={posSettings}
              isReprint={true}
            />
          ) : (
            <>
              <SheetHeader className="shrink-0">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Clock className="h-5 w-5" />
                  </div>
                  <div>
                    <SheetTitle>Recent Transactions</SheetTitle>
                    <SheetDescription>
                      Select a transaction on the left to view its products
                    </SheetDescription>
                  </div>
                </div>
              </SheetHeader>

              <div className="mt-4 flex flex-1 gap-4 overflow-hidden">
                <div className="flex w-[300px] shrink-0 flex-col overflow-hidden rounded-xl border">
                  <div className="flex flex-col border-b bg-muted/40 px-3 py-2 shrink-0 gap-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Transactions</span>
                      {!isLoading && <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{recentSales.length}</span>}
                    </div>
                    <TransactionSearchBar
                      searchText={searchText}
                      onSearchTextChange={(v) => { setSearchText(v); setHighlightedIndex(null); }}
                      dateFrom={dateFrom}
                      dateTo={dateTo}
                      onDateFromChange={setDateFrom}
                      onDateToChange={setDateTo}
                      onClear={clearSearch}
                    />
                  </div>
                  <ScrollArea className="flex-1" ref={scrollAreaRef}>
                    {isLoading ? (
                      <div className="p-4 text-center text-sm text-muted-foreground">Loading recent sales...</div>
                    ) : recentSales && recentSales.length > 0 ? (
                      recentSales.map((sale: any, index: number) => {
                        const isActive = selectedSale?.id === sale.id;
                        const isHighlighted = highlightedIndex !== null && index === highlightedIndex;
                        return (
                          <button
                            key={sale.id}
                            onClick={() => setSelectedSale(sale)}
                            className={`w-full border-b border-border/50 px-3 py-2.5 text-left transition-colors ${
                              isHighlighted ? 'bg-primary/20 ring-2 ring-inset ring-primary border-l-2 border-l-primary' : isActive ? 'bg-primary/10 border-l-2 border-l-primary' : 'border-l-2 border-l-transparent hover:bg-muted/50'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate font-mono text-sm font-semibold">{sale.siNumber ? formatSINumber(sale.siNumber) : (sale.orderNumber ? sale.orderNumber : sale.id.substring(0, 7))}</span>
                              <span className="shrink-0 font-mono text-sm font-bold">₱{formatCurrency(sale.total)}</span>
                            </div>
                            <div className="mt-0.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                              <span className="truncate">{sale.customer?.name || 'Walk-in'}</span>
                              <span className="shrink-0">{format(new Date(sale.date || new Date()), 'p')}</span>
                            </div>
                            <div className="mt-1">
                              <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                                {sale.paymentMethod || '-'}
                              </span>
                            </div>
                          </button>
                        );
                      })
                    ) : (
                      <div className="p-4 text-center text-sm text-muted-foreground">
                        {(searchText || dateFrom || dateTo) ? 'No transactions match your search.' : 'No recent sales found.'}
                      </div>
                    )}
                  </ScrollArea>
                </div>

                <div className="flex-1 overflow-hidden">
                  {selectedSale ? (
                    <SaleDetailView
                      sale={selectedSale}
                      onReprint={() => handlePrintReceipt(selectedSale)}
                    />
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center rounded-xl border border-dashed text-center text-muted-foreground">
                      <Clock className="mb-2 h-10 w-10 opacity-40" />
                      <p className="text-sm font-medium">No transaction selected</p>
                      <p className="text-xs">Pick a transaction from the list to see its products.</p>
                    </div>
                  )}
                </div>
              </div>

              <SheetFooter className="shrink-0 mt-4">
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Close
                </Button>
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>

      <AdminAuthDialog
        isOpen={isOpen && step === 'auth'}
        onOpenChange={handleAuthClose}
        onSuccess={handleAuthSuccess}
        requiredCredentials={posSettings?.enableRecentSalesAuth ? {
          username: posSettings.recentSalesAuthUsername,
          password: posSettings.recentSalesAuthPassword
        } : null}
        title="Recent Sales Authorization"
        description="Enter authorized credentials to view recent sales."
      />
    </>
  );
}

