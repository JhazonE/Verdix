'use client';

import { useRef, useEffect, useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Button } from '@/components/ui/button';
import { Search, Tag } from 'lucide-react';
import { calculateEffectivePrice } from '@/lib/pricing';
import { formatStockQuantity } from '@/lib/utils';
import { usePriceInquiry } from './use-price-inquiry';
import type { PriceInquiryDialogProps } from './price-inquiry-types';

export function PriceInquiryDialog({
  isOpen,
  onOpenChange,
  activeLevelId,
  defaultLevelId,
  activeLevelName = 'Retail'
}: PriceInquiryDialogProps) {
  const { searchTerm, setSearchTerm, selectedProduct, products, loading, error, handleSelect } = usePriceInquiry({
    isOpen,
    activeLevelId,
  });

  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen || loading || products.length === 0) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setHighlightedIndex(prev => (prev === null ? 0 : (prev + 1) % products.length));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setHighlightedIndex(prev => (prev === null ? products.length - 1 : (prev - 1 + products.length) % products.length));
          break;
        case 'Enter':
          e.preventDefault();
          if (highlightedIndex !== null) {
            handleSelect(products[highlightedIndex].id);
          }
          break;
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, products, highlightedIndex, loading, handleSelect]);

  useEffect(() => {
    if (!isOpen) {
      setHighlightedIndex(null);
    }
  }, [isOpen]);

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-4xl w-full p-0 flex flex-col gap-0">
        <SheetHeader className="px-6 py-4 border-b">
          <SheetTitle>Price Inquiry</SheetTitle>
          <SheetDescription>
            Find a product by name or Barcode to check its price.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-1 min-h-0">
          {/* Left column: product list */}
          <div className="w-1/2 border-r flex flex-col min-h-0">
            <Command shouldFilter={false} className="flex flex-col flex-1 min-h-0 rounded-none border-0 bg-transparent">
              <CommandInput
                placeholder="Type a product name or Barcode..."
                value={searchTerm}
                onValueChange={setSearchTerm}
                autoFocus
              />
              <CommandList className="flex-1 max-h-none" ref={listRef}>
                {loading && <div className="p-4 text-center text-muted-foreground">Loading products...</div>}
                {error && <div className="p-4 text-center text-destructive">{error}</div>}
                {!loading && !error && (
                  <>
                    <CommandEmpty>No products found.</CommandEmpty>
                    <CommandGroup>
                      {products.map((product, index) => {
                        const isActive = selectedProduct?.id === product.id;
                        const isHighlighted = highlightedIndex !== null && index === highlightedIndex;
                        return (
                          <CommandItem
                            key={product.id}
                            value={`${product.name} ${product.sellingUnits?.find((su: any) => su.isBase)?.barcode || product.barcode || ''}`}
                            onSelect={() => handleSelect(product.id)}
                            className={`flex items-center justify-between cursor-pointer p-3 data-[selected]:bg-transparent ${
                              isHighlighted ? 'bg-primary/20 ring-2 ring-primary' : isActive ? 'bg-primary/10' : ''
                            }`}
                          >
                            <div className="min-w-0">
                              <p className={`font-medium truncate ${isActive || isHighlighted ? 'text-primary' : ''}`}>{product.name}</p>
                              <p className="text-sm text-muted-foreground truncate">{product.sellingUnits?.find((su: any) => su.isBase)?.barcode || product.barcode || ''} • {product.unitOfMeasure}</p>
                            </div>
                            {isActive && <Tag className="h-4 w-4 text-primary shrink-0" />}
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  </>
                )}
              </CommandList>
            </Command>
          </div>

          {/* Right column: price detail */}
          <div className="w-1/2 flex flex-col min-h-0 overflow-y-auto">
            {selectedProduct ? (
              <div className="flex flex-col items-center justify-center flex-1 p-6 animate-in fade-in-50 zoom-in-95 duration-200">
                <h3 className="text-xl font-bold text-center mb-2">{selectedProduct.name}</h3>

                <div className="text-xs text-muted-foreground mb-6 font-mono bg-muted px-2 py-1 rounded">
                  {selectedProduct.sellingUnits?.find((su: any) => su.isBase)?.barcode || selectedProduct.barcode || ''}
                </div>

                <div className="text-center w-full bg-primary/5 py-8 rounded-xl border-2 border-primary/10 shadow-sm relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent pointer-events-none" />
                  <div className="text-xs font-bold text-primary/70 uppercase tracking-widest mb-1">{activeLevelName} Price</div>
                  <div className="text-5xl font-black text-primary tracking-tighter drop-shadow-sm">
                    ₱{calculateEffectivePrice(selectedProduct, 1, activeLevelId, defaultLevelId).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                  </div>
                </div>

                {selectedProduct.stock !== undefined && (
                  <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 px-3 py-1.5 rounded-full border">
                    <span>Available Stock:</span>
                    <span className={`font-bold ${selectedProduct.stock > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                      {formatStockQuantity(selectedProduct.stock)} {selectedProduct.unitOfMeasure}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center flex-1 p-6 text-center text-muted-foreground">
                <Search className="h-12 w-12 mb-3 opacity-20" />
                <p className="font-medium">Select a product</p>
                <p className="text-sm opacity-70">Pick a product on the left to see its price here.</p>
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end border-t px-4 py-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
