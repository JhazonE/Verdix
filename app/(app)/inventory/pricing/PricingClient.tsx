'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Search, X, Loader2, Package, SlidersHorizontal, Tags, ArrowRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';

import { useBulkPriceUpdate } from '@/app/(app)/products/bulk-price-update/use-bulk-price-update';
import { downloadPriceListTemplate } from '@/app/(app)/products/bulk-price-update/price-list-template';
import { UploadPriceListDialog } from '@/app/(app)/products/bulk-price-update/UploadPriceListDialog';
import { PricingConfigFields } from './pricing-config-fields';

interface Option { id: string; name: string }

function getCurrentUserId(): string {
  try {
    const raw = localStorage.getItem('mock-user-session');
    return raw ? JSON.parse(raw).uid : 'system';
  } catch {
    return 'system';
  }
}

export default function PricingClient() {
  const router = useRouter();
  const queryClient = useQueryClient();
  // Both an in-page submit and an Excel upload change the prices this list
  // displays, so refetch the product query after either one.
  const refreshProducts = () =>
    queryClient.invalidateQueries({ queryKey: ['bulk-price-update-products'] });
  const bp = useBulkPriceUpdate(refreshProducts);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [mobileView, setMobileView] = useState<'list' | 'config'>('list');
  const [warehouses, setWarehouses] = useState<Option[]>([]);
  const [priceLevels, setPriceLevels] = useState<Option[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [whRes, plRes] = await Promise.all([
          fetch('/api/warehouses').then(r => r.json()),
          fetch('/api/price-levels').then(r => r.json()),
        ]);
        if (cancelled) return;
        setWarehouses((whRes?.data ?? []).map((w: any) => ({ id: String(w.id), name: w.name })));
        setPriceLevels((plRes?.data ?? []).map((pl: any) => ({ id: String(pl.id), name: pl.name })));
      } catch {
        // Options are additive — an empty list just leaves the selects empty
        // rather than breaking the page.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const allSelected = bp.products.length > 0 && bp.selectedIds.size === bp.products.length;

  const configFieldsProps = {
    warehouses,
    priceLevels,
    warehouseId: bp.warehouseId,
    setWarehouseId: bp.setWarehouseId,
    targetField: bp.targetField,
    setTargetField: bp.setTargetField,
    adjustmentType: bp.adjustmentType,
    setAdjustmentType: bp.setAdjustmentType,
    priceLevelId: bp.priceLevelId,
    onPriceLevelChange: (id: string) => {
      bp.setPriceLevelId(id);
      bp.setPriceLevelName(priceLevels.find(pl => pl.id === id)?.name || '');
    },
    adjustmentValue: bp.adjustmentValue,
    setAdjustmentValue: bp.setAdjustmentValue,
    onDownloadTemplate: () => downloadPriceListTemplate(
      bp.products.slice(0, 3).map((p: any) => ({
        barcode: p.baseUnitBarcode || p.barcode || '',
        name: p.name,
        brand: p.brand || '',
        category: p.category || '',
        unitOfMeasure: p.unitOfMeasure || '',
        price: Number(p.price),
        cost: Number(p.cost || 0),
      })),
      warehouses.find(w => w.id === bp.warehouseId)?.name || 'warehouse',
    ),
    onOpenUpload: () => setIsUploadOpen(true),
  };

  const searchBar = (compact?: boolean) => (
    <div className="relative">
      <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
      <Input
        placeholder="Search products by SKU, barcode, or name..."
        className={cn('pl-10 pr-10 bg-muted/40 focus:bg-background transition-colors', compact ? 'h-10' : 'h-11')}
        value={bp.searchTerm}
        onChange={e => bp.setSearchTerm(e.target.value)}
        disabled={!bp.warehouseId}
      />
      {bp.searchTerm && (
        <button
          onClick={() => bp.setSearchTerm('')}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );

  const productTable = (
    <Table>
      <TableHeader className="sticky top-0 bg-card z-10 border-b border-border">
        <TableRow className="hover:bg-transparent">
          <TableHead className="pl-6 py-3 w-10">
            <Checkbox
              checked={allSelected}
              onCheckedChange={c => c
                ? bp.selectAll(bp.products.map((p: any) => p.id))
                : bp.clearSelection()}
            />
          </TableHead>
          <TableHead className="py-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">Product</TableHead>
          <TableHead className="py-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">Barcode</TableHead>
          <TableHead className="py-3 text-xs font-bold uppercase tracking-widest text-muted-foreground text-right">Price</TableHead>
          <TableHead className="pr-6 py-3 text-xs font-bold uppercase tracking-widest text-muted-foreground text-right">Cost</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {bp.products.map((p: any) => (
          <TableRow
            key={p.id}
            className={cn('cursor-pointer', bp.selectedIds.has(p.id) && 'bg-primary/5')}
            onClick={() => bp.toggleSelected(p.id)}
          >
            {/* The row itself toggles selection, so the checkbox must not also
                handle the click — both firing would toggle twice and leave the
                row unchanged. Let the row own the state change. */}
            <TableCell className="pl-6" onClick={e => e.stopPropagation()}>
              <Checkbox
                checked={bp.selectedIds.has(p.id)}
                onCheckedChange={() => bp.toggleSelected(p.id)}
              />
            </TableCell>
            <TableCell className="font-medium">{p.name}</TableCell>
            <TableCell className="text-muted-foreground text-sm font-mono">
              {p.baseUnitBarcode || p.barcode || '—'}
            </TableCell>
            <TableCell className="text-right">₱{Number(p.price || 0).toFixed(2)}</TableCell>
            <TableCell className="pr-6 text-right text-muted-foreground">
              ₱{Number(p.cost || 0).toFixed(2)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  const previewTable = (
    <Table>
      <TableHeader className="sticky top-0 bg-card z-10 border-b border-border">
        <TableRow className="hover:bg-transparent">
          <TableHead className="pl-6 py-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">Product</TableHead>
          <TableHead className="py-3 text-xs font-bold uppercase tracking-widest text-muted-foreground text-right">Old</TableHead>
          <TableHead className="pr-6 py-3 text-xs font-bold uppercase tracking-widest text-muted-foreground text-right">New</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {bp.preview.map(item => (
          <TableRow key={item.productId}>
            <TableCell className="pl-6 font-medium">{item.productName}</TableCell>
            <TableCell className="text-right text-muted-foreground">₱{item.oldValue.toFixed(2)}</TableCell>
            <TableCell className="pr-6 text-right font-bold text-primary">
              ₱{item.newValue.toFixed(2)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  const listBody = (
    <>
      {!bp.warehouseId ? (
        <PricingEmptyState
          title="No warehouse chosen"
          message="Choose a warehouse in the configuration panel to load its products."
        />
      ) : bp.isLoading ? (
        <div className="flex flex-col items-center justify-center h-full min-h-[300px] gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading products...</p>
        </div>
      ) : bp.products.length === 0 ? (
        <PricingEmptyState
          title="No products found"
          message="No products match this warehouse and search. Try a different term."
        />
      ) : (
        <>
          {productTable}
          {bp.preview.length > 0 && (
            <div className="border-t-4 border-border mt-2">
              <div className="flex items-center gap-2 px-6 py-3 bg-muted/30">
                <ArrowRight className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Preview — {bp.preview.length} change{bp.preview.length !== 1 ? 's' : ''}
                </span>
              </div>
              {previewTable}
            </div>
          )}
        </>
      )}
    </>
  );

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-background">

      <UploadPriceListDialog
        open={isUploadOpen}
        onOpenChange={setIsUploadOpen}
        warehouseId={bp.warehouseId}
        onUpdated={refreshProducts}
      />

      {/* ═══════════════════════ DESKTOP LAYOUT ═══════════════════════ */}
      <div data-testid="pricing-desktop" className="hidden md:flex flex-1 min-h-0 overflow-hidden">

        {/* Left: Product List */}
        <div className="flex-1 flex flex-col min-w-0 bg-card border-r border-border">
          <div className="px-6 py-4 border-b border-border bg-card shrink-0">
            {searchBar()}
          </div>
          <ScrollArea className="flex-1">{listBody}</ScrollArea>
        </div>

        {/* Right: Config Sidebar */}
        <div className="w-[340px] shrink-0 bg-card border-l border-border flex flex-col">
          <div className="px-6 py-4 border-b border-border flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <SlidersHorizontal className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-foreground">Price Configuration</h3>
              <p className="text-[11px] text-muted-foreground">Set options for this update</p>
            </div>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-6">
              <PricingConfigFields {...configFieldsProps} />
            </div>
          </ScrollArea>
        </div>
      </div>

      {/* ═══════════════════════ MOBILE LAYOUT ═══════════════════════ */}
      <div className="flex md:hidden flex-1 flex-col min-h-0">
        <div className="bg-card border-b border-border shrink-0">
          <div className="flex border-b border-border">
            <button
              onClick={() => setMobileView('list')}
              className={cn(
                'flex-1 flex items-center justify-center gap-2 py-3 text-sm font-semibold transition-colors border-b-2',
                mobileView === 'list'
                  ? 'text-primary border-primary bg-primary/5'
                  : 'text-muted-foreground border-transparent hover:text-foreground',
              )}
            >
              <Package className="h-4 w-4" />
              Products
              {bp.selectedIds.size > 0 && (
                <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
                  {bp.selectedIds.size}
                </span>
              )}
            </button>
            <button
              onClick={() => setMobileView('config')}
              className={cn(
                'flex-1 flex items-center justify-center gap-2 py-3 text-sm font-semibold transition-colors border-b-2',
                mobileView === 'config'
                  ? 'text-primary border-primary bg-primary/5'
                  : 'text-muted-foreground border-transparent hover:text-foreground',
              )}
            >
              <SlidersHorizontal className="h-4 w-4" />
              Configure
            </button>
          </div>
        </div>

        {mobileView === 'list' && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <div className="px-4 py-3 bg-card border-b border-border shrink-0">
              {searchBar(true)}
            </div>
            <div className="flex-1 overflow-y-auto">{listBody}</div>
          </div>
        )}

        {mobileView === 'config' && (
          <div className="flex-1 overflow-y-auto">
            <div className="p-4">
              <PricingConfigFields compact {...configFieldsProps} />
            </div>
          </div>
        )}
      </div>

      {/* ══════════════════ FOOTER (both views) ══════════════════════ */}
      <div className="shrink-0 bg-card border-t border-border shadow-[0_-2px_16px_rgba(0,0,0,0.06)]">
        <div className="hidden md:flex items-center gap-3 px-6 pt-3 pb-1">
          <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
            {bp.selectedIds.size} selected
          </span>
          {bp.preview.length > 0 && (
            <Badge variant="outline" className="bg-primary/5 text-primary border-primary/30 text-[11px] gap-1">
              <Tags className="h-3 w-3" /> {bp.preview.length} to update
            </Badge>
          )}
          {bp.targetField === 'priceLevel' && !bp.priceLevelId && bp.selectedIds.size > 0 && (
            <Badge variant="destructive" className="text-[11px] ml-auto">
              Select a price level
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
            className="h-11 font-bold flex-1 gap-2 transition-all"
            disabled={bp.preview.length === 0 || bp.isSubmitting}
            onClick={() => bp.submit(getCurrentUserId())}
          >
            {bp.isSubmitting ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Submitting...</>
            ) : (
              <>Update {bp.preview.length} Product{bp.preview.length !== 1 ? 's' : ''}</>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

function PricingEmptyState({ title, message }: { title: string; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[300px] text-center px-6 py-12">
      <div className="w-20 h-20 rounded-2xl bg-muted flex items-center justify-center mb-5">
        <Tags className="h-10 w-10 text-muted-foreground/60" />
      </div>
      <h3 className="text-lg font-bold text-foreground mb-1">{title}</h3>
      <p className="text-sm text-muted-foreground max-w-xs">{message}</p>
    </div>
  );
}
