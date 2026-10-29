import assert from 'node:assert/strict';
import { getConnection, query } from '../../lib/mysql';
import { updateStockAndRecordMovement } from '../../lib/stock-movements';

// Two terminals deducting the same product at the same time must not lose a
// deduction. updateStockAndRecordMovement reads products.stock, computes the
// new figure in JS, then writes it back as an ABSOLUTE value. Without a row
// lock on the read, two interleaved transactions both read the same starting
// stock and the second write overwrites the first — stock silently gains back
// the first deduction, and both stock_movements rows claim the same
// previous_stock, so the audit trail contradicts itself.
//
// This reproduces the interleaving deterministically by holding both
// transactions open across each other's reads, rather than hoping for a
// natural race.

const PRODUCT_ID = `test_race_${Date.now()}`;
const START_STOCK = 100;

(async () => {
  // Minimal product row. warehouse_id/supplier_id are nullable.
  await query(
    `INSERT INTO products (id, name, category, brand, stock, price, unit_of_measure, vat_status, availability)
     VALUES (?, 'Concurrency Race Probe', 'TEST', 'TEST', ?, 10, 'pcs', 'vatable', 'available')`,
    [PRODUCT_ID, START_STOCK]
  );

  const connA = await getConnection();
  const connB = await getConnection();

  try {
    await connA.beginTransaction();
    await connB.beginTransaction();

    // Interleave deliberately: A reads, B reads, A writes, B writes.
    // Both helpers do read-then-write internally, so to force the overlap we
    // read on each connection FIRST, then let the helper run its own
    // read-modify-write. With a FOR UPDATE lock in the helper, B's read will
    // block until A commits and B will observe A's write.
    const [aRows]: any = await connA.query('SELECT stock FROM products WHERE id = ?', [PRODUCT_ID]);
    const [bRows]: any = await connB.query('SELECT stock FROM products WHERE id = ?', [PRODUCT_ID]);
    assert.equal(Number(aRows[0].stock), START_STOCK, 'A sees the starting stock');
    assert.equal(Number(bRows[0].stock), START_STOCK, 'B sees the starting stock');

    // A deducts 2 and commits.
    await updateStockAndRecordMovement(
      PRODUCT_ID, -2, 'sale', `race_a_${Date.now()}`, 'sale', 'Terminal A', connA as any
    );
    await connA.commit();

    // B deducts 3 and commits. B's helper re-reads inside its own transaction.
    await updateStockAndRecordMovement(
      PRODUCT_ID, -3, 'sale', `race_b_${Date.now()}`, 'sale', 'Terminal B', connB as any
    );
    await connB.commit();

    const after: any = await query('SELECT stock FROM products WHERE id = ?', [PRODUCT_ID]);
    const finalStock = Number(after[0].stock);

    assert.equal(
      finalStock,
      START_STOCK - 5,
      `both deductions must survive: expected ${START_STOCK - 5}, got ${finalStock}`
    );

    // The audit trail must also be coherent: no two movements may claim the
    // same previous_stock, and the last new_stock must equal the real figure.
    // stock_movements.id is a UUID, so it cannot be ordered chronologically —
    // sort by the deduction each row recorded instead (A deducted 2, B 3).
    const moves: any = await query(
      'SELECT quantity_change, previous_stock, new_stock FROM stock_movements WHERE product_id = ?',
      [PRODUCT_ID]
    );
    assert.equal(moves.length, 2, 'both movements recorded');

    const prevs = moves.map((m: any) => Number(m.previous_stock));
    assert.equal(new Set(prevs).size, prevs.length, `movements must not share a previous_stock, got ${JSON.stringify(prevs)}`);

    // The chain must be continuous: one row starts at the opening stock, and
    // the other picks up exactly where the first left off, ending at the real
    // figure. That is what a lost update breaks.
    const chain = moves
      .map((m: any) => ({ prev: Number(m.previous_stock), next: Number(m.new_stock) }))
      .sort((x: any, y: any) => y.prev - x.prev);
    assert.equal(chain[0].prev, START_STOCK, 'first movement starts at the opening stock');
    assert.equal(chain[1].prev, chain[0].next, 'second movement starts where the first ended');
    assert.equal(chain[1].next, finalStock, 'last movement agrees with products.stock');

    console.log('✓ concurrent-stock-race');
  } finally {
    try { await connA.rollback(); } catch {}
    try { await connB.rollback(); } catch {}
    connA.release();
    connB.release();
    await query('DELETE FROM stock_movements WHERE product_id = ?', [PRODUCT_ID]);
    await query('DELETE FROM products WHERE id = ?', [PRODUCT_ID]);
  }
})().catch((e) => {
  console.error('Test failed:', e);
  process.exit(1);
});
