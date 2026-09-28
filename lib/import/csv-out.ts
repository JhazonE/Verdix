import Papa from 'papaparse';
import type { EntitySchema } from './entity-schemas';
import type { ClassifiedRow } from './classify';

const SAMPLE: Record<string, string> = {
  name: 'Milo 24g', barcode: '4800361381130', description: 'Chocolate malt drink',
  category: 'Beverages', brand: 'Nestle', subcategory: 'Powdered', unit: 'pcs',
  cost_price: '8.50', selling_price: '12.00', stock_quantity: '100', reorder_point: '20',
  image_url: '', conversion_factor: '1', contact_number: '09171234567',
  address: '123 Rizal St', billing_address: '', sales_person: '', sales_area: '',
  sales_group: '', payment_terms: 'COD', loyalty_points: '0', discount: '0',
  credit_limit: '0', active: 'true', markup_percentage: '15',
};

export function buildTemplateCsv(schema: EntitySchema): string {
  const keys = schema.fields.map((f) => f.key);
  const sampleRow: Record<string, string> = {};
  for (const k of keys) sampleRow[k] = SAMPLE[k] ?? '';
  return Papa.unparse({ fields: keys, data: [sampleRow] });
}

// Column list for an entity export. Uses the exact import-template fields (so
// export -> edit -> re-import round-trips cleanly), plus any extra reference-only
// columns an entity wants to append that import itself ignores.
export function exportColumns(schema: EntitySchema, extra: string[] = []): string[] {
  return [...schema.fields.map((f) => f.key), ...extra];
}

// Builds an export CSV whose header/order matches the import template. Rows are
// keyed by field key; missing keys emit blanks rather than dropping the column.
export function buildEntityExportCsv(
  schema: EntitySchema,
  rows: Record<string, unknown>[],
  extra: string[] = [],
): string {
  const fields = exportColumns(schema, extra);
  const data = rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const key of fields) out[key] = row[key] ?? '';
    return out;
  });
  return Papa.unparse({ fields, data });
}

export function buildSkippedCsv(rows: ClassifiedRow[]): string {
  const errorRows = rows.filter((r) => r.status === 'error');
  if (errorRows.length === 0) return '';
  const headerSet = new Set<string>();
  for (const r of errorRows) Object.keys(r.raw).forEach((h) => headerSet.add(h));
  const headers = [...headerSet, '_error'];
  const data = errorRows.map((r) => ({ ...r.raw, _error: r.reason ?? 'Invalid row' }));
  return Papa.unparse({ fields: headers, data });
}
