import Papa from 'papaparse';
import { priceLevelFieldsOf, type EntitySchema } from './entity-schemas';
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

/**
 * The header text a field is written out under.
 *
 * Static fields use their key, exactly as they always have. A generated
 * price-level field uses its first alias (the human "Price Wholesale") instead,
 * because its key embeds an opaque level id that means nothing to whoever opens
 * the spreadsheet. Auto-map matches headers against aliases, so a file written
 * with these headers maps back onto the same fields on re-import.
 */
function headerMap(schema: EntitySchema): Map<string, string> {
  const headers = new Map(schema.fields.map((f) => [f.key, f.key]));
  for (const { key } of priceLevelFieldsOf(schema)) {
    const field = schema.fields.find((f) => f.key === key);
    if (field?.aliases[0]) headers.set(key, field.aliases[0]);
  }
  return headers;
}

export function buildTemplateCsv(schema: EntitySchema): string {
  const keys = schema.fields.map((f) => f.key);
  const headers = headerMap(schema);
  const sampleRow: Record<string, string> = {};
  for (const k of keys) sampleRow[k] = SAMPLE[k] ?? '';
  // Price-level columns are generated per configured level, so they have no
  // entry in SAMPLE. Show a plausible amount rather than a blank, so it reads
  // as a peso price and not a percentage or a yes/no flag.
  for (const { key } of priceLevelFieldsOf(schema)) sampleRow[key] = '11.00';
  const fields = keys.map((k) => headers.get(k) ?? k);
  const data = [Object.fromEntries(keys.map((k) => [headers.get(k) ?? k, sampleRow[k]]))];
  return Papa.unparse({ fields, data });
}

// Column list for an entity export. Uses the exact import-template fields (so
// export -> edit -> re-import round-trips cleanly), plus any extra reference-only
// columns an entity wants to append that import itself ignores.
export function exportColumns(schema: EntitySchema, extra: string[] = []): string[] {
  const headers = headerMap(schema);
  return [...schema.fields.map((f) => headers.get(f.key) ?? f.key), ...extra];
}

// Builds an export CSV whose header/order matches the import template. Rows are
// keyed by field key; missing keys emit blanks rather than dropping the column.
export function buildEntityExportCsv(
  schema: EntitySchema,
  rows: Record<string, unknown>[],
  extra: string[] = [],
): string {
  const fields = exportColumns(schema, extra);
  const headers = headerMap(schema);
  // Rows are keyed by FIELD KEY while the CSV is headed by display header, so
  // each value is looked up under its key and written under its header. Reading
  // by header alone would blank every price-level column, whose header and key
  // differ.
  const sourceKeyOf = new Map<string, string>();
  for (const f of schema.fields) sourceKeyOf.set(headers.get(f.key) ?? f.key, f.key);

  const data = rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const header of fields) {
      const key = sourceKeyOf.get(header) ?? header;
      out[header] = row[key] ?? '';
    }
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
