'use client';

import { useEffect, useState } from 'react';
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
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Search, Trash2, AlertTriangle, ArrowLeft, ChevronDown, ChevronUp } from 'lucide-react';
import { FormTotalsBar, formatPeso } from '@/components/form-totals-bar';
import { DiscardChangesDialog } from '@/components/discard-changes-dialog';
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard';
import { UnitStockView } from '@/components/unit-stock-view';

import { useRecordBadOrder } from './use-record-bad-order';
import { ProductSelector } from './product-selector';
import { CurrencyInput } from './currency-input';

interface RecordBadOrderFormProps {
  onClose: () => void;
  onSuccess: () => void;
}

/**
 * Bad order form body, rendered full-page at
 * app/(app)/purchases/bad-orders/new. The hook is driven in page mode
 * (`open: true`), so its init effect runs on mount and "closing" navigates back.
 */
export function RecordBadOrderForm({ onClose, onSuccess }: RecordBadOrderFormProps) {
  const controller = useRecordBadOrder({
    onSuccess,
    open: true,
    onOpenChange: (open) => { if (!open) onClose(); },
  });
  const {
    isSubmitting,
    isConfirmOpen, setIsConfirmOpen,
    supplierChangeConfirm,
    form,
    fields, remove,
    suppliers,
    warehouses,
    shelfLocations,
    total,
    handleAddProduct,
    handleSupplierChange,
    confirmSupplierChange,
    cancelSupplierChange,
    handleFinalSubmit,
    onSubmit,
  } = controller;

  const [showDetails, setShowDetails] = useState(true);
  const isDirty = form.formState.isDirty || fields.length > 0;
  const [isDiscardOpen, setIsDiscardOpen] = useState(false);

  const handleCancel = () => {
    if (isDirty) setIsDiscardOpen(true);
    else onClose();
  };

  const reloadGuard = useUnsavedChangesGuard(isDirty);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (!isSubmitting && fields.length > 0) {
          form.handleSubmit(onSubmit, () => setShowDetails(true))();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isSubmitting, fields.length, form, onSubmit]);

  const totalQty = fields.reduce((sum, f) => sum + Number(f.quantity || 0), 0);

  return (
    <div className="flex-1 min-h-[900px] flex flex-col rounded-lg border bg-background overflow-hidden">
      <div className="px-4 py-3 border-b bg-background flex items-center gap-3 shrink-0">
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={handleCancel} aria-label="Back">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-lg font-semibold leading-tight">Record Bad Order</h1>
          <p className="text-xs text-muted-foreground">
            Record defective, damaged, or expired items to remove them from inventory properly.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden lg:flex items-center gap-1.5 text-xs text-muted-foreground mr-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500" /> Ready to process
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={() => setShowDetails((v) => !v)}
            aria-expanded={showDetails}
          >
            {showDetails ? <ChevronUp className="mr-1.5 h-3.5 w-3.5" /> : <ChevronDown className="mr-1.5 h-3.5 w-3.5" />}
            {showDetails ? 'Hide' : 'Show'} report details
          </Button>
          <Button type="button" variant="outline" size="sm" className="h-8" onClick={handleCancel}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="bad-order-form"
            title="Ctrl+S to save"
            variant="destructive"
            disabled={isSubmitting || fields.length === 0}
            className="w-44 h-8 font-semibold shadow-lg shadow-destructive/20"
          >
            {isSubmitting ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Processing...</>
            ) : (
              <><AlertTriangle className="mr-2 h-4 w-4" /> Record Bad Order</>
            )}
          </Button>
        </div>
      </div>

      <FormTotalsBar
        items={[
          { label: 'Lines', value: String(fields.length) },
          { label: 'Total Qty', value: String(totalQty) },
          { label: 'Total Lost Value', value: formatPeso(total), emphasis: true },
        ]}
      />

      <Form {...form}>
        {/* A failed validation re-opens the details, otherwise a required field
            (Reported By) would reject the submit with its message out of sight. */}
        <form
          id="bad-order-form"
          onSubmit={form.handleSubmit(onSubmit, () => setShowDetails(true))}
          className="flex-1 min-h-0 flex flex-col"
        >
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-muted/10">

            {/* HEADER FIELDS */}
            {/* Hidden, not unmounted, so entered values and validation survive a collapse. */}
            <div className={`bg-background border-b p-4 grid grid-cols-4 gap-4 shrink-0 ${showDetails ? '' : 'hidden'}`}>
              <div className="col-span-1 space-y-3">
                <FormField
                  control={form.control}
                  name="reportedBy"
                  render={({ field }) => (
                    <FormItem className="space-y-1">
                      <div className="h-5 flex items-center">
                        <FormLabel className="text-xs font-semibold text-muted-foreground">Reported By</FormLabel>
                      </div>
                      <FormControl>
                        <Input className="h-8 bg-background text-xs" placeholder="Jane Doe" {...field} />
                      </FormControl>
                      <FormMessage className="text-xs" />
                    </FormItem>
                  )}
                />
              </div>

              <div className="col-span-1 space-y-3">
                <FormField
                  control={form.control}
                  name="supplierId"
                  render={({ field }) => (
                    <FormItem className="space-y-1">
                      <div className="h-5 flex items-center">
                        <FormLabel className="text-xs font-semibold text-muted-foreground">Supplier (Optional)</FormLabel>
                      </div>
                      <Select
                        onValueChange={handleSupplierChange}
                        value={field.value || ''}
                      >
                        <FormControl>
                          <SelectTrigger className="h-8 bg-background text-xs">
                            <SelectValue placeholder="Select supplier" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          {suppliers.map((supplier) => (
                            <SelectItem key={supplier.id} value={supplier.id}>
                              {supplier.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage className="text-xs" />
                    </FormItem>
                  )}
                />
              </div>

              <div className="col-span-1 space-y-3">
                <FormField
                  control={form.control}
                  name="warehouseId"
                  render={({ field }) => (
                    <FormItem className="space-y-1">
                      <div className="h-5 flex items-center">
                        <FormLabel className="text-xs font-semibold text-muted-foreground">Warehouse</FormLabel>
                      </div>
                      <Select onValueChange={field.onChange} value={field.value || ''}>
                        <FormControl>
                          <SelectTrigger className="h-8 bg-background text-xs">
                            <SelectValue placeholder="Select warehouse" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {warehouses.map((w) => (
                            <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )}
                />
              </div>

              <div className="col-span-1 space-y-3">
                <FormField
                  control={form.control}
                  name="shelfId"
                  render={({ field }) => (
                    <FormItem className="space-y-1">
                      <div className="h-5 flex items-center">
                        <FormLabel className="text-xs font-semibold text-muted-foreground">Shelf / Area</FormLabel>
                      </div>
                      <Select onValueChange={field.onChange} value={field.value || ''}>
                        <FormControl>
                          <SelectTrigger className="h-8 bg-background text-xs">
                            <SelectValue placeholder="Select shelf" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {shelfLocations.map((s) => (
                            <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )}
                />
              </div>

              <div className="col-span-4 flex items-center justify-end pr-4 text-muted-foreground text-sm">
                <div className="bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 px-3 py-1.5 rounded-md flex items-center gap-2 border border-amber-200 dark:border-amber-900/50">
                  <AlertTriangle className="h-4 w-4" />
                  Items recorded here will be deducted from active inventory.
                </div>
              </div>
            </div>

            {/* ITEMS TABLE */}
            <div className="flex-1 flex flex-col overflow-hidden bg-muted/5 p-4 relative">
              <div className="max-w-2xl mb-4 z-10">
                {/* Scoped to the selected warehouse: a products row is
                    warehouse-specific, and a bad order deducts stock, so the
                    row picked must be the one whose stock is written off. */}
                <ProductSelector
                  onSelectProduct={handleAddProduct}
                  supplierId={form.watch('supplierId')}
                  warehouseId={form.watch('warehouseId')}
                />
              </div>

              <div className="flex-1 rounded-lg border bg-background shadow-sm overflow-hidden flex flex-col relative">
                <div className="overflow-y-auto flex-1 h-full relative">
                  <table className="w-full caption-bottom text-sm text-left border-collapse">
                    <TableHeader className="sticky top-0 bg-background z-50 shadow-sm">
                      <TableRow className="hover:bg-transparent border-b">
                        <TableHead className="w-[20%] pl-4 h-10">Product</TableHead>
                        <TableHead className="w-[8%] text-center h-10">Stock</TableHead>
                        <TableHead className="w-[15%] text-left h-10">Reason</TableHead>
                        <TableHead className="w-[12%] text-center h-10">Qty</TableHead>
                        <TableHead className="w-[12%] text-right h-10">Cost</TableHead>
                        <TableHead className="w-[15%] text-left h-10">Description</TableHead>
                        <TableHead className="w-[13%] text-right pr-4 h-10">Total</TableHead>
                        <TableHead className="w-[5%] h-10" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {fields.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={8} className="h-full text-center text-muted-foreground border-none w-full py-[150px]">
                            <div className="flex flex-col items-center justify-center">
                              <div className="bg-muted p-4 rounded-full mb-4">
                                <Search className="h-8 w-8 opacity-20" />
                              </div>
                              <p className="font-medium">No items added</p>
                              <p className="text-xs text-muted-foreground">Search or scan products to record.</p>
                            </div>
                          </TableCell>
                        </TableRow>
                      ) : (
                        fields.map((field, index) => (
                          <TableRow key={field.id} className="group bg-background hover:bg-muted/5">
                            <TableCell className="font-medium pl-4 py-2 border-r">
                              <div className="text-sm font-semibold line-clamp-2" title={field.productName}>
                                {field.productName}
                                {field.sellingUnitName && (field.sellingUnitFactor ?? 1) !== 1 && (
                                  <span className="ml-1.5 text-xs font-semibold text-blue-600">— {field.sellingUnitName}</span>
                                )}
                              </div>
                              <div className="text-xs text-muted-foreground flex items-center gap-2">
                                <span className="font-mono">{field.barcode || '-'}</span>
                              </div>
                            </TableCell>

                            <TableCell className="py-2 text-center border-r font-mono text-xs">
                              <UnitStockView
                                stock={field.currentStock || 0}
                                factor={field.sellingUnitFactor}
                                unitName={field.sellingUnitName}
                                className={Math.floor((field.currentStock || 0) / (field.sellingUnitFactor || 1)) <= 0 ? 'text-destructive font-bold' : 'text-muted-foreground'}
                              />
                            </TableCell>

                            <TableCell className="py-2 border-r px-2 text-center">
                              <FormField
                                control={form.control}
                                name={`items.${index}.reason`}
                                render={({ field }) => (
                                  <FormItem className="space-y-0">
                                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                                      <FormControl>
                                        <SelectTrigger className="h-8 text-xs bg-background border-transparent hover:border-input focus:border-input">
                                          <SelectValue placeholder="Reason" />
                                        </SelectTrigger>
                                      </FormControl>
                                      <SelectContent>
                                        <SelectItem value="Damaged">Damaged</SelectItem>
                                        <SelectItem value="Defective">Defective</SelectItem>
                                        <SelectItem value="Expired">Expired</SelectItem>
                                        <SelectItem value="Wrong Item">Wrong Item</SelectItem>
                                        <SelectItem value="Missing">Missing</SelectItem>
                                        <SelectItem value="Other">Other</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </FormItem>
                                )}
                              />
                            </TableCell>

                            <TableCell className="py-2 border-r">
                              <div className="flex justify-center flex-col items-center">
                                <FormField
                                  control={form.control}
                                  name={`items.${index}.quantity`}
                                  render={({ field }) => (
                                    <FormItem className="space-y-0 w-full max-w-[80px]">
                                      <FormControl>
                                        <Input
                                          type="number"
                                          className="h-8 w-full text-center bg-background border-transparent hover:border-input focus:border-input text-xs"
                                          {...field}
                                          onFocus={(e) => e.target.select()}
                                        />
                                      </FormControl>
                                      <FormMessage className="text-[10px]" />
                                    </FormItem>
                                  )}
                                />
                              </div>
                            </TableCell>

                            <TableCell className="py-2 text-right border-r px-2">
                              <FormField
                                control={form.control}
                                name={`items.${index}.cost`}
                                render={({ field }) => (
                                  <FormItem className="space-y-0">
                                    <FormControl>
                                      <CurrencyInput
                                        className="h-8 w-full max-w-[100px] text-right ml-auto border-transparent hover:border-input focus:border-input bg-background p-1 font-mono text-xs"
                                        placeholder="0.00"
                                        {...field}
                                      />
                                    </FormControl>
                                  </FormItem>
                                )}
                              />
                            </TableCell>

                            <TableCell className="py-2 text-left border-r px-2">
                              <FormField
                                control={form.control}
                                name={`items.${index}.description`}
                                render={({ field }) => (
                                  <FormItem className="space-y-0">
                                    <FormControl>
                                      <Input
                                        className="h-8 w-full border-transparent hover:border-input focus:border-input bg-background p-1 text-xs"
                                        placeholder="Notes..."
                                        {...field}
                                      />
                                    </FormControl>
                                  </FormItem>
                                )}
                              />
                            </TableCell>

                            <TableCell className="text-right py-2 pr-4 font-mono font-medium">
                              {(() => {
                                const cost = parseFloat(form.watch(`items.${index}.cost`) as any) || 0;
                                const qty = parseFloat(form.watch(`items.${index}.quantity`) as any) || 0;
                                return formatPeso(cost * qty);
                              })()}
                            </TableCell>

                            <TableCell className="py-2 flex items-center justify-end gap-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-destructive transition-colors"
                                onClick={() => remove(index)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </table>
                </div>
              </div>
            </div>

            {/* BOTTOM NOTES */}
            <div className="bg-background border-t p-4 flex gap-6 shrink-0 z-20">
              <div className="flex-[2] space-y-2">
                <FormField
                  control={form.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem className="space-y-1">
                      <FormLabel className="text-xs font-semibold text-muted-foreground">General Notes</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Additional details about this bad order report..."
                          className="h-20 resize-none text-xs"
                          {...field}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>

              <div className="flex-1 flex flex-col justify-end items-end pb-2">
                <div className="text-xs text-muted-foreground mb-4">
                  <span className="font-semibold">{fields.length}</span> items added
                </div>
                <div className="flex flex-col items-end border-l pl-8 border-destructive/20">
                  <span className="text-[10px] uppercase tracking-wider text-destructive font-bold">Total Lost Value</span>
                  <span className="font-mono text-3xl font-bold text-destructive">
                    {formatPeso(total)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </form>
      </Form>

      <DiscardChangesDialog open={isDiscardOpen} onOpenChange={setIsDiscardOpen} onConfirm={onClose} />
      <DiscardChangesDialog
        open={reloadGuard.open}
        onOpenChange={reloadGuard.setOpen}
        onConfirm={reloadGuard.confirmReload}
      />

      <AlertDialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Bad Order Report</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to record these {fields.length} items as bad orders?
              This will deduct them from active inventory and potentially submit for multi-level approval.
              Total value: {formatPeso(total)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleFinalSubmit}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Confirm &amp; Record
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!supplierChangeConfirm}
        onOpenChange={(o) => { if (!o) cancelSupplierChange(); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change supplier?</AlertDialogTitle>
            <AlertDialogDescription>
              {supplierChangeConfirm?.mismatchedNames.length} item(s) are not carried by{' '}
              <span className="font-medium">{supplierChangeConfirm?.supplierName}</span> and will be
              removed from this bad order:
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="max-h-40 overflow-y-auto rounded-md border bg-muted/30 p-3 text-sm">
            <ul className="list-disc pl-4 space-y-1">
              {supplierChangeConfirm?.mismatchedNames.map((name, i) => (
                <li key={i}>{name}</li>
              ))}
            </ul>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={cancelSupplierChange}>Keep current supplier</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmSupplierChange}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove items &amp; change
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
