import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { applyAdjustment } from '../../lib/price-update-math';

/**
 * Bulk-setting a price level on products that have never had one must start
 * from the unit's OWN price, not from 0.
 *
 * The situation this covers: a store adds a level (PEDDLER) long after its
 * catalogue exists. `addPriceLevel` only writes the level definition — it does
 * not back-fill a row per selling unit, and nothing else does either. So every
 * existing product resolves that level to its shelf price (correct: see
 * lib/pricing.ts) until someone sets a real one. Inventory -> Pricing is the
 * tool for setting them in bulk, and its upsert already creates the missing
 * rows.
 *
 * But the preview read a missing row as `0`, which made that tool unusable for
 * precisely the job it is needed for. The arithmetic below is the whole bug:
 * off a 0 start, a percentage writes 0 and a fixed amount writes the
 * adjustment by itself. Only 'exact' and 'markup' escaped, because they ignore
 * the current value — which is why this could go unnoticed.
 */

// --- the arithmetic that made a 0 start wrong ---
{
  const shelfPrice = 16;

  // From 0, as it was.
  assert.equal(
    applyAdjustment('percentage', 0, 25), 0,
    'a percentage off a 0 start writes 0 — a free product',
  );
  assert.equal(
    applyAdjustment('fixed', 0, 4), 4,
    'a fixed amount off a 0 start writes the adjustment alone, not shelf + 4',
  );

  // From the unit's own price, as it is now.
  assert.equal(
    applyAdjustment('percentage', shelfPrice, 25), 20,
    'a percentage off the shelf price gives the intended level price',
  );
  assert.equal(
    applyAdjustment('fixed', shelfPrice, 4), 20,
    'a fixed amount off the shelf price gives the intended level price',
  );

  // These two never depended on the start, which is why the bug hid.
  assert.equal(applyAdjustment('exact', 0, 20), 20, 'exact ignores the start');
  assert.equal(
    applyAdjustment('markup', 0, 100, 10), 20,
    'markup derives from cost and ignores the start',
  );
}

// --- the preview must fall back to the unit price, not 0 ---
{
  const hook = fs.readFileSync(
    path.join(
      process.cwd(),
      'app', '(app)', 'products', 'bulk-price-update', 'use-bulk-price-update.ts',
    ),
    'utf8',
  );

  const at = hook.indexOf('const currentValue =');
  assert.ok(at > -1, 'the preview should still compute a currentValue');
  const expr = hook.slice(at, hook.indexOf(';', at));

  assert.ok(
    /levelId === priceLevelId\)\?\.price \?\? r\.price/.test(expr),
    'a unit with no row for the chosen level must fall back to its OWN price ' +
      '(the rule lib/pricing.ts resolves by), never to 0 — a 0 start makes ' +
      'percentage and fixed adjustments write 0 and the bare adjustment',
  );
  assert.ok(
    !/levelId === priceLevelId\)\?\.price \?\? 0/.test(expr),
    'the `?? 0` fallback must not come back',
  );
}

console.log('✅ price level seeds from unit price tests passed');
