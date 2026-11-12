import assert from 'node:assert/strict';
import { applyMatchedItems, APPLY_CHUNK_SIZE, type PriceUpdateItem } from '../../lib/price-list-import';

// A chunk is one transaction. If a later row in it throws, the whole chunk
// rolls back, so rows counted as applied/skipped earlier in that same chunk
// never reached the database and must not appear in the totals.

const item = (id: string): PriceUpdateItem => ({
  productId: id, baseUnitBarcode: id, barcode: id, productName: id, field: 'price',
  oldValue: 1, newValue: 2, adjustmentType: 'exact', adjustmentValue: 2,
});

// Fake transaction: runs the callback against a scripted connection. Throwing
// from the callback stands in for a rollback.
const fakeTransaction = async (fn: (c: any) => Promise<void>) => {
  const connection = {
    async query(sql: string, params: any[]) {
      if (sql.startsWith('SELECT id, cost FROM products')) {
        return [params[0] === 'missing' ? [] : [{ id: params[0], cost: 1 }]];
      }
      if (sql.includes('FROM product_selling_units')) return [[{ id: `u-${params[0]}`, cost: 1, is_base: 1 }]];
      if (sql.startsWith('UPDATE products SET price') && params[1] === 'boom') throw new Error('deadlock');
      return [{}];
    },
  };
  await fn(connection);
};

(async () => {
  const good = Array.from({ length: APPLY_CHUNK_SIZE }, (_, i) => item(`ok-${i}`));
  // Second chunk: one row skipped, one applied, then a throw -> whole chunk rolls back.
  const items = [...good, item('missing'), item('fine'), item('boom')];

  const out = await applyMatchedItems(items, undefined, fakeTransaction as any);

  assert.equal(out.error, 'deadlock', 'the failure is reported');
  assert.equal(out.applied, APPLY_CHUNK_SIZE, 'only the committed chunk counts as applied');
  assert.equal(out.skipped.length, 0, 'a skip recorded inside a rolled-back chunk is not reported');

  console.log('price-list-import-apply.test.ts passed');
})().catch((e) => { console.error(e); process.exit(1); });
