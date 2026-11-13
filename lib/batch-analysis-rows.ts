import { profitOf } from './profit';

/**
 * Expands one sold line into Batch Profit rows, one per inventory batch it
 * drew from. Pure (no DB) so the row arithmetic can be unit-tested.
 *
 * Batches are stocked and consumed in BASE units, so every row is in base
 * units: the selling price and the fallback cost are scaled down by the
 * line's selling-unit factor (NULL = base unit, factor 1).
 *
 * A line with NO batch split still produces a row, or the report silently
 * disagrees with every other sales report:
 *   - a RETURN line (negative quantity) is written without batch_source, and
 *     must reduce revenue and cost, as it does in Sales Transactions, Sales by
 *     Product and the readings (see lib/profit.ts);
 *   - a line that predates batch costing is still a sale.
 * Those rows are costed exactly as lib/cost-of-sale.ts costs them elsewhere
 * (`fallbackUnitCost` = the per-SELLING-unit cost from unitCostExpr).
 */
export type BatchLineInput = {
  qtySold: number | string;
  sellingPrice: number | string;
  sellingUnitFactor: number | string | null;
  batchSource: unknown;
  /** Cost of ONE selling unit, used only when the line has no batch split. */
  fallbackUnitCost: number | string | null;
};

export type BatchRow = {
  batchId: string | null;
  batchType: string;
  qtySold: number;
  unitCost: number;
  unitSellingPrice: number;
  lineRevenue: number;
  lineCost: number;
  lineProfit: number;
  marginPct: number;
};

const num = (v: unknown) => {
  const n = parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
};

function parseSplits(batchSource: unknown): any[] {
  if (!batchSource) return [];
  try {
    const v = typeof batchSource === 'string' ? JSON.parse(batchSource) : batchSource;
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function expandBatchLine(line: BatchLineInput): BatchRow[] {
  const factor = num(line.sellingUnitFactor) || 1;
  const pricePerBase = num(line.sellingPrice) / factor;
  const lineQty = num(line.qtySold);

  const row = (batchId: string | null, batchType: string, qty: number, unitCost: number): BatchRow => {
    const lineRevenue = qty * pricePerBase;
    const lineCost = qty * unitCost;
    const lineProfit = profitOf(lineRevenue, lineCost);
    const margin = lineRevenue !== 0 ? (lineProfit / lineRevenue) * 100 : 0;
    return {
      batchId, batchType, qtySold: qty, unitCost, unitSellingPrice: pricePerBase,
      lineRevenue, lineCost, lineProfit, marginPct: parseFloat(margin.toFixed(2)),
    };
  };

  const splits = parseSplits(line.batchSource);
  if (splits.length > 0) {
    return splits.map((s) => row(s.batchId ?? null, s.type || 'batch', num(s.qty), num(s.unitCost)));
  }

  return [row(null, lineQty < 0 ? 'return' : 'unbatched', lineQty * factor, num(line.fallbackUnitCost) / factor)];
}
