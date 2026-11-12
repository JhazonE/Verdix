import assert from 'node:assert/strict';
import { ENTITY_SCHEMAS, templateFields } from '../../lib/import/entity-schemas';

const products = ENTITY_SCHEMAS.products;
assert.equal(products.key, 'products');
assert.ok(products.fields.find(f => f.key === 'name')?.required, 'name required');
assert.ok(!products.fields.find(f => f.key === 'sku'), 'sku excluded (auto-generated)');
assert.ok(!products.fields.find(f => f.key === 'id'), 'id excluded (auto-generated)');
assert.ok(products.fields.find(f => f.key === 'stock_quantity'), 'stock_quantity present');
assert.deepEqual(products.matchKeys, ['barcode', 'name'], 'barcode-then-name');
const vat = products.fields.find(f => f.key === 'vat_status');
assert.ok(vat, 'vat_status present');
assert.equal(vat!.default, undefined, 'vat_status has no default: blank must leave an existing product alone');
assert.ok(!products.fields.find(f => f.key === 'image_url'), 'image_url retired (no UI sets it)');
assert.ok(!products.fields.find(f => f.key === 'conversion_factor'), 'conversion_factor retired (selling units replace it)');

const customers = ENTITY_SCHEMAS.customers;
assert.ok(!customers.fields.find(f => f.key === 'id'), 'customer id excluded (auto-generated)');
assert.ok(customers.fields.find(f => f.key === 'name')?.required, 'customer name required');
assert.deepEqual(customers.matchKeys, ['name', 'contact_number']);

const suppliers = ENTITY_SCHEMAS.suppliers;
assert.ok(suppliers.fields.find(f => f.key === 'name')?.required, 'supplier name required');
assert.deepEqual(suppliers.matchKeys, ['name']);

assert.ok(templateFields(products).length > 0, 'template has fields');
assert.ok(!templateFields(products).find(f => f.key === 'sku'), 'template excludes sku');

console.log('import-schemas: all assertions passed');
