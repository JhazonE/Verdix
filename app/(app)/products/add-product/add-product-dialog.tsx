'use client';

import { useState, useEffect, useRef } from 'react';
import { PlusCircle, Loader2, Wand2 } from 'lucide-react';

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
import { DiscardChangesDialog } from '@/components/discard-changes-dialog';
import { Form } from '@/components/ui/form';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';

import { useAddProductForm, type UseAddProductFormProps } from './use-add-product-form';
import { AddProductFormProvider } from './add-product-form-context';
import { BasicInfoTab } from './tabs/basic-info-tab';
import { InventoryTab } from './tabs/inventory-tab';
import { SellingUnitsTab } from './tabs/conversion-tab';
import { LoyaltyTab } from './tabs/loyalty-tab';
import { SuppliersTab } from './tabs/suppliers-tab';

export function AddProductDialog(props: UseAddProductFormProps) {
  const controller = useAddProductForm(props);
  const {
    isOpen, setIsOpen,
    hasUnsavedDraft, discardDraft,
    isSubmitting,
    form,
    tabErrors,
    markupSource,
    onSubmit,
    itemType, setItemType,
  } = controller;
  const { toast } = useToast();

  // Closing with a half-filled form asks first instead of silently binning the
  // work. The prompt's two answers are the two things a user actually wants
  // here — "Close & keep" (come back to it later, the reason this fix exists)
  // and "Discard" (really throw it away). There is deliberately no answer that
  // closes AND loses the form, since that is the bug being fixed. Same prompt
  // for Cancel, Escape and a backdrop click — the accidental closes are the
  // whole point.
  const [isDiscardOpen, setIsDiscardOpen] = useState(false);
  // Set for the one render in which "Discard" is closing the prompt, so
  // onOpenChange can tell that case apart from a plain dismissal.
  const isDiscardingRef = useRef(false);

  const requestClose = () => {
    if (hasUnsavedDraft()) {
      setIsDiscardOpen(true);
      return;
    }
    setIsOpen(false);
  };

  // Uncontrolled Tabs meant a validation failure on a tab the user wasn't
  // looking at (e.g. a blank required Name/Brand/SKU on Basic Info while
  // sitting on Selling Units) produced nothing more visible than a small red
  // dot — indistinguishable from the button silently doing nothing. Making
  // this controlled lets a failed submit jump the user straight to the
  // first tab that actually has the problem.
  const [activeTab, setActiveTab] = useState('basic');

  useEffect(() => {
    // A restored draft reopens on the tab it was left on — snapping back to
    // Basic Info would make a preserved form feel like a reset one. Only a
    // genuinely fresh form starts at the first tab.
    if (isOpen && !hasUnsavedDraft()) setActiveTab('basic');
  }, [isOpen, hasUnsavedDraft]);

  const handleInvalid = () => {
    // Reuse tabErrors rather than re-deriving which field lives on which tab
    // here — that mapping depends on itemType (a Standard product's
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

  // A caller that passes `open` drives visibility itself (e.g. Add Purchase
  // Order's own "+ Add New Product" button) — the dialog then renders no
  // trigger of its own, so there is never a second, redundant Add Product
  // button sitting next to the caller's.
  const isControlled = props.open !== undefined;

  return (
    <>
    <Dialog
      open={isOpen}
      onOpenChange={(next) => {
        // Radix routes Escape and backdrop clicks through here as `false` —
        // the two ways a user loses a form by accident — so the confirmation
        // has to live on this path, not only on the Cancel button.
        if (!next) {
          requestClose();
          return;
        }
        setIsOpen(true);
      }}
    >
      {!isControlled && (
        <DialogTrigger asChild>
          <Button size="sm">
            <PlusCircle className="mr-2 h-4 w-4" />
            Add Product
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-3xl h-[85vh] flex flex-col overflow-hidden !rounded-3xl !duration-500 ease-in-out data-[state=open]:!animate-in data-[state=closed]:!animate-out data-[state=closed]:!fade-out-0 data-[state=open]:!fade-in-0 data-[state=closed]:!zoom-out-95 data-[state=open]:!zoom-in-90 data-[state=closed]:!slide-out-to-top-[5%] data-[state=open]:!slide-in-from-top-[5%]">
        <DialogHeader className="flex-shrink-0">
          {/* The type choice sits in the header, outside the scroll area: it
              decides which form you are filling in, so it must stay visible
              while you scroll. The description doubles as the hint slot so
              switching type never shifts the layout. */}
          <div className="flex items-start justify-between gap-4 pr-8">
            <div className="space-y-1.5">
              <DialogTitle>Add New Product</DialogTitle>
              <DialogDescription>
                {itemType === 'service'
                  ? 'No stock tracking — always available for sale.'
                  : 'Fill in the details below to add a new product.'}
              </DialogDescription>
            </div>
            <div
              role="group"
              aria-label="Product type"
              className="inline-flex flex-shrink-0 rounded-lg border bg-muted/40 p-0.5"
            >
              {([
                { value: 'standard', label: 'Standard' },
                { value: 'service', label: 'Service' },
              ] as const).map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={itemType === value}
                  onClick={() => setItemType(value)}
                  className={`rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${
                    itemType === value
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </DialogHeader>
        <AddProductFormProvider controller={controller}>
          <div className="flex-1 overflow-y-auto px-4 py-1">
            <Form {...form}>
              <form
                id="add-product-form"
                onSubmit={(e) => {
                  // This dialog can be embedded inside another form (Add
                  // Purchase Order's own "+ Add New Product" button portals
                  // this dialog in, but React's synthetic event system
                  // bubbles submits through the COMPONENT tree, not the
                  // portaled DOM tree). Without stopping it here, submitting
                  // this form also bubbles up into the host's <form
                  // onSubmit>, which then validates and reports on the
                  // host's own fields — exactly what looked like this
                  // dialog "detecting" unrelated Purchase Order fields.
                  e.stopPropagation();
                  form.handleSubmit(onSubmit, handleInvalid)(e);
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
                      {itemType === 'standard' && (
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
                      {itemType === 'standard' && (
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
                    {itemType === 'standard' && (
                      <TabsContent value="conversion" className="space-y-4 p-6">
                        <SellingUnitsTab />
                      </TabsContent>
                    )}
                    <TabsContent value="loyalty" className="space-y-4 p-6">
                      <LoyaltyTab />
                    </TabsContent>
                    {itemType === 'standard' && (
                      <TabsContent value="suppliers" className="space-y-4 p-6">
                        <SuppliersTab />
                      </TabsContent>
                    )}
                  </Tabs>
                </div>
              </form>
            </Form>
          </div>
        </AddProductFormProvider>
        <DialogFooter className="flex-shrink-0">
          <Button type="button" variant="outline" onClick={requestClose}>
            Cancel
          </Button>
          {markupSource && (
            <span className="text-xs text-muted-foreground mr-auto ml-2 flex items-center">
              <Wand2 className="mr-1 h-3 w-3" />
              {markupSource}
            </span>
          )}
          <Button type="submit" form="add-product-form" disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Adding Product...
              </>
            ) : (
              'Add Product'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {/* Sits outside <Dialog> so it is not unmounted along with it — the prompt
        has to outlive the thing it is asking about closing. */}
    <DiscardChangesDialog
      open={isDiscardOpen}
      onOpenChange={(next) => {
        setIsDiscardOpen(next);
        // Radix fires this for "Discard" too, before onConfirm runs, so the
        // keep-path has to skip the one close that discardDraft() will do
        // itself — otherwise which branch wins depends on callback ordering.
        // Every OTHER dismissal (Escape, backdrop, "Close & keep") closes the
        // product dialog with the draft intact: the safe outcome is what an
        // accidental dismissal of this prompt gets.
        if (!next && !isDiscardingRef.current) setIsOpen(false);
        isDiscardingRef.current = false;
      }}
      onConfirm={() => {
        isDiscardingRef.current = true;
        setIsDiscardOpen(false);
        discardDraft();
      }}
      title="Keep this unfinished product?"
      description="You've started filling this in. Close and keep it — what you typed will still be here next time you open Add Product — or discard it and start fresh."
      confirmLabel="Discard"
      cancelLabel="Close & keep"
    />
    </>
  );
}
