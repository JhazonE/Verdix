import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { allocateLineTotals, toCents } from '../../lib/line-allocation';

// Sales reports disagreed by a few centavos. The sale's header total
// (sales_transactions.total / pos_transactions.total_amount) is the cart's
// UNROUNDED line nets summed and then rounded once by the DECIMAL(10,2)
// column, while every line row was rounded on its own. Line-level reports
// (By Tax Type, BIR Summary, By Product) therefore summed to a centavo or two
// away from Sales by Date / Z-reading for any sale carrying a discount.
// allocateLineTotals must make the lines add up to the header EXACTLY.

const sumCents = (xs: { lineTotal: number }[]) => xs.reduce((a, x) => a + toCents(x.lineTotal), 0);

// --- toCents mirrors MySQL's DECIMAL(…,2) rounding of what mysql2 sends ------
// mysql2 sends String(n); MySQL rounds that decimal half away from zero.
assert.equal(toCents(9.045), 905, '9.045 is sent as "9.045" and MySQL stores 9.05');
assert.equal(toCents(18.525), 1853);
assert.equal(toCents(39.2), 3920);
assert.equal(toCents(73.3875), 7339);
assert.equal(toCents(-73.3875), -7339, 'half away from zero for negatives');
assert.equal(toCents(10), 1000);
assert.equal(toCents(0), 0);
assert.equal(toCents(1e-7), 0, 'exponent notation handled');

// --- Reproduced cart: header 39.20, lines used to round to 39.21 -------------
{
  const cart = [
    { price: 10.05, quantity: 1, discountPercent: 10 },          // 9.045
    { price: 25.45, quantity: 1, discountPercent: 10 },          // 22.905
    { price: 8.25, quantity: 1, discountPercent: (1 / 8.25) * 100 }, // 7.25
  ];
  const total = cart.reduce((a, l) => { const t = l.price * l.quantity; return a + (t - (t * l.discountPercent) / 100); }, 0);
  assert.equal(toCents(total), 3920);
  const out = allocateLineTotals(cart, total);
  assert.equal(sumCents(out), 3920, 'lines must sum to the header exactly');
  // Every line stays within one centavo of its own exact value.
  out.forEach((o, i) => {
    const exact = cart[i].price * cart[i].quantity * (1 - cart[i].discountPercent / 100);
    assert.ok(Math.abs(o.lineTotal - exact) < 0.0101, `line ${i} moved more than a centavo`);
    assert.equal(toCents(o.discountAmount), toCents(cart[i].price * cart[i].quantity) - toCents(o.lineTotal),
      'discount = gross − line, so each row is self-consistent');
  });
  // One centavo comes back off a line that was rounded UP. 9.045 → 9.05 and
  // 22.905 → 22.91 were both rounded up by half a centavo; the tie goes to the
  // earlier line.
  assert.deepEqual(out.map(o => o.lineTotal), [9.04, 22.91, 7.25]);
}

// --- Senior 20% + fixed ₱ discounts, header 269.06 ---------------------------
{
  const cart = [
    { price: 12.99, quantity: 5, discountPercent: 20 },
    { price: 33.0, quantity: 3, discountPercent: (10 / 99) * 100 },
    { price: 61.85, quantity: 1, discountPercent: (5 / 61.85) * 100 },
    { price: 18.75, quantity: 4, discountPercent: 5 },
  ];
  const total = cart.reduce((a, l) => { const t = l.price * l.quantity; return a + (t - (t * l.discountPercent) / 100); }, 0);
  const out = allocateLineTotals(cart, total);
  assert.equal(sumCents(out), toCents(total));
}

// --- Undiscounted cart is untouched -------------------------------------------
{
  const cart = [
    { price: 45.5, quantity: 2, discountPercent: 0 },
    { price: 12.25, quantity: 3, discountPercent: 0 },
  ];
  const out = allocateLineTotals(cart, 127.75);
  assert.deepEqual(out.map(o => o.lineTotal), [91, 36.75]);
  assert.deepEqual(out.map(o => o.discountAmount), [0, 0]);
}

// --- A header that does not come from these lines is NOT forced onto them ----
// (e.g. a stale client total). Spreading a ₱5 gap across lines would invent
// discounts; plain per-line rounding is kept instead.
{
  const cart = [
    { price: 10, quantity: 1, discountPercent: 0 },
    { price: 20, quantity: 1, discountPercent: 0 },
  ];
  const out = allocateLineTotals(cart, 25);
  assert.deepEqual(out.map(o => o.lineTotal), [10, 20]);
}

// --- 100% discount line never goes negative -----------------------------------
{
  const cart = [
    { price: 9.99, quantity: 1, discountPercent: 100 },
    { price: 10.05, quantity: 1, discountPercent: 10 },
    { price: 10.05, quantity: 1, discountPercent: 10 },
  ];
  const total = cart.reduce((a, l) => { const t = l.price * l.quantity; return a + (t - (t * l.discountPercent) / 100); }, 0);
  const out = allocateLineTotals(cart, total);
  assert.equal(sumCents(out), toCents(total));
  assert.equal(out[0].lineTotal, 0);
  out.forEach(o => assert.ok(o.lineTotal >= 0));
}

// --- Guard: no report sums sale_items revenue as price × quantity ------------
// sale_items.price is the ROUNDED per-unit price, so price × quantity is off
// by up to a centavo per unit. Readers must use lib/sale-item-revenue.ts.
{
  const root = path.join(__dirname, '../..');
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name)) {
        const src = fs.readFileSync(p, 'utf-8');
        if (/\b(si|asi)\.price\s*\*\s*\1\.quantity\b|\b(si|asi)\.quantity\s*\*\s*\3\.price\b/.test(src)) {
          offenders.push(path.relative(root, p));
        }
      }
    }
  };
  walk(path.join(root, 'app/api'));
  assert.deepEqual(offenders, [], 'use saleItemRevenueSql() instead of si.price * si.quantity');
}

console.log('✓ line-allocation: line totals sum to the sale header exactly');
