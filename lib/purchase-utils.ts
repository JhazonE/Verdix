/**
 * Utility functions for purchase order cost calculations, 
 * including Landed Cost distribution.
 */
import { toSafeNumber } from './utils';
import { applyPriceLevelAdjustment } from './price-level-calc';

export interface PurchaseItem {
  productId: string;
  productName: string;
  quantity: number;
  cost: number;
  discount?: number;
  discountType?: 'amount' | 'percentage';
  vatSubject?: boolean;
}

export interface CalculatedPurchaseDetails {
  subtotal: number;
  vatAmount: number;
  shippingFee: number;
  grandTotal: number;
  items: Array<PurchaseItem & {
    lineTotal: number;
    landedCostPerUnit: number;
    landedCostTotal: number;
    shippingAllocation: number;
  }>;
}

/**
 * Calculates total costs and distributes shipping fee across items (Landed Cost).
 * 
 * @param items List of purchase items
 * @param shippingFee Total shipping fee for the order
 * @param taxRate VAT rate (e.g., 12 for 12%). VAT is assumed to be INCLUSIVE if vatSubject is true.
 * @param allocationStrategy Strategy for distributing shipping costs: 
 *                           'equal' (per line) or 'proportional' (by value/subtotal)
 */
export function calculatePurchaseCosts(
  items: PurchaseItem[],
  shippingFee: number | string = 0,
  taxRate: number | string = 12,
  allocationStrategy: 'equal' | 'proportional' = 'equal'
): CalculatedPurchaseDetails {
  let subtotal = 0;
  let totalVat = 0;

  const numericShippingFee = toSafeNumber(shippingFee);
  const numericTaxRate = toSafeNumber(taxRate);

  // 1. Calculate line totals and base order subtotal
  const processedItems = items.map(item => {
    const cost = toSafeNumber(item.cost);
    const quantity = toSafeNumber(item.quantity);
    const discount = toSafeNumber(item.discount);
    const discountType = item.discountType || 'amount';
    const isVatSubject = item.vatSubject || false;

    let lineTotal = cost * quantity;
    if (discountType === 'percentage') {
      lineTotal = lineTotal - (lineTotal * (discount / 100));
    } else {
      lineTotal = lineTotal - discount;
    }

    subtotal += lineTotal;

    if (isVatSubject) {
      // Inclusive VAT calculation: Total * (Rate / (100 + Rate))
      totalVat += lineTotal * (numericTaxRate / (100 + numericTaxRate));
    }

    return {
      ...item,
      cost,
      quantity,
      discount,
      lineTotal,
    };
  });

  const grandTotal = subtotal + numericShippingFee;

  // 2. Distribute shipping fee across items (Landed Cost Calculation)
  const numLines = items.length;
  
  const itemsWithLandedCost = processedItems.map(item => {
    let shippingAllocation = 0;

    if (numericShippingFee > 0) {
      if (allocationStrategy === 'proportional' && subtotal > 0) {
        // Allocation method: Proportional to line total / subtotal
        shippingAllocation = (item.lineTotal / subtotal) * numericShippingFee;
      } else {
        // Allocation method: Divided equally by the number of item lines (not total quantity).
        shippingAllocation = numLines > 0 ? numericShippingFee / numLines : 0;
      }
    }

    const landedCostTotal = item.lineTotal + shippingAllocation;
    const landedCostPerUnit = item.quantity > 0 ? landedCostTotal / item.quantity : 0;

    return {
      ...item,
      shippingAllocation,
      landedCostTotal,
      landedCostPerUnit,
    };
  });

  return {
    subtotal,
    vatAmount: totalVat,
    shippingFee: numericShippingFee,
    grandTotal,
    items: itemsWithLandedCost,
  };
}

/**
 * Calculates the markup percentage for a product based on system settings and priority rules.
 */
