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

    // clearStockAndReassign's own child/parent-exist guards run BEFORE the stock
    // clear, so a rejection there (e.g. a missing parent id) never reaches the
    // clear at all and proves nothing about rollback. The self-parent rejection
    // is different: clearStockAndReassign looks up CHILD_ID as both the child
    // and the "parent" (same row, so both of its own guards pass), clears
    // CHILD_ID's stock, and only THEN calls reassignParentOnConnection, which
    // rejects on its `childId === newParentId` check. That rejection is raised
    // strictly after the clear, inside the same transaction — exactly the path
    // the ReassignRejectedError fix exists to roll back.
    const before = await stockOf(CHILD_ID);
    const bad = await clearStockAndReassign(CHILD_ID, CHILD_ID, 2);
    assert.equal(bad.success, false, 'a product cannot become its own parent');
    assert.equal(
      await stockOf(CHILD_ID),
      before,
      'ROLLBACK: a failed attach must leave stock exactly as it was',
    );

    console.log('✅ clear-stock-and-reassign tests passed');
  } catch (error) {
    console.error('❌ clear-stock-and-reassign tests FAILED');
    console.error(error);
    await cleanup();
    process.exit(1);
  }
  await cleanup();
  process.exit(0);
})();
