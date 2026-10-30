import assert from 'node:assert/strict';
import { factorExpr, unitCostExpr, lineCostExpr, sumLineCostExpr } from '../../lib/cost-of-sale';

// The profit reports costed a sold line as `quantity * p.cost`. `p.cost` is per
// BASE unit but a line's quantity is in SELLING units, so a case of 24 was
// costed as a single bottle: C2 SOLO LEMON 230ML showed 4 "Bottle" sold for
// ₱1,360.00 revenue against ₱54.32 cost — a 96% margin on a product that
// really earns about 4%. These assertions pin the expression that fixes it.
//
// This evaluates the SQL for real rather than regex-matching route source:
// source-assertion regexes have silently passed on correct code here before.

// A tiny SQL evaluator is overkill; instead assert the expression's SHAPE and
// then evaluate it with a substitution, which catches operator-precedence and
// missing-COALESCE mistakes that a substring check would not.
const evaluate = (
  expr: string,
  row: Record<string, number | null>
): number | null => {
  // Replace `alias.column` references with JS lookups, then eval as JS.
  // COALESCE/SUM map onto small JS equivalents.
  const js = expr.replace(/([a-z_]+)\.([a-z_]+)/gi, (_m, a, c) => {
    const key = `${a}.${c}`;
    assert.ok(key in row, `expression referenced unknown column ${key}`);
    const v = row[key];
    return v === null ? 'null' : String(v);
  });
  const COALESCE = (...args: (number | null)[]) => {
    for (const a of args) if (a !== null && a !== undefined && !Number.isNaN(a)) return a;
    return null;
  };
  // MySQL NULLIF(a, b) -> NULL when a = b, else a.
  const NULLIF = (a: number | null, b: number) => (a === b ? null : a);
  // `null * 2` is 0 in JS but NULL in SQL — model that so the COALESCE
  // fallback chain is exercised the way MySQL would exercise it.
  const guarded = js.replace(/null \* /g, 'NULLMUL * ');
  // eslint-disable-next-line no-new-func
  const fn = new Function('COALESCE', 'NULLIF', 'SUM', 'NULLMUL', `return ${guarded};`);
  return fn(COALESCE, NULLIF, (x: number) => x, NaN);
};

export const costOfSaleTest = (() => {
  // --- factor: NULL means the base unit, never 0 ---------------------------
  assert.equal(evaluate(factorExpr('si'), { 'si.selling_unit_factor': null }), 1);
  assert.equal(evaluate(factorExpr('si'), { 'si.selling_unit_factor': 24 }), 24);

  // --- the reported bug ----------------------------------------------------
  // 4 cases of 24, true batch cost ₱325.92 per case, sold at ₱340 each.
  const caseRow = {
    'si.selling_unit_factor': 24,
    'si.cost_at_sale': 325.92,
    'si.quantity': 4,
    'p.cost': 13.58,
  };
  const cost = evaluate(lineCostExpr('si', 'p', { hasCostAtSale: true }), caseRow)!;
  assert.equal(cost, 1303.68);
  const revenue = 1360.0;
  const margin = ((revenue - cost) / revenue) * 100;
  assert.ok(margin > 3 && margin < 5, `expected a ~4% margin, got ${margin.toFixed(1)}%`);
  // The old expression (quantity * p.cost) is exactly what the screenshot showed.
  assert.equal(caseRow['si.quantity'] * caseRow['p.cost'], 54.32);

  // --- cost_at_sale is ALREADY per selling unit: never scale it again ------
  // Scaling it would give 4 * 325.92 * 24 = 31,288.32 and a wildly negative margin.
  assert.equal(
    evaluate(unitCostExpr('si', 'p', { hasCostAtSale: true }), caseRow),
    325.92
  );

  // --- fallback when batch costing never ran: p.cost MUST be scaled --------
  const legacyRow = {
    'si.selling_unit_factor': 24,
    'si.cost_at_sale': null,
    'si.quantity': 4,
    'p.cost': 13.58,
  };
  assert.equal(
    evaluate(unitCostExpr('si', 'p', { hasCostAtSale: true }), legacyRow),
    13.58 * 24
  );
  assert.equal(
    evaluate(lineCostExpr('si', 'p', { hasCostAtSale: true }), legacyRow),
    13.58 * 24 * 4
  );

  // --- a filed sale is FROZEN: editing the cost cannot move it ------------
  // A snapshot, once taken, is the historical record. Raising products.cost
  // tomorrow must change tomorrow's sales only — never a sale already filed.
  const alreadyFiled = {
    'si.selling_unit_factor': 24,
    'si.cost_at_sale': 325.92, // captured on the day of the sale
    'si.quantity': 4,
    'p.cost': 99.0, // edited much later; must be ignored here
  };
  assert.equal(
    evaluate(lineCostExpr('si', 'p', { hasCostAtSale: true }), alreadyFiled),
    1303.68
  );

  // A deliberate zero cost is a KNOWN cost and is equally frozen.
  assert.equal(
    evaluate(unitCostExpr('si', 'p', { hasCostAtSale: true }), {
      'si.selling_unit_factor': 1,
      'si.cost_at_sale': 0,
      'p.cost': 50,
    }),
    0
  );

  // Only a line with NO snapshot at all (NULL) still follows products.cost.
  // lib/pos/process-sale-leg.ts now writes NULL rather than 0 when no cost
  // was on record, so exactly these lines stay correctable.
  assert.equal(
    evaluate(unitCostExpr('si', 'p', { hasCostAtSale: true }), {
      'si.selling_unit_factor': 24,
      'si.cost_at_sale': null,
      'p.cost': 13.58,
    }),
    13.58 * 24
  );

  // --- base-unit sales are unchanged (factor 1 / NULL) --------------------
  const baseRow = {
    'si.selling_unit_factor': null,
    'si.cost_at_sale': null,
    'si.quantity': 3,
    'p.cost': 10,
  };
  assert.equal(evaluate(lineCostExpr('si', 'p', { hasCostAtSale: true }), baseRow), 30);

  // --- tables without cost_at_sale use the scaled fallback only -----------
  const ptiExpr = unitCostExpr('pti', 'p', { hasCostAtSale: false });
  assert.ok(!ptiExpr.includes('cost_at_sale'), 'pos_transaction_items has no cost_at_sale column');
  assert.equal(
    evaluate(ptiExpr, { 'pti.selling_unit_factor': 12, 'p.cost': 5 }),
    60
  );

  // --- a NULL p.cost must cost 0, never NULL (it would void the SUM) ------
  assert.equal(
    evaluate(unitCostExpr('si', 'p', { hasCostAtSale: true }), {
      'si.selling_unit_factor': 6,
      'si.cost_at_sale': null,
      'p.cost': null,
    }),
    0
  );
  assert.equal(
    evaluate(unitCostExpr('pti', 'p', { hasCostAtSale: false }), {
      'pti.selling_unit_factor': 6,
      'p.cost': null,
    }),
    0
  );

  // --- SUM wrapper keeps the same per-line expression ---------------------
  assert.equal(
    sumLineCostExpr('si', 'p', { hasCostAtSale: true }),
    `SUM(${lineCostExpr('si', 'p', { hasCostAtSale: true })})`
  );

  console.log('✓ cost-of-sale: sold lines cost per selling unit, not per base unit');
})();
