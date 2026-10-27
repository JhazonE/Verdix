'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import { calculateMarkupPercentage, calculateSuggestedPrice } from '@/lib/purchase-utils';
import { applyPriceLevelAdjustment } from '@/lib/price-level-calc';
import { useSellingUnitAutoPricing } from '../use-selling-unit-autopricing';
import { dispatchStockUpdate } from '@/hooks/use-live-refresh';
import { logActivity } from '@/lib/client-activity-logger';
import { useToast } from '@/hooks/use-toast';
import { getApiUrl } from '@/lib/api-config';
import { Category, Brand, UnitOfMeasure, Supplier, TaxRate, SystemSettings, Product } from '@/lib/types';
import type { ProductType } from '@/lib/product-type';

import {
  getCategories,
  getBrands,
  getSubcategories,
  getUnitsOfMeasure,
  addProduct,
  getSuppliers,
  getWarehouses,
  getShelfLocations,
  getDepartments,
  getProductOptions,
} from '../actions';
import { productSchema, type ProductFormValues } from './product-schema';

function getCurrentUid(): string {
  if (typeof window === 'undefined') return 'system';
  try {
    const raw = localStorage.getItem('mock-user-session');
    if (!raw) return 'system';
    const session = JSON.parse(raw);
    return session.uid || session.userId || 'system';
  } catch {
    return 'system';
  }
}

/**
 * Calculate the price for a price level override.
 * Applies the price level's percentage adjustment to the selected base price (retail or cost).
 */
export function calculatePriceLevelPrice(
  levelId: string,
  calculationBase: 'retail' | 'cost',
  priceLevels: any[],
  formPrice: number,
  formCost: number
): number {
  if (!levelId) return 0;

  const level = priceLevels.find(l => l.id === levelId);
  if (!level) return 0;

  const basePrice = calculationBase === 'retail' ? formPrice : formCost;
  if (basePrice === undefined || basePrice === null) return 0;

  return applyPriceLevelAdjustment(level.adjustmentType, level.percentageAdjustment, basePrice);
}

export interface UseAddProductFormProps {
  onProductAdded?: () => void;
  // Fired only on immediate (non-approval-queue) success, with the newly
  // created product so a caller like Add Purchase Order can treat it as a PO
  // line item straight away. When PRODUCT_CREATE requires approval, no real
  // product id exists yet — this callback simply does not fire that time.
  onProductCreated?: (product: Product) => void;
  productOptions?: any;
  onOptionsRefresh?: () => void;
  // Lets a host (e.g. Add Purchase Order's "+ Add New Product" button)
  // control the dialog's open state itself instead of using the built-in
  // trigger button — mirrors useAddPurchaseOrder's own controlled-open props.
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  // A product created from inside a Purchase Order gets its stock from that
  // PO's own receiving flow, not from this form — showing Initial Stock here
  // too would invite entering it twice (once here, once via the PO) with
  // nothing reconciling the two. The field is hidden, not just disabled, so
  // there is nothing to misread as "this is where PO stock goes."
  hideInitialStock?: boolean;
  // Which warehouse the form's Warehouses picker starts on, for a host that
  // already knows the answer — Add Purchase Order passes its own "Receive To"
  // warehouse. Without this the form always preselected the store's MAIN
  // warehouse, so a product created inline on a PO receiving into BODEGA was
  // created as a STORE row and then did not appear in that PO's own
  // warehouse-scoped product search: created, apparently, into nowhere.
  // Still only a DEFAULT — it fills an empty field and the user can change it.
  defaultWarehouseId?: string;
}

