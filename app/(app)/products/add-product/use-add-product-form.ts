'use client';

import { useState, useEffect } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import { calculateMarkupPercentage, calculateSuggestedPrice } from '@/lib/purchase-utils';
import { dispatchStockUpdate } from '@/hooks/use-live-refresh';
import { logActivity } from '@/lib/client-activity-logger';
import { useToast } from '@/hooks/use-toast';
import { getApiUrl } from '@/lib/api-config';
import { Category, Brand, UnitOfMeasure, Supplier, TaxRate, SystemSettings } from '@/lib/types';
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

  return basePrice * (1 + level.percentageAdjustment / 100);
}

export interface UseAddProductFormProps {
  onProductAdded?: () => void;
  productOptions?: any;
  onOptionsRefresh?: () => void;
}

export function useAddProductForm({
  onProductAdded,
  productOptions: externalProductOptions,
  onOptionsRefresh,
}: UseAddProductFormProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [productType, setProductType] = useState<'parent' | 'child'>('parent');
  // Standard vs Service. Distinct from `productType` above, which is the
  // parent/child family selector.
  const [itemType, setItemType] = useState<ProductType>('standard');
  const [autoCreateChild, setAutoCreateChild] = useState(true);
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
      supplier: '',
      warehouse: '',
      shelfLocationIds: [],
      unitOfMeasure: '',
      stock: 0,
      reorderPoint: 0,
      price: 0,
      cost: 0,
      sku: '',
      barcode: '',
      conversionFactor: 1,
      conversionFactors: [],
      priceLevels: [],
      earnsPoints: true,
      isPerishable: false,
    },
  });

  const { fields: conversionFactorFields, append: appendConversionFactor, remove: removeConversionFactor } = useFieldArray({
    control: form.control,
    name: "conversionFactors",
  });

  const { fields: priceLevelFields, append: appendPriceLevel, remove: removePriceLevel } = useFieldArray({
    control: form.control,
    name: "priceLevels",
  });

  const selectedUnitOfMeasure = form.watch('unitOfMeasure');
  const watchedPrice = form.watch('price');
  const formErrors = form.formState.errors;
  const tabErrors = {
    basic: !!(formErrors.name || formErrors.brand || formErrors.sku || formErrors.description || formErrors.category),
    inventory: !!(formErrors.unitOfMeasure || formErrors.stock),
    priceLevels: !!(formErrors.priceLevels),
    conversion: !!(formErrors.conversionFactors),
  };

  // State for selected price level (for automatic price calculation)
  const [selectedPriceLevelId, setSelectedPriceLevelId] = useState<string>('');

  // Use pre-loaded data from parent when available
  useEffect(() => {
    if (externalProductOptions) {
      setCategories(externalProductOptions.categories || []);
      setSubcategories(externalProductOptions.subcategories || []);
      setBrands(externalProductOptions.brands || []);
      setUnitsOfMeasure(externalProductOptions.units || []);
      setSuppliers(externalProductOptions.suppliers || []);
      setWarehouses(externalProductOptions.warehouses || []);
      setShelfLocations(externalProductOptions.shelfLocations || []);
      setDepartments(externalProductOptions.departments || []);
      setPriceLevels(externalProductOptions.priceLevels || []);
      setTaxRates(externalProductOptions.taxRates || []);

      // Initialize default price level if form is empty
      const systemPriceLevels = externalProductOptions.priceLevels || [];
      const currentPriceLevels = form.getValues('priceLevels') || [];

      if (currentPriceLevels.length === 0 && systemPriceLevels.length > 0) {
          // Find default level or take first
          const defaultLevel = systemPriceLevels.find((l:any) => l.isDefault) || systemPriceLevels[0];
          if (defaultLevel) {
              appendPriceLevel({ levelId: defaultLevel.id, price: 0 });
          }
      }

    }
  }, [externalProductOptions, form, appendPriceLevel]); // Added appendPriceLevel dep

  useEffect(() => {
    if (isOpen) {
      form.reset();

      // Set default tax rate if available and valid
      if (taxRates.length > 0) {
        const defaultTax = taxRates.find(t => t.isDefault) || taxRates[0];
        form.setValue('vatStatus', defaultTax.name);
      }

      setProductType('parent');
      setAutoCreateChild(true);
    }
  }, [isOpen, form]);

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
      form.setValue('supplier', undefined);
      form.setValue('warehouse', undefined);
      form.setValue('shelfLocationIds', undefined);
      form.setValue('parentId', undefined);
      form.setValue('conversionFactor', undefined);
      form.setValue('conversionFactors', undefined);
      form.setValue('isPerishable', undefined);
    }
  }, [itemType, form]);

  const watchedCost = form.watch('cost');
  const watchedCategoryName = form.watch('category');
  const watchedSubcategoryName = form.watch('subcategory');
  const watchedBrandName = form.watch('brand');
  const watchedSupplierId = form.watch('supplier');
  const [markupSource, setMarkupSource] = useState<string | null>(null);

  useEffect(() => {
    if (!systemSettings?.enableAutomaticMarkup) {
        setMarkupSource(null);
        return;
    }

    const { markup, source } = calculateMarkupPercentage(
        {
            category: watchedCategoryName,
            subcategory: watchedSubcategoryName,
            brand: watchedBrandName,
            supplierId: watchedSupplierId
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

  }, [watchedCost, watchedCategoryName, watchedSubcategoryName, watchedBrandName, watchedSupplierId, categories, subcategories, brands, suppliers, form, priceLevels, systemSettings]);

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

      const level = priceLevels.find(l => l.id === pl.levelId);
      if (!level) return;

      const newPrice = calculatePriceLevelPrice(
        pl.levelId,
        level.calculationBase || 'retail',
        priceLevels,
        watchedPrice || 0,
        watchedCost || 0
      );
      form.setValue(`priceLevels.${idx}.price`, parseFloat(newPrice.toFixed(2)));
    });
  }, [watchedPrice, watchedCost, priceLevels, form]);

  async function onSubmit(values: ProductFormValues) {
    setIsSubmitting(true);

    try {
      const uid = getCurrentUid();

      // Build the auto-child intent (if applicable) so a single approval covers parent + child.
      let childProduct: any = undefined;
      const willAutoChild =
        itemType === 'standard' &&
        productType === 'parent' &&
        autoCreateChild &&
        values.conversionFactors &&
        values.conversionFactors.length > 0;

      if (willAutoChild) {
        const firstConversion = values.conversionFactors![0];
        const childPrice = values.price / firstConversion.factor;
        const childCost = values.cost ? values.cost / firstConversion.factor : undefined;
        childProduct = {
          name: `${values.name} (${firstConversion.unit})`,
          brand: values.brand,
          sku: `${values.sku}-${firstConversion.unit.toLowerCase().replace(/\s+/g, '')}`,
          barcode: values.barcode ? `${values.barcode}-${firstConversion.unit.toLowerCase()}` : undefined,
          description: `${values.description} - ${firstConversion.unit}`,
          additionalDescription: values.additionalDescription,
          category: values.category,
          subcategory: values.subcategory,
          supplier: values.supplier,
          unitOfMeasure: firstConversion.unit,
          stock: 0,
          reorderPoint: 0,
          price: childPrice,
          cost: childCost,
          conversionFactor: firstConversion.factor,
          image: `https://picsum.photos/seed/${values.sku}-${firstConversion.unit}/400/300`,
        };
      }

      const result = await addProduct(
        {
          ...values,
          itemType,
          image: `https://picsum.photos/seed/${values.sku}/400/300`,
          ...(childProduct ? { __childProduct: childProduct } : {}),
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
        // Immediate insert path — create child directly if approval is off.
        if (willAutoChild && result.productId) {
          const childResult = await addProduct(
            { ...childProduct, parentId: result.productId } as any,
            uid,
          );
          if (!childResult.success) {
            console.warn('Failed to auto-create child product:', childResult.message);
          }
        }

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
          description: `${values.name} has been successfully added.${willAutoChild ? ' Child unit auto-created.' : ''}`,
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

  const generateBarcode = () => {
    // EAN-8: 7 random digits + 1 check digit
    const digits = Array.from({ length: 7 }, () => Math.floor(Math.random() * 10));
    const sum = digits.reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
    const check = (10 - (sum % 10)) % 10;
    form.setValue('barcode', [...digits, check].join(''));
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
    autoCreateChild, setAutoCreateChild,
    form,

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
    priceLevelFields, appendPriceLevel, removePriceLevel,

    // derived values
    selectedUnitOfMeasure,
    tabErrors,
    selectedPriceLevelId, setSelectedPriceLevelId,
    markupSource,

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
