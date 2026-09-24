'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ArrowRight, Loader2, Send, Warehouse as WarehouseIcon } from 'lucide-react';
import { formatQuantity } from '@/lib/utils';
import type { Product } from '@/lib/types';

import { useStockTransfer } from './use-stock-transfer';

interface StockTransferDialogProps {
  product: Product;
  children?: React.ReactNode;
  onSuccess?: () => void;
  requireConfirmation?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function StockTransferDialog({ product, children, onSuccess, requireConfirmation, open, onOpenChange }: StockTransferDialogProps) {
  const {
    isOpen,
    setIsOpen,
    isSubmitting,
    warehouses,
    isLoadingWarehouses,
    targetWarehouseId,
    setTargetWarehouseId,
    quantity,
    handleQuantityChange,
    notes,
    setNotes,
    isConfirmOpen,
    setIsConfirmOpen,
    handleTransferClick,
    processTransfer,
    targetWhName,
  } = useStockTransfer({ product, onSuccess, requireConfirmation, open, onOpenChange });

  return (
    <>
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        {children && <DialogTrigger asChild>{children}</DialogTrigger>}
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <WarehouseIcon className="h-5 w-5 text-primary" />
              Stock Transfer
            </DialogTitle>
            <DialogDescription>
              Move <strong>{product.name}</strong> from <strong>{product.warehouseName || 'Current Warehouse'}</strong> to another location.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="bg-muted/50 p-3 rounded-md border text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Current Stock:</span>
                <span className="font-semibold">{formatQuantity(product.stock)} {product.unitOfMeasure}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Barcode:</span>
                <span>{product.sellingUnits?.find((su) => su.isBase)?.barcode || product.barcode || 'N/A'}</span>
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="targetWarehouse">Destination Warehouse</Label>
              <Select value={targetWarehouseId} onValueChange={setTargetWarehouseId}>
                <SelectTrigger id="targetWarehouse" className="w-full">
                  <SelectValue placeholder={isLoadingWarehouses ? 'Loading warehouses...' : 'Select where to move stock'} />
                </SelectTrigger>
                <SelectContent>
                  {warehouses.map((w) => (
                    <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                  ))}
                  {warehouses.length === 0 && !isLoadingWarehouses && (
                    <div className="p-2 text-sm text-center text-muted-foreground">No other active warehouses found.</div>
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="quantity">Transfer Quantity</Label>
              <Input
                id="quantity"
                type="number"
                min="1"
                max={product.stock}
                value={quantity || ''}
                onChange={(e) => handleQuantityChange(e.target.value)}
                placeholder={`Max: ${formatQuantity(product.stock)}`}
                className="w-full"
              />
            </div>

            {quantity > 0 && targetWarehouseId && (
              <div className="flex items-center justify-center gap-3 py-2 px-4 bg-primary/5 rounded-lg border border-primary/20 animate-in fade-in zoom-in duration-300">
                <div className="text-center">
                  <div className="text-[10px] uppercase text-muted-foreground font-bold">From</div>
                  <div className="text-xs font-medium truncate max-w-[100px]">{product.warehouseName || 'Source'}</div>
                </div>
                <ArrowRight className="h-4 w-4 text-primary" />
                <div className="text-center">
                  <div className="text-[10px] uppercase text-muted-foreground font-bold">To</div>
                  <div className="text-xs font-medium truncate max-w-[100px]">{targetWhName || 'Destination'}</div>
                </div>
                <div className="ml-auto text-right">
                  <div className="text-[10px] uppercase text-primary font-bold">Moving</div>
                  <div className="text-sm font-bold text-primary">{formatQuantity(quantity)}</div>
                </div>
              </div>
            )}

            <div className="grid gap-2">
              <Label htmlFor="notes">Transfer Notes</Label>
              <Input
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g., Seasonal restocking, store request"
                className="w-full"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsOpen(false)}>Cancel</Button>
            <Button
              onClick={handleTransferClick}
              disabled={isSubmitting || !targetWarehouseId || quantity <= 0}
              className="gap-2"
            >
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Confirm Transfer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Stock Transfer</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to move <strong>{formatQuantity(quantity)} {product.unitOfMeasure}</strong> of <strong>{product.name}</strong> to <strong>{targetWhName}</strong>?
              This action will update stock levels in both locations.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={processTransfer} disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Confirm Transfer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