export function useAddProductForm({
  onProductAdded,
  onProductCreated,
  productOptions: externalProductOptions,
  onOptionsRefresh,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  hideInitialStock = false,
  defaultWarehouseId,
}: UseAddProductFormProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setIsOpen = (val: boolean) => {
    controlledOnOpenChange?.(val);
    setInternalOpen(val);
  };
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [productType, setProductType] = useState<'parent' | 'child'>('parent');
  // Standard vs Service. Distinct from `productType` above, which is the
  // parent/child family selector.
  const [itemType, setItemType] = useState<ProductType>('standard');
  const { toast } = useToast();

  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoadingCategories, setIsLoadingCategories] = useState(false);
  const [subcategories, setSubcategories] = useState<Category[]>([]);
  const [isLoadingSubcategories, setIsLoadingSubcategories] = useState(false);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [isLoadingBrands, setIsLoadingBrands] = useState(false);
  const [departments, setDepartments] = useState<any[]>([]);
  const [isLoadingDepartments, setIsLoadingDepartments] = useState(false);
  const [unitsOfMeasure, setUnitsOfMeasure] = useState<UnitOfMeasure[]>([]);
  const [isLoadingUnits, setIsLoadingUnits] = useState(false);

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [isLoadingSuppliers, setIsLoadingSuppliers] = useState(false);
  const [warehouses, setWarehouses] = useState<any[]>([]); // Using any for now to avoid cross-file type issues
  const [isLoadingWarehouses, setIsLoadingWarehouses] = useState(false);
  const [shelfLocations, setShelfLocations] = useState<any[]>([]);
  const [isLoadingShelfLocations, setIsLoadingShelfLocations] = useState(false);
  const [priceLevels, setPriceLevels] = useState<any[]>([]);
  const [taxRates, setTaxRates] = useState<TaxRate[]>([]);

  const [isLoadingPriceLevels, setIsLoadingPriceLevels] = useState(false);
  const [systemSettings, setSystemSettings] = useState<SystemSettings | null>(null);

  const [selects, setSelects] = useState({
    categories: false,
    brands: false,
    subcategories: false,
    suppliers: false,
    warehouses: false,
    shelfLocations: false,
    units: false,
    departments: false,
  });

  useEffect(() => {
    fetch(getApiUrl('/pos-settings'))
      .then(res => res.json())
      .then(data => {
        if (data.success) {
            setSystemSettings(data.data);
        }
      })
      .catch(err => console.error('Failed to fetch settings', err));
  }, []);

  const form = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      itemType: 'standard',
      name: '',
      brand: '',
      department: '',
      description: '',
      additionalDescription: '',
      category: '',
      subcategory: '',
      warehouse: '',
      additionalWarehouses: [],
      shelfLocationIds: [],
      unitOfMeasure: '',
      // Left undefined so Initial Stock renders its `0` placeholder instead of
      // a pre-filled zero; the schema defaults it back to 0 on submit.
      stock: undefined,
      reorderPoint: 0,
      price: 0,
      cost: undefined,
      barcode: '',
      conversionFactor: 1,
      conversionFactors: [],
      sellingUnits: [],
      priceLevels: [],
      earnsPoints: true,
      isPerishable: false,
      supplierMappings: [],
    },
  });

  const { fields: conversionFactorFields, append: appendConversionFactor, remove: removeConversionFactor } = useFieldArray({
    control: form.control,
    name: "conversionFactors",
  });

  const { fields: sellingUnitFields, append: appendSellingUnit, remove: removeSellingUnit } = useFieldArray({
    control: form.control,
    name: "sellingUnits",
  });

  const { fields: supplierMappingFields, append: appendSupplierMapping, remove: removeSupplierMapping, update: updateSupplierMappingField } = useFieldArray({
    control: form.control,
    name: "supplierMappings",
  });

  const { fields: priceLevelFields, append: appendPriceLevel, remove: removePriceLevel, replace: replacePriceLevels } = useFieldArray({
    control: form.control,
    name: "priceLevels",
  });

  const selectedUnitOfMeasure = form.watch('unitOfMeasure');
  const watchedPrice = form.watch('price');
  const formErrors = form.formState.errors;
  // unitOfMeasure is required for every item type and cost, while optional,
  // can still fail its non-negative rule — but which TAB renders them differs
  // by itemType: a Service shows them on Inventory; a Standard product shows
  // them inside the base unit card on Selling Units instead (see
  // inventory-tab.tsx / conversion-tab.tsx). Routing both to 'inventory'
  // unconditionally used to light up (or jump to) a tab that, for a Standard
  // product, doesn't even contain the field.
  const unitOrCostError = !!(formErrors.unitOfMeasure || formErrors.cost);
  const tabErrors = {
    // Brand and category are optional now, so they can't error — name and
    // description are the only required fields this tab holds.
    basic: !!(formErrors.name || formErrors.description),
    inventory: !!(formErrors.stock) || (itemType === 'service' && unitOrCostError),
    // The base selling unit's price-level overrides bind to the top-level
    // `priceLevels` field (see product-schema.ts), but they render inside
    // the Selling Units tab, not a standalone one — fold their errors into
    // the same `conversion` flag extra units' sellingUnits[].priceLevels
    // errors already use, so the tab that actually shows the problem is the
    // one that lights up.
    conversion: !!(formErrors.conversionFactors || formErrors.sellingUnits || formErrors.priceLevels) || (itemType === 'standard' && unitOrCostError),
  };

  // State for selected price level (for automatic price calculation)
  const [selectedPriceLevelId, setSelectedPriceLevelId] = useState<string>('');

  // Remembers the value the cost→markup auto-fill effect last wrote to the
  // Retail price field, so it can tell its own write apart from the user's.
  // Reset on every dialog open (see the form.reset() effect below) so a
  // manual edit from a previous product doesn't silently carry into the next
  // one. See the effect further down for the full explanation.
  const lastAutoRetailPrice = useRef<number | null>(null);
  const retailPriceEditedByUser = useRef(false);

  // Bumped on every dialog open, so the Selling Units auto-pricing hook can
  // drop the per-cell memory it keeps for the product just entered.
  const [formSession, setFormSession] = useState(0);

  // Mirrors lastAutoRetailPrice/retailPriceEditedByUser above, but for the
  // base unit's Cost field being suggested from the primary supplier
  // mapping's own cost.
  const lastAutoSuggestedCost = useRef<number | null>(null);
  const costEditedByUser = useRef(false);

  // Clears every dropdown's loading flag in one go. Arriving data is the only
  // thing that ends a load, so this lives next to applyProductOptions rather
  // than being spelled out at each call site: the parent-supplied branch used
  // to apply its data without lowering these flags, so options that arrived
  // from the parent after the self-fetch below had raised them left the
  // dropdowns stuck on "Loading...".
  const clearOptionLoadingFlags = () => {
    setIsLoadingCategories(false);
    setIsLoadingSubcategories(false);
    setIsLoadingBrands(false);
    setIsLoadingUnits(false);
    setIsLoadingSuppliers(false);
    setIsLoadingWarehouses(false);
    setIsLoadingShelfLocations(false);
    setIsLoadingDepartments(false);
    setIsLoadingPriceLevels(false);
  };

  // Applies a getProductOptions()-shaped payload to every dropdown's state,
  // whichever source it came from (parent-supplied or self-fetched below).
  // Does NOT touch the form — ensureDefaultPriceLevel (below) owns that, and
  // runs separately on every open, not just whenever this data happens to load.
  const applyProductOptions = (options: any) => {
    setCategories(options.categories || []);
    setSubcategories(options.subcategories || []);
    setBrands(options.brands || []);
    setUnitsOfMeasure(options.units || []);
    setSuppliers(options.suppliers || []);
    setWarehouses(options.warehouses || []);
    setShelfLocations(options.shelfLocations || []);
    setDepartments(options.departments || []);
    setPriceLevels(options.priceLevels || []);
    setTaxRates(options.taxRates || []);
    clearOptionLoadingFlags();
  };

  // Use pre-loaded data from parent when available. applyProductOptions also
  // lowers the loading flags, so parent data arriving late — after the
  // self-fetch below has already raised them — still releases the dropdowns
  // even if that fetch never settles.
  useEffect(() => {
    if (externalProductOptions) {
      applyProductOptions(externalProductOptions);
    }
  }, [externalProductOptions]);

  // A caller with no productOptions to share (e.g. Add Purchase Order's own
  // "+ Add New Product" button) previously got a dialog full of empty
  // dropdowns — nothing ever populated categories/brands/units/etc. in that
  // case, only the branch above did. Self-fetch the same getProductOptions()
  // payload the Products page already uses once, on the dialog's first open
  // (the fetched lists themselves don't need refetching on every re-open —
  // ensureDefaultPriceLevel below is what needs to re-run each time).
  const [hasSelfFetchedOptions, setHasSelfFetchedOptions] = useState(false);
  useEffect(() => {
    if (externalProductOptions || !isOpen || hasSelfFetchedOptions) return;
    setHasSelfFetchedOptions(true);
    setIsLoadingCategories(true);
    setIsLoadingSubcategories(true);
    setIsLoadingBrands(true);
    setIsLoadingUnits(true);
    setIsLoadingSuppliers(true);
    setIsLoadingWarehouses(true);
    setIsLoadingShelfLocations(true);
    setIsLoadingDepartments(true);
    setIsLoadingPriceLevels(true);
    getProductOptions()
      .then((options) => applyProductOptions(options))
      .catch((error) => console.error('Error loading product options:', error))
      .finally(clearOptionLoadingFlags);
  }, [externalProductOptions, isOpen, hasSelfFetchedOptions]);

  // Closing the dialog mid-entry (Escape, a click on the backdrop, or Cancel)
  // used to throw the half-filled product away, because the effect below reset
  // the form on EVERY open. Losing ten typed fields to a stray click on the
  // overlay is not a reset the user asked for, so a started-but-unsaved form is
  // kept and restored on the next open instead. Only a completed save or an
  // explicit "Discard" clears it — `discardDraft` below is the one place that
  // happens, so there is a single answer to "what throws the draft away".
  const hasDraft = useRef(false);

  useEffect(() => {
    if (isOpen) {
      // A draft survived a close: restore it untouched. Re-running any of the
      // below would regenerate the barcode and wipe the user's own vatStatus
      // pick, which is exactly the clearing this fix exists to prevent.
      if (hasDraft.current) return;
      form.reset();
      generateBarcode();
      // A fresh product for a fresh session — don't carry a previous
      // product's "user edited Retail price, stop suggesting" state into
      // this one.
      lastAutoRetailPrice.current = null;
      retailPriceEditedByUser.current = false;
      lastAutoSuggestedCost.current = null;
      costEditedByUser.current = false;
      // Same reasoning for the Selling Units auto-pricing, which keeps its own
      // per-cell memory: this dialog is reused, so bump the key it resets on.
      setFormSession(n => n + 1);

      // Set default tax rate if available and valid
      if (taxRates.length > 0) {
        const defaultTax = taxRates.find(t => t.isDefault) || taxRates[0];
        form.setValue('vatStatus', defaultTax.name);
      }

      setProductType('parent');
    }
  }, [isOpen, form]);

  // What counts as "the user started filling this in".
  //
  // react-hook-form's own `isDirty` is useless for this: the effects around
  // this one call setValue for a generated barcode, a preselected warehouse, a
  // default tax rate and a mirrored price, so the form is already dirty before
  // the user has touched a key. Asking "would anything be lost?" directly —
  // are any of the fields a human actually types non-empty? — is the honest
  // question, and it is also the one that stays correct when another default
  // gets preselected later.
  const draftWatch = form.watch();
  useEffect(() => {
    if (!isOpen) return;
    const v = draftWatch as any;
    const typedSomething =
      !!v?.name?.trim() ||
      !!v?.brand ||
      !!v?.category ||
      !!v?.description?.trim() ||
      !!v?.additionalDescription?.trim() ||
      !!v?.subcategory ||
      !!v?.unitOfMeasure ||
      Number(v?.stock) > 0 ||
      Number(v?.reorderPoint) > 0 ||
      Number(v?.cost) > 0 ||
      Number(v?.price) > 0 ||
      (v?.sellingUnits?.length ?? 0) > 0 ||
      (v?.supplierMappings?.length ?? 0) > 0;
    if (typedSomething) hasDraft.current = true;
  }, [isOpen, draftWatch]);

  // The one place a draft is thrown away. Called after a successful save and
  // from the Cancel/close confirmation — never from the open effect, which is
  // what used to clear the form behind the user's back.
  const discardDraft = () => {
    hasDraft.current = false;
    form.reset();
    setIsOpen(false);
  };

  // True only when closing would actually lose work, so the dialog can decide
  // between confirming and just closing. Reads a ref and is wrapped in
  // useCallback so consumers can safely list it as an effect dependency —
  // an unstable identity here would re-run the caller's effects every render.
  const hasUnsavedDraft = useCallback(() => hasDraft.current, []);

  // The base unit's Retail price-level row is required (product-schema.ts
  // treats it as the product's actual `price`), but the form.reset() effect
  // above wipes the form's priceLevels field array back to `[]` on every
  // open — including the second and later opens, when priceLevels (the
  // loaded option list) is already sitting in state from the very first open
  // and nothing else will re-trigger appending it. Declared AFTER the reset
  // effect so it runs after reset within the same commit, not before it —
  // otherwise reset would immediately wipe out the row this just appended.
  // Without this, only the first "Add New Product" of a session ever gets a
  // submittable form; every reopen after that fails validation on a price
  // row the user never sees, with nothing more visible than a small dot on
  // the Selling Units tab.
  useEffect(() => {
    if (!isOpen || priceLevels.length === 0) return;
    const currentPriceLevels = form.getValues('priceLevels') || [];
    if (currentPriceLevels.length > 0) return;
    const defaultLevel = priceLevels.find((l: any) => l.isDefault) || priceLevels[0];
    if (defaultLevel) {
      // `price: undefined`, not 0 — the row has to exist so the user has a
      // field to type in, but it must render EMPTY rather than pre-filled
      // with a zero they have to clear first. Left untouched it fails the
      // schema's `price: positive()` rule, which is correct: price is
      // required, so an unfilled Retail row should block the save.
      appendPriceLevel({ levelId: defaultLevel.id, price: undefined as any });
    }
  }, [isOpen, priceLevels, form, appendPriceLevel]);

  // Warehouse is optional on the form, but a stocked product with none shows a
  // blank column in the product list — so preselect the store warehouse
  // (is_main, else the seeded 'wh_main', else the first active one — same order
  // the product importer uses). Declared after the reset effect so it
  // re-applies on every open, and only fills an empty field so a user's own
  // pick is never replaced; clearing it afterwards is allowed and saves NULL.
  //
  // A host-supplied default wins over that chain when it names a warehouse
  // that is actually selectable here: it is a stronger signal than "the main
  // one", because the host knows where this product is being created FOR.
  useEffect(() => {
    if (!isOpen || itemType !== 'standard' || warehouses.length === 0) return;
    if (form.getValues('warehouse')) return;
    const active = warehouses.filter((w: any) => w.isActive !== false);
    const requested = defaultWarehouseId
      ? active.find((w: any) => String(w.id) === String(defaultWarehouseId))
      : undefined;
    const store =
      requested ||
      active.find((w: any) => w.isMain) ||
      active.find((w: any) => w.id === 'wh_main') ||
      active[0];
    if (store) form.setValue('warehouse', store.id);
  }, [isOpen, itemType, warehouses, form, defaultWarehouseId]);

  // "There is no standalone price field — the default (Retail) price-level
  // row IS the product's price" only held at submit time (onSubmit copied
  // priceLevels' Retail entry into `price` right before the DB write). But
  // the schema's zodResolver validates the form's CURRENT values before
  // onSubmit is ever called, and nothing kept `price` itself in sync while
  // the user was typing — it sat at its default of 0 for the entire session,
  // so `price: z.coerce.number().positive()` failed validation unconditionally,
  // no matter how correctly the user filled in Retail price. This mirrors
  // Retail price into `price` live, the moment it changes, so validation sees
  // what onSubmit always assumed it would.
  const watchedPriceLevels = form.watch('priceLevels');
  useEffect(() => {
    if (!isOpen || priceLevels.length === 0) return;
    const defaultLevel = priceLevels.find((l: any) => l.isDefault) || priceLevels[0];
    if (!defaultLevel) return;
    const retailEntry = (watchedPriceLevels || []).find((pl: any) => pl.levelId === defaultLevel.id);
    const retailPrice = retailEntry?.price ?? 0;
    if (form.getValues('price') !== retailPrice) {
      form.setValue('price', retailPrice, { shouldValidate: form.formState.isSubmitted });
    }
  }, [isOpen, priceLevels, watchedPriceLevels, form]);

  useEffect(() => {
    if (productType === 'parent') {
      form.setValue('conversionFactor', 1);
      form.setValue('parentId', undefined);
    }
  }, [productType, form]);

  useEffect(() => {
    if (productType === 'child') {
      // For child products, conversion factor should be manually entered by user
      // The previous auto-setting based on unit of measure is no longer valid
      // since conversion factors are now managed separately
    }
  }, [productType]);

  // Switching to Service clears every stock-side field. Without this, values
  // typed while Standard was selected stay in form state and fail the service
  // branch's z.undefined() checks on submit, with no visible field to fix.
  useEffect(() => {
    // Must run for BOTH branches: this is the only place that writes the
    // discriminator into react-hook-form state. `itemType` otherwise lives
    // only in React state, so the zod resolver would always see 'standard'
    // and serviceProductSchema (and its required-cost rule) would never run.
    form.setValue('itemType', itemType);

    if (itemType === 'service') {
      form.setValue('stock', 0);
      form.setValue('reorderPoint', 0);
      form.setValue('cost', 0);
      form.setValue('department', undefined);
      form.setValue('warehouse', undefined);
      // Must be cleared too, or rows entered before the switch would fail
      // serviceProductSchema's `additionalWarehouses: z.undefined()`.
      form.setValue('additionalWarehouses', undefined);
      form.setValue('shelfLocationIds', undefined);
      form.setValue('parentId', undefined);
      form.setValue('conversionFactor', undefined);
      form.setValue('conversionFactors', undefined);
      form.setValue('sellingUnits', undefined);
      form.setValue('isPerishable', undefined);
      form.setValue('supplierMappings', undefined);
    }
  }, [itemType, form]);

  const watchedCost = form.watch('cost');
  const watchedCategoryName = form.watch('category');
  const watchedSubcategoryName = form.watch('subcategory');
  const watchedBrandName = form.watch('brand');
  const watchedSupplierMappings = form.watch('supplierMappings');
  const markupSupplierId = (watchedSupplierMappings || []).find(m => m.isPrimary)?.supplierId;
  const [markupSource, setMarkupSourceRaw] = useState<string | null>(null);
  const [autoMarkup, setAutoMarkup] = useState<number | null>(null);
  const setMarkupSource = (v: string | null) => {
    setMarkupSourceRaw(v);
    if (v === null) setAutoMarkup(null);
  };

  useEffect(() => {
    if (!systemSettings?.enableAutomaticMarkup) {
        setMarkupSource(null);
        return;
    }

    const { markup, source } = calculateMarkupPercentage(
        {
            markupPercentage: null,
            category: watchedCategoryName,
            subcategory: watchedSubcategoryName,
            brand: watchedBrandName,
            supplierId: markupSupplierId
        },
        systemSettings,
        categories,
        subcategories,
        brands,
        suppliers
    );

    if (source) {
      setMarkupSource(`Calculated from ${source} Markup (${markup}%)`);
      setAutoMarkup(markup);
      if (watchedCost && watchedCost > 0 && !retailPriceEditedByUser.current) {
          // Calculate base price and default level price
          const defaultLevel = priceLevels.find((l: any) => l.isDefault) || priceLevels[0];
          const suggestedMainPrice = calculateSuggestedPrice(watchedCost, markup, 0, defaultLevel);

          // There is no standalone "price" field any more — the default
          // (Retail) price-level row IS the product's price. Write the
          // suggestion directly onto that row.
          if (defaultLevel) {
            const idx = priceLevelFields.findIndex((f: any) => f.levelId === defaultLevel.id);
            if (idx !== -1) {
              const currentValue = form.getValues(`priceLevels.${idx}.price`);
              // A mismatch against what this effect itself wrote last means
              // the user changed it in between — respect that and stop.
              if (lastAutoRetailPrice.current !== null && currentValue !== lastAutoRetailPrice.current) {
                retailPriceEditedByUser.current = true;
                return;
              }
              const rounded = parseFloat(suggestedMainPrice.toFixed(2));
              form.setValue(`priceLevels.${idx}.price`, rounded);
              lastAutoRetailPrice.current = rounded;
            }
          }
      }
    } else {
      setMarkupSource(null);
    }

  }, [watchedCost, watchedCategoryName, watchedSubcategoryName, watchedBrandName, markupSupplierId, categories, subcategories, brands, suppliers, form, priceLevels, systemSettings, priceLevelFields]);

  const { notifyPriceCleared } = useSellingUnitAutoPricing({
    form,
    priceLevels,
    baseLevelRows: priceLevelFields as any,
    unitKeys: sellingUnitFields.map(f => f.id),
    markup: autoMarkup,
    resetKey: formSession,
  });

  const [costSuggestionSource, setCostSuggestionSource] = useState<string | null>(null);

  useEffect(() => {
    const primaryMapping = (watchedSupplierMappings || []).find(m => m.isPrimary);
    if (!primaryMapping || primaryMapping.cost == null) {
      setCostSuggestionSource(null);
      return;
    }
    if (costEditedByUser.current) {
      return;
    }

    const suggested = primaryMapping.cost;
    const currentValue = form.getValues('cost');
    if (lastAutoSuggestedCost.current !== null && currentValue !== lastAutoSuggestedCost.current) {
      costEditedByUser.current = true;
      return;
    }

    form.setValue('cost', suggested);
    lastAutoSuggestedCost.current = suggested;
    const supplierName = suppliers.find(s => s.id === primaryMapping.supplierId)?.name;
    setCostSuggestionSource(`Suggested from ${supplierName || 'the primary supplier'}'s cost`);
  }, [watchedSupplierMappings, suppliers, form]);

  // Auto-update main price when a price level is selected
  useEffect(() => {
    if (selectedPriceLevelId) {
      const selectedLevel = priceLevels.find((l: any) => l.id === selectedPriceLevelId);
      if (selectedLevel) {
        const cost = form.getValues('cost');
        if (cost && cost > 0) {
          // Get category/brand markup
          const category = categories.find(c => c.name === form.getValues('category'));
          const subcategory = subcategories.find(s => s.name === form.getValues('subcategory'));
          const brand = brands.find(b => b.name === form.getValues('brand'));

          let markup = 0;
          // Parse markupPriority if it's a string (from DB)
          let priority: string[] = ["subcategory", "category", "brand", "supplier"];
          if (systemSettings?.markupPriority) {
            if (typeof systemSettings.markupPriority === 'string') {
              try {
                priority = JSON.parse(systemSettings.markupPriority);
              } catch (e) {
                console.error('Failed to parse markupPriority:', e);
              }
            } else if (Array.isArray(systemSettings.markupPriority)) {
              priority = systemSettings.markupPriority;
            }
          }

          for (const type of priority) {
            if (type === 'subcategory' && subcategory?.markupPercentage !== undefined && subcategory.markupPercentage !== null) {
              markup = Number(subcategory.markupPercentage);
              break;
            } else if (type === 'category' && category?.markupPercentage !== undefined && category.markupPercentage !== null) {
              markup = Number(category.markupPercentage);
              break;
            } else if (type === 'brand' && brand?.markupPercentage !== undefined && brand.markupPercentage !== null) {
              markup = Number(brand.markupPercentage);
              break;
            }
          }

          const globalDefault = systemSettings?.defaultMarkupPercentage !== undefined ? Number(systemSettings.defaultMarkupPercentage) : undefined;
          if (!markup && globalDefault !== undefined) {
            markup = globalDefault;
          }

          const basePrice = cost * (1 + markup / 100);

          // There is no standalone "price" field any more — every level's
          // own row (Retail included) is written directly by the loop below,
          // keyed by its own calculationBase/markup, not just the selected one.
          // Update all price level fields automatically
          if (priceLevelFields.length > 0) {
            priceLevelFields.forEach((field, index) => {
              const levelDef = priceLevels.find((l: any) => l.id === field.levelId);
              if (levelDef) {
                // Calculate price for each level
                let levelPrice;
                const levelMarkup = levelDef.percentageAdjustment ?? 0;

                if (levelDef.calculationBase === 'cost') {
                    levelPrice = parseFloat((cost * (1 + levelMarkup / 100)).toFixed(2));
                } else {
                    // Retail Base
                    if (levelMarkup === 0 && levelDef.name?.toLowerCase() === 'retail') {
                        levelPrice = parseFloat(basePrice.toFixed(2));
                    } else {
                        levelPrice = parseFloat((basePrice * (1 + levelMarkup / 100)).toFixed(2));
                    }
                }
                form.setValue(`priceLevels.${index}.price`, levelPrice);
              }
            });
          }
        }
      }
    }
  }, [selectedPriceLevelId, priceLevels, priceLevelFields, form, categories, subcategories, brands, systemSettings]);

  async function onSubmit(values: ProductFormValues) {
    setIsSubmitting(true);

    try {
      const uid = getCurrentUid();

      // There is no standalone "price" field any more — the default (Retail)
      // price-level row IS the product's price, and it is REQUIRED (enforced
      // by the schema), so it always carries a real, positive value by the
      // time submit runs. Every other level still sitting at an untouched 0
      // placeholder (auto-appended on productOptions load, before the user
      // typed anything) gets fixed up from it here — a row the user edited
      // to any nonzero value is left alone. (A deliberate, genuine ₱0 price
      // level is indistinguishable from "untouched" with the current data
      // model and would also get corrected here — an accepted, narrow edge
      // case, not the scenario this fix targets.)
      const defaultLevelDef = priceLevels.find((l: any) => l.isDefault) || priceLevels[0];
      const retailEntry = (values.priceLevels || []).find((pl) => pl.levelId === defaultLevelDef?.id);
      const retailPrice = retailEntry?.price ?? 0;

      values.priceLevels = (values.priceLevels || [])
        // Drop any row that carries a tier but no price. A quantity threshold
        // on its own is not an override — it only qualifies one — and letting
        // it through would write a ₱0 price for that level, which the resolver
        // would then pick as the cheapest candidate and sell at zero. This runs
        // BEFORE the auto-fill below so a price-less row is never mistaken for
        // the "untouched ₱0" case that auto-fill exists to correct.
        .filter((pl) => pl.price !== undefined && pl.price !== null)
        .map((pl) => {
          if (pl.price !== 0) return pl;
          const level = priceLevels.find((l: any) => l.id === pl.levelId);
          if (!level) return pl;
          const basePrice = (level.calculationBase || 'retail') === 'cost' ? (values.cost || 0) : retailPrice;
          return { ...pl, price: applyPriceLevelAdjustment(level.adjustmentType, level.percentageAdjustment, basePrice) };
        });

      // products.price stays in the schema/backend (it's the fallback price
      // when a selling unit has no override for the active level) — it is
      // just no longer typed directly; it mirrors the Retail row instead.
      values.price = retailPrice;

      // Same story per EXTRA selling unit: no standalone Price field there
      // either — each unit's own Retail price-level entry (required, same as
      // the base unit's) IS that unit's price, and sellingUnits[i].price
      // stays the schema/backend fallback for when this unit has no override
      // for the active level.
      values.sellingUnits = (values.sellingUnits || []).map((unit) => {
        // Same tier-without-price filter as the base unit above.
        const unitPriceLevels = (unit.priceLevels || []).filter(
          (pl) => pl.price !== undefined && pl.price !== null,
        );
        const unitRetailEntry = unitPriceLevels.find((pl) => pl.levelId === defaultLevelDef?.id);
        return { ...unit, priceLevels: unitPriceLevels, price: unitRetailEntry?.price ?? 0 };
      });

      // No child product is built any more. Extra ways to sell this product are
      // selling units on the product itself, written by addProduct in the same
      // transaction — one product, one stock figure, nothing to keep in sync.
      const result = await addProduct(
        {
          ...values,
          itemType,
          image: `https://picsum.photos/seed/${values.barcode}/400/300`,
        } as any,
        uid,
      );

      if (result.success && (result as any).pendingApproval) {
        toast({
          title: 'Submitted for Approval',
          description: `${values.name} was submitted and is awaiting approval.`,
        });
        // Saved (pending approval, but filed) — there is no longer a draft to
        // preserve, so the next open starts clean.
        hasDraft.current = false;
        form.reset();
        onProductAdded?.();
        setIsOpen(false);
      } else if (result.success) {
        // Fire and forget - don't block form submission on activity logging
        logActivity({
          action: 'CREATE',
          module: 'PRODUCTS',
          description: `Added product: ${values.name} (Barcode: ${values.barcode}) — Category: ${values.category || 'N/A'}`,
          referenceId: result.productId,
        }).catch(() => {
          // Silently ignore activity logging errors
        });
        toast({
          title: 'Product Added',
          description: `${values.name} has been successfully added.`,
        });
        onProductCreated?.({
          id: result.productId!,
          name: values.name,
          description: values.description,
          // Brand and Category are optional on the form but required `string`
          // on `Product`, so blank becomes '' here rather than undefined —
          // the same shape the write path stores for an unset one.
          category: values.category ?? '',
          brand: values.brand ?? '',
          department: values.department,
          subcategory: values.subcategory,
          stock: values.stock ?? 0,
          reorderPoint: values.reorderPoint ?? 0,
          avgDailySales: 0,
          price: values.price,
          cost: values.cost,
          // `Product.sku` (lib/types.ts) is still a required string — out of
          // scope for this task, which only retires the Add Product form's
          // OWN sku field. Mirror the barcode here (matching how the backend
          // now derives products.sku) instead of an empty string, keeping
          // this emitted object internally consistent; nothing currently
          // reads this field since onProductCreated has no live caller.
          sku: values.barcode,
          barcode: values.barcode,
          imageUrl: '',
          imageHint: '',
          unitOfMeasure: values.unitOfMeasure,
          vatStatus: values.vatStatus,
          availability: values.availability,
          earnsPoints: values.earnsPoints,
          type: itemType,
        });
        // Saved — nothing left to preserve for the next open.
        hasDraft.current = false;
        form.reset();
        onProductAdded?.();
        dispatchStockUpdate();
        setIsOpen(false);
      } else {
        toast({
          variant: 'destructive',
          title: 'Error',
          description: result.message,
        });
      }
    } catch (error) {
      console.error('Error adding product:', error);
      toast({
        variant: 'destructive',
        title: 'Uh oh! Something went wrong.',
        description: 'There was a problem adding the product. Please try again.',
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  const generateBarcode = (
    fieldPath: 'barcode' | `sellingUnits.${number}.barcode` = 'barcode',
  ) => {
    // EAN-8: 7 random digits + 1 check digit
    const digits = Array.from({ length: 7 }, () => Math.floor(Math.random() * 10));
    const sum = digits.reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
    const check = (10 - (sum % 10)) % 10;
    form.setValue(fieldPath, [...digits, check].join(''));
  };

  // Refresh callbacks wired to the "Manage …" dialogs.
  const refreshBrands = () => getBrands().then(setBrands);
  const refreshDepartments = () => getDepartments().then(setDepartments);
  const refreshCategories = () => getCategories().then(setCategories);
  const refreshSubcategories = () => getSubcategories().then(setSubcategories);
  const refreshSuppliers = () => getSuppliers().then(setSuppliers);
  const refreshWarehouses = () => getWarehouses().then(setWarehouses);
  const refreshShelfLocations = () => getShelfLocations().then(setShelfLocations);
  const refreshUnits = () => getUnitsOfMeasure().then(setUnitsOfMeasure);

  // Inline "+ Add Brand/Category/Subcategory" inserts the one new row into the
  // list we already hold, rather than calling the matching refresh*() above.
  // The add action already returns the row it created, so refetching the whole
  // table only bought a second server round trip the dropdown had to sit and
  // wait out — visibly slow against the cloud DB. Sorted on insert to match
  // the `ORDER BY name` the fetches use, so the new row lands where a refetch
  // would have put it.
  const byName = <T extends { name: string }>(list: T[]) =>
    [...list].sort((a, b) => a.name.localeCompare(b.name));
  const insertBrand = (brand: Brand) => setBrands((prev) => byName([...prev, brand]));
  const insertCategory = (category: Category) => setCategories((prev) => byName([...prev, category]));
  const insertSubcategory = (subcategory: Category) =>
    setSubcategories((prev) => byName([...prev, subcategory]));

  return {
    // dialog + submit state
    isOpen, setIsOpen,
    // Draft preservation: a half-filled form survives a close and is restored
    // on the next open. hasUnsavedDraft lets the dialog ask before throwing it
    // away; discardDraft is the only thing that actually does.
    hasUnsavedDraft, discardDraft,
    isSubmitting,
    productType, setProductType,
    itemType, setItemType,
    form,
    hideInitialStock,

    // option data + loading flags
    categories, isLoadingCategories,
    subcategories, isLoadingSubcategories,
    brands, isLoadingBrands,
    departments, isLoadingDepartments,
    unitsOfMeasure, isLoadingUnits,
    suppliers, isLoadingSuppliers,
    warehouses, isLoadingWarehouses,
    shelfLocations, isLoadingShelfLocations,
    priceLevels, isLoadingPriceLevels,
    taxRates,
    systemSettings,

    // nested popover/select open state
    selects, setSelects,

    // field arrays
    conversionFactorFields, appendConversionFactor, removeConversionFactor,
    sellingUnitFields, appendSellingUnit, removeSellingUnit,
    priceLevelFields, appendPriceLevel, removePriceLevel, replacePriceLevels,
    supplierMappingFields, appendSupplierMapping, removeSupplierMapping, updateSupplierMappingField,

    // derived values
    selectedUnitOfMeasure,
    tabErrors,
    selectedPriceLevelId, setSelectedPriceLevelId,
    markupSource,
    costSuggestionSource,

    // handlers
    onSubmit,
    generateBarcode,
    notifyPriceCleared,
    refreshBrands,
    refreshDepartments,
    refreshCategories,
    refreshSubcategories,
    refreshSuppliers,
    refreshWarehouses,
    refreshShelfLocations,
    refreshUnits,
    insertBrand,
    insertCategory,
    insertSubcategory,
  };
}

export type AddProductFormController = ReturnType<typeof useAddProductForm>;
