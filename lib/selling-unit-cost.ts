/**
 * The cost a non-base selling unit carries when one was TYPED for it on the
 * Selling Units tab — e.g. a Case of 24 bought at ₱220 rather than 24 × the
 * piece cost.
 *
 * Rule (decided by the store owner): when a non-base unit has a typed cost,
 * that cost IS the cost of sale for a line sold in that unit, whatever the FIFO
 * batch charged. A unit with no typed cost, and the base unit always, keep
 * FIFO batch cost × factor. The base unit's cost column mirrors
 * `products.cost`, which FIFO already uses where a batch has no cost of its
 * own, so it is deliberately not consulted here.
 *
 * Only a POSITIVE cost counts as typed: the form stores a blank unit cost as
 * NULL or 0, and treating that 0 as "this case was free" is exactly the frozen
 * zero-cost bug this codebase has fixed twice already.
 */
import mysql from 'mysql2/promise';

export async function typedSellingUnitCost(
  unitId: string | null | undefined,
  connection: mysql.PoolConnection | mysql.Connection
): Promise<number | null> {
  if (!unitId) return null;
  const [rows]: any = await connection.query(
    'SELECT cost, is_base FROM product_selling_units WHERE id = ?',
    [unitId]
  );
  const row = rows?.[0];
  if (!row || Number(row.is_base) === 1 || row.cost == null) return null;
  const cost = parseFloat(row.cost);
  return Number.isFinite(cost) && cost > 0 ? cost : null;
}

/**
 * cost_at_sale for one line, per SELLING unit: the unit's typed cost when it
 * has one, else the FIFO weighted average scaled by the factor, else NULL when
 * no cost was on record at all (see DeductionResult.costUnknown).
 */
export async function resolveCostAtSale(
  deduction: { weightedAvgCost: number; costUnknown: boolean },
  factor: number,
  unitId: string | null | undefined,
  connection: mysql.PoolConnection | mysql.Connection
): Promise<number | null> {
  // A factor-1 unit is the base unit (or behaves as one): skip the round trip.
  if (factor !== 1) {
    const typed = await typedSellingUnitCost(unitId, connection);
    if (typed != null) return typed;
  }
  return deduction.costUnknown ? null : deduction.weightedAvgCost * factor;
}
