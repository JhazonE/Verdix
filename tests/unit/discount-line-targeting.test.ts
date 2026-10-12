import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Applying a discount to a single selected cart line silently did nothing —
// the dialog closed, the "Discount Applied" toast fired, and the line kept
// its old price. Only "apply to ALL" worked.
//
// Root cause: SaleItem has TWO ids. `id` is the PRODUCT id (SaleItem extends
// Product) and is shared by two cart lines of the same product sold on
// different selling units; `lineId` is a crypto.randomUUID() minted per cart
// LINE. The selling-units work introduced lineId and moved every cart
// mutation onto it — updateQuantity, removeItem, handleUpdateItem, row
// selection, line void all key on lineId — but use-discount.ts was left
// passing `item.id`.
//
// handleApplyDiscount then matched `item.lineId === itemId`, comparing a
// random UUID against a product id. That can never be true, so .map()
// returned every item unchanged. No error, no mismatch warning: the discount
// was simply dropped. Hence "wala ning gana ang mga discounts".
//
// The two ids are never interchangeable, so this is asserted structurally
// below as well as behaviourally.

const read = (rel: string) =>
  fs.readFileSync(path.join(__dirname, '../..', rel), 'utf-8');

const stripComments = (src: string) =>
  src
    .replace(/\r\n/g, '\n')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');

const useDiscount = stripComments(read('app/(app)/pos/discount/use-discount.ts'));
const usePos = stripComments(read('app/(app)/pos/pos-content/use-pos.ts'));

// ─── the premise: cart mutations are keyed by lineId, not product id ──────
// If the cart ever goes back to keying by product id this test is wrong, so
// pin the convention the fix depends on.
assert.ok(
  /const\s+updateQuantity\s*=\s*\(\s*lineId/.test(usePos) &&
    /const\s+removeItem\s*=\s*\(\s*lineId/.test(usePos),
  'cart mutations in use-pos are keyed by lineId (the per-line id), ' +
    'which is the convention a discount must follow too',
);

assert.ok(
  /lineId:\s*crypto\.randomUUID\(\)/.test(usePos),
  'lineId is a freshly generated UUID — it can never equal a product id, ' +
    'which is why passing item.id made the match structurally impossible',
);

// ─── handleApplyDiscount matches on lineId ───────────────────────────────
const applyBlock = usePos.slice(usePos.indexOf('const handleApplyDiscount'));
assert.ok(
  /item\.lineId\s*===\s*itemId/.test(applyBlock),
  'handleApplyDiscount targets the line by lineId',
);

// ─── so the dialog must hand it a lineId ─────────────────────────────────
assert.ok(
  /onApplyDiscount\(\s*item\.lineId\s*,/.test(useDiscount),
  'use-discount passes item.lineId to onApplyDiscount, matching what ' +
    'handleApplyDiscount compares against (it passed item.id, the PRODUCT id, ' +
    'so no line ever matched and the discount was silently dropped)',
);

assert.ok(
  !/onApplyDiscount\(\s*item\.id\s*,/.test(useDiscount),
  'use-discount no longer passes the product id as a line target',
);

// ─── behavioural: the same mismatch, reproduced in isolation ─────────────
// Mirrors handleApplyDiscount's update so the targeting rule is checked by
// execution and not only by pattern.
type Line = { id: string; lineId: string; discount: number };

const applyDiscount = (lines: Line[], itemId: string | 'ALL', percentage: number): Line[] =>
  itemId === 'ALL'
    ? lines.map((l) => ({ ...l, discount: percentage }))
    : lines.map((l) => (l.lineId === itemId ? { ...l, discount: percentage } : l));

// Two lines of the SAME product on different selling units: identical `id`,
// distinct `lineId`. This is exactly the case product-id targeting cannot
// express, even if the ids had happened to collide.
const cart: Line[] = [
  { id: 'prod-1', lineId: 'line-aaa', discount: 0 },
  { id: 'prod-1', lineId: 'line-bbb', discount: 0 },
  { id: 'prod-2', lineId: 'line-ccc', discount: 0 },
];

// Targeting by lineId discounts exactly one line.
const byLineId = applyDiscount(cart, 'line-bbb', 20);
assert.deepEqual(
  byLineId.map((l) => l.discount),
  [0, 20, 0],
  'a lineId target discounts exactly the selected line, leaving the other ' +
    'line of the same product alone',
);

// Targeting by product id matches nothing — the original bug.
const byProductId = applyDiscount(cart, 'prod-1', 20);
assert.deepEqual(
  byProductId.map((l) => l.discount),
  [0, 0, 0],
  'a product-id target matches no line at all — this is the silent no-op ' +
    'that made per-item discounts appear not to work',
);

// ALL still discounts everything (this path was never broken).
assert.deepEqual(
  applyDiscount(cart, 'ALL', 10).map((l) => l.discount),
  [10, 10, 10],
  'the ALL scope discounts every line',
);

// ─── statutory discounts reach the line too ──────────────────────────────
// PWD/senior/NAAC 20% and solo-parent 10% are legally mandated rates. They
// went through the same broken single-item path, so a cashier granting a
// senior discount on one line silently charged full price.
assert.ok(
  /percentage\s*=\s*20/.test(useDiscount) && /percentage\s*=\s*10/.test(useDiscount),
  'statutory rates (20% PWD/senior/NAAC, 10% solo parent) are still set',
);

console.log('✓ discount-line-targeting');
