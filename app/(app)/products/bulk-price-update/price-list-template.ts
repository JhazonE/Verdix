import * as XLSX from 'xlsx';
import type { ParsedFile } from '@/lib/import/parse-file';
import type { PriceListRow } from './actions';

interface TemplateProduct {
  sku: string;
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
  const header = ['sku', 'barcode', 'name', 'current_price', 'current_cost', 'current_markup_pct', 'new_price', 'new_cost', 'new_markup_pct', 'brand', 'category', 'unit_of_measure'];
  const rows = products.map(p => {
    const markup = p.cost > 0 ? Math.round(((p.price / p.cost) - 1) * 10000) / 100 : 0;
    return [p.sku, p.barcode, p.name, p.price, p.cost, markup, '', '', '', p.brand, p.category, p.unitOfMeasure];
  });
  const sheet = XLSX.utils.aoa_to_sheet([header, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'Price List');
  const safeName = warehouseName.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  XLSX.writeFile(wb, `price-list-${safeName}.xlsx`);
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
  return parsed.rows.map(row => ({
    sku: row.sku || '',
    barcode: row.barcode || '',
    name: str(row.name),
    brand: str(row.brand),
    category: str(row.category),
    unitOfMeasure: str(row.unit_of_measure),
    newPrice: num(row.new_price),
    newCost: num(row.new_cost),
    newMarkupPct: num(row.new_markup_pct),
  }));
}
