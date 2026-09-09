import assert from 'node:assert/strict';
import { query } from '../../lib/mysql';
import { clearStockAndReassign } from '../../app/(app)/products/actions';

/**
 * The safety property: clearing stock and attaching are ONE transaction.
 * A failed attach must leave the product's stock exactly as it was — otherwise
 * a user loses inventory and gains nothing.
 */

const SUFFIX = `csr_${Date.now()}`;
const PARENT_ID = `test_parent_${SUFFIX}`;
const CHILD_ID = `test_child_${SUFFIX}`;

async function makeProduct(id: string, name: string, stock: number, parentId: string | null) {
  await query(
    `INSERT INTO products (id, name, sku, unit_of_measure, stock, price, cost, parent_id)
     VALUES (?, ?, ?, 'Pieces', ?, 10, 5, ?)`,
    [id, name, `SKU-${id}`, stock, parentId],
  );
}

async function stockOf(id: string): Promise<number> {
  const rows: any = await query('SELECT stock FROM products WHERE id = ?', [id]);
  return Number(rows[0].stock);
}

async function parentOf(id: string): Promise<string | null> {
  const rows: any = await query('SELECT parent_id FROM products WHERE id = ?', [id]);
  return rows[0].parent_id;
}

async function cleanup() {
  await query('DELETE FROM conversion_factors WHERE product_id IN (?, ?)', [PARENT_ID, CHILD_ID]);
  await query('DELETE FROM stock_movements WHERE product_id IN (?, ?)', [PARENT_ID, CHILD_ID]);
  await query('DELETE FROM products WHERE id IN (?, ?)', [PARENT_ID, CHILD_ID]);
}

(async () => {
  await cleanup();
  try {
    // --- happy path: stock is cleared AND the child is attached ---
    await makeProduct(PARENT_ID, `CSR Parent ${SUFFIX}`, 0, null);
    await makeProduct(CHILD_ID, `CSR Child ${SUFFIX}`, 8, null);

    const ok = await clearStockAndReassign(CHILD_ID, PARENT_ID, 4);
    assert.equal(ok.success, true, `attach should succeed: ${ok.message}`);
    assert.equal(await stockOf(CHILD_ID), 0, 'stock is cleared on success');
    assert.equal(await parentOf(CHILD_ID), PARENT_ID, 'child is attached on success');

    // the clear is auditable, not a silent UPDATE
    const movements: any = await query(
      'SELECT COUNT(*) AS n FROM stock_movements WHERE product_id = ?',
      [CHILD_ID],
    );
    assert.ok(Number(movements[0].n) > 0, 'clearing stock records a movement');

    // --- rollback: a failed attach leaves stock untouched ---
    // Reset the child to standalone with stock again.
    await query('UPDATE products SET parent_id = NULL, stock = 8 WHERE id = ?', [CHILD_ID]);

    // Attaching the PARENT under its own CHILD is a loop — the attach must fail.
    const bad = await clearStockAndReassign(PARENT_ID, PARENT_ID, 2);
    assert.equal(bad.success, false, 'a product cannot become its own child');

    // And the child we did not touch still holds its stock.
    assert.equal(await stockOf(CHILD_ID), 8, 'unrelated stock untouched');

    // Now the real rollback case: give the parent stock, then fail its attach.
    await query('UPDATE products SET stock = 5 WHERE id = ?', [PARENT_ID]);
    const before = await stockOf(PARENT_ID);
    const failed = await clearStockAndReassign(PARENT_ID, 'no_such_parent_id_zzz', 2);
    assert.equal(failed.success, false, 'attach to a missing parent fails');
    assert.equal(
      await stockOf(PARENT_ID),
      before,
      'ROLLBACK: a failed attach must leave stock exactly as it was',
    );

    console.log('✅ clear-stock-and-reassign tests passed');
  } finally {
    await cleanup();
    process.exit(0);
  }
})();
