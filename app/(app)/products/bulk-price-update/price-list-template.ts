import * as XLSX from 'xlsx';
import type { ParsedFile } from '@/lib/import/parse-file';
import type { PriceListRow } from './actions';

interface TemplateProduct {
  barcode: string;
  name: string;
  brand: string;
  category: string;
  unitOfMeasure: string;
  price: number;
  cost: number;
}

export function downloadPriceListTemplate(products: TemplateProduct[], warehouseName: string) {
  // brand/category/unit_of_measure are appended at the end, after every
  // pre-existing column — inserting them in the middle shifted
  // current_price/current_cost/etc. to different positions and was
  // confusing for anyone used to the original layout.
  const header = ['barcode', 'name', 'current_price', 'current_cost', 'current_markup_pct', 'new_price', 'new_cost', 'new_markup_pct', 'brand', 'category', 'unit_of_measure'];
  const rows = products.map(p => {
    const markup = p.cost > 0 ? Math.round(((p.price / p.cost) - 1) * 10000) / 100 : 0;
    return [p.barcode, p.name, p.price, p.cost, markup, '', '', '', p.brand, p.category, p.unitOfMeasure];
  });
  const sheet = XLSX.utils.aoa_to_sheet([header, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'Price List');
  const safeName = warehouseName.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  XLSX.writeFile(wb, `price-list-${safeName}.xlsx`);
}

/** "New Price", "new-price" and " NEW_PRICE " all mean the template's `new_price`. */
function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

/**
 * Returns a user-facing message when the file cannot possibly do anything, or
 * null when it is usable. Without this, a misspelt header made every row either
 * "Missing barcode" or silently a no-op ("0 will be updated, 0 skipped").
 */
export function findPriceListHeaderProblem(headers: string[]): string | null {
  const found = new Set(headers.map(normalizeHeader));
  const shown = headers.filter(h => h.trim()).join(', ') || '(none)';
  if (!found.has('barcode')) {
    return `The file has no "barcode" column. Columns found: ${shown}. Use the downloaded template's column names.`;
  }
  if (!found.has('new_price') && !found.has('new_cost') && !found.has('new_markup_pct')) {
    return `The file has none of the new_price, new_cost or new_markup_pct columns, so there is nothing to update. Columns found: ${shown}.`;
  }
  return null;
}

/** Maps parsed sheet rows (raw header/rows from parseFile) into typed PriceListRow entries. */
export function mapParsedRowsToPriceListRows(parsed: ParsedFile): PriceListRow[] {
  const num = (v: string | undefined): number | undefined => {
    if (v == null || v.trim() === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN; // NaN signals "present but invalid" to the caller
  };
  const str = (v: string | undefined): string | undefined => {
    const t = (v || '').trim();
    return t === '' ? undefined : t;
  };
  return parsed.rows.map(rawRow => {
    const row: Record<string, string> = {};
    for (const [key, value] of Object.entries(rawRow)) row[normalizeHeader(key)] = value;
    return {
    barcode: row.barcode || '',
    name: str(row.name),
    brand: str(row.brand),
    category: str(row.category),
    unitOfMeasure: str(row.unit_of_measure),
    newPrice: num(row.new_price),
    newCost: num(row.new_cost),
    newMarkupPct: num(row.new_markup_pct),
    };
  });
}
