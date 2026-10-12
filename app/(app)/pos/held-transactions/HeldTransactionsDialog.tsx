'use client';

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Undo, Trash2, Clock, Package, FileText } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useHeldTransactions } from './use-held-transactions';
import type { HeldTransactionsDialogProps } from './held-transactions-types';

export function HeldTransactionsDialog({ isOpen, onOpenChange, heldTransactions, onRestore, onDelete }: HeldTransactionsDialogProps) {
  const { selectedIndex, setSelectedIndex, calculateTotal, calculateItemCount } =
    useHeldTransactions({ isOpen, heldTransactions, onRestore });

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-2xl" onInteractOutside={(e) => e.preventDefault()}>
        <SheetHeader>
          <SheetTitle className="text-2xl font-extrabold text-slate-800 dark:text-slate-100">Suspended Transactions</SheetTitle>
          <SheetDescription className="text-slate-500 dark:text-slate-400 font-medium">
            Select a transaction to restore it to the cart or delete it. Use Up/Down arrows to navigate and Enter to select.
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="h-[500px]">
          <div className="space-y-4 p-6 pt-2">
            {heldTransactions.length > 0 ? (
              heldTransactions.map((transaction, index) => (
                <div
                  key={transaction.id || index}
                  className={`relative overflow-hidden rounded-2xl border-2 transition-all duration-200 cursor-pointer ${
                    index === selectedIndex
                      ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/40 shadow-md'
                      : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800/60 hover:border-blue-300 dark:hover:border-blue-600 hover:shadow-sm'
                  }`}
                  onClick={() => setSelectedIndex(index)}
                  onDoubleClick={() => onRestore(index)}
                >
                  {index === selectedIndex && (
                    <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-blue-500" />
                  )}

                  <div className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex-1 min-w-0 pr-4">
                      <div className="flex items-center gap-2 mb-1.5">
                        <FileText className={`w-4 h-4 shrink-0 ${index === selectedIndex ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400 dark:text-slate-500'}`} />
                        <h4 className={`text-base font-bold truncate ${index === selectedIndex ? 'text-blue-900 dark:text-blue-200' : 'text-slate-700 dark:text-slate-200'}`}>
                          {transaction.note || 'No Note Provided'}
                        </h4>
                      </div>
                      <div className="flex items-center gap-4 text-xs font-medium text-slate-500 dark:text-slate-400">
                        <div className="flex items-center gap-1.5">
                          <Package className="w-3.5 h-3.5 opacity-70" />
                          <span>{calculateItemCount(transaction.items)} items</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 opacity-70" />
                          <span>
                            {transaction.timestamp
                              ? formatDistanceToNow(new Date(transaction.timestamp), { addSuffix: true })
                              : 'Unknown time'}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col sm:items-end gap-3 shrink-0">
                      <div className="text-2xl font-black text-slate-800 dark:text-slate-100 tracking-tight">
                        <span className="text-lg mr-1 text-slate-400 dark:text-slate-500 font-bold">₱</span>
                        {calculateTotal(transaction.items).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 rounded-lg font-bold text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                          onClick={(e) => { e.stopPropagation(); onRestore(index); }}
                        >
                          <Undo className="mr-1.5 h-3.5 w-3.5" /> Restore
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 rounded-lg font-bold text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                          onClick={(e) => { e.stopPropagation(); onDelete(index); }}
                        >
                          <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="flex flex-col items-center justify-center py-20 text-slate-400 dark:text-slate-500 bg-slate-50/50 dark:bg-slate-800/40 rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-700">
                <FileText className="w-12 h-12 mb-3 opacity-20" />
                <p className="text-lg font-bold">No Suspended Transactions</p>
                <p className="text-sm font-medium opacity-70">Transactions you suspend will appear here.</p>
              </div>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
