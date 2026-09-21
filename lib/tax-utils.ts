export type TaxType = 'VAT' | 'NON_VAT' | 'ZERO_RATED' | 'VAT_EXEMPT';

const STATUTORY_VAT_EXEMPT_DISCOUNTS = new Set(['senior', 'pwd', 'naac', 'solo_parent']);

/** Classifies a product's free-text `vat_status` into the four BIR tax types. */
export function mapVatStatusToTaxType(vatStatus?: string): TaxType {
  if (!vatStatus) return 'VAT';
  const status = vatStatus.toUpperCase();
  if (status.includes('SUBJECT TO 12% VAT') || status.includes('YES')) return 'VAT';
  if (status.includes('EXEMPT')) return 'VAT_EXEMPT';
  if (status.includes('ZERO RATED') || status.includes('ZERO-RATED') || status.includes('0%')) return 'ZERO_RATED';
  if (status.includes('NON-VAT') || status.includes('NON VAT') || status.includes('NO VAT')) return 'NON_VAT';
  if (status.startsWith('NO') || status.startsWith('NON')) return 'NON_VAT';
  return 'VAT';
}

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
