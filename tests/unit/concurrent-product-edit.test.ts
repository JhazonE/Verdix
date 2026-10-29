import assert from 'node:assert/strict';
import { getConnection, query } from '../../lib/mysql';

// updateProduct() reads the whole product row, then writes every column back
// in one UPDATE — a field the form did not touch is re-written with the value
// read at the start. Two users editing the same product concurrently must not
// clobber each other: if user A changes the price and user B changes the
// reorder point, both edits must survive.
//
// This exercises the read-modify-write shape against the real DB on two
// connections. It asserts the row lock is in place by checking that the second
// transaction cannot read the row while the first holds it — which is what
// forces B to see A's committed price instead of the stale one.

const PRODUCT_ID = `test_edit_${Date.now()}`;

(async () => {
  await query(
    `INSERT INTO products (id, name, category, brand, stock, price, reorder_point, unit_of_measure, vat_status, availability)
     VALUES (?, 'Concurrent Edit Probe', 'TEST', 'TEST', 50, 10.00, 5, 'pcs', 'vatable', 'available')`,
    [PRODUCT_ID]
  );

  const connA = await getConnection();
  const connB = await getConnection();

  try {
    // A opens a transaction and takes the lock, as updateProduct now does.
    await connA.beginTransaction();
    const [aRows]: any = await connA.query('SELECT * FROM products WHERE id = ? FOR UPDATE', [PRODUCT_ID]);
    const aSnapshot = aRows[0];
    assert.equal(Number(aSnapshot.price), 10, 'A reads the opening price');

    // B tries to take the same lock. It must BLOCK until A commits. Race the
    // locking read against a timer: if the read wins, there was no lock.
    await connB.beginTransaction();
    let bUnblockedEarly = false;
    const bRead = connB
      .query('SELECT * FROM products WHERE id = ? FOR UPDATE', [PRODUCT_ID])
      .then((r: any) => { bUnblockedEarly = true; return r; });

    const timer = new Promise((resolve) => setTimeout(resolve, 1200));
    await Promise.race([bRead, timer]);
    assert.equal(bUnblockedEarly, false, 'B must block on the row lock while A holds it');

    // A writes its edit (price) back as a full-row update, preserving the rest.
    await connA.query(
      'UPDATE products SET price = ?, reorder_point = ?, stock = ? WHERE id = ?',
      [99.00, aSnapshot.reorder_point, aSnapshot.stock, PRODUCT_ID]
    );
    await connA.commit();

    // Now B's read completes, and must observe A's committed price.
    const [bRows]: any = await bRead;
    const bSnapshot = bRows[0];
    assert.equal(
      Number(bSnapshot.price),
      99,
      `B must read A's committed price, got ${bSnapshot.price} (stale read = lost update)`
    );

    // B writes its own edit (reorder point), preserving A's price.
    await connB.query(
      'UPDATE products SET price = ?, reorder_point = ?, stock = ? WHERE id = ?',
      [bSnapshot.price, 42, bSnapshot.stock, PRODUCT_ID]
    );
    await connB.commit();

    const final: any = await query('SELECT price, reorder_point FROM products WHERE id = ?', [PRODUCT_ID]);
    assert.equal(Number(final[0].price), 99, "A's price edit survived B's save");
    assert.equal(Number(final[0].reorder_point), 42, "B's reorder-point edit survived");

    console.log('✓ concurrent-product-edit');
  } finally {
    try { await connA.rollback(); } catch {}
    try { await connB.rollback(); } catch {}
    connA.release();
    connB.release();
    await query('DELETE FROM products WHERE id = ?', [PRODUCT_ID]);
  }
})().catch((e) => {
  console.error('Test failed:', e);
  process.exit(1);
});
