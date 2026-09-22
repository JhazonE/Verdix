'use client';

import { useState, useEffect, useRef } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import { calculateMarkupPercentage, calculateSuggestedPrice } from '@/lib/purchase-utils';
import { applyPriceLevelAdjustment } from '@/lib/price-level-calc';
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
}

export function useAddProductForm({
  onProductAdded,
  onProductCreated,
  productOptions: externalProductOptions,
  onOptionsRefresh,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  hideInitialStock = false,
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
      shelfLocationIds: [],
      unitOfMeasure: '',
      stock: 0,
      reorderPoint: 0,
      price: 0,
      cost: undefined,
      sku: '',
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
  // unitOfMeasure and cost are top-level fields the schema requires for every
  // item type, but which TAB renders them differs by itemType: a Service
  // shows them on Inventory; a Standard product shows them inside the base
  // unit card on Selling Units instead (see inventory-tab.tsx / conversion-tab.tsx).
  // Routing both to 'inventory' unconditionally used to light up (or jump to)
  // a tab that, for a Standard product, doesn't even contain the field.
  const unitOrCostError = !!(formErrors.unitOfMeasure || formErrors.cost);
  const tabErrors = {
    basic: !!(formErrors.name || formErrors.brand || formErrors.sku || formErrors.description || formErrors.category),
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

  // Mirrors lastAutoRetailPrice/retailPriceEditedByUser above, but for the
  // base unit's Cost field being suggested from the primary supplier
  // mapping's own cost.
  const lastAutoSuggestedCost = useRef<number | null>(null);
  const costEditedByUser = useRef(false);

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
  };

  // Use pre-loaded data from parent when available
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
      .finally(() => {
        setIsLoadingCategories(false);
        setIsLoadingSubcategories(false);
        setIsLoadingBrands(false);
        setIsLoadingUnits(false);
        setIsLoadingSuppliers(false);
        setIsLoadingWarehouses(false);
        setIsLoadingShelfLocations(false);
        setIsLoadingDepartments(false);
        setIsLoadingPriceLevels(false);
      });
  }, [externalProductOptions, isOpen, hasSelfFetchedOptions]);

  useEffect(() => {
    if (isOpen) {
      form.reset();
      // A fresh product for a fresh session — don't carry a previous
      // product's "user edited Retail price, stop suggesting" state into
      // this one.
      lastAutoRetailPrice.current = null;
      retailPriceEditedByUser.current = false;
      lastAutoSuggestedCost.current = null;
      costEditedByUser.current = false;

      // Set default tax rate if available and valid
      if (taxRates.length > 0) {
        const defaultTax = taxRates.find(t => t.isDefault) || taxRates[0];
        form.setValue('vatStatus', defaultTax.name);
      }

      setProductType('parent');
    }
  }, [isOpen, form]);

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
      appendPriceLevel({ levelId: defaultLevel.id, price: 0 });
    }
  }, [isOpen, priceLevels, form, appendPriceLevel]);

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
  const [markupSource, setMarkupSource] = useState<string | null>(null);

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

      values.priceLevels = (values.priceLevels || []).map((pl) => {
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
        const unitRetailEntry = (unit.priceLevels || []).find((pl) => pl.levelId === defaultLevelDef?.id);
        return { ...unit, price: unitRetailEntry?.price ?? 0 };
      });

      // No child product is built any more. Extra ways to sell this product are
      // selling units on the product itself, written by addProduct in the same
      // transaction — one product, one stock figure, nothing to keep in sync.
      const result = await addProduct(
        {
          ...values,
          itemType,
          image: `https://picsum.photos/seed/${values.sku}/400/300`,
        } as any,
        uid,
      );

      if (result.success && (result as any).pendingApproval) {
        toast({
          title: 'Submitted for Approval',
          description: `${values.name} was submitted and is awaiting approval.`,
        });
        form.reset();
        onProductAdded?.();
        setIsOpen(false);
      } else if (result.success) {
        // Fire and forget - don't block form submission on activity logging
        logActivity({
          action: 'CREATE',
          module: 'PRODUCTS',
          description: `Added product: ${values.name} (SKU: ${values.sku}) — Category: ${values.category || 'N/A'}`,
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
          category: values.category,
          brand: values.brand,
          department: values.department,
          subcategory: values.subcategory,
          stock: values.stock ?? 0,
          reorderPoint: values.reorderPoint ?? 0,
          avgDailySales: 0,
          price: values.price,
          cost: values.cost,
          sku: values.sku,
          barcode: values.barcode,
          imageUrl: '',
          imageHint: '',
          unitOfMeasure: values.unitOfMeasure,
          vatStatus: values.vatStatus,
          availability: values.availability,
          earnsPoints: values.earnsPoints,
          type: itemType,
        });
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

  const generateSku = () => {
    const randomPart = Math.random().toString(36).substring(2, 8).toUpperCase();
    const brandPart = form.getValues('brand')?.substring(0, 3).toUpperCase() || 'BRD';
    const namePart = form.getValues('name')?.substring(0, 3).toUpperCase() || 'PRO';
    form.setValue('sku', `${brandPart}-${namePart}-${randomPart}`);
  };

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

  return {
    // dialog + submit state
    isOpen, setIsOpen,
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
    generateSku,
    generateBarcode,
    refreshBrands,
    refreshDepartments,
    refreshCategories,
    refreshSubcategories,
    refreshSuppliers,
    refreshWarehouses,
    refreshShelfLocations,
    refreshUnits,
  };
}

export type AddProductFormController = ReturnType<typeof useAddProductForm>;
