import assert from 'node:assert/strict';
import Papa from 'papaparse';
import { buildTemplateCsv, buildSkippedCsv, exportColumns, buildEntityExportCsv } from '../../lib/import/csv-out';
import { ENTITY_SCHEMAS } from '../../lib/import/entity-schemas';

const tpl = buildTemplateCsv(ENTITY_SCHEMAS.products);
const tplParsed = Papa.parse<Record<string, string>>(tpl, { header: true, skipEmptyLines: true });
assert.ok((tplParsed.meta.fields ?? []).includes('name'), 'template has name column');
assert.ok(!(tplParsed.meta.fields ?? []).includes('sku'), 'template excludes sku');
assert.equal(tplParsed.data.length, 1, 'template has one sample row');

const skipped = buildSkippedCsv([
  { sourceIndex: 0, status: 'error', values: {}, reason: 'Missing required "Product Name"', raw: { 'Product Name': '', 'Price': '10' } },
  { sourceIndex: 1, status: 'new', values: {}, raw: { 'Product Name': 'Milo', 'Price': '120' } },
]);
const sp = Papa.parse<Record<string, string>>(skipped, { header: true, skipEmptyLines: true });
assert.equal(sp.data.length, 1, 'only error rows exported');
assert.ok((sp.meta.fields ?? []).includes('_error'), 'has _error column');
assert.equal(sp.data[0]._error, 'Missing required "Product Name"');

// exportColumns: export uses the same field order as the import template.
// products.sku is retired (Sub-project D of the sku-retirement effort) and no
// longer passed as a trailing extra column here — this exercises the generic
// "extra" mechanism with a placeholder column instead of a real product field.
const prodCols = exportColumns(ENTITY_SCHEMAS.products, ['_reference_only']);
assert.deepEqual(
  prodCols.slice(0, ENTITY_SCHEMAS.products.fields.length),
  ENTITY_SCHEMAS.products.fields.map((f) => f.key),
  'product export columns match template order',
);
assert.equal(prodCols[prodCols.length - 1], '_reference_only', 'extra columns append after the template fields');
assert.deepEqual(exportColumns(ENTITY_SCHEMAS.products), ENTITY_SCHEMAS.products.fields.map((f) => f.key), 'no extra columns by default, matching the real products export');
assert.deepEqual(exportColumns(ENTITY_SCHEMAS.suppliers), ENTITY_SCHEMAS.suppliers.fields.map((f) => f.key));

// buildEntityExportCsv: header order fixed by schema; missing keys emit blanks (round-trippable).
const exp = buildEntityExportCsv(ENTITY_SCHEMAS.suppliers, [
  { name: 'Acme', contact_number: '0917', address: 'Manila', payment_terms: 'COD', markup_percentage: 15 },
  { name: 'Beta' }, // partial row -> blanks, not crash
]);
const expParsed = Papa.parse<Record<string, string>>(exp, { header: true, skipEmptyLines: true });
assert.deepEqual(expParsed.meta.fields, ['name', 'contact_number', 'address', 'payment_terms', 'markup_percentage']);
assert.equal(expParsed.data.length, 2);
assert.equal(expParsed.data[0].name, 'Acme');
assert.equal(expParsed.data[1].name, 'Beta');
assert.equal(expParsed.data[1].contact_number, '', 'missing value exported as blank');

console.log('import-csvout: all assertions passed');
