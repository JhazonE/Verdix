import assert from 'node:assert/strict';
import {
  LOW_STOCK_ALERT_LIMIT,
  buildLowStockAlertQuery,
  isLowStock,
} from '../../lib/low-stock-alerts';

// The bug this exists to fix: the notification bell's query was
// `stock < reorder_point OR stock < <global threshold>`, which counts a
// zero-stock product as low stock. On a bulk-imported catalogue that matched
// 15,982 of 15,987 products (15,919 of them never stocked), so a server action
// tried to ship ~1.8 MB to the browser every 30 seconds and the fetch failed.
//
// `getStockStatus` (lib's UI rule) calls stock === 0 "out of stock", NOT low
// stock. These assertions pin the two definitions together.
{
  // Zero stock is out-of-stock, never a low-stock alert.
  assert.equal(isLowStock(0, 5, 10), false, 'zero stock is not a low-stock alert');
  assert.equal(isLowStock(0, 0, 10), false, 'never-stocked import is not an alert');
}

{
  // Below the effective threshold, with stock on hand, is the real alert.
  assert.equal(isLowStock(3, 5, 10), true, 'under its own reorder point');
  assert.equal(isLowStock(8, 0, 10), true, 'under the global floor');
}

{
  // The effective threshold is the HIGHER of the two, matching
  // getStockStatus's Math.max(reorderPoint, globalLowStockThreshold).
  assert.equal(isLowStock(12, 20, 10), true, 'reorder point above global floor wins');
  assert.equal(isLowStock(12, 5, 10), false, 'at or above both thresholds is fine');
  assert.equal(isLowStock(10, 10, 10), false, 'exactly at threshold is in stock');
}

{
  // The query must exclude zero stock and must be bounded, so a catalogue of
  // any size can never produce an unbounded server-action payload.
  const { sql, params } = buildLowStockAlertQuery(10);
  assert.ok(/stock\s*>\s*0/.test(sql), 'query excludes zero stock');
  assert.ok(/GREATEST/i.test(sql), 'query uses the higher of the two thresholds');
  assert.ok(/LIMIT/i.test(sql), 'query is bounded');
  assert.ok(params.includes(10), 'threshold is parameterised, not interpolated');
  assert.ok(params.includes(LOW_STOCK_ALERT_LIMIT), 'limit is parameterised');
}

{
  // A non-numeric / missing threshold must not disable the bound or produce
  // NaN in the SQL parameters.
  const { params } = buildLowStockAlertQuery(undefined as unknown as number);
  assert.ok(params.every((p) => Number.isFinite(p)), 'no NaN reaches the query');
}

console.log('✓ low-stock-alerts');
