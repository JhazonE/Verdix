export type TaxType = 'VAT' | 'NON_VAT' | 'ZERO_RATED' | 'VAT_EXEMPT';

const STATUTORY_VAT_EXEMPT_DISCOUNTS = new Set(['senior', 'pwd', 'naac', 'solo_parent']);

/**
 * RA 9994 (Senior Citizens), RA 10754 (PWD), RA 10699 (NAAC) and RA 11861 (Solo Parents)
 * exempt the qualifying purchase from VAT, not just discount it — the statutory discount
 * must be computed on the VAT-exclusive price. A line carrying one of these discount types
 * is therefore always VAT_EXEMPT for tax purposes, overriding the product's own tax setup.
 */
export function resolveEffectiveTaxType(baseTaxType: TaxType, discountType?: string, discount?: number): TaxType {
  if (discountType && STATUTORY_VAT_EXEMPT_DISCOUNTS.has(discountType) && (discount || 0) > 0) {
    return 'VAT_EXEMPT';
  }
  return baseTaxType;
}
