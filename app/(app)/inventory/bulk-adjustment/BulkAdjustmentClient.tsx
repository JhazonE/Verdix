'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
  Search, Package, TrendingDown, TrendingUp, Loader2,
  CheckCircle2, Repeat, SlidersHorizontal, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

import { useBulkAdjustment } from './use-bulk-adjustment';
import { SearchResultsDropdown } from './search-results-dropdown';
import { ConfigFields } from './config-fields';
import { EmptyState } from './empty-state';
import { AdjustmentTableRow } from './adjustment-table-row';
import { AdjustmentMobileCard } from './adjustment-mobile-card';

export default function BulkAdjustmentClient() {
  const {
    router,
    searchRef,
    search,
    setSearch,
    isLoadingProducts,
    showResults,
    setShowResults,
    warehouses,
    suppliers,
    adjustmentType,
    changeAdjustmentType,
    warehouseId,
    setWarehouseId,
    targetWarehouseId,
    setTargetWarehouseId,
    supplierId,
    setSupplierId,
    referenceNo,
    setReferenceNo,
    note,
    setNote,
    adjustments,
    isProcessing,
    showExpirationColumn,
    applyExpirationToAll,
    mobileView,
    setMobileView,
    filteredProducts,
    addProduct,
    removeAdjustment,
    updateAdjustment,
    handleProcessAdjustments,
    hasNegativeStock,
    addCount,
    removeCount,
    transferCount,
  } = useBulkAdjustment();

  const configFieldsProps = {
    adjustmentType,
    onChangeType: changeAdjustmentType,
    warehouseId,
    setWarehouseId,
    targetWarehouseId,
    setTargetWarehouseId,
    warehouses,
    referenceNo,
    setReferenceNo,
    suppliers,
    supplierId,
    setSupplierId,
    note,
    setNote,
    showExpirationColumn,
    applyExpirationToAll,
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-background">

      {/* ═══════════════════════ DESKTOP LAYOUT ═══════════════════════ */}
      <div className="hidden md:flex flex-1 min-h-0 overflow-hidden">

        {/* Left: Product List */}
        <div className="flex-1 flex flex-col min-w-0 bg-card border-r border-border">
          {/* Search Bar */}
          <div className="px-6 py-4 border-b border-border bg-card shrink-0">
            <div ref={searchRef} className="relative">
              <div className="flex items-center gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  <Input
                    placeholder="Search products by name or SKU..."
                    className="pl-10 h-11 bg-muted/40 focus:bg-background transition-colors"
                    value={search}
                    onChange={e => { setSearch(e.target.value); setShowResults(true); }}
                    onFocus={() => search.trim() && setShowResults(true)}
                  />
                  {search && (
                    <button onClick={() => { setSearch(''); setShowResults(false); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
              {showResults && search.trim() && (
                <SearchResultsDropdown isLoadingProducts={isLoadingProducts} filteredProducts={filteredProducts} onAdd={addProduct} />
              )}
            </div>
          </div>

          {/* Table */}
          <ScrollArea className="flex-1">
            {adjustments.length === 0 ? (
              <EmptyState />
            ) : (
              <Table>
                <TableHeader className="sticky top-0 bg-card z-10 border-b border-border">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-6 py-3 text-xs font-bold uppercase tracking-widest text-muted-foreground w-[280px]">Product</TableHead>
                    <TableHead className="py-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">Type</TableHead>
                    <TableHead className="py-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">Quantity</TableHead>
                    <TableHead className="py-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">Impact</TableHead>
                    {showExpirationColumn && <TableHead className="py-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">Expiry</TableHead>}
                    <TableHead className="py-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">Note</TableHead>
                    <TableHead className="pr-4 py-3 w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {adjustments.map(adj => (
                    <AdjustmentTableRow key={adj.product.id} adj={adj} onUpdate={updateAdjustment} onRemove={removeAdjustment} showExpirationColumn={showExpirationColumn} />
                  ))}
                </TableBody>
              </Table>
            )}
          </ScrollArea>
        </div>

        {/* Right: Config Sidebar */}
        <div className="w-[340px] shrink-0 bg-card border-l border-border flex flex-col">
          <div className="px-6 py-4 border-b border-border flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <SlidersHorizontal className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-foreground">Batch Configuration</h3>
              <p className="text-[11px] text-muted-foreground">Set options for this adjustment</p>
            </div>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-6">
              <ConfigFields {...configFieldsProps} />
            </div>
          </ScrollArea>
        </div>
      </div>

      {/* ═══════════════════════ MOBILE LAYOUT ═══════════════════════ */}
      <div className="flex md:hidden flex-1 flex-col min-h-0">

        {/* Mobile Header with Tabs */}
        <div className="bg-card border-b border-border shrink-0">
          <div className="flex border-b border-border">
            <button
              onClick={() => setMobileView('list')}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 py-3 text-sm font-semibold transition-colors border-b-2",
                mobileView === 'list'
                  ? "text-primary border-primary bg-primary/5"
                  : "text-muted-foreground border-transparent hover:text-foreground"
              )}
            >
              <Package className="h-4 w-4" />
              Items
              {adjustments.length > 0 && (
                <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
                  {adjustments.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setMobileView('config')}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 py-3 text-sm font-semibold transition-colors border-b-2",
                mobileView === 'config'
                  ? "text-primary border-primary bg-primary/5"
                  : "text-muted-foreground border-transparent hover:text-foreground"
              )}
            >
              <SlidersHorizontal className="h-4 w-4" />
              Configure
            </button>
          </div>
        </div>

        {/* Mobile Items View */}
        {mobileView === 'list' && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {/* Search Bar */}
            <div className="px-4 py-3 bg-card border-b border-border shrink-0">
              <div ref={searchRef} className="relative">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  placeholder="Search products..."
                  className="pl-10 h-10 bg-muted/40 pr-10"
                  value={search}
                  onChange={e => { setSearch(e.target.value); setShowResults(true); }}
                  onFocus={() => search.trim() && setShowResults(true)}
                />
                {search ? (
                  <button onClick={() => { setSearch(''); setShowResults(false); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    <X className="h-4 w-4" />
                  </button>
                ) : null}
                {showResults && search.trim() && (
                  <SearchResultsDropdown isLoadingProducts={isLoadingProducts} filteredProducts={filteredProducts} onAdd={addProduct} />
                )}
              </div>
            </div>

            {/* Item Cards */}
            <div className="flex-1 overflow-y-auto">
              {adjustments.length === 0 ? (
                <EmptyState />
              ) : (
                <div className="p-4 space-y-3 pb-4">
                  {adjustments.map(adj => (
                    <AdjustmentMobileCard key={adj.product.id} adj={adj} onUpdate={updateAdjustment} onRemove={removeAdjustment} showExpirationColumn={showExpirationColumn} />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Mobile Config View */}
        {mobileView === 'config' && (
          <div className="flex-1 overflow-y-auto">
            <div className="p-4 space-y-1">
              <ConfigFields compact {...configFieldsProps} />
            </div>
          </div>
        )}
      </div>

      {/* ══════════════════ FOOTER (both views) ══════════════════════ */}
      <div className="shrink-0 bg-card border-t border-border shadow-[0_-2px_16px_rgba(0,0,0,0.06)]">
        {/* Summary pills - desktop only */}
        <div className="hidden md:flex items-center gap-3 px-6 pt-3 pb-1">
          <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
            {adjustments.length} item{adjustments.length !== 1 ? 's' : ''} total
          </span>
          {addCount > 0 && (
            <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/30 text-[11px] gap-1">
              <TrendingUp className="h-3 w-3" /> {addCount} In
            </Badge>
          )}
          {removeCount > 0 && (
            <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/30 text-[11px] gap-1">
              <TrendingDown className="h-3 w-3" /> {removeCount} Out
            </Badge>
          )}
          {transferCount > 0 && (
            <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/30 text-[11px] gap-1">
              <Repeat className="h-3 w-3" /> {transferCount} Transfer
            </Badge>
          )}
          {hasNegativeStock && (
            <Badge variant="destructive" className="text-[11px] ml-auto">
              ⚠ Negative stock detected
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-3 px-4 md:px-6 py-3">
          <Button
            variant="outline"
            className="h-11 font-semibold text-muted-foreground hover:text-foreground md:w-auto w-1/3"
            onClick={() => router.push('/inventory')}
          >
            Cancel
          </Button>
          <Button
            className={cn(
              "h-11 font-bold flex-1 gap-2 transition-all",
              hasNegativeStock && "opacity-80"
            )}
            onClick={handleProcessAdjustments}
            disabled={adjustments.length === 0 || isProcessing || hasNegativeStock}
          >
            {isProcessing ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Processing...</>
            ) : (
              <><CheckCircle2 className="h-4 w-4" /> Apply {adjustments.length > 0 ? adjustments.length : ''} Adjustment{adjustments.length !== 1 ? 's' : ''}</>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
