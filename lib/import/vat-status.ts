import { mapVatStatusToTaxType, type TaxType } from '@/lib/tax-utils';

export interface ImportTaxRate {
  name: string;
  isDefault?: boolean;
}

export type VatResolution =
  | { ok: true; name: string }
  | { ok: false; reason: string };

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/[\s_-]+/g, ' ');

/**
 * Short spellings a spreadsheet author would plausibly type, each pinned to one
 * BIR tax type. Deliberately a closed list: `mapVatStatusToTaxType` answers
 * "VAT" for any string it does not recognise, so feeding it a typo would
 * silently classify the product as VATable. An unrecognised cell must be
 * rejected instead — a wrong tax type is a filed-receipt error, not a cosmetic one.
 */
const ALIASES: Record<string, TaxType> = {
  'vat': 'VAT', 'vatable': 'VAT', 'yes': 'VAT', 'y': 'VAT', 'taxable': 'VAT', '12%': 'VAT',
  'non vat': 'NON_VAT', 'nonvat': 'NON_VAT', 'no': 'NON_VAT', 'n': 'NON_VAT', 'no vat': 'NON_VAT',
  'vat exempt': 'VAT_EXEMPT', 'exempt': 'VAT_EXEMPT', 'vat exempted': 'VAT_EXEMPT',
  'zero rated': 'ZERO_RATED', 'zero': 'ZERO_RATED', '0%': 'ZERO_RATED',
};

/**
 * Resolve a spreadsheet's VAT Status cell to the name of a configured tax rate.
 *
 * `products.vat_status` is free text that is matched back against `tax_rates`
 * names, so the stored value must be one of those names verbatim. Order:
 *   1. exact tax-rate name (case/spacing-insensitive)
 *   2. a known short alias, mapped to the tax rate of the same BIR type
 * Anything else is an error the caller reports against the row.
 */
export function resolveVatStatus(raw: unknown, rates: ImportTaxRate[]): VatResolution {
  const text = String(raw ?? '').trim();
  if (!text) return { ok: false, reason: 'Empty VAT status' };

  const wanted = norm(text);
  const exact = rates.find((r) => norm(r.name) === wanted);
  if (exact) return { ok: true, name: exact.name };

  const type = ALIASES[wanted];
  if (type) {
    const candidates = rates.filter((r) => mapVatStatusToTaxType(r.name) === type);
    const pick = candidates.find((r) => r.isDefault) ?? candidates[0];
    if (pick) return { ok: true, name: pick.name };
  }

  const known = rates.map((r) => `"${r.name}"`).join(', ');
  return {
    ok: false,
    reason: `Unknown VAT status "${text}"${known ? ` — use one of: ${known}` : ''}`,
  };
}
