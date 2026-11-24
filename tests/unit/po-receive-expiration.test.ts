import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Receiving a PO must put the delivery's expiry on its BATCH (what Expiring
// Soon and FEFO read) and recompute the product's cached soonest expiry, not
// overwrite that cache with this delivery's date or NULL.
const src = readFileSync('lib/purchase-actions.ts', 'utf8');

assert.ok(!/UPDATE products SET[^']*expiration_date/.test(src),
  'PO receiving must not write products.expiration_date directly');
assert.ok(/INSERT INTO inventory_batches[\s\S]{0,200}expiration_date/.test(src),
  'the received batch must carry the expiration date');
assert.ok(src.includes('refreshProductExpirationCache(receivedItem.productId, connection)'),
  'the product expiry cache is recomputed from batches on the same connection');
assert.ok(!/expirationDate\)\.toISOString\(\)/.test(src),
  'no toISOString() on the date: it shifts local midnight back a day in UTC+8');

console.log('✓ po-receive-expiration');
