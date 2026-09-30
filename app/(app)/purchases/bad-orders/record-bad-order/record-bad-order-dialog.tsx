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
import { Loader2, Search, Trash2, AlertTriangle } from 'lucide-react';
import { formatQuantity } from '@/lib/utils';
import { UnitStockView } from '@/components/unit-stock-view';

import { useRecordBadOrder, type UseRecordBadOrderProps } from './use-record-bad-order';
import { ProductSelector } from './product-selector';
import { CurrencyInput } from './currency-input';

export function RecordBadOrderDialog({ onSuccess }: UseRecordBadOrderProps) {
  const controller = useRecordBadOrder({ onSuccess });
  const {
    open, handleOpenChange,
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

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <AlertTriangle className="mr-2 h-4 w-4" />
          Record Bad Order
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-none max-w-full w-full h-screen max-h-screen flex flex-col p-0 gap-0 bg-background border-none rounded-none m-0 shadow-none">
        <DialogHeader className="px-6 py-4 border-b bg-background">
          <DialogTitle>Record Bad Order</DialogTitle>
          <DialogDescription>
            Record defective, damaged, or expired items to remove them from inventory properly.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex-1 flex flex-col overflow-hidden">
            <div className="flex-1 flex flex-col overflow-hidden bg-muted/10">

              {/* HEADER FIELDS */}
              <div className="bg-background border-b p-4 grid grid-cols-4 gap-4 shrink-0">
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
                  <ProductSelector
                    onSelectProduct={handleAddProduct}
                    supplierId={form.watch('supplierId')}
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
                                  return `₱${(cost * qty).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

              {/* BOTTOM SUMMARY & NOTES */}
              <div className="bg-background border-t p-4 flex gap-6 shrink-0 z-20 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
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
                      ₱{total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <DialogFooter className="p-4 bg-background border-t">
              <div className="flex items-center text-xs text-muted-foreground mr-auto">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" /> Ready to process
                </span>
              </div>
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={isSubmitting || fields.length === 0}
                className="w-48 font-semibold shadow-lg shadow-destructive/20"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <AlertTriangle className="mr-2 h-4 w-4" />
                    Record Bad Order
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>

      <AlertDialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Bad Order Report</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to record these {fields.length} items as bad orders?
              This will deduct them from active inventory and potentially submit for multi-level approval.
              Total value: ₱{total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleFinalSubmit}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Confirm & Record
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
    </Dialog>
  );
}
