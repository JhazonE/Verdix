/**
 * How much a return gives back — the amount the line actually CHARGED, never
 * its shelf price.
 *
 * Returns used to refund pos_transaction_items.unit_price × quantity, which is
 * the price BEFORE the line's discount, so a Senior/PWD or promo line was
 * refunded more than the customer paid. Worse, the returned quantity of a
 * discounted line was never counted against it, so it stayed fully returnable.
 *
 * The basis is pooled per product + selling unit, because return rows are not
 * linked to a particular original line: a return row only records its sale,
 * product and unit. Partial returns refund the charged amount pro rata, and
 * the return that empties the pool refunds exactly what is left, so returning
 * a line in any number of steps gives back exactly what it charged.
 *
 * Pure and client-safe: the POS dialog shows the same figure the server
 * books, from the basis /api/pos/recent-sales computes with this module.
 */
import { toCents } from '../line-allocation';

/** One sale_items row of the sale: positive = sold, negative = returned. */
export interface RefundRow {
  productId: string;
  sellingUnitId: string | null;
  quantity: number;
  /** Signed charged amount: COALESCE(line_total, price × quantity). */
  amount: number;
}

export interface RefundBasis {
  /** Identifies the pool, so lines sharing one can be sequenced. */
  poolKey: string;
  /** The pool's selling unit (null on lines that predate selling units). */
  unitId: string | null;
  paidTotal: number;
  soldQty: number;
  refundedTotal: number;
  returnedQty: number;
}

const keyOf = (productId: string, unitId: string | null) => `${productId}|${unitId ?? ''}`;

/**
 * The pool a (product, unit) belongs to: the sold pool with that exact unit,
 * otherwise the product's OLDEST sold pool — the same fallback
 * processReturnLeg uses to choose the unit it restocks. Rows are expected in
 * insertion order.
 */
function poolUnitFor(rows: RefundRow[], productId: string, unitId: string | null): { unit: string | null } | null {
  const sold = rows.filter(r => r.productId === productId && r.quantity > 0);
  if (sold.length === 0) return null;
  if (unitId != null) {
    const exact = sold.find(r => r.sellingUnitId === unitId);
    if (exact) return { unit: exact.sellingUnitId };
  }
  return { unit: sold[0].sellingUnitId };
}

function poolFor(rows: RefundRow[], productId: string, unitId: string | null): string | null {
  const p = poolUnitFor(rows, productId, unitId);
  return p ? keyOf(productId, p.unit) : null;
}

export function buildRefundBasis(rows: RefundRow[], productId: string, unitId: string | null): RefundBasis | null {
  const pool = poolUnitFor(rows, productId, unitId);
  if (!pool) return null;
  const poolKey = keyOf(productId, pool.unit);
  let paid = 0, sold = 0, refunded = 0, returned = 0;
  for (const r of rows) {
    if (r.productId !== productId) continue;
    if (r.quantity > 0) {
      if (keyOf(r.productId, r.sellingUnitId) !== poolKey) continue;
      paid += toCents(Number(r.amount));
      sold += Number(r.quantity);
    } else if (r.quantity < 0) {
      if (poolFor(rows, r.productId, r.sellingUnitId) !== poolKey) continue;
      refunded += -toCents(Number(r.amount));
      returned += -Number(r.quantity);
    }
  }
  return { poolKey, unitId: pool.unit, paidTotal: paid / 100, soldQty: sold, refundedTotal: refunded / 100, returnedQty: returned };
}

/** Refund, in pesos, for returning `qty` more from this basis. */
export function refundFor(basis: RefundBasis, qty: number): number {
  if (!(qty > 0) || !(basis.soldQty > 0)) return 0;
  const remainingQty = basis.soldQty - basis.returnedQty;
  const remainingCents = Math.max(0, toCents(basis.paidTotal) - toCents(basis.refundedTotal));
  // Quantities may be fractional (weighed goods); compare with a tolerance.
  if (qty >= remainingQty - 1e-9) return remainingCents / 100;
  return Math.min(remainingCents, toCents((basis.paidTotal * qty) / basis.soldQty)) / 100;
}

export interface RefundRequest {
  productId: string;
  sellingUnitId?: string | null;
  quantity: number;
}

export interface RefundResult {
  amount: number;
  basis: RefundBasis | null;
  error?: string;
}

/**
 * Client-side counterpart of refundsInOrder, for the POS return dialog, which
 * only has each line's basis (from /api/pos/recent-sales). Lines sharing a
 * pool are sequenced the same way the server sequences them. A line with no
 * basis (an older server) falls back to price × quantity.
 */
export function refundsForLines(
  lines: { refundBasis?: RefundBasis; price: number; quantity: number }[]
): number[] {
  const pools = new Map<string, RefundBasis>();
  return lines.map(line => {
    const qty = Number(line.quantity);
    if (!line.refundBasis) return toCents(Number(line.price) * qty) / 100;
    const cur = pools.get(line.refundBasis.poolKey) ?? { ...line.refundBasis };
    const amount = refundFor(cur, qty);
    pools.set(cur.poolKey, {
      ...cur,
      returnedQty: cur.returnedQty + qty,
      refundedTotal: (toCents(cur.refundedTotal) + toCents(amount)) / 100,
    });
    return amount;
  });
}

/**
 * Refunds for several return lines in order, each seeing the ones before it —
 * so two lines drawing on one pool cannot both take its remainder.
 */
export function refundsInOrder(rows: RefundRow[], requests: RefundRequest[]): RefundResult[] {
  const working = [...rows];
  return requests.map(req => {
    const basis = buildRefundBasis(working, req.productId, req.sellingUnitId ?? null);
    if (!basis) return { amount: 0, basis, error: 'Item is not on this sale' };
    const qty = Number(req.quantity);
    const remaining = basis.soldQty - basis.returnedQty;
    if (!(qty > 0)) return { amount: 0, basis, error: 'Return quantity must be more than zero' };
    if (qty > remaining + 1e-9) {
      return { amount: 0, basis, error: `Only ${Math.max(0, Math.round(remaining * 1000) / 1000)} left to return` };
    }
    const amount = refundFor(basis, qty);
    working.push({ productId: req.productId, sellingUnitId: basis.unitId, quantity: -qty, amount: -amount });
    return { amount, basis };
  });
}
