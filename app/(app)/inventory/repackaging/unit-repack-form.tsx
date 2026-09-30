'use client';

import { ArrowRight, Package, Search, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatUnitBreakdown } from '@/lib/unit-quantity';

import { useUnitRepackForm } from './use-unit-repack-form';

/**
 * Repackage inside one product: open a Case into Pieces, or merge Pieces back
 * into Cases. Both are the same operation between two of a product's selling
 * units, so this one form replaces the separate Break Pack and Pack -> Bulk flows.
 */
export function UnitRepackForm({ onSuccess }: { onSuccess?: () => void }) {
  const {
    search,
    setSearch,
    results,
    product,
    selectProduct,
    clearProduct,
    fromUnitId,
    setFromUnitId,
    toUnitId,
    setToUnitId,
    fromUnit,
    toUnit,
    quantity,
    setQuantity,
    actualProduced,
    setActualProduced,
    preview,
    canSubmit,
    isLoading,
    handleSubmit,
  } = useUnitRepackForm({ onSuccess });

  const outcome = preview.outcome;

  return (
    <div className="space-y-6 max-w-2xl mx-auto py-4">
      {/* 1. Product */}
      <div className="space-y-2">
        <Label>Product</Label>
        {product ? (
          <div className="flex items-center justify-between rounded-xl border p-3">
            <div className="flex items-center gap-3 min-w-0">
              <Package className="h-5 w-5 text-primary shrink-0" />
              <div className="min-w-0">
                <p className="font-semibold truncate">{product.name}</p>
                <p className="text-xs text-muted-foreground">
                  In stock: {formatUnitBreakdown(product.stock, product.sellingUnits)}
                </p>
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={clearProduct} aria-label="Change product">
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                autoFocus
                className="pl-9"
                placeholder="Search by name or barcode…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            {results.length > 0 && (
              <div className="rounded-xl border divide-y max-h-64 overflow-auto">
                {results.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className="w-full text-left p-3 hover:bg-muted/50 transition-colors"
                    onClick={() => selectProduct(r)}
                  >
                    <p className="font-medium">{r.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatUnitBreakdown(r.stock, r.sellingUnits)} · units:{' '}
                      {r.sellingUnits.map((u) => u.name).join(', ')}
                    </p>
                  </button>
                ))}
              </div>
            )}
            {search.trim().length >= 2 && results.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No matching product with more than one selling unit.
              </p>
            )}
          </>
        )}
      </div>

      {product && fromUnit && toUnit && (
        <>
          {/* 2. Units + quantity */}
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] items-end gap-3">
            <div className="space-y-2">
              <Label>Use</Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  min="0"
                  step="any"
                  className="w-24"
                  aria-label="Quantity to use"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
                <Select value={fromUnitId} onValueChange={setFromUnitId}>
                  <SelectTrigger aria-label="From unit"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {product.sellingUnits.map((u) => (
                      <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <ArrowRight className="hidden sm:block h-5 w-5 mb-2.5 text-muted-foreground" />
            <div className="space-y-2">
              <Label>Into</Label>
              <Select value={toUnitId} onValueChange={setToUnitId}>
                <SelectTrigger aria-label="To unit"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {product.sellingUnits.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* 3. Expected + actual */}
          {outcome && (
            <div className="rounded-xl bg-muted/40 p-4 space-y-3">
              <p className="text-sm">
                Expected:{' '}
                <span className="font-semibold">
                  {parseFloat(outcome.expectedProduced.toFixed(4))} {toUnit.name}
                </span>{' '}
                <span className="text-muted-foreground">
                  ({parseFloat(outcome.baseUsed.toFixed(4))} base units)
                </span>
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="actual-produced" className="text-xs">
                  Actually obtained ({toUnit.name}) — optional
                </Label>
                <Input
                  id="actual-produced"
                  type="number"
                  min="0"
                  step="any"
                  className="w-40"
                  placeholder={String(parseFloat(outcome.expectedProduced.toFixed(4)))}
                  value={actualProduced}
                  onChange={(e) => setActualProduced(e.target.value)}
                />
              </div>
              {outcome.shortfallBase > 0 && (
                <p className="text-xs text-amber-600" data-testid="shortfall-note">
                  {outcome.shortfallBase} base unit(s) short — this will be written off as a stock
                  adjustment.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Total stock stays the same: {product.sellingUnits.map((u) => u.name).join(' and ')}{' '}
                share one count.
              </p>
            </div>
          )}

          {preview.error && <p className="text-sm text-destructive">{preview.error}</p>}

          <Button onClick={handleSubmit} disabled={!canSubmit} className="w-full">
            {isLoading ? 'Processing…' : 'Confirm Repackaging'}
          </Button>
        </>
      )}
    </div>
  );
}
