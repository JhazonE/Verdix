'use client';

import { useState, useEffect, useRef } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import { calculateMarkupPercentage, calculateSuggestedPrice } from '@/lib/purchase-utils';
import { seedDefaultPriceLevel } from '@/lib/price-level-seed';
import { applyPriceLevelAdjustment } from '@/lib/price-level-calc';
import { dispatchStockUpdate } from '@/hooks/use-live-refresh';
import { logActivity } from '@/lib/client-activity-logger';
import { useToast } from '@/hooks/use-toast';
import { getApiUrl } from '@/lib/api-config';
import { Category, Product, Brand, UnitOfMeasure, Supplier, TaxRate, SystemSettings, SupplierProductMapping } from '@/lib/types';

import {
  updateProduct,
  getBrands,
  getCategories,
  getSubcategories,
  getUnitsOfMeasure,
  getSuppliers,
  getSupplierMappings,
  getWarehouses,
  getShelfLocations,
  getDepartments,
} from '../actions';
import { buildProductSchema, type ProductFormValues } from './product-schema';

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

export interface UseEditProductFormProps {
  product: Product;
  onProductUpdated?: () => void;
  productOptions?: any;
  onOptionsRefresh?: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function useEditProductForm({
  product,
  onProductUpdated,
  productOptions: externalProductOptions,
  onOptionsRefresh,
  open: externalOpen,
  onOpenChange: externalOnOpenChange,
}: UseEditProductFormProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = externalOpen !== undefined ? externalOpen : internalOpen;
  const setIsOpen = externalOnOpenChange !== undefined ? externalOnOpenChange : setInternalOpen;

  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();
  const [brands, setBrands] = useState<Brand[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [subcategories, setSubcategories] = useState<Category[]>([]);
  const [units, setUnits] = useState<UnitOfMeasure[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierMappings, setSupplierMappings] = useState<SupplierProductMapping[]>([]);
  const [isLoadingSupplierMappings, setIsLoadingSupplierMappings] = useState(false);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [shelfLocations, setShelfLocations] = useState<any[]>([]);
  const [isLoadingShelfLocations, setIsLoadingShelfLocations] = useState(false);
  const [priceLevels, setPriceLevels] = useState<any[]>([]);
  const [taxRates, setTaxRates] = useState<TaxRate[]>([]);
  const [isLoadingPriceLevels, setIsLoadingPriceLevels] = useState(false);
  const [departments, setDepartments] = useState<any[]>([]);
  const [isLoadingDepartments, setIsLoadingDepartments] = useState(false);
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

  // Guard to prevent auto-calculation on initial form reset
  const isInitialLoad = useState(true);

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

  // Use pre-loaded data from parent when available
  useEffect(() => {
    if (externalProductOptions) {
      setBrands(externalProductOptions.brands || []);
      setCategories(externalProductOptions.categories || []);
      setSubcategories(externalProductOptions.subcategories || []);
      setUnits(externalProductOptions.units || []);
      setSuppliers(externalProductOptions.suppliers || []);
      setDepartments(externalProductOptions.departments || []);
      setWarehouses(externalProductOptions.warehouses || []);
      setShelfLocations(externalProductOptions.shelfLocations || []);
      setPriceLevels(externalProductOptions.priceLevels || []);
      setTaxRates(externalProductOptions.taxRates || []);
      setIsLoadingPriceLevels(false);
    }
  }, [externalProductOptions]);

  const form = useForm<ProductFormValues>({
    resolver: zodResolver(buildProductSchema(product.type === 'service')),
    defaultValues: {
      ...product,
      category: product.category ?? '',
      brand: product.brand ?? '',
      department: product.department ?? '',
      cost: product.cost ?? undefined,
      barcode: product.sellingUnits?.find(su => su.isBase)?.barcode || product.barcode || '',
      additionalDescription: product.additionalDescription ?? '',
      incomeAccount: product.incomeAccount ?? '',
      expenseAccount: product.expenseAccount ?? '',
      warehouse: product.warehouse ?? '',
      shelfLocationIds: product.shelfLocationIds || [],
      subcategory: product.subcategory ?? '', // Handle null
      unitOfMeasure: product.unitOfMeasure ?? '', // Handle null
      conversionFactor: product.conversionFactor ?? 1, // Handle null/0 by defaulting to 1
      conversionFactors: product.conversionFactors || [],
      // The base unit is shown as a row in the Selling Units tab, but it is
      // not a `sellingUnits[]` entry in the submitted payload — its factor
      // stays 1 and its price/cost/barcode post through the top-level
      // fields above. Keeping it out of this field array also matters for
      // validation: updateProduct rejects any submitted unit whose name
      // matches the base unit name.
      sellingUnits: (product.sellingUnits || []).filter(su => !su.isBase),
      // The base unit's own price-level overrides come from its
      // `sellingUnits` entry (isBase: true), not from a top-level
      // `product.priceLevels` field — getProducts no longer returns one.
      priceLevels: product.sellingUnits?.find(su => su.isBase)?.priceLevels || [],
      vatStatus: product.vatStatus || 'YES (Subject to 12% VAT)',
      availability: product.availability || 'Available',
      earnsPoints: product.earnsPoints ?? true,
      isPerishable: product.isPerishable ?? false,
      description: product.description ?? '',
    },
  });

  const { fields: conversionFactorFields, append: appendConversionFactor, remove: removeConversionFactor } = useFieldArray({
    control: form.control,
    name: 'conversionFactors',
  });

  const { fields: sellingUnitFields, append: appendSellingUnit, remove: removeSellingUnit } = useFieldArray({
    control: form.control,
    name: 'sellingUnits',
  });

  const { fields: priceLevelFields, append: appendPriceLevel, remove: removePriceLevel, replace: replacePriceLevels } = useFieldArray({
    control: form.control,
    name: "priceLevels",
  });

  const selectedUnitOfMeasure = form.watch('unitOfMeasure');
  const costValue = form.watch('cost');
  const watchedCost = form.watch('cost');
  const watchedPrice = form.watch('price');
  const watchedCategoryName = form.watch('category');
  const watchedSubcategoryName = form.watch('subcategory');
  const watchedBrandName = form.watch('brand');
  const formErrors = form.formState.errors;
  // unitOfMeasure and cost are top-level fields the schema requires for every
  // item type, but which TAB renders them differs by product type: a Service
  // shows them on Inventory; a Standard product shows them inside the base
  // unit card on Selling Units instead (see inventory-tab.tsx / conversion-tab.tsx).
  // Routing both to 'inventory' unconditionally used to light up (or jump to)
  // a tab that, for a Standard product, doesn't even contain the field.
  const unitOrCostError = !!(formErrors.unitOfMeasure || formErrors.cost);
  const tabErrors = {
    basic: !!(formErrors.name || formErrors.brand || formErrors.description || formErrors.category),
    inventory: product.type === 'service' && unitOrCostError,
    // The base selling unit's price-level overrides bind to the top-level
    // `priceLevels` field (see product-schema.ts), but they render inside
    // the Selling Units tab, not a standalone one — fold their errors into
    // the same `conversion` flag extra units' sellingUnits[].priceLevels
    // errors already use, so the tab that actually shows the problem is the
    // one that lights up.
    conversion: !!(formErrors.conversionFactors || formErrors.sellingUnits || formErrors.priceLevels) || (product.type !== 'service' && unitOrCostError),
  };

  // State for selected price level (for automatic price calculation)
  const [selectedPriceLevelId, setSelectedPriceLevelId] = useState<string>('');

  // Remembers the value the cost→markup auto-fill effect last wrote to the
  // Retail price field, so it can tell its own write apart from the user's.
  // Reset whenever the form is reset for a (re)opened product below, so a
  // manual edit made while editing a previous product doesn't silently carry
  // into the next one. See that effect further down for the full explanation.
  const lastAutoRetailPrice = useRef<number | null>(null);
  const retailPriceEditedByUser = useRef(false);

  // Mirrors lastAutoRetailPrice/retailPriceEditedByUser above, but for the
  // base unit's Cost field being suggested from the primary supplier
  // mapping's own cost. Reset on the same product-open effect as those two,
  // so a manual edit on a previously-open product doesn't carry into the next.
  const lastAutoSuggestedCost = useRef<number | null>(null);
  const costEditedByUser = useRef(false);

  useEffect(() => {
    if (product && isOpen) {
      lastAutoRetailPrice.current = null;
      retailPriceEditedByUser.current = false;
      lastAutoSuggestedCost.current = null;
      costEditedByUser.current = false;
      const sanitizedProduct = {
          ...product,
          category: product.category ?? '',
          brand: product.brand ?? '',
          cost: product.cost ?? undefined,
          barcode: product.sellingUnits?.find(su => su.isBase)?.barcode || product.barcode || '',
          additionalDescription: product.additionalDescription ?? '',
          incomeAccount: product.incomeAccount ?? '',
          expenseAccount: product.expenseAccount ?? '',
          warehouse: product.warehouseId ?? product.warehouse ?? '',
          shelfLocationIds: product.shelfLocationIds || [],
          reorderPoint: product.reorderPoint ?? 0,
          subcategory: product.subcategory ?? '', // Handle null
          unitOfMeasure: product.unitOfMeasure ?? '', // Handle null
          conversionFactor: product.conversionFactor ?? 1, // Handle null/0 by defaulting to 1
          conversionFactors: product.conversionFactors || [],
          // See the defaultValues block above: the base unit is a permanent
          // display-only row here, not a `sellingUnits[]` entry.
          sellingUnits: (product.sellingUnits || []).filter(su => !su.isBase),
          priceLevels: seedDefaultPriceLevel(
            product.sellingUnits?.find(su => su.isBase)?.priceLevels || [],
            priceLevels,
            product.price,
          ),
          vatStatus: product.vatStatus || 'YES (Subject to 12% VAT)',
          availability: product.availability || 'Available',
          earnsPoints: product.earnsPoints ?? true,
          isPerishable: product.isPerishable ?? false,
          description: product.description ?? '',
          department: product.department ?? '',
      };
      console.log('Resetting form with:', sanitizedProduct);
      form.reset(sanitizedProduct);
    }
    // priceLevels (level definitions) is deliberately NOT a dependency here —
    // this effect's job is resetting the form for a newly opened product; if
    // level definitions arrive after that reset already ran, this session
    // just won't have the auto-seeded row (closing/reopening picks it up).
    // Depending on it would re-run form.reset (and wipe any in-progress edit
    // across every tab) any time productOptions happens to refresh elsewhere
    // while this dialog is open — a materially worse failure than a missed
    // seed on the rare cold-load race.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product, isOpen, form]);

  const refreshSupplierMappings = async () => {
    setIsLoadingSupplierMappings(true);
    try {
      setSupplierMappings(await getSupplierMappings(product.id));
    } finally {
      setIsLoadingSupplierMappings(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      refreshSupplierMappings();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, product.id]);

  const primarySupplierMapping = supplierMappings.find(m => m.isPrimary);

  const [markupSource, setMarkupSource] = useState<string | null>(null);

  // Track initial load to prevent overwriting existing prices
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    if (isOpen) {
        // Reset initialization state when dialog opens
        setIsInitialized(false);
        // Small timeout to allow form.reset to complete before allowing calculations
        const timer = setTimeout(() => setIsInitialized(true), 1000);
        return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // "There is no standalone price field — the default (Retail) price-level
  // row IS the product's price" only held at save time (saveChanges copied
  // priceLevels' Retail entry into `price` right before the DB write). The
  // form opens pre-populated with the saved product's real price, so this
  // usually goes unnoticed — but the schema's zodResolver validates the
  // form's CURRENT values before saveChanges is ever called, so editing
  // Retail price without this went stale: `price` kept the OLD saved value
  // while the user's new Retail entry sat unvalidated, and a mismatch there
  // could block a legitimate save. This mirrors Retail price into `price`
  // live, the moment it changes, so validation sees what saveChanges always
  // assumed it would.
  const watchedPriceLevels = form.watch('priceLevels');
  useEffect(() => {
    if (!isOpen || priceLevels.length === 0) return;
    const defaultLevel = priceLevels.find((l: any) => l.isDefault) || priceLevels[0];
    if (!defaultLevel) return;
    const retailEntry = (watchedPriceLevels || []).find((pl: any) => pl.levelId === defaultLevel.id);
    if (!retailEntry) return;
    const retailPrice = retailEntry.price ?? 0;
    if (form.getValues('price') !== retailPrice) {
      form.setValue('price', retailPrice, { shouldValidate: form.formState.isSubmitted });
    }
  }, [isOpen, priceLevels, watchedPriceLevels, form]);

  // The Supplier field is gone from the form — markup's supplier link now
  // comes from the primary supplier mapping (see refreshSupplierMappings /
  // primarySupplierMapping above), falling back to the read-only legacy
  // `product.supplier` (itself already primary_supplier_id || supplier_id,
  // resolved by getProducts) for a product with no mapping row yet.
  const markupSupplierId = primarySupplierMapping?.supplierId ?? product.supplier;

  useEffect(() => {
    // Skip if not initialized. A per-product markup is a deliberate entry
    // (not a guess from category/brand/supplier), so it must survive
    // enableAutomaticMarkup being off — that toggle governs only the
    // inherited sources below it.
    const hasOwnMarkup = product?.markupPercentage !== null && product?.markupPercentage !== undefined;
    if (!isInitialized || (!systemSettings?.enableAutomaticMarkup && !hasOwnMarkup)) {
        setMarkupSource(null);
        return;
    }

    const { markup, source } = calculateMarkupPercentage(
        {
            markupPercentage: product?.markupPercentage ?? null,
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
  }, [watchedCost, watchedCategoryName, watchedSubcategoryName, watchedBrandName, markupSupplierId, categories, subcategories, brands, suppliers, form, priceLevels, systemSettings, isInitialized, priceLevelFields]);

  const [costSuggestionSource, setCostSuggestionSource] = useState<string | null>(null);

  useEffect(() => {
    if (!isInitialized || !primarySupplierMapping || primarySupplierMapping.supplierCost == null) {
      setCostSuggestionSource(null);
      return;
    }
    if (costEditedByUser.current) {
      // User already overrode a previous suggestion this session — respect
      // that for the rest of it, same contract as retailPriceEditedByUser.
      return;
    }

    const suggested = primarySupplierMapping.supplierCost;
    const currentValue = form.getValues('cost');
    // A mismatch against what this effect itself wrote last means the user
    // changed it in between — respect that and stop suggesting.
    if (lastAutoSuggestedCost.current !== null && currentValue !== lastAutoSuggestedCost.current) {
      costEditedByUser.current = true;
      return;
    }

    form.setValue('cost', suggested);
    lastAutoSuggestedCost.current = suggested;
    setCostSuggestionSource(`Suggested from ${primarySupplierMapping.supplierName || 'the primary supplier'}'s cost`);
  }, [isInitialized, primarySupplierMapping, form]);

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

  const generateBarcode = (
    fieldPath: 'barcode' | `sellingUnits.${number}.barcode` = 'barcode',
  ) => {
    // EAN-8: 7 random digits + 1 check digit
    const digits = Array.from({ length: 7 }, () => Math.floor(Math.random() * 10));
    const sum = digits.reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
    const check = (10 - (sum % 10)) % 10;
    form.setValue(fieldPath, [...digits, check].join(''));
  };

  const saveChanges = async (values: ProductFormValues) => {
    console.log('EditProductDialog saveChanges called with values:', values);
    // Filter out conversion factors with empty units to avoid schema validation errors
    values.conversionFactors = values.conversionFactors?.filter(cf => cf.unit.trim() !== '') || [];
    // There is no standalone "price" field any more — the default (Retail)
    // price-level row IS the product's price. products.price stays in the
    // schema/backend (it's the fallback price when a selling unit has no
    // override for the active level); it just mirrors the Retail row now.
    const defaultLevelDef = priceLevels.find((l: any) => l.isDefault) || priceLevels[0];
    const retailEntry = (values.priceLevels || []).find((pl) => pl.levelId === defaultLevelDef?.id);
    if (retailEntry?.price !== undefined) {
      values.price = retailEntry.price;
    }
    // The per-unit price-level sub-table (conversion-tab.tsx) never stores an
    // entry with a blank price — a blank input splices the row out entirely,
    // so `price` is always a concrete number by the time it lands here. This
    // narrows the type to match actions.ts's SellingUnitInput, which expects
    // exactly that. Same story as the product-level Retail derivation above:
    // no standalone Price field per extra unit any more — each unit's own
    // Retail price-level entry IS that unit's price.
    const sellingUnitsForSubmit = values.sellingUnits?.map(unit => {
      const unitPriceLevels = (unit.priceLevels || []).filter(
        (pl): pl is { levelId: string; price: number; minQuantity?: number } => pl.price !== undefined,
      );
      const unitRetailEntry = unitPriceLevels.find((pl) => pl.levelId === defaultLevelDef?.id);
      return {
        ...unit,
        price: unitRetailEntry?.price ?? unit.price ?? 0,
        priceLevels: unitPriceLevels,
      };
    });
    try {
      setIsSubmitting(true);

      const result = await updateProduct(product.id, { ...values, sellingUnits: sellingUnitsForSubmit });

      console.log('updateProduct result:', result);

      // MOCK API CAILL
      // console.log('API Disabled: Mock Save Success');
      // const result = { success: true, message: 'Mock saved successfully' };

      if (result.success) {
        await logActivity({
          action: 'UPDATE',
          module: 'PRODUCTS',
          description: `Updated product: ${values.name || product.name} (Barcode: ${values.barcode || product.sellingUnits?.find(su => su.isBase)?.barcode || product.barcode})`,
          referenceId: String(product.id),
        });
        toast({
          title: 'Product Updated',
          description: result.message,
        });
        onProductUpdated?.();
        dispatchStockUpdate();
        setIsOpen(false);
      } else {
        toast({
          variant: 'destructive',
          title: 'Error Updating Product',
          description: result.message,
        });
      }
    } catch (error) {
      console.error('Error in EditProductDialog:', error);
      toast({
        variant: 'destructive',
        title: 'Error Updating Product',
        description: 'An unexpected error occurred. Check console for details.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Refresh callbacks wired to the "Manage …" dialogs.
  const refreshBrands = () => getBrands().then(setBrands);
  const refreshDepartments = () => getDepartments().then(setDepartments);
  const refreshCategories = () => getCategories().then(setCategories);
  const refreshSubcategories = () => getSubcategories().then(setSubcategories);
  const refreshSuppliers = () => getSuppliers().then(setSuppliers);
  const refreshWarehouses = () => getWarehouses().then(setWarehouses);
  const refreshShelfLocations = () => getShelfLocations().then(setShelfLocations);
  const refreshUnits = () => getUnitsOfMeasure().then(setUnits);

  return {
    // the product being edited (read-only stock display, etc.)
    product,

    // dialog + submit state
    isOpen, setIsOpen,
    isSubmitting,
    form,

    // option data + loading flags
    brands,
    categories,
    subcategories,
    units,
    suppliers,
    supplierMappings, isLoadingSupplierMappings, refreshSupplierMappings, primarySupplierMapping,
    warehouses,
    shelfLocations, isLoadingShelfLocations,
    priceLevels, isLoadingPriceLevels,
    departments, isLoadingDepartments,
    taxRates,
    systemSettings,

    // nested popover/select open state
    selects, setSelects,

    // field arrays
    conversionFactorFields, appendConversionFactor, removeConversionFactor,
    sellingUnitFields, appendSellingUnit, removeSellingUnit,
    priceLevelFields, appendPriceLevel, removePriceLevel, replacePriceLevels,

    // watched / derived values
    selectedUnitOfMeasure,
    tabErrors,
    selectedPriceLevelId, setSelectedPriceLevelId,
    markupSource,
    costSuggestionSource,

    // handlers
    generateBarcode,
    saveChanges,
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

export type EditProductFormController = ReturnType<typeof useEditProductForm>;
