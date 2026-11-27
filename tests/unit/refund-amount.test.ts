import assert from 'node:assert/strict';
import { buildRefundBasis, refundFor, refundsForLines, refundsInOrder, type RefundRow } from '../../lib/pos/refund-amount';

// A return refunded the UNDISCOUNTED unit price (pos_transaction_items.unit_price)
// and, on a discounted line, its returned quantity was never counted against
// the line (recent-sales grouped by sale_items.price, which differs between the
// discounted sale row and the return row) — so the line could be returned
// again and again at full price. Measured on verdix_test: a 3 × ₱25.75 line at
// 5% off (charged ₱73.39) refunded ₱25.75 for ONE unit and still showed
// 3 returnable afterwards.
//
// The refund basis is what the line actually charged, pooled per product +
// selling unit, net of what was already refunded.

const sold: RefundRow[] = [
  { productId: 'P1', sellingUnitId: 'U1', quantity: 3, amount: 73.39 },
];

// --- basis is the charged amount, not the shelf price --------------------------
{
  const b = buildRefundBasis(sold, 'P1', 'U1')!;
  assert.deepEqual(
    { paidTotal: b.paidTotal, soldQty: b.soldQty, refundedTotal: b.refundedTotal, returnedQty: b.returnedQty },
    { paidTotal: 73.39, soldQty: 3, refundedTotal: 0, returnedQty: 0 },
  );
  assert.equal(refundFor(b, 1), 24.46, 'one of three: 73.39 / 3 rounded');
  assert.equal(refundFor(b, 3), 73.39, 'all three: exactly what was charged');
}

// --- returning one at a time refunds exactly the charged total -----------------
{
  const rows = [...sold];
  const got: number[] = [];
  for (let i = 0; i < 3; i++) {
    const b = buildRefundBasis(rows, 'P1', 'U1')!;
    const r = refundFor(b, 1);
    got.push(r);
    rows.push({ productId: 'P1', sellingUnitId: 'U1', quantity: -1, amount: -r });
  }
  assert.deepEqual(got, [24.46, 24.46, 24.47], 'the last unit takes the remainder');
  assert.equal(Math.round(got.reduce((a, b) => a + b, 0) * 100), 7339);
  const after = buildRefundBasis(rows, 'P1', 'U1')!;
  assert.equal(after.soldQty - after.returnedQty, 0, 'nothing left to return');
  assert.equal(refundFor(after, 1), 0, 'a fully-returned line refunds nothing more');
}

// --- a return row recorded under a different unit id still nets against the line
// (pre-selling-unit sales have NULL selling_unit_id; processReturnLeg then
// writes the base unit id on the return row).
{
  const rows: RefundRow[] = [
    { productId: 'P1', sellingUnitId: null, quantity: 2, amount: 40 },
    { productId: 'P1', sellingUnitId: 'BASE', quantity: -1, amount: -20 },
  ];
  const b = buildRefundBasis(rows, 'P1', null)!;
  assert.equal(b.returnedQty, 1);
  assert.equal(b.refundedTotal, 20);
}

// --- two units of the same product are separate pools --------------------------
{
  const rows: RefundRow[] = [
    { productId: 'P1', sellingUnitId: 'PC', quantity: 6, amount: 60 },
    { productId: 'P1', sellingUnitId: 'CASE', quantity: 1, amount: 100 },
  ];
  assert.equal(refundFor(buildRefundBasis(rows, 'P1', 'CASE')!, 1), 100);
  assert.equal(refundFor(buildRefundBasis(rows, 'P1', 'PC')!, 1), 10);
  // No unit given → the OLDEST line's unit, the same rule processReturnLeg uses.
  assert.equal(buildRefundBasis(rows, 'P1', null)!.poolKey, buildRefundBasis(rows, 'P1', 'PC')!.poolKey);
}

// --- an earlier over-refund (the old bug) never makes a refund negative --------
{
  const rows: RefundRow[] = [
    { productId: 'P1', sellingUnitId: 'U1', quantity: 3, amount: 73.39 },
    { productId: 'P1', sellingUnitId: 'U1', quantity: -2, amount: -51.5 }, // 2 × 25.75 under the old bug
  ];
  const b = buildRefundBasis(rows, 'P1', 'U1')!;
  assert.equal(refundFor(b, 1), 21.89, 'the last unit gets only what is left of the charge');
}

// --- product not on the sale -------------------------------------------------
assert.equal(buildRefundBasis(sold, 'NOPE', null), null);

// --- several lines of one pool in one request are sequenced --------------------
{
  const rows: RefundRow[] = [
    { productId: 'P1', sellingUnitId: 'U1', quantity: 3, amount: 73.39 },
  ];
  const out = refundsInOrder(rows, [
    { productId: 'P1', sellingUnitId: 'U1', quantity: 2 },
    { productId: 'P1', sellingUnitId: 'U1', quantity: 1 },
  ]);
  assert.deepEqual(out.map(o => o.amount), [48.93, 24.46]);
  assert.equal(Math.round((out[0].amount + out[1].amount) * 100), 7339);
}

// --- over-return is reported, not silently clamped -----------------------------
{
  const out = refundsInOrder(sold, [{ productId: 'P1', sellingUnitId: 'U1', quantity: 4 }]);
  assert.equal(out[0].error, 'Only 3 left to return');
}

// --- the dialog's figure equals the server's -----------------------------------
// The POS dialog only has each line's basis; it must reach the same amounts
// the server books from the raw rows, or the cashier quotes one credit and
// the slip prints another.
{
  const rows: RefundRow[] = [
    { productId: 'P1', sellingUnitId: 'U1', quantity: 3, amount: 73.39 },
    { productId: 'P2', sellingUnitId: 'U2', quantity: 5, amount: 51.96 },
    { productId: 'P2', sellingUnitId: 'U2', quantity: -1, amount: -10.39 },
  ];
  const reqs = [
    { productId: 'P1', sellingUnitId: 'U1', quantity: 2 },
    { productId: 'P2', sellingUnitId: 'U2', quantity: 4 },
    { productId: 'P1', sellingUnitId: 'U1', quantity: 1 },
  ];
  const server = refundsInOrder(rows, reqs).map(r => r.amount);
  const client = refundsForLines(reqs.map(r => ({
    refundBasis: buildRefundBasis(rows, r.productId, r.sellingUnitId)!,
    price: 999, // the shelf price must not leak into the amount
    quantity: r.quantity,
  })));
  assert.deepEqual(client, server);
  assert.deepEqual(server, [48.93, 41.57, 24.46]);
  // No basis (older server) falls back to price × qty.
  assert.deepEqual(refundsForLines([{ price: 12.5, quantity: 2 }]), [25]);
}

console.log('✓ refund-amount: refunds are what the line charged, and add up to it');
