'use client';

import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Search } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useBulkPriceUpdate } from './use-bulk-price-update';
import { downloadPriceListTemplate } from './price-list-template';
import { UploadPriceListDialog } from './UploadPriceListDialog';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productOptions: { warehouses?: { id: string; name: string }[]; priceLevels?: { id: string; name: string }[] };
  onUpdated?: () => void;
}

function getCurrentUserId(): string {
  try {
    const raw = localStorage.getItem('mock-user-session');
    return raw ? JSON.parse(raw).uid : 'system';
  } catch {
    return 'system';
  }
}

export function BulkPriceUpdateDrawer({ open, onOpenChange, productOptions, onUpdated }: Props) {
  const bp = useBulkPriceUpdate(onUpdated);
  const [isUploadOpen, setIsUploadOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Bulk Update Price</SheetTitle>
          <SheetDescription>Apply a price, cost, markup%, or price-level change to many products at once.</SheetDescription>
        </SheetHeader>

        <div className="space-y-4 py-4">
          <div className="grid gap-2">
            <Label>Warehouse</Label>
            <Select value={bp.warehouseId} onValueChange={bp.setWarehouseId}>
              <SelectTrigger><SelectValue placeholder="Select a warehouse" /></SelectTrigger>
              <SelectContent>
                {productOptions.warehouses?.map(w => (
                  <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {bp.warehouseId && (
            <>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => downloadPriceListTemplate(
                    bp.products.map((p: any) => ({ sku: p.sku, barcode: p.barcode || '', name: p.name, price: Number(p.price), cost: Number(p.cost || 0) })),
                    productOptions.warehouses?.find(w => w.id === bp.warehouseId)?.name || 'warehouse',
                  )}
                >
                  Download Template
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setIsUploadOpen(true)}>
                  Upload Excel
                </Button>
              </div>
              <UploadPriceListDialog
                open={isUploadOpen}
                onOpenChange={setIsUploadOpen}
                warehouseId={bp.warehouseId}
                onUpdated={onUpdated}
              />
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Target Field</Label>
                  <Select value={bp.targetField} onValueChange={(v: any) => bp.setTargetField(v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="price">Selling Price</SelectItem>
                      <SelectItem value="cost">Cost</SelectItem>
                      <SelectItem value="markup">Recalculate from Markup %</SelectItem>
                      <SelectItem value="priceLevel">Price Level</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Adjustment Type</Label>
                  <Select
                    value={bp.targetField === 'markup' ? 'markup' : bp.adjustmentType}
                    onValueChange={(v: any) => bp.setAdjustmentType(v)}
                    disabled={bp.targetField === 'markup'}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="percentage">Percentage (%)</SelectItem>
                      <SelectItem value="fixed">Fixed Amount (₱)</SelectItem>
                      <SelectItem value="exact">Set Exact Value</SelectItem>
                      {bp.targetField === 'markup' && <SelectItem value="markup">Markup %</SelectItem>}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {bp.targetField === 'priceLevel' && (
                <div className="grid gap-2">
                  <Label>Price Level</Label>
                  <Select value={bp.priceLevelId} onValueChange={(id) => {
                    bp.setPriceLevelId(id);
                    bp.setPriceLevelName(productOptions.priceLevels?.find(pl => pl.id === id)?.name || '');
                  }}>
                    <SelectTrigger><SelectValue placeholder="Select a price level" /></SelectTrigger>
                    <SelectContent>
                      {productOptions.priceLevels?.map(pl => (
                        <SelectItem key={pl.id} value={pl.id}>{pl.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="grid gap-2">
                <Label>{bp.targetField === 'markup' ? 'Target Markup %' : 'Value'}</Label>
                <Input
                  type="number"
                  value={bp.adjustmentValue}
                  onChange={(e) => bp.setAdjustmentValue(parseFloat(e.target.value) || 0)}
                />
              </div>

              <div className="relative">
                <Search className="absolute left-3 top-[0.65rem] h-4 w-4 text-muted-foreground" />
                <Input
                  type="search"
                  placeholder="Search products by SKU, barcode, or name..."
                  className="pl-9"
                  value={bp.searchTerm}
                  onChange={(e) => bp.setSearchTerm(e.target.value)}
                />
              </div>

              <div className="border rounded-lg max-h-64 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          checked={bp.products.length > 0 && bp.selectedIds.size === bp.products.length}
                          onCheckedChange={(c) => c ? bp.selectAll(bp.products.map((p: any) => p.id)) : bp.clearSelection()}
                        />
                      </TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead>Barcode</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bp.products.map((p: any) => (
                      <TableRow key={p.id}>
                        <TableCell><Checkbox checked={bp.selectedIds.has(p.id)} onCheckedChange={() => bp.toggleSelected(p.id)} /></TableCell>
                        <TableCell>{p.name}</TableCell>
                        <TableCell>{p.barcode || '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {bp.preview.length > 0 && (
                <div className="border rounded-lg max-h-64 overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product</TableHead>
                        <TableHead className="text-right">Old</TableHead>
                        <TableHead className="text-right">New</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {bp.preview.map(item => (
                        <TableRow key={item.productId}>
                          <TableCell>{item.productName}</TableCell>
                          <TableCell className="text-right">₱{item.oldValue.toFixed(2)}</TableCell>
                          <TableCell className="text-right font-medium">₱{item.newValue.toFixed(2)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </>
          )}
        </div>

        <SheetFooter>
          <Button
            disabled={bp.preview.length === 0 || bp.isSubmitting}
            onClick={() => bp.submit(getCurrentUserId())}
          >
            {bp.isSubmitting ? 'Submitting...' : `Update ${bp.preview.length} Product(s)`}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
