'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger,
} from '@/components/ui/sheet';
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command';
import { Loader2, Package2, X, Eye, EyeOff, Tag, FlaskConical } from 'lucide-react';
import { calculateEffectivePriceForUnit } from '@/lib/pricing';
import { formatStockQuantity } from '@/lib/utils';
import { useProductSearch } from './use-product-search';
import type { ProductSearchDialogProps } from './product-search-types';

const LS_KEY = 'pos_search_filter_visibility';

function loadVisibility() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw) as { category: boolean; brand: boolean };
  } catch {}
  return { category: true, brand: true };
}

export function ProductSearchDialog({
  onSelectProduct, children, isOpen, onOpenChange,
  showQuantityInSearch = true,
  activeLevelId, defaultLevelId, activeLevelName = 'Retail',
  warehouseId, allProducts,
}: ProductSearchDialogProps) {
  const {
    searchTerm, setSearchTerm,
    selectedBrand, setSelectedBrand,
    selectedCategory, setSelectedCategory,
    displayedRows, loading, error,
    handleSelect, stockTone,
    brands, categories,
  } = useProductSearch({ isOpen, onOpenChange, onSelectProduct, activeLevelId, warehouseId, allProducts });

  const [showCategory, setShowCategory] = useState(true);
  const [showBrand, setShowBrand]       = useState(true);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Load persisted visibility on first open
  useEffect(() => {
    const saved = loadVisibility();
    setShowCategory(saved.category);
    setShowBrand(saved.brand);
  }, []);

  function toggleCategory() {
    const next = !showCategory;
    setShowCategory(next);
    if (!next) setSelectedCategory('');
    localStorage.setItem(LS_KEY, JSON.stringify({ category: next, brand: showBrand }));
  }

  function toggleBrand() {
    const next = !showBrand;
    setShowBrand(next);
    if (!next) setSelectedBrand('');
    localStorage.setItem(LS_KEY, JSON.stringify({ category: showCategory, brand: next }));
  }

  const hasFilters        = selectedBrand || selectedCategory;
  const hasCategoryData   = categories.length > 0;
  const hasBrandData      = brands.length > 0;
  const anyColumnVisible  = (hasCategoryData && showCategory) || (hasBrandData && showBrand);

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>{children}</SheetTrigger>
      <SheetContent
        side="top"
        className="h-[65vh] w-full flex flex-col p-0 gap-0"
        // Radix focuses the first tabbable child, which is the Category toggle in the
        // header. The cashier types straight after F9, so claim focus for the input.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          searchInputRef.current?.focus();
        }}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {/* Header */}
        <SheetHeader className="px-6 pt-4 pb-3 border-b text-left shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <SheetTitle className="text-base">Search Product</SheetTitle>
              <SheetDescription className="text-xs mt-0.5">
                Type a name, barcode, or filter by brand / category
              </SheetDescription>
            </div>

            <div className="flex items-center gap-2">
              {/* Column visibility toggles */}
              {hasCategoryData && (
                <VisibilityToggle
                  label="Category"
                  icon={<Tag className="h-3 w-3" />}
                  visible={showCategory}
                  onToggle={toggleCategory}
                />
              )}
              {hasBrandData && (
                <VisibilityToggle
                  label="Brand"
                  icon={<FlaskConical className="h-3 w-3" />}
                  visible={showBrand}
                  onToggle={toggleBrand}
                />
              )}

              {/* Clear filters */}
              {hasFilters && (
                <button
                  onClick={() => { setSelectedCategory(''); setSelectedBrand(''); }}
                  className="flex items-center gap-1.5 rounded-lg border border-rose-300 bg-rose-50 dark:bg-rose-950/30 dark:border-rose-800 px-2.5 py-1 text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-950/50 transition-colors"
                >
                  <X className="h-3 w-3" />
                  Clear
                </button>
              )}
            </div>
          </div>
        </SheetHeader>

        <Command shouldFilter={false} className="flex-1 flex flex-col overflow-hidden rounded-none">
          <div className="flex flex-1 overflow-hidden">

            {/* ── Filter columns ── */}
            {anyColumnVisible && (
              <div className="flex shrink-0 border-r overflow-hidden" style={{ width: 340 }}>

                {/* Category column */}
                {hasCategoryData && showCategory && (
                  <div className={`flex flex-col overflow-hidden ${hasBrandData && showBrand ? 'flex-1 border-r' : 'w-full'}`}>
                    <div className="flex items-center justify-between px-4 py-2.5 border-b bg-muted/30">
                      <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        <Tag className="h-3 w-3" />
                        Category
                      </span>
                    </div>
                    <div className="flex-1 overflow-y-auto no-scrollbar">
                      <ColItem active={!selectedCategory} color="primary" onClick={() => setSelectedCategory('')}>
                        All
                      </ColItem>
                      {categories.map(cat => (
                        <ColItem
                          key={cat}
                          active={selectedCategory === cat}
                          color="primary"
                          onClick={() => setSelectedCategory(selectedCategory === cat ? '' : cat)}
                        >
                          {cat}
                        </ColItem>
                      ))}
                    </div>
                  </div>
                )}

                {/* Brand column */}
                {hasBrandData && showBrand && (
                  <div className={`flex flex-col overflow-hidden ${hasCategoryData && showCategory ? 'flex-1' : 'w-full'}`}>
                    <div className="flex items-center justify-between px-4 py-2.5 border-b bg-muted/30">
                      <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        <FlaskConical className="h-3 w-3" />
                        Brand
                      </span>
                    </div>
                    <div className="flex-1 overflow-y-auto no-scrollbar">
                      <ColItem active={!selectedBrand} color="sky" onClick={() => setSelectedBrand('')}>
                        All
                      </ColItem>
                      {brands.map(brand => (
                        <ColItem
                          key={brand}
                          active={selectedBrand === brand}
                          color="sky"
                          onClick={() => setSelectedBrand(selectedBrand === brand ? '' : brand)}
                        >
                          {brand}
                        </ColItem>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Right: search + list ── */}
            <div className="flex flex-col flex-1 overflow-hidden">
              {/* Search input */}
              <div className="relative shrink-0 border-b">
                <CommandInput
                  ref={searchInputRef}
                  placeholder="Search by name or barcode..."
                  value={searchTerm}
                  onValueChange={setSearchTerm}
                  className="h-11"
                />
                {loading && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                )}
              </div>

              {/* Active filter pills */}
              {hasFilters && (
                <div className="shrink-0 flex items-center gap-2 px-4 py-1.5 border-b bg-muted/10">
                  {selectedCategory && (
                    <span className="flex items-center gap-1 rounded bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 text-[11px] font-semibold">
                      {selectedCategory}
                      <button onClick={() => setSelectedCategory('')} className="hover:opacity-60 transition-opacity">
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </span>
                  )}
                  {selectedBrand && (
                    <span className="flex items-center gap-1 rounded bg-sky-100 dark:bg-sky-950/40 text-sky-700 dark:text-sky-400 border border-sky-200 dark:border-sky-800 px-2 py-0.5 text-[11px] font-semibold">
                      {selectedBrand}
                      <button onClick={() => setSelectedBrand('')} className="hover:opacity-60 transition-opacity">
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </span>
                  )}
                  <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
                    {displayedRows.length} result{displayedRows.length !== 1 ? 's' : ''}
                  </span>
                </div>
              )}

              {/* Product list */}
              <CommandList className="flex-1 max-h-none overflow-y-auto">
                {error && <div className="p-4 text-center text-sm text-destructive">{error}</div>}
                {displayedRows.length === 0 && !loading && !error && (
                  <CommandEmpty className="flex h-32 flex-col items-center justify-center gap-2 text-muted-foreground">
                    <Package2 className="h-8 w-8 opacity-20" />
                    <span className="text-sm">No products found</span>
                  </CommandEmpty>
                )}
                <CommandGroup className={loading ? 'opacity-50 transition-opacity duration-200' : 'transition-opacity duration-200'}>
                  {displayedRows.map(({ key, product, unit }) => {
                    const outOfStock = product.stock <= 0;
                    const unitPrice = unit
                      ? calculateEffectivePriceForUnit(unit, 1, activeLevelId, defaultLevelId)
                      : calculateEffectivePriceForUnit({ price: product.price, priceLevels: [] }, 1, activeLevelId, defaultLevelId);
                    return (
                      <CommandItem
                        key={key}
                        value={`${product.name} ${unit?.name || ''} ${unit?.barcode || product.barcode || ''}`}
                        onSelect={() => handleSelect(key)}
                        className="group mx-2 my-0.5 flex items-center gap-3 rounded-xl px-3 py-2 cursor-pointer transition-colors data-[selected=true]:bg-accent"
                      >
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted">
                          {product.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={product.imageUrl} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <Package2 className="h-4 w-4 text-muted-foreground" />
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold leading-tight">
                            {product.name}
                            {unit && !unit.isBase && (
                              <span className="ml-1.5 text-xs font-normal text-muted-foreground">({unit.name})</span>
                            )}
                          </p>
                          <div className="mt-0.5 flex items-center gap-1.5">
                            <span className="text-[11px] text-muted-foreground font-mono truncate">
                              {unit?.barcode || product.sellingUnits?.find((su: any) => su.isBase)?.barcode || product.barcode}
                            </span>
                            {product.brand && (
                              <span className="shrink-0 rounded bg-sky-100 dark:bg-sky-950/40 text-sky-700 dark:text-sky-400 px-1.5 py-px text-[10px] font-medium">
                                {product.brand}
                              </span>
                            )}
                            {product.category && (
                              <span className="shrink-0 rounded bg-primary/10 text-primary px-1.5 py-px text-[10px] font-medium">
                                {product.category}
                              </span>
                            )}
                          </div>
                        </div>

                        {!!showQuantityInSearch && (
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${stockTone(product)}`}>
                            {outOfStock ? 'Out of stock' : `${formatStockQuantity(product.stock)} ${product.unitOfMeasure}`}
                          </span>
                        )}

                        <div className="w-20 shrink-0 text-right">
                          <p className="font-mono text-sm font-bold text-primary">
                            ₱{unitPrice.toFixed(2)}
                          </p>
                          <span className="text-[10px] text-muted-foreground opacity-0 transition-opacity group-data-[selected=true]:opacity-100">
                            ↵ add
                          </span>
                        </div>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </CommandList>
            </div>
          </div>
        </Command>

        {/* Footer */}
        <div className="flex items-center justify-between border-t bg-muted/10 px-6 py-2 shrink-0">
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">↑↓</kbd> navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">↵</kbd> select
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">Esc</kbd> close
            </span>
          </div>
          <span className="text-[11px] text-muted-foreground/60">Prices: {activeLevelName}</span>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ── Visibility toggle button ── */

function VisibilityToggle({
  label, icon, visible, onToggle,
}: {
  label: string;
  icon: React.ReactNode;
  visible: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={visible ? `Hide ${label}` : `Show ${label}`}
      className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-all duration-150 ${
        visible
          ? 'border-border bg-background text-foreground hover:bg-muted'
          : 'border-dashed border-border bg-muted/40 text-muted-foreground hover:text-foreground'
      }`}
    >
      {icon}
      <span>{label}</span>
      {visible
        ? <Eye    className="h-3 w-3 text-muted-foreground" />
        : <EyeOff className="h-3 w-3" />
      }
    </button>
  );
}

/* ── Column filter item ── */

function ColItem({
  active, color, onClick, children,
}: {
  active: boolean;
  color: 'primary' | 'sky';
  onClick: () => void;
  children: React.ReactNode;
}) {
  const activeLeft = color === 'sky'
    ? 'border-l-sky-500 bg-sky-50 dark:bg-sky-950/30 text-sky-700 dark:text-sky-400 font-semibold'
    : 'border-l-primary bg-primary/5 text-primary font-semibold';
  const idle = 'border-l-transparent text-muted-foreground hover:text-foreground hover:bg-muted/60';

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-4 py-2 text-xs border-l-2 transition-all duration-150 ${active ? activeLeft : idle}`}
    >
      {children}
    </button>
  );
}
