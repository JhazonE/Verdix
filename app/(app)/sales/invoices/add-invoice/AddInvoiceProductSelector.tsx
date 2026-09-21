'use client';

import { useState, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from '@/components/ui/command';
import { Search, Loader2 } from 'lucide-react';
import { useProducts, mapApiProduct } from '@/hooks/use-api';
import { useDebounce } from '@/hooks/use-debounce';
import { getApiUrl } from '@/lib/api-config';
import { formatQuantity } from '@/lib/utils';
import type { Product } from '@/lib/types';
import { explodeToUnitRows, type ProductUnitRow } from '@/lib/selling-unit-rows';

type SelectedUnit = { id?: string; name: string; factor: number; price: number };
type Props = { onSelectProduct: (product: Product, unit?: SelectedUnit) => void; warehouseId?: string };

export function AddInvoiceProductSelector({ onSelectProduct, warehouseId }: Props) {
  const [inputValue, setInputValue] = useState('');
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [isScanning, setIsScanning] = useState(false);

  // Same field the user types/scans into now drives the autocomplete —
  // the server caps results at 100 rows, so without a search term a store
  // with more than 100 products would silently hide the rest behind that
  // page instead of ever fetching them, which is why suggestions only
  // appear once there's a query.
  const debouncedSearch = useDebounce(inputValue, 300);
  const { products: suggestedProducts, loading, error } = useProducts(debouncedSearch, undefined, undefined, warehouseId);
  const rows = useMemo<ProductUnitRow[]>(() => explodeToUnitRows(suggestedProducts), [suggestedProducts]);

  // Enter fires immediately, milliseconds after a hardware scanner finishes
  // typing — too fast for the debounced autocomplete query to have resolved.
  // It looks up the exact code directly instead of waiting on that query.
  const handleScanOrPunch = async () => {
    const code = inputValue.trim();
    if (!code) return;
    setIsScanning(true);
    try {
      const params = new URLSearchParams({ search: code, limit: '25' });
      if (warehouseId) params.append('warehouseId', warehouseId);
      const res = await fetch(getApiUrl(`/products?${params.toString()}`), { cache: 'no-store' });
      const result = await res.json();
      if (!result.success) return;
      const matches: Product[] = (result.data || []).map(mapApiProduct);

      const needle = code.toLowerCase();
      // A unit's own barcode takes priority so scanning a Case's barcode picks
      // the Case, not silently falling through to the product's base unit.
      const unitRow = explodeToUnitRows(matches).find(r => r.unit?.barcode?.toLowerCase() === needle);
      if (unitRow) {
        onSelectProduct(unitRow.product, unitRow.unit);
        setInputValue('');
        setSuggestionsOpen(false);
        return;
      }
      const product = matches.find(p =>
        p.barcode?.toLowerCase() === needle ||
        p.sku?.toLowerCase() === needle ||
        p.name.toLowerCase() === needle
      );
      if (product) {
        onSelectProduct(product);
        setInputValue('');
        setSuggestionsOpen(false);
      }
    } finally {
      setIsScanning(false);
    }
  };

  const selectRow = (row: ProductUnitRow) => {
    onSelectProduct(row.product, row.unit);
    setInputValue('');
    setSuggestionsOpen(false);
  };

  return (
    <Popover open={suggestionsOpen && inputValue.trim().length > 0} onOpenChange={setSuggestionsOpen}>
      <PopoverAnchor asChild>
        <div className="relative pb-2">
          <Input
            placeholder="Scan barcode, enter SKU, or type product name"
            value={inputValue}
            onChange={e => { setInputValue(e.target.value); setSuggestionsOpen(true); }}
            onFocus={() => setSuggestionsOpen(true)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); handleScanOrPunch(); }
              else if (e.key === 'Escape') { setSuggestionsOpen(false); }
            }}
            disabled={isScanning}
            className="pr-10 bg-background"
          />
          {isScanning ? (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground animate-spin" />
          ) : (
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="w-[--radix-popover-trigger-width] p-0"
      >
        <Command shouldFilter={false}>
          <CommandList>
            {loading ? (
              <div className="flex justify-center py-4 text-sm text-muted-foreground">Loading products...</div>
            ) : error ? (
              <div className="text-sm text-destructive py-4 px-2">Error loading products: {error}</div>
            ) : (
              <>
                <CommandEmpty>No products found.</CommandEmpty>
                <CommandGroup>
                  {rows.map(({ key, product, unit }) => (
                    <CommandItem
                      key={key}
                      value={key}
                      onSelect={() => selectRow({ key, product, unit })}
                    >
                      <div className="flex flex-col">
                        <span className="font-medium">
                          {product.name}
                          {unit && !unit.isBase && (
                            <span className="ml-1.5 text-xs font-normal text-muted-foreground">({unit.name})</span>
                          )}
                        </span>
                        <span className="text-sm text-muted-foreground">
                          SKU: {product.sku || 'N/A'} | Barcode: {unit?.barcode || product.barcode || 'N/A'} | Stock: {formatQuantity(product.stock)}
                        </span>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
