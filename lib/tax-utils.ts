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
 * A non-VAT-registered establishment has no authority to charge output VAT, so no line it
 * sells can be VAT-able no matter how the product itself is configured. `vat_registration`
 * in `pos_settings` used to drive only the printed "NON-VAT REG TIN" header label while
 * every computation still back-computed 12% out of the price; this is the gate that makes
 * the setting mean what it says. Products set to ZERO_RATED or VAT_EXEMPT keep that
 * classification — those are distinct BIR buckets and collapsing them into NON_VAT would
 * misreport the breakdown — only VAT becomes NON_VAT.
 */
export function applyRegistrationToTaxType(taxType: TaxType, vatRegistration?: string): TaxType {
  if (vatRegistration === 'NON_VAT' && taxType === 'VAT') return 'NON_VAT';
  return taxType;
}

/**
 * RA 9994 (Senior Citizens), RA 10754 (PWD), RA 10699 (NAAC) and RA 11861 (Solo Parents)
 * exempt the qualifying purchase from VAT, not just discount it — the statutory discount
 * must be computed on the VAT-exclusive price. A line carrying one of these discount types
 * is therefore always VAT_EXEMPT for tax purposes, overriding the product's own tax setup.
 *
 * `vatRegistration` is applied last: a statutory discount at a non-VAT store still lands on
 * VAT_EXEMPT (the discount is what exempts it, and that is the bucket BIR wants it in),
 * while an ordinary line falls through to NON_VAT.
 */
export function resolveEffectiveTaxType(
  baseTaxType: TaxType,
  discountType?: string,
  discount?: number,
  vatRegistration?: string,
): TaxType {
  if (discountType && STATUTORY_VAT_EXEMPT_DISCOUNTS.has(discountType) && (discount || 0) > 0) {
    return 'VAT_EXEMPT';
  }
  return applyRegistrationToTaxType(baseTaxType, vatRegistration);
}
