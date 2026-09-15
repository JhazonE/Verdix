'use client';

import { Button } from '@/components/ui/button';
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
import { Input } from '@/components/ui/input';
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Loader2, Trash2, Search, ArrowRight, Wand2 } from 'lucide-react';

import { InlineWarehouseSelect } from '../../components/inline-selects/inline-warehouse-select';
import { InlinePaymentMethodSelect } from '../../components/inline-selects/inline-payment-method-select';
import { InlineSupplierSelect } from '../../components/inline-selects/inline-supplier-select';

import { calculateMarkupPercentage, calculateSuggestedPrice } from '@/lib/purchase-utils';
import { formatQuantity } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

import { useAddPurchaseOrder, type UseAddPurchaseOrderProps } from './use-add-purchase-order';
import { ProductSelector } from './product-selector';
import { CurrencyInput } from './currency-input';

export function AddPurchaseOrderDialog(props: UseAddPurchaseOrderProps & { trigger?: React.ReactNode }) {
  const { trigger, ...hookProps } = props;
  const controller = useAddPurchaseOrder(hookProps);
  const {
    isOpen, setOpen,
    isSubmitting,
    isConfirmOpen, setIsConfirmOpen,
    confirmValues,
    form,
    fields, remove,
    warehouses,
    suppliers,
    paymentMethods,
    priceLevels,
    categories, brands, subcategories,
    activeTaxRate,
    systemSettings,
    total, vatTotal, purchaseResults,
    handleAddProduct,
    fetchSuppliers,
    fetchWarehouses,
    refetchPaymentMethods,
    onSubmit,
    processSubmit,
  } = controller;

  const { toast } = useToast();

  return (
    <Dialog open={isOpen} onOpenChange={(val) => setOpen(val)}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}

      <DialogContent className="sm:max-w-none max-w-full w-full h-screen max-h-screen flex flex-col p-0 gap-0 bg-background border-none rounded-none m-0 shadow-none">
        <DialogHeader className="px-6 py-4 border-b bg-background">
          <DialogTitle>{hookProps.editOrder ? 'Edit' : 'New'} Purchase Order</DialogTitle>
          <DialogDescription>
            Create a purchase transaction. Reference:{' '}
            <span className="font-mono font-medium text-primary">{form.watch('reference')}</span>
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex-1 flex flex-col overflow-hidden">
            <div className="flex-1 flex flex-col overflow-hidden bg-muted/10">

              {/* HEADER FIELDS */}
              <div className="bg-background border-b p-4 grid grid-cols-5 gap-x-4 gap-y-3 shrink-0">

                {/* ROW 1 */}
                <FormField
                  control={form.control}
                  name="supplierId"
                  render={({ field }) => (
                    <FormItem className="space-y-1">
                      <div className="flex items-center h-5">
                        <FormLabel className="text-xs font-semibold text-muted-foreground">Supplier</FormLabel>
                      </div>
                      <InlineSupplierSelect
                        suppliers={suppliers}
                        value={field.value || ''}
                        onChange={field.onChange}
                        onListChange={fetchSuppliers}
                        triggerClassName="h-8 bg-background text-xs"
                        itemClassName="text-xs"
                      />
                      <FormMessage className="text-xs" />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="issueDate"
                  render={({ field }) => (
                    <FormItem className="space-y-1">
                      <div className="h-5 flex items-center">
                        <FormLabel className="text-xs font-semibold text-muted-foreground">Issue Date</FormLabel>
                      </div>
                      <FormControl>
                        <Input type="date" className="h-8 bg-background text-xs" {...field} />
                      </FormControl>
                      <FormMessage className="text-xs" />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="deliveryDate"
                  render={({ field }) => (
                    <FormItem className="space-y-1">
                      <div className="h-5 flex items-center">
                        <FormLabel className="text-xs font-semibold text-muted-foreground">Due Date</FormLabel>
                      </div>
                      <FormControl>
                        <Input type="date" className="h-8 bg-background text-xs" {...field} />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="paymentMethod"
                  render={({ field }) => (
                    <FormItem className="space-y-1">
                      <div className="h-5 flex items-center">
                        <FormLabel className="text-xs font-semibold text-muted-foreground">Payment Method</FormLabel>
                      </div>
                      <InlinePaymentMethodSelect
                        paymentMethods={paymentMethods}
                        value={field.value || ''}
                        onChange={field.onChange}
                        onListChange={refetchPaymentMethods}
                        triggerClassName="h-8 bg-background text-xs"
                        itemClassName="text-xs"
                      />
                      <FormMessage className="text-xs" />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="deliveryAddress"
                  render={({ field }) => (
                    <FormItem className="space-y-1">
                      <div className="h-5 flex items-center">
                        <FormLabel className="text-xs font-semibold text-muted-foreground">Address</FormLabel>
                      </div>
                      <FormControl>
                        <Input className="h-8 bg-background text-xs" placeholder="Deliver to..." {...field} />
                      </FormControl>
                    </FormItem>
                  )}
                />

                {/* ROW 2 */}
                <FormField
                  control={form.control}
                  name="purchaseType"
                  render={({ field }) => (
                    <FormItem className="space-y-1">
                      <div className="h-5 flex items-center">
                        <FormLabel className="text-xs font-semibold text-muted-foreground">Type</FormLabel>
                      </div>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger className="h-8 bg-background text-xs">
                            <SelectValue placeholder="Type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="Order" className="text-xs">Order</SelectItem>
                          <SelectItem value="Receive" className="text-xs">Receive</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage className="text-xs" />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="reference"
                  render={({ field }) => (
                    <FormItem className="space-y-1">
                      <div className="h-5 flex items-center">
                        <FormLabel className="text-xs font-semibold text-muted-foreground">Ref #</FormLabel>
                      </div>
                      <FormControl>
                        <Input className="h-8 bg-background text-xs" {...field} />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="receiveToWarehouse"
                  render={({ field }) => (
                    <FormItem className="space-y-1">
                      <div className="h-5 flex items-center">
                        <FormLabel className="text-xs font-semibold text-muted-foreground">Receive To</FormLabel>
                      </div>
                      <InlineWarehouseSelect
                        warehouses={warehouses}
                        value={field.value || ''}
                        onChange={field.onChange}
                        onListChange={fetchWarehouses}
                        triggerClassName="h-8 bg-background text-xs"
                        itemClassName="text-xs"
                      />
                      <FormMessage className="text-xs" />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="shipping"
                  render={({ field }) => (
                    <FormItem className="space-y-1">
                      <div className="h-5 flex items-center">
                        <FormLabel className="text-xs font-semibold text-muted-foreground">Shipping Cost</FormLabel>
                      </div>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          className="h-8 bg-background text-xs"
                          placeholder="0.00"
                          {...field}
                          value={field.value ?? ''}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="note"
                  render={({ field }) => (
                    <FormItem className="space-y-1">
                      <div className="h-5 flex items-center">
                        <FormLabel className="text-xs font-semibold text-muted-foreground">Notes/Payment Reference</FormLabel>
                      </div>
                      <FormControl>
                        <Input
                          className="h-8 bg-background text-xs"
                          placeholder="Notes/Payment..."
                          {...field}
                          value={field.value || ''}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
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
                          <TableHead className="w-[15%] pl-4 h-10">Product</TableHead>
                          <TableHead className="w-[10%] text-center h-10">Remaining QTY</TableHead>
                          <TableHead className="w-[8%] text-center h-10">Qty</TableHead>
                          <TableHead className="w-[10%] text-right h-10">Cost</TableHead>
                          <TableHead className="w-[10%] text-right h-10">Sell Price</TableHead>
                          <TableHead className="w-[8%] text-right h-10 italic text-blue-600">Suggested</TableHead>
                          <TableHead className="w-[8%] text-center h-10">Discount</TableHead>
                          <TableHead className="w-[3%] text-center h-10">VAT</TableHead>
                          <TableHead className="w-[8%] text-left h-10">Expiry</TableHead>
                          <TableHead className="w-[10%] text-right h-10 italic text-muted-foreground">Landed Cost</TableHead>
                          <TableHead className="w-[10%] text-right pr-4 h-10">Line Total</TableHead>
                          <TableHead className="w-[5%] h-10"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {fields.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={11} className="h-[300px] text-center text-muted-foreground flex flex-col items-center justify-center border-none">
                              <div className="bg-muted p-4 rounded-full mb-4">
                                <Search className="h-8 w-8 text-muted-foreground opacity-50" />
                              </div>
                              <p className="font-bold text-lg">No items added</p>
                              <p className="text-xs text-muted-foreground font-medium">Scan barcode or search above to add products.</p>
                            </TableCell>
                          </TableRow>
                        ) : (
                          fields.map((field, index) => {
                            const { markup, source } = calculateMarkupPercentage(
                              {
                                markupPercentage: controller.products.find((p) => p.id === field.productId)?.markupPercentage ?? null,
                                category: controller.products.find((p) => p.id === field.productId)?.category,
                                subcategory: controller.products.find((p) => p.id === field.productId)?.subcategory,
                                brand: controller.products.find((p) => p.id === field.productId)?.brand,
                                supplierId: form.watch('supplierId'),
                              },
                              systemSettings,
                              categories,
                              subcategories,
                              brands,
                              suppliers,
                            );

                            const itemResult = purchaseResults?.items[index];
                            const baseCost = itemResult?.cost || 0;
                            const shippingPerUnit =
                              itemResult?.quantity > 0
                                ? itemResult.shippingAllocation / itemResult.quantity
                                : 0;
                            const landedCostPerUnit = baseCost + shippingPerUnit;
                            const defaultLevel = priceLevels.find((l) => l.isDefault) || priceLevels[0];
                            const suggestedPrice = calculateSuggestedPrice(baseCost, markup, shippingPerUnit, defaultLevel);

                            return (
                              <TableRow key={field.id} className="group bg-background hover:bg-muted/5">
                                <TableCell className="font-medium pl-4 py-2 border-r">
                                  <span className="font-bold text-sm text-foreground">{field.productName}</span>
                                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <span className="font-mono font-bold">{field.barcode || '-'}</span>
                                  </div>
                                </TableCell>

                                <TableCell className="py-2 text-center border-r font-mono text-xs">
                                  <span className={(field.currentStock || 0) <= 0 ? 'text-destructive font-black' : 'text-muted-foreground font-bold'}>
                                    {formatQuantity(field.currentStock || 0)}
                                  </span>
                                </TableCell>

                                <TableCell className="py-2 border-r">
                                  <div className="flex justify-center flex-col items-center">
                                    <FormField
                                      control={form.control}
                                      name={`items.${index}.quantity`}
                                      render={({ field }) => (
                                        <Input
                                          type="number"
                                          className="h-8 w-20 text-center bg-background"
                                          {...field}
                                          onFocus={(e) => e.target.select()}
                                        />
                                      )}
                                    />
                                  </div>
                                </TableCell>

                                <TableCell className="py-2 text-right border-r">
                                  <FormField
                                    control={form.control}
                                    name={`items.${index}.cost`}
                                    render={({ field }) => (
                                      <CurrencyInput
                                        className="h-8 w-24 text-right ml-auto border-transparent hover:border-input focus:border-input bg-background p-1 font-mono text-xs"
                                        placeholder="0.00"
                                        {...field}
                                      />
                                    )}
                                  />
                                </TableCell>

                                <TableCell className="py-2 text-right border-r">
                                  <FormField
                                    control={form.control}
                                    name={`items.${index}.sellingPrice`}
                                    render={({ field }) => (
                                      <CurrencyInput
                                        className="h-8 w-24 text-right ml-auto border-transparent hover:border-input focus:border-input bg-background p-1 font-mono text-xs"
                                        placeholder="0.00"
                                        {...field}
                                      />
                                    )}
                                  />
                                </TableCell>

                                <TableCell className="py-2 text-right border-r bg-blue-50/10">
                                  <div className="flex flex-col items-end justify-center">
                                    <div className="flex items-center gap-1">
                                      <span className="text-sm font-bold text-blue-600 font-mono">
                                        ₱{suggestedPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                      </span>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6 text-blue-600 hover:text-blue-700 hover:bg-blue-100/50 rounded-full"
                                        onClick={() => {
                                          form.setValue(`items.${index}.sellingPrice`, parseFloat(suggestedPrice.toFixed(2)));
                                          toast({
                                            title: 'Price Updated',
                                            description: `Suggested price of ₱${suggestedPrice.toFixed(2)} applied to ${field.productName}`,
                                          });
                                        }}
                                        title={`Apply suggested price (Markup: ${markup}% from ${source})`}
                                      >
                                        <Wand2 className="h-4 w-4" />
                                      </Button>
                                    </div>
                                    <span className="text-[9px] text-blue-500/70 uppercase font-medium">
                                      {source}: {markup}%
                                    </span>
                                  </div>
                                </TableCell>

                                <TableCell className="py-2 text-right border-r">
                                  <div className="flex items-center gap-1 justify-center">
                                    <FormField
                                      control={form.control}
                                      name={`items.${index}.discountType`}
                                      render={({ field }) => (
                                        <FormItem className="space-y-0 text-center">
                                          <Select onValueChange={field.onChange} defaultValue={field.value || 'amount'}>
                                            <FormControl>
                                              <SelectTrigger className="h-8 w-[40px] px-1 text-xs bg-background border-transparent hover:border-input focus:border-input">
                                                <SelectValue />
                                              </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                              <SelectItem value="amount">₱</SelectItem>
                                              <SelectItem value="percentage">%</SelectItem>
                                            </SelectContent>
                                          </Select>
                                        </FormItem>
                                      )}
                                    />
                                    <FormField
                                      control={form.control}
                                      name={`items.${index}.discount`}
                                      render={({ field }) => (
                                        <FormItem className="space-y-0">
                                          <FormControl>
                                            <Input
                                              type="number"
                                              step="0.01"
                                              className="h-8 w-16 text-right border-transparent hover:border-input focus:border-input bg-background p-1 text-xs"
                                              {...field}
                                            />
                                          </FormControl>
                                        </FormItem>
                                      )}
                                    />
                                  </div>
                                </TableCell>

                                <TableCell className="py-2 text-center border-r">
                                  <FormField
                                    control={form.control}
                                    name={`items.${index}.vatSubject`}
                                    render={({ field }) => (
                                      <div className="flex justify-center">
                                        <input
                                          type="checkbox"
                                          className="h-4 w-4"
                                          checked={field.value}
                                          onChange={field.onChange}
                                        />
                                      </div>
                                    )}
                                  />
                                </TableCell>

                                <TableCell className="py-2 border-r">
                                  <FormField
                                    control={form.control}
                                    name={`items.${index}.expirationDate`}
                                    render={({ field }) => (
                                      <Input
                                        type="date"
                                        className="h-8 w-full border-transparent hover:border-input focus:border-input bg-background text-xs p-1"
                                        {...field}
                                      />
                                    )}
                                  />
                                </TableCell>

                                <TableCell className="text-right py-2 text-xs font-mono text-muted-foreground font-bold italic bg-muted/50 border-r">
                                  ₱{landedCostPerUnit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </TableCell>

                                <TableCell className="text-right py-2 pr-4 font-mono font-medium border-r">
                                  ₱{(purchaseResults?.items[index]?.lineTotal || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </TableCell>

                                <TableCell className="py-2 text-center h-10">
                                  <div className="flex items-center gap-1 justify-center">
                                    {(() => {
                                      const rop = fields[index].reorderPoint || 0;
                                      const hasRop = rop > 0;
                                      return (
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="icon"
                                          className={`h-8 w-8 transition-colors ${hasRop ? 'text-primary hover:text-primary/80' : 'text-muted-foreground hover:text-foreground'}`}
                                          title={hasRop ? `Suggest Order Qty: ${rop}` : 'No Reorder Point set'}
                                          onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            if (!hasRop || rop <= 0) {
                                              toast({
                                                title: 'No Suggestion Available',
                                                description: 'Please set a Reorder Point for this product in settings to use auto-fill.',
                                                variant: 'destructive',
                                              });
                                              return;
                                            }
                                            form.setValue(`items.${index}.quantity`, rop, {
                                              shouldValidate: true,
                                              shouldDirty: true,
                                              shouldTouch: true,
                                            });
                                            toast({
                                              title: 'Quantity Updated',
                                              description: `Set quantity to ${rop} (based on Reorder Point).`,
                                            });
                                          }}
                                        >
                                          <Wand2 className="h-4 w-4" />
                                        </Button>
                                      );
                                    })()}
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                                      onClick={() => remove(index)}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            );
                          })
                        )}
                      </TableBody>
                    </table>
                  </div>
                </div>

                {/* SUMMARY BAR */}
                <div className="bg-background border-t p-3 flex justify-between items-center shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] z-20">
                  <div className="text-xs text-muted-foreground font-medium">
                    <span className="font-black text-foreground">{fields.length}</span> items added.
                  </div>
                  <div className="flex items-center gap-8">
                    <div className="flex flex-col items-end">
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Subtotal</span>
                      <span className="font-mono text-sm font-bold text-foreground">
                        ₱{(total - (form.watch('shipping') || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Shipping</span>
                      <span className="font-mono text-sm font-bold text-foreground">
                        ₱{(form.watch('shipping') || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
                        VAT {activeTaxRate ? `(${activeTaxRate.rate}%)` : ''}
                      </span>
                      <span className="font-mono text-sm font-bold text-foreground">
                        ₱{vatTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                    <div className="flex flex-col items-end border-l pl-8">
                      <span className="text-[10px] uppercase tracking-wider text-primary font-black">Total Payable</span>
                      <span className="font-mono text-2xl font-black text-primary">
                        ₱{total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <DialogFooter className="p-4 bg-background border-t">
              <div className="flex items-center text-xs text-muted-foreground font-bold mr-auto">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-600" /> Ready to process
                </span>
              </div>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting || fields.length === 0}
                className="w-40 font-semibold shadow-lg shadow-primary/20"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    {hookProps.editOrder ? 'Update Order' : 'Create Order'}
                    <ArrowRight className="ml-2 h-4 w-4" />
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
            <AlertDialogTitle>Confirm Purchase Order</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to {hookProps.editOrder ? 'update' : 'create'} this purchase order for{' '}
              <strong>{suppliers.find((s) => s.id === form.watch('supplierId'))?.name || 'the selected supplier'}</strong>?
              Total Amount: <strong>₱{total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmValues && processSubmit(confirmValues)}
              disabled={isSubmitting}
            >
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Confirm & Save
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
