'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { FormTotalsBar, formatPeso } from '@/components/form-totals-bar';
import { DiscardChangesDialog } from '@/components/discard-changes-dialog';
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
import { Loader2, Trash2, Search, ArrowRight, ArrowLeft, ChevronDown, ChevronUp, Wand2, Plus } from 'lucide-react';

import { InlineWarehouseSelect } from '../../components/inline-selects/inline-warehouse-select';
import { InlinePaymentMethodSelect } from '../../components/inline-selects/inline-payment-method-select';
import { InlineSupplierSelect } from '../../components/inline-selects/inline-supplier-select';

import { calculateMarkupPercentage, calculateSuggestedPrice } from '@/lib/purchase-utils';
import { UnitStockView } from '@/components/unit-stock-view';
import { useToast } from '@/hooks/use-toast';

import type { AddPurchaseOrderController } from './use-add-purchase-order';
import { ProductSelector } from './product-selector';
import { CurrencyInput } from './currency-input';
import { AddProductDialog } from '../../products/add-product/add-product-dialog';

interface PurchaseOrderFormProps {
  controller: AddPurchaseOrderController;
  isEdit: boolean;
  /** Called when the user backs out. The caller decides whether that closes a dialog or leaves the page. */
  onCancel: () => void;
}

/**
 * Purchase order form body. Rendered full-page for "New Purchase Order"
 * (app/(app)/purchases/new) and inside a dialog for edit / reorder / prefill.
 */
