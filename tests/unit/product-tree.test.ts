import assert from 'node:assert/strict';
import { getDescendantIds, getIllegalReassignTargets, getIllegalChildTargets, type TreeProduct } from '../../lib/product-tree';

// Tree: A -> B -> C ; A -> D ; E (standalone)
const products: TreeProduct[] = [
  { id: 'A', parentId: null },
  { id: 'B', parentId: 'A' },
  { id: 'C', parentId: 'B' },
  { id: 'D', parentId: 'A' },
  { id: 'E', parentId: null },
];

// descendants of A = B, C, D
const descA = getDescendantIds('A', products);
assert.deepEqual([...descA].sort(), ['B', 'C', 'D'], 'descendants of A');

// descendants of B = C
assert.deepEqual([...getDescendantIds('B', products)].sort(), ['C'], 'descendants of B');

// leaf has no descendants
assert.equal(getDescendantIds('C', products).size, 0, 'leaf has no descendants');

// illegal targets for A = self + all descendants
const illegalA = getIllegalReassignTargets('A', products);
assert.deepEqual([...illegalA].sort(), ['A', 'B', 'C', 'D'], 'A cannot go under itself or its descendants');

// E is a legal target for A
assert.equal(illegalA.has('E'), false, 'E is a legal target for A');

// cyclic data must not infinite-loop: X -> Y -> X
const cyclic: TreeProduct[] = [
  { id: 'X', parentId: 'Y' },
  { id: 'Y', parentId: 'X' },
];
assert.deepEqual([...getDescendantIds('X', cyclic)].sort(), ['Y'], 'cyclic data terminates');

// --- getIllegalChildTargets: who may NOT become a child of X ---
// Mirror of getIllegalReassignTargets. Walking UP from the parent, not down.

// C's ancestors are B and A; adding either under C would make a loop.
{
  const illegal = getIllegalChildTargets('C', products);
  assert.deepEqual([...illegal].sort(), ['A', 'B', 'C'], 'C plus its ancestors');
}

// A is a root: only A itself is illegal (nothing is above it).
{
  const illegal = getIllegalChildTargets('A', products);
  assert.deepEqual([...illegal].sort(), ['A'], 'a root excludes only itself');
}

// A product cannot become its own child.
assert.equal(getIllegalChildTargets('E', products).has('E'), true, 'self is always illegal');

// DESCENDANTS ARE LEGAL: re-attaching a grandchild one level up is a real move,
// so C must NOT be excluded as a candidate child of A.
{
  const illegal = getIllegalChildTargets('A', products);
  assert.equal(illegal.has('C'), false, 'a descendant may be re-attached higher up');
  assert.equal(illegal.has('B'), false, 'a direct child is not excluded either');
}

// Cycle-safe: malformed data (a parent loop) must terminate, not hang.
{
  const cyclic: TreeProduct[] = [
    { id: 'X', parentId: 'Y' },
    { id: 'Y', parentId: 'X' },
  ];
  const illegal = getIllegalChildTargets('X', cyclic);
  assert.equal(illegal.has('X'), true, 'terminates on a cycle and includes self');
}

console.log('product-tree: all assertions passed');
