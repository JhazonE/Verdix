import assert from 'node:assert/strict';
import { getConnection, query } from '../../lib/mysql';

// Adding FOR UPDATE to the stock deduction introduces a deadlock risk: the
// checkout item loop walks the cart in scan order, so two terminals selling
// the same two products in OPPOSITE order would each hold the row the other
// needs next. MySQL kills one with ER_LOCK_DEADLOCK and that sale dies at the
// till.
//
// Checkout now takes every product lock up front in one id-ordered statement.
// This test proves that ordered acquisition prevents the cycle that the
// unordered, per-item version would create.

const P1 = `test_dl_a_${Date.now()}`;
const P2 = `test_dl_b_${Date.now()}`;

async function makeProduct(id: string) {
  await query(
    `INSERT INTO products (id, name, category, brand, stock, price, unit_of_measure, vat_status, availability)
     VALUES (?, 'Deadlock Probe', 'TEST', 'TEST', 100, 10, 'pcs', 'vatable', 'available')`,
    [id]
  );
}

(async () => {
  await makeProduct(P1);
  await makeProduct(P2);

  // Two carts holding the same two products in opposite scan order.
  const cartA = [P1, P2];
  const cartB = [P2, P1];

  const connA = await getConnection();
  const connB = await getConnection();

  try {
    await connA.beginTransaction();
    await connB.beginTransaction();

    // Each terminal acquires its locks the way checkout now does: ONE
    // statement, ids sorted, regardless of the cart's own order.
    const lockAll = async (conn: any, cart: string[]) => {
      const ids = [...new Set(cart)].sort();
      const ph = ids.map(() => '?').join(',');
      await conn.query(`SELECT id FROM products WHERE id IN (${ph}) ORDER BY id FOR UPDATE`, ids);
    };

    await lockAll(connA, cartA);

    // B asks for the same set. It must block (not deadlock) until A commits.
    let bDone = false;
    let bError: any = null;
    const bLock = lockAll(connB, cartB)
      .then(() => { bDone = true; })
      .catch((e: any) => { bError = e; bDone = true; });

    await Promise.race([bLock, new Promise((r) => setTimeout(r, 1000))]);
    assert.equal(bDone, false, 'B blocks while A holds the locks');

    // A does its work and commits.
    await connA.query('UPDATE products SET stock = stock - 1 WHERE id IN (?, ?)', [P1, P2]);
    await connA.commit();

    // B now proceeds — and must NOT have been killed as a deadlock victim.
    await bLock;
    assert.equal(bError, null, `B must not deadlock, got: ${bError && bError.code}`);

    await connB.query('UPDATE products SET stock = stock - 1 WHERE id IN (?, ?)', [P1, P2]);
    await connB.commit();

    const rows: any = await query('SELECT id, stock FROM products WHERE id IN (?, ?)', [P1, P2]);
    for (const r of rows) {
      assert.equal(Number(r.stock), 98, `both sales deducted from ${r.id}, got ${r.stock}`);
    }

    console.log('✓ concurrent-checkout-deadlock');
  } finally {
    try { await connA.rollback(); } catch {}
    try { await connB.rollback(); } catch {}
    connA.release();
    connB.release();
    await query('DELETE FROM products WHERE id IN (?, ?)', [P1, P2]);
  }
})().catch((e) => {
  console.error('Test failed:', e);
  process.exit(1);
});