export function PurchaseOrderForm({ controller, isEdit, onCancel }: PurchaseOrderFormProps) {
  const {
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
  const [isAddProductOpen, setIsAddProductOpen] = useState(false);
  const [showDetails, setShowDetails] = useState(true);

  // An edit/reorder opens pre-filled, so only a user-made change counts as dirty there.
  const isDirty = isEdit ? form.formState.isDirty : form.formState.isDirty || fields.length > 0;

  const [isDiscardOpen, setIsDiscardOpen] = useState(false);

  const handleCancel = () => {
    if (isDirty) setIsDiscardOpen(true);
    else onCancel();
  };

  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (!isSubmitting && fields.length > 0) form.handleSubmit(onSubmit)();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isSubmitting, fields.length, form, onSubmit]);

  const totalQty = fields.reduce((sum, f) => sum + (Number(f.quantity) || 0), 0);

  return (
    <div className="flex-1 min-h-[980px] flex flex-col rounded-lg border bg-background overflow-hidden">
      <div className="px-4 py-3 border-b bg-background flex items-center gap-3 shrink-0">
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={handleCancel} aria-label="Back">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-lg font-semibold leading-tight">{isEdit ? 'Edit' : 'New'} Purchase Order</h1>
          <p className="text-xs text-muted-foreground">
            Reference: <span className="font-mono font-medium text-primary">{form.watch('reference')}</span>
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
            {showDetails ? 'Hide' : 'Show'} order details
          </Button>
          <Button type="button" variant="outline" size="sm" className="h-8" onClick={handleCancel}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="purchase-order-form"
            title="Ctrl+S to save"
            disabled={isSubmitting || fields.length === 0}
            className="w-40 h-8 font-semibold shadow-lg shadow-primary/20"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                {isEdit ? 'Update Order' : 'Create Order'}
                <ArrowRight className="ml-2 h-4 w-4" />
              </>
            )}
          </Button>
        </div>
      </div>

        <FormTotalsBar
        items={[
          { label: 'Items', value: String(fields.length) },
          { label: 'Total Qty', value: String(totalQty) },
          { label: 'Subtotal', value: formatPeso(total - (Number(form.watch('shipping')) || 0)) },
          { label: 'Shipping', value: formatPeso(Number(form.watch('shipping')) || 0) },
          { label: `VAT${activeTaxRate ? ` (${activeTaxRate.rate}%)` : ''}`, value: formatPeso(vatTotal) },
          { label: 'Total Payable', value: formatPeso(total), emphasis: true },
        ]}
      />

      <Form {...form}>
          <form id="purchase-order-form" onSubmit={form.handleSubmit(onSubmit, () => setShowDetails(true))} className="flex-1 min-h-0 flex flex-col">
            <div className="flex-1 flex flex-col overflow-hidden bg-muted/10">

              {/* HEADER FIELDS */}
              <div className={`bg-background border-b p-4 grid grid-cols-5 gap-x-4 gap-y-3 shrink-0 ${showDetails ? '' : 'hidden'}`}>

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
                <div className="max-w-2xl mb-4 z-10 flex items-start gap-2">
                  <div className="flex-1">
                    <ProductSelector
                      onSelectProduct={handleAddProduct}
                      supplierId={form.watch('supplierId')}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 shrink-0"
                    onClick={() => setIsAddProductOpen(true)}
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Add New Product
                  </Button>
                </div>

                {/* Deliberately independent of the items table: creating a
                    product here does not add a PO line for it. The user
                    finds it again through the search above like any other
                    product — this dialog's only job is to make a product
                    that didn't exist yet exist, nothing more. Initial Stock
                    is hidden: a product created from a PO gets its stock
                    from that PO's own receiving flow, not from this form. */}
                <AddProductDialog
                  open={isAddProductOpen}
                  onOpenChange={setIsAddProductOpen}
                  hideInitialStock
                />

                <div className="flex-1 rounded-lg border bg-background shadow-sm overflow-hidden flex flex-col relative">
                  <div className="overflow-auto flex-1 h-full relative">
                    <table className="caption-bottom text-sm text-left border-collapse table-fixed" style={{ width: 1500, minWidth: "100%" }}>
                      <TableHeader className="sticky top-0 bg-background z-50 shadow-sm">
                        <TableRow className="hover:bg-transparent border-b">
                          <TableHead className="w-[300px] min-w-[300px] sticky z-[60] bg-background left-[0px] pl-3 h-9">Product</TableHead>
                          <TableHead className="w-[90px] min-w-[90px] sticky z-[60] bg-background left-[300px] text-center h-9">Remaining QTY</TableHead>
                          <TableHead className="w-[90px] min-w-[90px] sticky z-[60] bg-background left-[390px] text-center h-9">Qty</TableHead>
                          <TableHead className="w-[110px] min-w-[110px] sticky z-[60] bg-background left-[480px] text-right h-9">Cost</TableHead>
                          <TableHead className="w-[110px] min-w-[110px] sticky z-[60] bg-background left-[590px] border-r-2 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.15)] text-right h-9">Sell Price</TableHead>
                          <TableHead className="w-[150px] text-right h-9 italic text-blue-600">Suggested</TableHead>
                          <TableHead className="w-[140px] text-center h-9">Discount</TableHead>
                          <TableHead className="w-[50px] text-center h-9">VAT</TableHead>
                          <TableHead className="w-[140px] text-left h-9">Expiry</TableHead>
                          <TableHead className="w-[110px] text-right h-9 italic text-muted-foreground">Landed Cost</TableHead>
                          <TableHead className="w-[120px] text-right pr-4 h-9">Line Total</TableHead>
                          <TableHead className="w-[90px] h-9"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {fields.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={12} className="h-[calc(100vh-480px)] min-h-[240px] text-center text-muted-foreground flex flex-col items-center justify-center border-none">
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
                                <TableCell className="font-medium pl-3 py-1 border-r sticky z-10 bg-background left-[0px]">
                                  <span className="font-bold text-sm text-foreground">
                                    {field.productName}
                                    {field.sellingUnitName && field.sellingUnitFactor !== 1 && (
                                      <span className="ml-1.5 text-xs font-semibold text-blue-600">— {field.sellingUnitName}</span>
                                    )}
                                  </span>
                                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <span className="font-mono font-bold">{field.barcode || '-'}</span>
                                  </div>
                                </TableCell>

                                <TableCell className="py-1 text-center border-r sticky z-10 bg-background left-[300px] font-mono text-xs">
                                  <UnitStockView
                                    stock={field.currentStock || 0}
                                    factor={field.sellingUnitFactor}
                                    unitName={field.sellingUnitName}
                                    className={Math.floor((field.currentStock || 0) / (field.sellingUnitFactor || 1)) <= 0 ? 'text-destructive font-black' : 'text-muted-foreground font-bold'}
                                  />
                                </TableCell>

                                <TableCell className="py-1 border-r sticky z-10 bg-background left-[390px]">
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

                                <TableCell className="py-1 text-right border-r sticky z-10 bg-background left-[480px]">
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

                                <TableCell className="py-1 text-right border-r-2 sticky z-10 bg-background left-[590px] shadow-[2px_0_4px_-2px_rgba(0,0,0,0.15)]">
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

                                <TableCell className="py-1 text-right border-r bg-blue-50/10">
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

                                <TableCell className="py-1 text-right border-r">
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

                                <TableCell className="py-1 text-center border-r">
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

                                <TableCell className="py-1 border-r">
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

                                <TableCell className="text-right py-1 text-xs font-mono text-muted-foreground font-bold italic bg-muted/50 border-r">
                                  ₱{landedCostPerUnit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </TableCell>

                                <TableCell className="text-right py-1 pr-4 font-mono font-medium border-r">
                                  ₱{(purchaseResults?.items[index]?.lineTotal || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </TableCell>

                                <TableCell className="py-1 text-center">
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
                                      type="button"
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

              </div>
            </div>

          </form>
        </Form>

      <AlertDialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Purchase Order</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to {isEdit ? 'update' : 'create'} this purchase order for{' '}
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

      <DiscardChangesDialog open={isDiscardOpen} onOpenChange={setIsDiscardOpen} onConfirm={onCancel} />
    </div>
  );
}
