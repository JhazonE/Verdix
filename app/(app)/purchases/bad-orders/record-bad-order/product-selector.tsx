'use client';

import { useState, useEffect, useRef } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { useProducts } from '@/hooks/use-api';
import { Product } from '@/lib/types';
import { formatQuantity } from '@/lib/utils';

// ---------------------------------------------------------------------------
// DraggableSearchDialogContent
// ---------------------------------------------------------------------------

export function DraggableSearchDialogContent({
  className,
  children,
  onClose,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { onClose?: () => void }) {
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartPos = useRef({ x: 0, y: 0 });
  const elementStartPos = useRef({ x: 0, y: 0 });

  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-drag-handle]')) {
      setIsDragging(true);
      dragStartPos.current = { x: e.clientX, y: e.clientY };
      elementStartPos.current = { ...position };
      e.preventDefault();
    }
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - dragStartPos.current.x;
      const dy = e.clientY - dragStartPos.current.y;
      setPosition({ x: elementStartPos.current.x + dx, y: elementStartPos.current.y + dy });
    };
    const handleMouseUp = () => setIsDragging(false);

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Content
        {...props}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        onMouseDown={handleMouseDown}
        style={{
          position: 'fixed',
          left: '50%',
          top: '20%',
          transform: `translate(calc(-50% + ${position.x}px), ${position.y}px)`,
          zIndex: 200,
        }}
        className={`bg-background p-6 shadow-lg rounded-xl border w-full max-w-lg ${className}`}
      >
        {children}
        <DialogPrimitive.Close
          onClick={onClose}
          className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground"
        >
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

// ---------------------------------------------------------------------------
// ProductSelector
// ---------------------------------------------------------------------------

export function ProductSelector({
  onSelectProduct,
  supplierId,
}: {
  onSelectProduct: (product: Product) => void;
  supplierId?: string | null;
}) {
  // When a supplier is selected, only that supplier's products are searchable.
  // Otherwise, all products are shown.
  const filterSupplierId = supplierId && supplierId !== 'none' ? supplierId : undefined;
  const { products: allProducts, loading, error } = useProducts(undefined, undefined, filterSupplierId);
  // Services are excluded: they have no stock, so they can't be reported as a
  // bad order. useProducts() is shared with POS/sales, so filter here rather
  // than in the hook or API route.
  const products = allProducts.filter((p) => p.type !== 'service');
  const [inputValue, setInputValue] = useState('');
  const [searchDialogOpen, setSearchDialogOpen] = useState(false);
  const [commandSearch, setCommandSearch] = useState('');

  const handleScanOrPunch = () => {
    const term = inputValue.trim();
    if (!term) return;

    const exactMatch = products.find(
      (p) =>
        p.barcode?.toLowerCase() === term.toLowerCase() ||
        p.sku?.toLowerCase() === term.toLowerCase(),
    );
    if (exactMatch) {
      onSelectProduct(exactMatch);
      setInputValue('');
      return;
    }

    const nameMatch = products.find((p) => p.name.toLowerCase() === term.toLowerCase());
    if (nameMatch) {
      onSelectProduct(nameMatch);
      setInputValue('');
      return;
    }

    const partialMatches = products.filter((p) =>
      p.name.toLowerCase().includes(term.toLowerCase()),
    );

    if (partialMatches.length === 1) {
      onSelectProduct(partialMatches[0]);
      setInputValue('');
    } else {
      setCommandSearch(term);
      setSearchDialogOpen(true);
    }
  };

  return (
    <>
      <div className="relative pb-2">
        <Input
          placeholder="Scan barcode, enter SKU, or type product name"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleScanOrPunch()}
          className="pr-10 bg-background"
        />
        <Search
          className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground cursor-pointer"
          onClick={() => setSearchDialogOpen(true)}
        />
      </div>

      <Dialog open={searchDialogOpen} onOpenChange={setSearchDialogOpen} modal={false}>
        <DraggableSearchDialogContent
          className="sm:max-w-md"
          onClose={() => setSearchDialogOpen(false)}
        >
          <div data-drag-handle className="cursor-move">
            <DialogHeader>
              <DialogTitle>Search Products</DialogTitle>
              <DialogDescription>Search and select a product to report.</DialogDescription>
            </DialogHeader>
          </div>

          {loading ? (
            <div className="flex justify-center py-4">
              <div className="text-sm text-muted-foreground">Loading products...</div>
            </div>
          ) : error ? (
            <div className="text-sm text-destructive py-4">Error loading products: {error}</div>
          ) : (
            <Command>
              <CommandInput
                placeholder="Type product name, SKU, or barcode..."
                value={commandSearch}
                onValueChange={setCommandSearch}
              />
              <CommandList>
                <CommandEmpty>No products found.</CommandEmpty>
                <CommandGroup>
                  {products.map((product) => (
                    <CommandItem
                      key={product.id}
                      value={`${product.name} ${product.sku || ''} ${product.barcode || ''}`}
                      onSelect={() => {
                        onSelectProduct(product);
                        setSearchDialogOpen(false);
                      }}
                    >
                      <div className="flex flex-col">
                        <span className="font-medium">{product.name}</span>
                        <span className="text-sm text-muted-foreground">
                          SKU: {product.sku || 'N/A'} | Barcode: {product.barcode || 'N/A'} | Stock:{' '}
                          {formatQuantity(product.stock)}
                        </span>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          )}
        </DraggableSearchDialogContent>
      </Dialog>
    </>
  );
}
