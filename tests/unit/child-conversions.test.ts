import assert from 'node:assert/strict';
import { query } from '../../lib/mysql';
import { updateChildConversions } from '../../app/(app)/products/actions';

/**
 * conversion_factors is keyed (product_id, unit) on the PARENT, so these tests
 * assert against that shape — including the case where two children sharing a
 * unit share one row.
 */

const SUFFIX = `cc_${Date.now()}`;
const PARENT_ID = `test_parent_${SUFFIX}`;
const CHILD_A = `test_child_a_${SUFFIX}`;
const CHILD_B = `test_child_b_${SUFFIX}`;

async function makeProduct(id: string, name: string, unit: string, parentId: string | null) {
  await query(
    `INSERT INTO products (id, name, sku, unit_of_measure, stock, price, cost, parent_id)
     VALUES (?, ?, ?, ?, 0, 10, 5, ?)`,
    [id, name, `SKU-${id}`, unit, parentId],
  );
}

async function factorFor(unit: string): Promise<number | null> {
  const rows: any = await query(
    'SELECT factor FROM conversion_factors WHERE product_id = ? AND unit = ?',
    [PARENT_ID, unit],
  );
  return rows[0] ? Number(rows[0].factor) : null;
}

async function rowCountFor(unit: string): Promise<number> {
  const rows: any = await query(
    'SELECT COUNT(*) AS n FROM conversion_factors WHERE product_id = ? AND unit = ?',
    [PARENT_ID, unit],
  );
  return Number(rows[0].n);
}

async function cleanup() {
  await query('DELETE FROM conversion_factors WHERE product_id = ?', [PARENT_ID]);
  await query('DELETE FROM products WHERE id IN (?, ?, ?)', [PARENT_ID, CHILD_A, CHILD_B]);
}

(async () => {
  try {
    await cleanup();
    await makeProduct(PARENT_ID, `CC Parent ${SUFFIX}`, 'Sack', null);
    await makeProduct(CHILD_A, `CC Child A ${SUFFIX}`, 'Kilo', PARENT_ID);
    await makeProduct(CHILD_B, `CC Child B ${SUFFIX}`, 'Kilo', PARENT_ID);

    // --- a numeric factor upserts ---
    {
      const r = await updateChildConversions(PARENT_ID, [{ unit: 'Kilo', factor: 25 }]);
      assert.equal(r.success, true, `upsert should succeed: ${r.message}`);
      assert.equal(await factorFor('Kilo'), 25, 'factor is written');
    }

    // --- upserting the same unit UPDATES rather than duplicating ---
    {
      const r = await updateChildConversions(PARENT_ID, [{ unit: 'Kilo', factor: 24 }]);
      assert.equal(r.success, true, 'second upsert succeeds');
      assert.equal(await factorFor('Kilo'), 24, 'factor is updated');
      assert.equal(await rowCountFor('Kilo'), 1, 'still exactly ONE row for this unit');
    }

    // --- 0 is REJECTED and writes nothing ---
    {
      const before = await factorFor('Kilo');
      const r = await updateChildConversions(PARENT_ID, [{ unit: 'Kilo', factor: 0 }]);
      assert.equal(r.success, false, 'a zero factor is rejected');
      assert.equal(await factorFor('Kilo'), before, 'a rejected batch writes nothing');
    }

    // --- a negative is REJECTED ---
    {
      const r = await updateChildConversions(PARENT_ID, [{ unit: 'Kilo', factor: -3 }]);
      assert.equal(r.success, false, 'a negative factor is rejected');
    }

    // --- one bad row rejects the WHOLE batch (nothing partial) ---
    {
      await updateChildConversions(PARENT_ID, [{ unit: 'Kilo', factor: 24 }]);
      const r = await updateChildConversions(PARENT_ID, [
        { unit: 'Kilo', factor: 30 },
        { unit: 'Gram', factor: 0 },
      ]);
      assert.equal(r.success, false, 'the batch is rejected');
      assert.equal(await factorFor('Kilo'), 24, 'the valid row in a rejected batch was NOT written');
      assert.equal(await factorFor('Gram'), null, 'the invalid row was not written either');
    }

    // --- null DELETES the row; it does not write 0 ---
    {
      const r = await updateChildConversions(PARENT_ID, [{ unit: 'Kilo', factor: null }]);
      assert.equal(r.success, true, `null should succeed: ${r.message}`);
      assert.equal(await rowCountFor('Kilo'), 0, 'null removes the row');
      assert.notEqual(await factorFor('Kilo'), 0, 'null must NOT be stored as 0');
    }

    // --- an empty batch is a successful no-op, not an error ---
    {
      const r = await updateChildConversions(PARENT_ID, []);
      assert.equal(r.success, true, 'saving nothing is a success, not a failure');
    }

    console.log('✅ child-conversions tests passed');
    await cleanup();
    process.exit(0);
  } catch (error) {
    console.error('❌ child-conversions tests FAILED');
    console.error(error);
    await cleanup();
    process.exit(1);
  }
})();
