import assert from 'node:assert/strict';
import { chunk } from '../../lib/price-list-import';

// chunk() drives both the 1,000-per-IN() lookup batching and the 500-per-
// transaction apply batching. Off-by-one errors here silently drop rows, so
// the boundaries are pinned explicitly.

assert.deepEqual(chunk([], 500), [], 'an empty list yields no chunks');
assert.deepEqual(chunk([1, 2, 3], 500), [[1, 2, 3]], 'a short list is one chunk');
assert.equal(chunk(Array.from({ length: 999 }, (_, i) => i), 1000).length, 1, '999 items -> 1 chunk');
assert.equal(chunk(Array.from({ length: 1000 }, (_, i) => i), 1000).length, 1, '1000 items -> 1 chunk');
assert.equal(chunk(Array.from({ length: 1001 }, (_, i) => i), 1000).length, 2, '1001 items -> 2 chunks');

{
  const c = chunk(Array.from({ length: 501 }, (_, i) => i), 500);
  assert.equal(c.length, 2, '501 items -> 2 chunks');
  assert.equal(c[0].length, 500);
  assert.equal(c[1].length, 1);
  assert.equal(c.flat().length, 501, 'chunking never loses an item');
}

console.log('price-list-import-chunking.test.ts passed');
