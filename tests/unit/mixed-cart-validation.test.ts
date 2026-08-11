import assert from 'node:assert/strict';
import { validateSingleDocumentType } from '../../app/api/pos/checkout/mixed-cart-validation';

// A cart must be entirely goods (standard) or entirely services — never both.
// This is enforced before any counter is incremented, so a rejected cart
// never burns an SI or OR number.

assert.equal(
  validateSingleDocumentType([{ type: 'standard' }, { type: 'standard' }]),
  'standard',
  'all-goods cart resolves to standard',
);
assert.equal(
  validateSingleDocumentType([{ type: 'service' }, { type: 'service' }]),
  'service',
  'all-services cart resolves to service',
);
assert.throws(
  () => validateSingleDocumentType([{ type: 'standard' }, { type: 'service' }]),
  /mix/i,
  'mixed cart throws',
);
assert.equal(
  validateSingleDocumentType([{ type: undefined }, { type: 'standard' }]),
  'standard',
  'missing type defaults to standard (matches isService() false-default direction)',
);
assert.equal(
  validateSingleDocumentType([{ type: undefined }]),
  'standard',
  'single item with no type is standard',
);

console.log('✓ mixed-cart-validation');
