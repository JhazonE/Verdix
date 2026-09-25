'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ArrowLeft, Minus, Plus, Undo } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { SheetFooter } from '@/components/ui/sheet';
import type { Sale, SaleItem } from '@/lib/types';
import { formatQuantity } from '@/lib/utils';
import { formatSINumber } from '@/lib/si-number';
import { peso } from './return-sales-utils';

interface SelectItemsViewProps {
  sale: Sale;
  onReturnItems: (items: SaleItem[]) => void;
  onBack: () => void;
  onExchangeItem: (item: SaleItem) => void;
}

export function SelectItemsView({ sale, onReturnItems, onBack, onExchangeItem }: SelectItemsViewProps) {
  // Keyed by row index, not product.id: the same product can appear as more
  // than one line on a sale (e.g. sold at two different prices/units), and
  // product.id would then wrongly select every line sharing that product.
  const [selectedItems, setSelectedItems] = useState<Set<number>>(new Set());
  const [returnQuantities, setReturnQuantities] = useState<Record<number, number>>({});
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null);

  const handleItemToggle = (item: SaleItem, index: number) => {
    const newSelected = new Set(selectedItems);

    if (newSelected.has(index)) {
      newSelected.delete(index);
      const newQuantities = { ...returnQuantities };
      delete newQuantities[index];
      setReturnQuantities(newQuantities);
    } else {
      newSelected.add(index);
      setReturnQuantities(prev => ({ ...prev, [index]: item.quantity }));
    }

    setSelectedItems(newSelected);
  };

  const handleQuantityChange = (item: SaleItem, index: number, value: string) => {
    const qty = parseFloat(value);
    if (isNaN(qty) || qty <= 0) return;

    const validQty = Math.min(qty, item.quantity);
    setReturnQuantities(prev => ({ ...prev, [index]: validQty }));
  };

  const handleConfirmReturn = () => {
    const itemsToReturn = sale.items
      .map((item, index) => ({ item, index }))
      .filter(({ index }) => selectedItems.has(index))
      .map(({ item, index }) => ({
        ...item,
        quantity: returnQuantities[index] || item.quantity
      }));

    onReturnItems(itemsToReturn);
  };

  // Move keyboard handler after handleConfirmReturn is defined
  const handleKeyboardConfirmReturn = () => {
    if (selectedItems.size > 0) {
      handleConfirmReturn();
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setHighlightedIndex(prev => (prev === null ? 0 : (prev + 1) % sale.items.length));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setHighlightedIndex(prev => (prev === null ? sale.items.length - 1 : (prev - 1 + sale.items.length) % sale.items.length));
          break;
        case ' ':
        case 'Space':
          e.preventDefault();
          if (highlightedIndex !== null) {
            handleItemToggle(sale.items[highlightedIndex], highlightedIndex);
          }
          break;
        case 'Enter':
          if (selectedItems.size > 0) {
            e.preventDefault();
            handleKeyboardConfirmReturn();
          }
          break;
        case 'Backspace':
        case 'Escape':
          e.preventDefault();
          onBack();
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectedItems, highlightedIndex, handleConfirmReturn, onBack, sale.items]);

  const allSelected = sale.items.length > 0 && selectedItems.size === sale.items.length;

  const toggleAll = () => {
    if (allSelected) {
      setSelectedItems(new Set());
      setReturnQuantities({});
    } else {
      const all = new Set<number>();
      const q: Record<number, number> = {};
      // Skip fully-returned lines (no quantity left to return).
      sale.items.forEach((it, index) => { if (it.quantity > 0) { all.add(index); q[index] = it.quantity; } });
      setSelectedItems(all);
      setReturnQuantities(q);
    }
  };

  const step = (item: SaleItem, index: number, delta: number) => {
    const current = returnQuantities[index] || 1;
    const next = Math.min(item.quantity, Math.max(1, current + delta));
    setReturnQuantities(prev => ({ ...prev, [index]: next }));
  };

  const creditTotal = sale.items.reduce((sum, item, index) => {
    if (!selectedItems.has(index)) return sum;
    const qty = returnQuantities[index] || item.quantity;
    return sum + item.price * qty;
  }, 0);

  const totalReturnQty = sale.items.reduce((sum, item, index) =>
    selectedItems.has(index) ? sum + (returnQuantities[index] || item.quantity) : sum, 0
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b pb-3 shrink-0">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0">
          <h2 className="text-base font-semibold">Select Items to Return</h2>
          <p className="truncate text-xs text-muted-foreground">SI No.: <span className="font-mono">{sale.siNumber ? formatSINumber(sale.siNumber) : (sale.orderNumber || sale.id)}</span></p>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between rounded-lg border bg-muted/40 px-3 py-2 shrink-0">
        <div role="button" tabIndex={0} onClick={toggleAll} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleAll(); } }} className="flex cursor-pointer items-center gap-2 text-sm font-medium">
          <Checkbox checked={allSelected} />
          Select all items
        </div>
        <span className="text-xs text-muted-foreground">{selectedItems.size} of {sale.items.length} selected</span>
      </div>

      <div className="mt-3 flex-1 overflow-hidden rounded-xl border">
        <ScrollArea className="h-full">
          {sale.items.map((item, index) => {
            const soldQty = item.originalQuantity ?? item.quantity;
            const alreadyReturned = item.returnedQuantity ?? 0;
            const remaining = item.quantity; // net still returnable
            const fullyReturned = remaining <= 0;
            const checked = selectedItems.has(index);
            const rQty = returnQuantities[index] || remaining;
            const isHighlighted = highlightedIndex === index;
            return (
              <div
                key={index}
                className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border/50 px-3 py-3 transition-colors ${
                  fullyReturned ? 'opacity-60' : isHighlighted ? 'bg-amber-100/70 dark:bg-amber-950/40 ring-2 ring-amber-500' : checked ? 'bg-amber-50/60 dark:bg-amber-950/20' : 'hover:bg-muted/40'
                }`}
              >
                <Checkbox checked={checked} disabled={fullyReturned} onCheckedChange={() => handleItemToggle(item, index)} />
                <div className={`min-w-0 flex-1 ${fullyReturned ? '' : 'cursor-pointer'}`} onClick={() => { if (!fullyReturned) handleItemToggle(item, index); }}>
                  <p className="truncate text-sm font-medium">{item.product.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Sold: {formatQuantity(soldQty)} {item.product.unitOfMeasure || ''} · {peso(item.price)} ea
                  </p>
                  {alreadyReturned > 0 && (
                    <p className="text-[11px] font-medium text-amber-600 dark:text-amber-400">
                      Returned: {formatQuantity(alreadyReturned)}{fullyReturned ? ' (fully returned)' : ` · ${formatQuantity(remaining)} left`}
                    </p>
                  )}
                </div>
                {fullyReturned ? (
                  <span className="shrink-0 text-xs font-medium text-amber-600 dark:text-amber-400">Fully returned</span>
                ) : checked ? (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button variant="outline" size="icon" className="h-7 w-7" disabled={rQty <= 1} onClick={() => step(item, index, -1)}>
                      <Minus className="h-3 w-3" />
                    </Button>
                    <Input
                      type="number"
                      min="1"
                      max={remaining}
                      className="h-7 w-12 px-1 text-center font-mono"
                      value={returnQuantities[index] || ''}
                      onChange={(e) => handleQuantityChange(item, index, e.target.value)}
                    />
                    <Button variant="outline" size="icon" className="h-7 w-7" disabled={rQty >= remaining} onClick={() => step(item, index, 1)}>
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>
                ) : (
                  <span className="shrink-0 text-xs text-muted-foreground">Not returning</span>
                )}
                <div className="ml-auto shrink-0 text-right font-mono text-sm font-semibold whitespace-nowrap">
                  {checked ? peso(item.price * rQty) : '—'}
                </div>
              </div>
            );
          })}
        </ScrollArea>
      </div>

      <div className="mt-3 flex items-center justify-between rounded-xl border bg-gradient-to-br from-amber-500/10 to-transparent px-4 py-3 shrink-0">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Merchandise Credit</p>
          <p className="text-xs text-muted-foreground">{totalReturnQty} {totalReturnQty === 1 ? 'item' : 'items'} to return</p>
        </div>
        <p className="font-mono text-2xl font-black tabular-nums text-amber-600">{peso(creditTotal)}</p>
      </div>

      <SheetFooter className="mt-4 shrink-0">
        <Button variant="outline" onClick={onBack}>
          Cancel
        </Button>
        <Button
          variant="outline"
          className="border-amber-600 text-amber-700 hover:bg-amber-50"
          disabled={selectedItems.size !== 1}
          title={selectedItems.size !== 1 ? 'Select exactly one item to exchange' : undefined}
          onClick={() => {
            const onlyIndex = [...selectedItems][0];
            const only = onlyIndex !== undefined ? sale.items[onlyIndex] : undefined;
            if (only) {
              onExchangeItem({ ...only, quantity: returnQuantities[onlyIndex] || only.quantity });
            }
          }}
        >
          Exchange for Another Item
        </Button>
        <Button
          className="bg-amber-600 hover:bg-amber-700 text-white"
          disabled={selectedItems.size === 0}
          onClick={handleConfirmReturn}
        >
          <Undo className="mr-2 h-4 w-4" />
          Issue Credit ({selectedItems.size})
        </Button>
      </SheetFooter>
    </div>
  );
}
