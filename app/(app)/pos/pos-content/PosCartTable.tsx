'use client';

import { RefObject, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Search, ShoppingCart } from 'lucide-react';
import { formatStockQuantity } from '@/lib/utils';
import type { SaleItem } from './pos-types';

type Props = {
  inputRef: RefObject<HTMLInputElement>;
  inputValue: string;
  setInputValue: (v: string) => void;
  handleAddItemBySKU: (sku: string) => void;
  getSearchSuggestions: (query: string, limit?: number) => any[];
  handleAddItem: (product: any) => void;
  handleDefaultTender: () => void;
  setIsProductSearchOpen: (v: boolean) => void;
  items: SaleItem[];
  selectedItemId: string | null;
  setSelectedItemId: (id: string) => void;
  editingNameItemId: string | null;
  setEditingNameItemId: (id: string | null) => void;
  editingQtyItemId: string | null;
  setEditingQtyItemId: (id: string | null) => void;
  editingPriceItemId: string | null;
  setEditingPriceItemId: (id: string | null) => void;
  qtyDraft: string;
  setQtyDraft: (v: string) => void;
  startEditName: (id: string) => void;
  commitInlineName: (id: string, value: string) => void;
  requestInlinePriceEdit: (id: string) => void;
  commitInlinePrice: (id: string, value: string) => void;
  focusInlineQuantity: (id: string | null) => void;
  commitQty: (id: string) => void;
  isFrontliner?: boolean;
  handleSendToQueue?: () => void;
};

