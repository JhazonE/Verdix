'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
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
  ChevronRight, ChevronDown, Layers,
} from 'lucide-react';
import { cn } from '@/lib/utils';

import { useBulkPriceUpdate, type PricingRow } from '@/app/(app)/products/bulk-price-update/use-bulk-price-update';
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
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

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

  // Rows are per selling unit; group them back under their product so the list
  // still reads as a product list, with each product's packs nested beneath it.
  const groups = useMemo(() => {
    const byProduct = new Map<string, { productId: string; productName: string; rows: PricingRow[] }>();
    for (const r of bp.rows as PricingRow[]) {
      if (!byProduct.has(r.productId)) {
        byProduct.set(r.productId, { productId: r.productId, productName: r.productName, rows: [] });
      }
      byProduct.get(r.productId)!.rows.push(r);
    }
    return Array.from(byProduct.values());
  }, [bp.rows]);

  const allSelected = bp.rows.length > 0 && bp.selectedIds.size === bp.rows.length;

  const toggleExpanded = (productId: string) =>
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId); else next.add(productId);
      return next;
    });

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
                ? bp.selectAll((bp.rows as PricingRow[]).map(r => r.key))
                : bp.clearSelection()}
            />
          </TableHead>
          <TableHead className="py-3 w-8" />
          <TableHead className="py-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">Product / Unit</TableHead>
          <TableHead className="py-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">Barcode</TableHead>
          <TableHead className="py-3 text-xs font-bold uppercase tracking-widest text-muted-foreground text-right">Price</TableHead>
          <TableHead className="pr-6 py-3 text-xs font-bold uppercase tracking-widest text-muted-foreground text-right">Cost</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {groups.map(group => {
          const extraUnits = group.rows.filter(r => !r.isBase);
          const baseRow = group.rows.find(r => r.isBase) ?? group.rows[0];
          const isOpen = expanded.has(group.productId);
          const selectedHere = group.rows.filter(r => bp.selectedIds.has(r.key)).length;

          // The rail and tint run down the parent AND its packs so the group
          // reads as one block that ends where the tint ends. It cannot be a
          // wrapper element — a div around <tr>s is invalid inside a table — so
          // each row in the group draws its own slice of the same left border,
          // which renders identically and keeps every column aligned with the
          // ungrouped rows above and below.
          const grouped = isOpen && extraUnits.length > 0;
          const railCell = grouped ? 'border-l-[3px] border-l-primary pl-[21px]' : 'pl-6';
          const bandRow = grouped ? 'bg-primary/[0.03]' : '';

          return (
            <Fragment key={group.productId}>
              {/* Product row — selects the BASE unit, since that is the price
                  this row displays. Its packs are selected individually below. */}
              <TableRow
                className={cn('cursor-pointer', bandRow, bp.selectedIds.has(baseRow.key) && 'bg-primary/5')}
                onClick={() => bp.toggleSelected(baseRow.key)}
              >
                {/* The row itself toggles selection, so the checkbox must not also
                    handle the click — both firing would toggle twice and leave the
                    row unchanged. Let the row own the state change. */}
                <TableCell className={railCell} onClick={e => e.stopPropagation()}>
                  <Checkbox
                    checked={bp.selectedIds.has(baseRow.key)}
                    onCheckedChange={() => bp.toggleSelected(baseRow.key)}
                  />
                </TableCell>
                <TableCell className="p-0" onClick={e => e.stopPropagation()}>
                  {extraUnits.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => toggleExpanded(group.productId)}
                      className={cn(
                        'h-7 w-7 flex items-center justify-center rounded hover:bg-muted',
                        isOpen ? 'text-primary' : 'text-muted-foreground',
                      )}
                      aria-label={isOpen ? 'Hide selling units' : 'Show selling units'}
                      aria-expanded={isOpen}
                    >
                      {isOpen
                        ? <ChevronDown className="h-4 w-4" />
                        : <ChevronRight className="h-4 w-4" />}
                    </button>
                  ) : null}
                </TableCell>
                <TableCell className="font-medium">
                  <span className="flex items-center gap-2">
                    {group.productName}
                    {extraUnits.length > 0 && (
                      <Badge
                        variant="outline"
                        className={cn(
                          'text-[10px] gap-1 font-semibold',
                          // A collapsed group must never hide a pending change,
                          // so the badge goes solid once anything inside it is
                          // selected.
                          selectedHere > 0
                            ? 'bg-primary/10 text-primary border-primary/30'
                            : 'text-muted-foreground',
                        )}
                      >
                        <Layers className="h-3 w-3" />
                        {group.rows.length} units
                        {selectedHere > 0 && ` · ${selectedHere} selected`}
                      </Badge>
                    )}
                  </span>
                </TableCell>
                <TableCell className="text-muted-foreground text-sm font-mono">
                  {baseRow.barcode || '—'}
                </TableCell>
                <TableCell className="text-right">₱{baseRow.price.toFixed(2)}</TableCell>
                <TableCell className="pr-6 text-right text-muted-foreground">
                  ₱{baseRow.cost.toFixed(2)}
                </TableCell>
              </TableRow>

              {isOpen && extraUnits.map(r => (
                <TableRow
                  key={r.key}
                  className={cn('cursor-pointer', bandRow, bp.selectedIds.has(r.key) && 'bg-primary/5')}
                  onClick={() => bp.toggleSelected(r.key)}
                >
                  <TableCell className={railCell} onClick={e => e.stopPropagation()}>
                    <Checkbox
                      checked={bp.selectedIds.has(r.key)}
                      onCheckedChange={() => bp.toggleSelected(r.key)}
                    />
                  </TableCell>
                  <TableCell />
                  <TableCell className="text-sm">
                    <span className="flex items-center gap-2 flex-wrap">
                      {/* The chip is what survives scrolling: once the parent
                          row is off screen the band and rail say nothing, but
                          "Unit · Box · of tes55" still reads correctly. */}
                      <span className="inline-flex items-center gap-1 rounded border border-primary/25 bg-primary/5 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-primary">
                        <Layers className="h-2.5 w-2.5" />
                        Unit
                      </span>
                      <span className="font-medium">{r.sellingUnitName}</span>
                      {/* A bare "×12" means nothing without the unit it counts. */}
                      <span className="text-[11px] text-muted-foreground">
                        {r.factor} × {baseRow.sellingUnitName || 'base'}
                      </span>
                      {/* Full token, not a faded one: at 11px an opacity-dimmed
                          muted-foreground drops under 4.5:1 on the band. */}
                      <span className="text-[11px] text-muted-foreground">
                        of {group.productName}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm font-mono">
                    {/* A pack genuinely without a barcode is labelled rather
                        than left as a dash — blank reads as a loading bug. */}
                    {r.barcode || (
                      <span className="inline-flex items-center rounded border border-border px-1.5 py-0.5 font-sans text-[10px] not-italic text-muted-foreground">
                        no barcode
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">₱{r.price.toFixed(2)}</TableCell>
                  <TableCell className="pr-6 text-right text-muted-foreground">
                    ₱{r.cost.toFixed(2)}
                  </TableCell>
                </TableRow>
              ))}
            </Fragment>
          );
        })}
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
        {/* Two selling units of the same product can both be in the preview,
            so the product id alone is no longer a unique key. */}
        {bp.preview.map(item => (
          <TableRow key={`${item.productId}::${item.sellingUnitId ?? 'base'}`}>
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
              <>Update {bp.preview.length} Item{bp.preview.length !== 1 ? 's' : ''}</>
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
