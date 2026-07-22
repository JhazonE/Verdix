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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import { ArrowRight, Minus, Plus } from 'lucide-react';
import { cn, formatQuantity } from '@/lib/utils';
import type { Product } from '@/lib/types';

import { useStockAdjustment } from './use-stock-adjustment';

export function StockAdjustmentDialog({ product, children, defaultReason, onSuccess, requireConfirmation, open, onOpenChange }: { product: Product, children?: React.ReactNode, defaultReason?: string, onSuccess?: () => void, requireConfirmation?: boolean, open?: boolean, onOpenChange?: (open: boolean) => void }) {
  const {
    isOpen,
    setIsOpen,
    isConfirmOpen,
    setIsConfirmOpen,
    quantity,
    reason,
    setReason,
    customReason,
    setCustomReason,
    adjustmentType,
    setAdjustmentType,
    physicalCount,
    setPhysicalCount,
    isPhysicalCountMode,
    dialogTitle,
    variance,
    projectedStock,
    expirationDate,
    setExpirationDate,
    showExpirationField,
    isExpirationInPast,
    reasons,
    handleQuantityChange,
    handlePhysicalCountChange,
    handleAdjustStock,
    processAdjustment,
    confirmationMessage,
  } = useStockAdjustment({ product, defaultReason, onSuccess, requireConfirmation, open, onOpenChange });

  const renderPhysicalCountMode = () => (
     <div className="space-y-6 py-4">
        <div className="flex flex-col items-center justify-center p-6 bg-muted/30 rounded-2xl border border-dashed border-muted-foreground/20">
            <span className="text-sm text-muted-foreground mb-1">Current Balance</span>
            <span className="text-4xl font-bold">{formatQuantity(product.stock, product.unitOfMeasure)}</span>
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider mt-1">{product.unitOfMeasure}</span>
        </div>

        <div className="space-y-4">
            <div className="space-y-2">
                <Label htmlFor="physicalCount" className="text-sm font-medium">Actual Quantity Counted</Label>
                <div className="relative">
                    <Input
                        id="physicalCount"
                        type="number"
                        value={physicalCount === null ? '' : physicalCount}
                        onChange={(e) => handlePhysicalCountChange(e.target.value)}
                        onBlur={() => {
                          const isDecimal = product.unitOfMeasure && (product.unitOfMeasure.toLowerCase() === 'kilogram' || product.unitOfMeasure.toLowerCase() === 'kg');
                          if (!isDecimal && physicalCount !== null) {
                            setPhysicalCount(Math.round(physicalCount));
                          }
                        }}
                        step={(product.unitOfMeasure && (product.unitOfMeasure.toLowerCase() === 'kilogram' || product.unitOfMeasure.toLowerCase() === 'kg')) ? "0.001" : "1"}
                        className="text-lg h-12 pl-4 pr-12 font-semibold"
                        placeholder="0"
                    />
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-medium">
                        {product.unitOfMeasure}
                    </div>
                </div>
            </div>

            {physicalCount !== null && (
                <div className={cn(
                    "flex items-center justify-between p-4 rounded-xl border transition-all duration-300",
                    variance === 0 ? "bg-muted/50 border-muted" :
                    variance > 0 ? "bg-emerald-500/5 border-emerald-500/20" : "bg-destructive/5 border-destructive/20"
                )}>
                    <div className="flex items-center gap-3">
                        <div className={cn(
                            "w-10 h-10 rounded-full flex items-center justify-center",
                            variance === 0 ? "bg-muted text-muted-foreground" :
                            variance > 0 ? "bg-emerald-500/20 text-emerald-600" : "bg-destructive/20 text-destructive"
                        )}>
                            {variance === 0 ? <ArrowRight className="h-5 w-5" /> :
                             variance > 0 ? <Plus className="h-5 w-5" /> : <Minus className="h-5 w-5" />}
                        </div>
                        <div>
                            <p className="text-xs text-muted-foreground font-medium uppercase">Inventory Variance</p>
                            <p className={cn(
                                "text-sm font-bold",
                                variance === 0 ? "text-muted-foreground" :
                                variance > 0 ? "text-emerald-600" : "text-destructive"
                            )}>
                                {variance > 0 ? '+' : ''}{formatQuantity(variance, product.unitOfMeasure)} {product.unitOfMeasure}
                            </p>
                        </div>
                    </div>
                </div>
            )}
        </div>

        <DialogFooter className="pt-2">
          <Button variant="ghost" onClick={() => setIsOpen(false)} className="flex-1 sm:flex-none">Cancel</Button>
          <Button
            onClick={handleAdjustStock}
            disabled={physicalCount === null}
            className="flex-1 sm:flex-none px-8"
          >
            Submit Physical Count
          </Button>
        </DialogFooter>
    </div>
  );

  const renderStandardMode = () => {
    return (
      <div className="space-y-6 py-4">
          <Tabs value={adjustmentType} onValueChange={(val) => setAdjustmentType(val as 'add' | 'remove')} className="w-full">
            <TabsList className="grid w-full grid-cols-2 h-11 p-1 bg-muted/50">
                <TabsTrigger value="add" className="rounded-md data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-sm">
                    <Plus className="mr-2 h-4 w-4" />
                    Add Stock
                </TabsTrigger>
                <TabsTrigger value="remove" className="rounded-md data-[state=active]:bg-background data-[state=active]:text-destructive data-[state=active]:shadow-sm">
                    <Minus className="mr-2 h-4 w-4" />
                    Remove Stock
                </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="quantity" className="text-sm font-medium">Quantity to {adjustmentType === 'add' ? 'Add' : 'Remove'}</Label>
                <div className="relative">
                  <Input
                    id="quantity"
                    type="number"
                    value={quantity === 0 ? '' : quantity}
                    onChange={(e) => handleQuantityChange(e.target.value)}
                    className="text-lg h-12 pl-4 pr-12 font-semibold"
                    placeholder="0"
                  />
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-medium">
                    {product.unitOfMeasure}
                  </div>
                </div>
              </div>

              {showExpirationField && (
                <div className="space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
                  <Label htmlFor="expirationDate" className="text-sm font-medium">
                    Expiration Date <span className="text-muted-foreground font-normal">(Optional)</span>
                  </Label>
                  <Input
                    id="expirationDate"
                    type="date"
                    value={expirationDate}
                    onChange={(e) => setExpirationDate(e.target.value)}
                    className="h-11"
                  />
                  {isExpirationInPast && (
                    <p className="text-xs text-amber-600 dark:text-amber-500">
                      This date is in the past. The stock will be recorded as already expired.
                    </p>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="reason" className="text-sm font-medium">Reason for Adjustment</Label>
                <Select value={reason} onValueChange={setReason} disabled={!!defaultReason}>
                    <SelectTrigger className="h-11">
                        <SelectValue placeholder="Select a reason..." />
                    </SelectTrigger>
                    <SelectContent>
                        {reasons[adjustmentType].map((r) => (
                            <SelectItem key={r} value={r}>{r}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
              </div>

              {reason === 'Other' && (
                <div className="space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
                    <Label htmlFor="customReason" className="text-sm font-medium">Custom Reason</Label>
                    <Input
                        id="customReason"
                        value={customReason}
                        onChange={(e) => setCustomReason(e.target.value)}
                        placeholder="Please specify..."
                        className="h-11"
                    />
                </div>
              )}
          </div>

          <div className="bg-muted/30 rounded-2xl p-4 border border-muted-foreground/10">
              <div className="flex items-center justify-between text-sm mb-2">
                  <span className="text-muted-foreground font-medium text-xs uppercase tracking-tight">Projected Impact</span>
                  <Badge variant={adjustmentType === 'add' ? "secondary" : "destructive"} className="text-[10px] h-5">
                      {adjustmentType === 'add' ? 'Stock Increase' : 'Stock Decrease'}
                  </Badge>
              </div>
              <div className="flex items-center justify-between">
                  <div className="text-center">
                      <p className="text-[10px] text-muted-foreground uppercase font-bold">Current</p>
                       <p className="text-lg font-semibold">{formatQuantity(product.stock, product.unitOfMeasure)}</p>
                  </div>
                  <div className="flex items-center text-muted-foreground/40">
                      <div className="w-8 h-px bg-current mx-2" />
                      <div className={cn(
                          "flex items-center justify-center p-1 rounded-full",
                          adjustmentType === 'add' ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"
                      )}>
                          {adjustmentType === 'add' ? <Plus className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
                      </div>
                      <div className="w-8 h-px bg-current mx-2" />
                  </div>
                  <div className="text-center">
                      <p className="text-[10px] text-muted-foreground uppercase font-bold">Adjustment</p>
                      <p className={cn(
                          "text-lg font-semibold",
                          adjustmentType === 'add' ? "text-primary" : "text-destructive"
                      )}>{formatQuantity(quantity, product.unitOfMeasure)}</p>
                  </div>
                  <div className="flex items-center text-muted-foreground/40 px-2">
                      <span className="text-xl font-light">=</span>
                  </div>
                  <div className="text-center">
                      <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">New Total</p>
                       <p className="text-xl font-bold">{formatQuantity(projectedStock, product.unitOfMeasure)}</p>
                  </div>
              </div>
          </div>

          <DialogFooter className="pt-2">
            <Button variant="ghost" onClick={() => setIsOpen(false)} className="flex-1 sm:flex-none">Cancel</Button>
            <Button
              onClick={handleAdjustStock}
              disabled={quantity === 0 || !(reason === 'Other' ? customReason.trim() : reason.trim())}
              variant={adjustmentType === 'add' ? 'default' : 'destructive'}
              className="flex-1 sm:flex-none px-8 h-11"
            >
              Confirm Adjustment
            </Button>
          </DialogFooter>
      </div>
    );
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        {children && (
          <DialogTrigger asChild>
            {children}
          </DialogTrigger>
        )}
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
            <DialogDescription>
              Current stock: {formatQuantity(product.stock, product.unitOfMeasure)}. {isPhysicalCountMode ? 'Enter the new physically counted quantity.' : 'Select whether to add or remove stock and provide a reason.'}
            </DialogDescription>
          </DialogHeader>
          {isPhysicalCountMode ? renderPhysicalCountMode() : renderStandardMode()}
        </DialogContent>
      </Dialog>

      <AlertDialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Stock Adjustment</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmationMessage}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={processAdjustment}>Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
