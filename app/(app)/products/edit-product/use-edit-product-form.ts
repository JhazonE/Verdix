'use client';

import { useState, useEffect } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import { calculateMarkupPercentage, calculateSuggestedPrice } from '@/lib/purchase-utils';
import { dispatchStockUpdate } from '@/hooks/use-live-refresh';
import { logActivity } from '@/lib/client-activity-logger';
import { useToast } from '@/hooks/use-toast';
import { getApiUrl } from '@/lib/api-config';
import { Category, Product, Brand, UnitOfMeasure, Supplier, TaxRate, SystemSettings } from '@/lib/types';

import {
  updateProduct,
  getBrands,
  getCategories,
  getSubcategories,
  getUnitsOfMeasure,
  getSuppliers,
  getWarehouses,
  getShelfLocations,
  getDepartments,
} from '../actions';
import { productSchema, type ProductFormValues } from './product-schema';

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

  return basePrice * (1 + level.percentageAdjustment / 100);
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
    resolver: zodResolver(productSchema),
    defaultValues: {
      ...product,
      category: product.category ?? '',
      brand: product.brand ?? '',
      department: product.department ?? '',
      cost: product.cost ?? 0,
      barcode: product.barcode ?? '',
      additionalDescription: product.additionalDescription ?? '',
      incomeAccount: product.incomeAccount ?? '',
      expenseAccount: product.expenseAccount ?? '',
      warehouse: product.warehouse ?? '',
      shelfLocationIds: product.shelfLocationIds || [],
      subcategory: product.subcategory ?? '', // Handle null
      supplier: product.supplier ?? '', // Handle null
      unitOfMeasure: product.unitOfMeasure ?? '', // Handle null
      conversionFactor: product.conversionFactor ?? 1, // Handle null/0 by defaulting to 1
      conversionFactors: product.conversionFactors || [],
      priceLevels: product.priceLevels || [],
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

  const { fields: priceLevelFields, append: appendPriceLevel, remove: removePriceLevel } = useFieldArray({
    control: form.control,
    name: "priceLevels",
  });

  const selectedSupplierId = form.watch('supplier');
  const selectedUnitOfMeasure = form.watch('unitOfMeasure');
  const costValue = form.watch('cost');
  const watchedCost = form.watch('cost');
  const watchedPrice = form.watch('price');
  const watchedCategoryName = form.watch('category');
  const watchedSubcategoryName = form.watch('subcategory');
  const watchedBrandName = form.watch('brand');
  const formErrors = form.formState.errors;
  const tabErrors = {
    basic: !!(formErrors.name || formErrors.brand || formErrors.sku || formErrors.description || formErrors.category),
    inventory: !!(formErrors.unitOfMeasure),
    priceLevels: !!(formErrors.priceLevels),
    conversion: !!(formErrors.conversionFactors),
  };

  // State for selected price level (for automatic price calculation)
  const [selectedPriceLevelId, setSelectedPriceLevelId] = useState<string>('');

  useEffect(() => {
    if (product && isOpen) {
      const sanitizedProduct = {
          ...product,
          category: product.category ?? '',
          brand: product.brand ?? '',
          cost: product.cost ?? 0,
          barcode: product.barcode ?? '',
          additionalDescription: product.additionalDescription ?? '',
          incomeAccount: product.incomeAccount ?? '',
          expenseAccount: product.expenseAccount ?? '',
          warehouse: product.warehouseId ?? product.warehouse ?? '',
          shelfLocationIds: product.shelfLocationIds || [],
          reorderPoint: product.reorderPoint ?? 0,
          subcategory: product.subcategory ?? '', // Handle null
          supplier: product.supplier ?? '', // Handle null
          unitOfMeasure: product.unitOfMeasure ?? '', // Handle null
          conversionFactor: product.conversionFactor ?? 1, // Handle null/0 by defaulting to 1
          conversionFactors: product.conversionFactors || [],
          priceLevels: product.priceLevels || [],
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
  }, [product, isOpen, form]);

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

  useEffect(() => {
    // Skip if not initialized or automation disabled
    if (!isInitialized || !systemSettings?.enableAutomaticMarkup) {
        setMarkupSource(null);
        return;
    }

    const { markup, source } = calculateMarkupPercentage(
        {
            category: watchedCategoryName,
            subcategory: watchedSubcategoryName,
            brand: watchedBrandName,
            supplierId: selectedSupplierId
        },
        systemSettings,
        categories,
        subcategories,
        brands,
        suppliers
    );

    if (source) {
      setMarkupSource(`Calculated from ${source} Markup (${markup}%)`);
      if (watchedCost && watchedCost > 0) {
          // Calculate base price and default level price
          const defaultLevel = priceLevels.find((l: any) => l.isDefault) || priceLevels[0];
          const suggestedMainPrice = calculateSuggestedPrice(watchedCost, markup, 0, defaultLevel);

          form.setValue('price', parseFloat(suggestedMainPrice.toFixed(2)));

          // Apply to all price levels
          if (priceLevels.length > 0) {
              const currentFields = form.getValues('priceLevels') || [];
              const getFieldIndex = (levelId: string) => currentFields.findIndex((f: any) => f.levelId === levelId);

              priceLevels.forEach((level: any) => {
                  const levelPrice = calculateSuggestedPrice(watchedCost, markup, 0, level);
                  const index = getFieldIndex(level.id);
                  if (index >= 0) {
                      form.setValue(`priceLevels.${index}.price`, parseFloat(levelPrice.toFixed(2)));
                  }
              });
          }
      }
    } else {
      setMarkupSource(null);
    }
  }, [watchedCost, watchedCategoryName, watchedSubcategoryName, watchedBrandName, selectedSupplierId, categories, subcategories, brands, suppliers, form, priceLevels, systemSettings, isInitialized]);

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

          // Calculate price based on selected level
          let finalPrice;
          const selectedLevelMarkup = selectedLevel.percentageAdjustment ?? 0;
          if (selectedLevel.calculationBase === 'cost') {
             finalPrice = cost * (1 + selectedLevelMarkup / 100);
          } else {
             // Retail Base
             if (selectedLevelMarkup === 0 && selectedLevel.name?.toLowerCase() === 'retail') {
                 finalPrice = basePrice;
             } else {
                 finalPrice = basePrice * (1 + selectedLevelMarkup / 100);
             }
          }

          form.setValue('price', parseFloat(finalPrice.toFixed(2)));

          // ALSO update all price level fields automatically
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

  // Recalculate all price level rows when base price or cost changes
  useEffect(() => {
    const allPriceLevels = form.getValues('priceLevels');
    if (!allPriceLevels || allPriceLevels.length === 0) return;

    allPriceLevels.forEach((pl, idx) => {
      if (!pl.levelId) return; // Skip rows without a selected level

      const newPrice = calculatePriceLevelPrice(
        pl.levelId,
        pl.calculationBase || 'retail',
        priceLevels,
        watchedPrice || 0,
        watchedCost || 0
      );
      form.setValue(`priceLevels.${idx}.price`, newPrice);
    });
  }, [watchedPrice, watchedCost, priceLevels, form]);

  const generateBarcode = () => {
    // EAN-8: 7 random digits + 1 check digit
    const digits = Array.from({ length: 7 }, () => Math.floor(Math.random() * 10));
    const sum = digits.reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
    const check = (10 - (sum % 10)) % 10;
    form.setValue('barcode', [...digits, check].join(''));
  };

  const saveChanges = async (values: ProductFormValues) => {
    console.log('EditProductDialog saveChanges called with values:', values);
    // Filter out conversion factors with empty units to avoid schema validation errors
    values.conversionFactors = values.conversionFactors?.filter(cf => cf.unit.trim() !== '') || [];
    try {
      setIsSubmitting(true);

      const result = await updateProduct(product.id, values);

      console.log('updateProduct result:', result);

      // MOCK API CAILL
      // console.log('API Disabled: Mock Save Success');
      // const result = { success: true, message: 'Mock saved successfully' };

      if (result.success) {
        await logActivity({
          action: 'UPDATE',
          module: 'PRODUCTS',
          description: `Updated product: ${values.name || product.name} (SKU: ${values.sku || product.sku})`,
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
    priceLevelFields, appendPriceLevel, removePriceLevel,

    // watched / derived values
    selectedSupplierId,
    selectedUnitOfMeasure,
    tabErrors,
    selectedPriceLevelId, setSelectedPriceLevelId,
    markupSource,

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