export function PosCartTable({
  inputRef, inputValue, setInputValue, handleAddItemBySKU, getSearchSuggestions, handleAddItem, handleDefaultTender,
  setIsProductSearchOpen, items, selectedItemId, setSelectedItemId,
  editingNameItemId, setEditingNameItemId,
  editingQtyItemId, setEditingQtyItemId,
  editingPriceItemId, setEditingPriceItemId,
  qtyDraft, setQtyDraft,
  startEditName, commitInlineName, isFrontliner, handleSendToQueue,
  requestInlinePriceEdit, commitInlinePrice, focusInlineQuantity, commitQty,
}: Props) {
  const [isSuggestOpen, setIsSuggestOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const suggestions = useMemo(
    () => (inputValue.trim() ? getSearchSuggestions(inputValue) : []),
    [inputValue, getSearchSuggestions]
  );

  useEffect(() => {
    setHighlightedIndex(0);
    setIsSuggestOpen(suggestions.length > 0);
  }, [suggestions]);

  const selectSuggestion = (product: any) => {
    handleAddItem(product);
    setIsSuggestOpen(false);
  };

  return (
    <>
      {/* Search Bar */}
      <div className="shrink-0 z-30 relative">
        <div className="relative w-full group">
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within:text-primary transition-colors">
            <Search className="w-4 h-4" />
          </div>
          <Input
            ref={inputRef}
            type="text"
            placeholder="Scan Barcode or Enter Product SKU (Enter)"
            className="pl-9 h-12 text-lg bg-background shadow-sm border-muted-foreground/20 focus-visible:ring-primary/20"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (isSuggestOpen && suggestions.length > 0 && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                e.preventDefault();
                setHighlightedIndex((prev) => {
                  const delta = e.key === 'ArrowDown' ? 1 : -1;
                  return (prev + delta + suggestions.length) % suggestions.length;
                });
                return;
              }
              if (e.key === 'Escape' && isSuggestOpen) {
                e.preventDefault();
                setIsSuggestOpen(false);
                return;
              }
              if (e.key === 'Enter' || (e.key === 'Tab' && inputValue.trim())) {
                e.preventDefault();
                e.stopPropagation();
                if (inputValue.trim()) {
                  if (isSuggestOpen && suggestions.length > 0) selectSuggestion(suggestions[highlightedIndex]);
                  else handleAddItemBySKU(inputValue);
                } else if (isFrontliner) handleSendToQueue?.();
                else handleDefaultTender();
              }
            }}
            onBlur={() => setTimeout(() => setIsSuggestOpen(false), 150)}
            onFocus={() => { if (suggestions.length > 0) setIsSuggestOpen(true); }}
            autoComplete="off"
            autoFocus
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="absolute right-2 top-1/2 -translate-y-1/2 h-8 px-2 text-muted-foreground hover:text-foreground"
            onClick={() => setIsProductSearchOpen(true)}
          >
            <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-100">
              F9
            </kbd>
          </Button>

          {isSuggestOpen && suggestions.length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-1 z-30 bg-popover border rounded-lg shadow-lg overflow-hidden">
              {suggestions.map((product, index) => (
                <button
                  key={product.id}
                  type="button"
                  className={`w-full flex items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors ${index === highlightedIndex ? 'bg-primary/10' : 'hover:bg-muted/50'}`}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  onMouseDown={(e) => { e.preventDefault(); selectSuggestion(product); }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{product.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {product.sku}{product.barcode ? ` · ${product.barcode}` : ''}
                    </div>
                  </div>
                  <div className="shrink-0 text-sm font-medium text-muted-foreground">
                    ₱{Number(product.price ?? 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Items Table */}
      <div className="flex-1 bg-background rounded-xl border shadow-sm flex flex-col overflow-hidden">
        <div className="overflow-y-auto flex-1 scroll-pt-12">
          <table className="w-full caption-bottom text-sm">
            <TableHeader className="sticky top-0 bg-muted z-20 shadow-sm">
              <TableRow className="hover:bg-transparent border-b-border/50">
                <TableHead className="w-10 pl-4" />
                <TableHead className="w-[40%] text-xs font-semibold uppercase tracking-wider text-muted-foreground">Description</TableHead>
                <TableHead className="w-[10%] text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Unit</TableHead>
                <TableHead className="text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">Price</TableHead>
                <TableHead className="text-center w-36 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Qty</TableHead>
                <TableHead className="text-right pr-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-64 text-center">
                    <div className="flex flex-col items-center justify-center text-muted-foreground/40">
                      <ShoppingCart className="w-12 h-12 mb-2" />
                      <p className="text-lg font-medium">Cart is empty</p>
                      <p className="text-sm">Scan items or search to start sale</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                items.map((item) => (
                  <TableRow
                    key={item.id}
                    id={`pos-item-${item.id}`}
                    className={`group cursor-pointer transition-colors border-b-border/40 last:border-0 ${selectedItemId === item.id ? 'bg-primary/5 hover:bg-primary/10' : 'hover:bg-muted/30'}`}
                    onClick={() => { setSelectedItemId(item.id); inputRef.current?.focus(); }}
                  >
                    <TableCell className="pl-4">
                      <div className={`w-2 h-2 rounded-full ${selectedItemId === item.id ? 'bg-primary' : 'bg-transparent border border-muted-foreground/30'}`} />
                    </TableCell>
                    <TableCell>
                      {editingNameItemId === item.id ? (
                        <Input
                          id={`pos-name-${item.id}`}
                          defaultValue={item.name}
                          className="h-8 w-full text-sm"
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); commitInlineName(item.id, (e.target as HTMLInputElement).value); inputRef.current?.focus(); }
                            else if (e.key === 'Escape') { e.preventDefault(); setEditingNameItemId(null); inputRef.current?.focus(); }
                          }}
                          onBlur={(e) => commitInlineName(item.id, e.target.value)}
                        />
                      ) : (
                        <div className="flex flex-col">
                          <button
                            type="button"
                            className="text-left font-medium text-sm hover:text-primary"
                            title="Edit name (F1)"
                            onClick={(e) => { e.stopPropagation(); startEditName(item.id); }}
                          >
                            {item.name}
                          </button>
                          {item.discount > 0 && <span className="text-[10px] text-green-600 font-medium">Discount: {item.discount}%</span>}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-left text-sm text-muted-foreground">{item.unitOfMeasure}</TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {editingPriceItemId === item.id ? (
                        <Input
                          id={`pos-price-${item.id}`}
                          type="text"
                          inputMode="decimal"
                          defaultValue={item.price}
                          className="ml-auto h-8 w-24 text-right font-mono"
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); commitInlinePrice(item.id, (e.target as HTMLInputElement).value); inputRef.current?.focus(); }
                            else if (e.key === 'Escape') { e.preventDefault(); setEditingPriceItemId(null); inputRef.current?.focus(); }
                          }}
                          onBlur={(e) => commitInlinePrice(item.id, e.target.value)}
                        />
                      ) : (
                        <button
                          type="button"
                          className="ml-auto block rounded px-1 decoration-dotted underline-offset-2 hover:text-primary hover:underline"
                          title="Edit price (F7)"
                          onClick={(e) => { e.stopPropagation(); requestInlinePriceEdit(item.id); }}
                        >
                          ₱{item.price.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                        </button>
                      )}
                    </TableCell>
                    <TableCell className="p-0">
                      {editingQtyItemId === item.id ? (
                        <div className="flex items-center justify-center h-full" onClick={(e) => e.stopPropagation()}>
                          <Input
                            id={`pos-qty-${item.id}`}
                            type="text"
                            inputMode="numeric"
                            value={qtyDraft}
                            className="h-8 w-20 px-2 text-center font-mono"
                            onChange={(e) => setQtyDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') { e.preventDefault(); commitQty(item.id); inputRef.current?.focus(); }
                              else if (e.key === 'Escape') { e.preventDefault(); setQtyDraft(String(item.quantity)); setEditingQtyItemId(null); inputRef.current?.focus(); }
                            }}
                            onBlur={() => commitQty(item.id)}
                          />
                        </div>
                      ) : (
                        <div className="flex items-center justify-center h-full">
                          <button
                            type="button"
                            className="w-12 rounded py-0.5 text-center font-mono text-sm font-medium hover:bg-muted hover:text-primary"
                            title="Edit quantity (F6)"
                            onClick={(e) => { e.stopPropagation(); focusInlineQuantity(item.id); }}
                          >
                            {formatStockQuantity(item.quantity)}
                          </button>
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right pr-4 font-mono font-medium">
                      ₱{(item.price * item.quantity * (1 - item.discount / 100)).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </table>
        </div>
      </div>
    </>
  );
}
