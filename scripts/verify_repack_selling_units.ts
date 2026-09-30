/**
 * Manual check for repackSellingUnits against the isolated E2E database.
 * Run with: DB_NAME=verdix_test npx tsx scripts/verify_repack_selling_units.ts
 * Refuses to run against any other database.
 */
import assert from 'node:assert/strict';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  assert.equal(process.env.DB_NAME, 'verdix_test', 'Refusing to run outside verdix_test');

  const { query } = await import('../lib/mysql');
  const { repackSellingUnits } = await import('../app/(app)/inventory/repackaging/actions');

  const productId = 'test-po-case-product-1';
  const caseUnitId = 'psu_case_test-po-case-product-1';
  const [baseUnit]: any = await query(
    'SELECT id FROM product_selling_units WHERE product_id = ? AND is_base = 1',
    [productId],
  );
  assert.ok(baseUnit, 'base unit seeded');

  const stock = async () =>
    Number(((await query('SELECT stock FROM products WHERE id = ?', [productId])) as any)[0].stock);
  const setStock = (n: number) => query('UPDATE products SET stock = ? WHERE id = ?', [n, productId]);

  // 1. Case -> Piece, no loss: stock untouched, log written with unit snapshots.
  await setStock(50);
  let r = await repackSellingUnits({ productId, fromUnitId: caseUnitId, toUnitId: baseUnit.id, quantity: 1 }, 'verify');
  assert.equal(r.success, true, r.message);
  assert.equal(await stock(), 50, 'no-loss repack leaves stock alone');
  let log: any = ((await query(
    'SELECT * FROM repackaging_logs WHERE source_product_id = ? ORDER BY created_at DESC LIMIT 1',
    [productId],
  )) as any)[0];
  assert.equal(log.source_selling_unit_name, 'Case');
  assert.equal(log.target_selling_unit_name, 'Piece');
  assert.equal(Number(log.target_qty_produced), 24);
  assert.equal(Number(log.shortfall_base_qty), 0);

  // 2. Shortfall: 22 of 24 pieces obtained -> 2 written off with a movement.
  r = await repackSellingUnits({ productId, fromUnitId: caseUnitId, toUnitId: baseUnit.id, quantity: 1, actualProduced: 22 }, 'verify');
  assert.equal(r.success, true, r.message);
  assert.equal(await stock(), 48, 'shortfall of 2 leaves stock');
  const mv: any = ((await query(
    "SELECT quantity_change FROM stock_movements WHERE product_id = ? AND notes LIKE 'Repackaging shortfall%' ORDER BY created_at DESC LIMIT 1",
    [productId],
  )) as any)[0];
  assert.equal(Number(mv.quantity_change), -2);

  // 3. Merge upward: 48 Piece -> 2 Case, consolidate direction recorded.
  r = await repackSellingUnits({ productId, fromUnitId: baseUnit.id, toUnitId: caseUnitId, quantity: 48 }, 'verify');
  assert.equal(r.success, true, r.message);
  assert.equal(await stock(), 48);
  log = ((await query(
    'SELECT notes, target_qty_produced FROM repackaging_logs WHERE source_product_id = ? ORDER BY created_at DESC LIMIT 1',
    [productId],
  )) as any)[0];
  assert.equal(log.notes, 'consolidate');
  assert.equal(Number(log.target_qty_produced), 2);

  // 4. Rejections leave everything alone.
  r = await repackSellingUnits({ productId, fromUnitId: caseUnitId, toUnitId: baseUnit.id, quantity: 3 }, 'verify');
  assert.equal(r.success, false, '3 Case = 72 > 48 in stock');
  assert.match(r.message, /insufficient/i);
  r = await repackSellingUnits({ productId, fromUnitId: caseUnitId, toUnitId: caseUnitId, quantity: 1 }, 'verify');
  assert.equal(r.success, false, 'same unit rejected');
  r = await repackSellingUnits({ productId, fromUnitId: caseUnitId, toUnitId: baseUnit.id, quantity: 1, actualProduced: 25 }, 'verify');
  assert.equal(r.success, false, 'more out than in rejected');
  assert.equal(await stock(), 48, 'rejected calls change nothing');

  console.log('repackSellingUnits checks passed');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
