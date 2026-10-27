'use client';

import { useState, useEffect } from 'react';
import { PlusCircle, Pencil, Loader2, Wand2 } from 'lucide-react';

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
import { Form } from '@/components/ui/form';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import { Product } from '@/lib/types';

import { useEditProductForm } from './use-edit-product-form';
import { EditProductFormProvider } from './edit-product-form-context';
import { BasicInfoTab } from './tabs/basic-info-tab';
import { InventoryTab } from './tabs/inventory-tab';
import { SellingUnitsTab } from './tabs/conversion-tab';
import { LoyaltyTab } from './tabs/loyalty-tab';
import { ProductSuppliers } from '../product-suppliers/product-suppliers';

export function EditProductDialog({
  product,
  onProductUpdated,
  productOptions,
  onOptionsRefresh,
  trigger,
  open: externalOpen,
  onOpenChange: externalOnOpenChange,
}: {
  product: Product;
  onProductUpdated?: () => void;
  productOptions?: any;
  onOptionsRefresh?: () => void;
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const controller = useEditProductForm({
    product,
    onProductUpdated,
    productOptions,
    onOptionsRefresh,
    open: externalOpen,
    onOpenChange: externalOnOpenChange,
  });
  const {
    isOpen, setIsOpen,
    isSubmitting,
    form,
    tabErrors,
    markupSource,
    saveChanges,
    supplierMappings,
    isLoadingSupplierMappings,
    refreshSupplierMappings,
  } = controller;
  const { toast } = useToast();

  // Uncontrolled Tabs meant a validation failure on a tab the user wasn't
  // looking at produced nothing more visible than a small red dot (or, until
  // now, only a console.log) — indistinguishable from Save silently doing
  // nothing. Making this controlled lets a failed submit jump the user
  // straight to the first tab that actually has the problem.
  const [activeTab, setActiveTab] = useState('basic');

  useEffect(() => {
    if (isOpen) setActiveTab('basic');
  }, [isOpen]);

  // Opening the form is the one moment its dropdowns must be current. The
  // page caches productOptions behind a staleTime with no polling, and the
  // cross-tab BroadcastChannel never leaves the browser it fired in, so a
  // category or supplier added on another terminal stays invisible here
  // until something forces a refetch. Nothing else will: once the dialog is
  // open the user stops leaving the window, which is precisely what
  // refetchOnWindowFocus depends on.
  useEffect(() => {
    if (isOpen) onOptionsRefresh?.();
  }, [isOpen, onOptionsRefresh]);

  const handleInvalid = () => {
    // Reuse tabErrors rather than re-deriving which field lives on which tab
    // here — that mapping depends on product type (a Standard product's
    // unitOfMeasure/cost render on Selling Units, a Service's render on
    // Inventory), and tabErrors is the one place that distinction is made.
    const firstErrorTab = tabErrors.basic
      ? 'basic'
      : tabErrors.inventory
      ? 'inventory'
      : tabErrors.conversion
      ? 'conversion'
      : 'basic';
    setActiveTab(firstErrorTab);
    toast({
      variant: 'destructive',
      title: 'Missing required fields',
      description: 'Some required fields are still blank — check the highlighted tab.',
    });
  };

  return (
    <TooltipProvider>
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        {trigger ? (
          <DialogTrigger asChild>
            {trigger}
          </DialogTrigger>
        ) : externalOpen !== undefined ? null : (
          <Tooltip>
            <TooltipTrigger asChild>
              <DialogTrigger asChild>
                <Button variant="ghost" size="icon" className="text-blue-600 hover:text-blue-700 hover:bg-blue-50">
                  <Pencil className="h-4 w-4" />
                  <span className="sr-only">Edit product</span>
                </Button>
              </DialogTrigger>
            </TooltipTrigger>
            <TooltipContent>
              <p>Edit this product</p>
            </TooltipContent>
          </Tooltip>
        )}
        <DialogContent className="sm:max-w-3xl h-[85vh] flex flex-col overflow-hidden !rounded-3xl !duration-500 ease-in-out data-[state=open]:!animate-in data-[state=closed]:!animate-out data-[state=closed]:!fade-out-0 data-[state=open]:!fade-in-0 data-[state=closed]:!zoom-out-95 data-[state=open]:!zoom-in-90 data-[state=closed]:!slide-out-to-top-[5%] data-[state=open]:!slide-in-from-top-[5%]">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle>Edit Product</DialogTitle>
            <DialogDescription>
              Update the details for {product.name}.{' '}
              {/* Required fields are spread over Basic Info and Selling Units,
                  so the legend lives in the header — the only part of the
                  dialog visible from every tab. */}
              Fields marked{' '}
              <span aria-hidden="true" className="text-destructive font-medium">*</span>
              {' '}are required.
            </DialogDescription>
          </DialogHeader>
          <EditProductFormProvider controller={controller}>
            <div className="flex-1 overflow-y-auto px-4 py-1">
              <Form {...form}>
                <form
                  id="edit-product-form"
                  onSubmit={(e) => {
                    // Defensive: if this dialog is ever embedded inside
                    // another <form> (e.g. the way Add Product's dialog is
                    // embedded in Add Purchase Order), React's synthetic
                    // event system would bubble this submit through the
                    // COMPONENT tree, not the portaled DOM tree — reaching
                    // and validating the host's own unrelated fields. Not
                    // currently reachable from inside a <form> today, but
                    // costs nothing to guard against here too.
                    e.stopPropagation();
                    form.handleSubmit(saveChanges, handleInvalid)(e);
                  }}
                  onKeyDown={(e) => {
                    // A barcode scanner is a keyboard: it types the digits and
                    // then sends Enter. Inside a <form> that Enter is an
                    // implicit submit, so a scan into a Barcode field used to
                    // SAVE the product instead of just filling the field.
                    // Suppress implicit submission from single-line inputs —
                    // saving stays on the explicit Save button (type="submit").
                    // Enter in a <textarea> (newline) and on buttons/links
                    // (activation) must still work, so they are exempt.
                    if (e.key !== 'Enter' || e.shiftKey) return;
                    const el = e.target as HTMLElement | null;
                    const tag = el?.tagName;
                    if (tag === 'TEXTAREA' || tag === 'BUTTON' || tag === 'A') return;
                    if (el?.getAttribute('role') === 'button') return;
                    if (el?.isContentEditable) return;
                    e.preventDefault();
                  }}
                >
                  <div className="h-full">
                    <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full h-full">
                      <TabsList className="w-full h-auto justify-start rounded-none border-b bg-transparent p-0">
                        <TabsTrigger
                          value="basic"
                          className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-3"
                        >
                          Basic Info
                          {tabErrors.basic && <span className="ml-1.5 inline-flex h-2 w-2 rounded-full bg-destructive" />}
                        </TabsTrigger>
                        <TabsTrigger
                          value="inventory"
                          className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-3"
                        >
                          Inventory
                          {tabErrors.inventory && <span className="ml-1.5 inline-flex h-2 w-2 rounded-full bg-destructive" />}
                        </TabsTrigger>
                        {product?.type !== 'service' && (
                          <TabsTrigger
                            value="conversion"
                            className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-3"
                          >
                            Selling Units
                            {tabErrors.conversion && <span className="ml-1.5 inline-flex h-2 w-2 rounded-full bg-destructive" />}
                          </TabsTrigger>
                        )}
                        <TabsTrigger
                          value="loyalty"
                          className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-3"
                        >
                          Loyalty
                        </TabsTrigger>
                        {product?.type !== 'service' && (
                          <TabsTrigger
                            value="suppliers"
                            className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-3"
                          >
                            Suppliers
                          </TabsTrigger>
                        )}
                      </TabsList>
                      <TabsContent value="basic" className="space-y-4 p-6">
                        <BasicInfoTab />
                      </TabsContent>
                      <TabsContent value="inventory" className="space-y-4 p-6">
                        <InventoryTab />
                      </TabsContent>
                      {product?.type !== 'service' && (
                        <TabsContent value="conversion" className="space-y-4 p-6">
                          <SellingUnitsTab />
                        </TabsContent>
                      )}
                      <TabsContent value="loyalty" className="space-y-4 p-6">
                        <LoyaltyTab />
                      </TabsContent>
                      {product?.type !== 'service' && (
                        <TabsContent value="suppliers" className="space-y-4 p-6">
                          <ProductSuppliers
                            productId={product.id}
                            mappings={supplierMappings}
                            isLoadingMappings={isLoadingSupplierMappings}
                            onMappingsChanged={refreshSupplierMappings}
                            onUpdate={onProductUpdated}
                          />
                        </TabsContent>
                      )}
                    </Tabs>
                  </div>
                </form>
              </Form>
            </div>
          </EditProductFormProvider>
          <DialogFooter className="flex-shrink-0">
            <Button type="button" variant="outline" onClick={() => setIsOpen(false)}>
              Cancel
            </Button>
            {markupSource && (
              <span className="text-xs text-muted-foreground mr-auto ml-2 flex items-center">
                <Wand2 className="mr-1 h-3 w-3" />
                {markupSource}
              </span>
            )}
            <Button type="submit" form="edit-product-form" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Changes'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}