export function calculateMarkupPercentage(
  product: { category?: string; subcategory?: string; brand?: string; supplierId?: string },
  settings: any,
  categories: any[] = [],
  subcategories: any[] = [],
  brands: any[] = [],
  suppliers: any[] = []
): { markup: number; source: string } {
  if (!settings?.enableAutomaticMarkup) {
    return { markup: 0, source: '' };
  }

  const clean = (val: any) => String(val || '').trim().toLowerCase();
  
  const productCat = clean(product.category);
  const productSub = clean(product.subcategory);
  const productBrand = clean(product.brand);

  const category = categories.find(c => c.id === product.category || clean(c.name) === productCat);
  const subcategory = subcategories.find(s => s.id === product.subcategory || clean(s.name) === productSub);
  const brand = brands.find(b => b.id === product.brand || clean(b.name) === productBrand);
  
  const supplierId = product.supplierId || (product as any).supplier_id || (product as any).supplier;
  const supplier = suppliers.find(s => s.id === supplierId);

  // Parse markupPriority if it's a string (from DB)
  let priority: string[] = ["subcategory", "category", "brand", "supplier"];
  if (settings.markupPriority) {
    if (typeof settings.markupPriority === 'string') {
      try {
        priority = JSON.parse(settings.markupPriority);
      } catch (e) {
        console.error('Failed to parse markupPriority:', e);
      }
    } else if (Array.isArray(settings.markupPriority)) {
      priority = settings.markupPriority;
    }
  }

  let markup = 0;
  let source = '';

  for (const type of priority) {
    if (type === 'subcategory' && subcategory && subcategory.markupPercentage) {
      markup = Number(subcategory.markupPercentage);
      if (markup > 0) {
        source = 'Subcategory';
        break;
      }
    }
    else if (type === 'category' && category && category.markupPercentage) {
      markup = Number(category.markupPercentage);
      if (markup > 0) {
        source = 'Category';
        break;
      }
    }
    else if (type === 'brand' && brand && brand.markupPercentage) {
      markup = Number(brand.markupPercentage);
      if (markup > 0) {
        source = 'Brand';
        break;
      }
    }
    else if (type === 'supplier' && supplier && supplier.markupPercentage) {
      markup = Number(supplier.markupPercentage);
      if (markup > 0) {
        source = 'Supplier';
        break;
      }
    }
  }

  // Fallback to global default if no specific markup found
  const globalDefault = settings.defaultMarkupPercentage !== undefined ? Number(settings.defaultMarkupPercentage) : undefined;
  if (!source && globalDefault !== undefined) {
    markup = globalDefault;
    source = 'Global Default';
  }

  return { markup, source };
}

/**
 * Calculates the suggested selling price based on item cost, markup, and shipping.
 */
export function calculateSuggestedPrice(
  unitCost: number,
  markupPercentage: number,
  shippingPerUnit: number = 0,
  priceLevel?: any // Default level from system
): number {
  // Formula: (Cost * (1 + Markup%)) + Shipping
  // This ensures markup is ONLY applied to the base cost, not the shipping.
  const baseRetailPrice = (toSafeNumber(unitCost) * (1 + (toSafeNumber(markupPercentage)) / 100)) + toSafeNumber(shippingPerUnit);
  const landedCost = toSafeNumber(unitCost) + toSafeNumber(shippingPerUnit);
  
  if (priceLevel) {
    const adjustmentType = priceLevel.adjustmentType === 'fixed' ? 'fixed' : 'percentage';
    const value = toSafeNumber(priceLevel.percentageAdjustment);
    const base = priceLevel.calculationBase || 'retail';
    const resolvedBase = base === 'cost' ? landedCost : baseRetailPrice;

    if (adjustmentType === 'fixed') {
      return applyPriceLevelAdjustment('fixed', value, resolvedBase);
    }
    if (value !== 0) {
      return applyPriceLevelAdjustment('percentage', value, resolvedBase);
    }
  }

  return baseRetailPrice;
}
