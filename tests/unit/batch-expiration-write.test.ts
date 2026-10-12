import assert from 'node:assert/strict';

import { withTransaction } from '../../lib/mysql';
import { resolveExpirationEdits } from '../../lib/batch-expiration-edit';
import { applyExpirationEdits } from '../../lib/batch-expiration-write';

/**
 * DB-backed proof that setting an expiration date does NOT move stock.
 *
 * batch-expiration-edit.test.ts pins the pure planning logic; this exercises the
 * actual writes against real tables, inside a transaction that is rolled back.
 * The pure tests cannot catch a wrong column, a broken UPDATE predicate, or a
 * products.stock mutation — only this can.
 */
(async () => {
  await withTransaction(async (connection) => {
    const productId = 'TEST-EXPWRITE-PROD-1';

    // products.type is ENUM('standard','service'); is_perishable gates the UI.
    await connection.query(
      `INSERT INTO products (id, name, sku, stock, cost, price, type, unit_of_measure, is_perishable, earns_points, created_at, updated_at)
       VALUES (?, 'Test Expiry Milk', 'TEST-EXPWRITE-SKU-1', 100, 20, 30, 'standard', 'Piece', 1, 1, NOW(), NOW())`,
      [productId]
    );

    // Two batches covering 40 of the 100 units on hand, so 60 units are
    // "untracked" — the exact gap this feature exists to close.
    await connection.query(
      `INSERT INTO inventory_batches (id, product_id, received_date, quantity_in, quantity_remaining, unit_cost, selling_price, source_type, created_at, updated_at)
       VALUES (?, ?, CURDATE(), 30, 30, 20, 30, 'purchase', NOW(), NOW())`,
      ['991001', productId]
    );
    await connection.query(
      `INSERT INTO inventory_batches (id, product_id, received_date, quantity_in, quantity_remaining, unit_cost, selling_price, source_type, created_at, updated_at)
       VALUES (?, ?, CURDATE(), 10, 10, 20, 30, 'purchase', NOW(), NOW())`,
      ['991002', productId]
    );
    // An exhausted batch must never be written to: it drives neither the
    // expiring-soon report nor the expiration cache (both need qty > 0).
    await connection.query(
      `INSERT INTO inventory_batches (id, product_id, received_date, quantity_in, quantity_remaining, unit_cost, selling_price, source_type, created_at, updated_at)
       VALUES (?, ?, CURDATE(), 5, 0, 20, 30, 'purchase', NOW(), NOW())`,
      ['991003', productId]
    );

    const [beforeRows]: any = await connection.query(
      'SELECT stock FROM products WHERE id = ?',
      [productId]
    );
    const stockBefore = Number(beforeRows[0].stock);
    assert.equal(stockBefore, 100, 'fixture starts at 100 units');

    const plan = resolveExpirationEdits({
      productStock: stockBefore,
      batches: [
        { id: '991001', quantityRemaining: 30 },
        { id: '991002', quantityRemaining: 10 },
        { id: '991003', quantityRemaining: 0 },
      ],
      updates: [{ batchId: '991001', expirationDate: '2026-12-01' }],
      untrackedExpiration: '2027-01-15',
    });

    assert.equal(plan.openingBatch?.quantity, 60, 'plan covers the 60-unit gap');

    const result = await applyExpirationEdits(connection, {
      productId,
      plan,
      unitCost: 20,
      sellingPrice: 30,
    });

    assert.equal(result.updated, 1, 'one existing batch was updated');
    assert.ok(result.openingBatchId, 'an opening batch was created');

    // THE central guarantee of this feature: stock is untouched.
    const [afterRows]: any = await connection.query(
      'SELECT stock, DATE_FORMAT(expiration_date, "%Y-%m-%d") AS exp FROM products WHERE id = ?',
      [productId]
    );
    assert.equal(
      Number(afterRows[0].stock),
      100,
      'setting an expiration date must NEVER change products.stock'
    );

    // products.expiration_date is a cache of the SOONEST batch still in stock.
    assert.equal(
      afterRows[0].exp,
      '2026-12-01',
      'the cache holds the soonest live batch expiry, not the latest'
    );

    const [b1]: any = await connection.query(
      'SELECT DATE_FORMAT(expiration_date, "%Y-%m-%d") AS exp FROM inventory_batches WHERE id = ?',
      ['991001']
    );
    assert.equal(b1[0].exp, '2026-12-01', 'the edited batch carries its new date');

    const [b2]: any = await connection.query(
      'SELECT expiration_date FROM inventory_batches WHERE id = ?',
      ['991002']
    );
    assert.equal(b2[0].expiration_date, null, 'an unedited batch is left alone');

    const [b3]: any = await connection.query(
      'SELECT expiration_date FROM inventory_batches WHERE id = ?',
      ['991003']
    );
    assert.equal(b3[0].expiration_date, null, 'the exhausted batch was never written to');

    // The opening batch registers stock already counted in products.stock, so
    // quantity_in must equal quantity_remaining — none of it was consumed
    // through this batch.
    const [opening]: any = await connection.query(
      `SELECT quantity_in, quantity_remaining, source_type,
              DATE_FORMAT(expiration_date, "%Y-%m-%d") AS exp
       FROM inventory_batches WHERE id = ?`,
      [result.openingBatchId]
    );
    assert.equal(Number(opening[0].quantity_in), 60, 'opening batch quantity_in covers the gap');
    assert.equal(
      Number(opening[0].quantity_remaining),
      60,
      'opening batch is fully unconsumed'
    );
    assert.equal(opening[0].source_type, 'opening', 'opening batch is tagged as such');
    assert.equal(opening[0].exp, '2027-01-15', 'opening batch carries the untracked date');

    // After the opening batch exists, total live batch coverage equals stock —
    // so a second visit offers no untracked row (no double-counting).
    const [coverage]: any = await connection.query(
      `SELECT COALESCE(SUM(quantity_remaining), 0) AS covered
       FROM inventory_batches
       WHERE product_id = ? AND quantity_remaining > 0`,
      [productId]
    );
    assert.equal(
      Number(coverage[0].covered),
      100,
      'live batches now account for exactly the stock on hand'
    );

    // Clearing a date writes NULL, which must drop it out of the cache too.
    const clearPlan = resolveExpirationEdits({
      productStock: 100,
      batches: [
        { id: '991001', quantityRemaining: 30 },
        { id: '991002', quantityRemaining: 10 },
        { id: String(result.openingBatchId), quantityRemaining: 60 },
      ],
      updates: [{ batchId: '991001', expirationDate: '' }],
    });
    await applyExpirationEdits(connection, {
      productId,
      plan: clearPlan,
      unitCost: 20,
      sellingPrice: 30,
    });

    const [cleared]: any = await connection.query(
      'SELECT expiration_date FROM inventory_batches WHERE id = ?',
      ['991001']
    );
    assert.equal(cleared[0].expiration_date, null, 'a blank date clears the column to NULL');

    const [recached]: any = await connection.query(
      'SELECT DATE_FORMAT(expiration_date, "%Y-%m-%d") AS exp FROM products WHERE id = ?',
      [productId]
    );
    assert.equal(
      recached[0].exp,
      '2027-01-15',
      'clearing the soonest date re-derives the cache from the remaining batches'
    );

    const [stockFinal]: any = await connection.query(
      'SELECT stock FROM products WHERE id = ?',
      [productId]
    );
    assert.equal(Number(stockFinal[0].stock), 100, 'stock is still untouched after a clear');

    throw new Error('__TEST_ROLLBACK__');
  }).catch((e: any) => {
    if (e.message !== '__TEST_ROLLBACK__') throw e;
  });

  console.log('✓ batch-expiration-write');
  // Deliberately NOT process.exit(0): run.ts imports every test file, and these
  // async IIFEs settle after the imports complete, so an exit(0) here would kill
  // the runner before the files imported after this one ever execute. (That bug
  // is why bir-or-number.test's exit silently skips process-return-leg and
  // process-sale-leg in `npm run test:unit`.) A non-zero exit on failure is
  // still correct — it must fail the run.
})().catch((e) => {
  console.error('Test failed:', e);
  process.exit(1);
});

/**
 * Setting a date on a product that was never flagged perishable must flag it.
 *
 * The Set Expiration action used to be hidden unless products.is_perishable was
 * already 1, which made the feature unreachable for virtually the whole
 * catalogue (4 of 15,988 rows carried the flag). Dating stock is now the act
 * that establishes perishability: a user who types an expiry has said this
 * product expires, so the flag follows the date rather than gating it.
 *
 * The flag is set in the SAME transaction as the date, so the two can never
 * disagree — a product carrying an expiry but not the flag would drop straight
 * back out of the UI that set it.
 */
(async () => {
  await withTransaction(async (connection) => {
    const productId = 'TEST-EXPFLAG-PROD-1';

    // is_perishable = 0: the state almost every real product is in.
    await connection.query(
      `INSERT INTO products (id, name, sku, stock, cost, price, type, unit_of_measure, is_perishable, earns_points, created_at, updated_at)
       VALUES (?, 'Test Unflagged Mayo', 'TEST-EXPFLAG-SKU-1', 5, 10, 15, 'standard', 'Piece', 0, 1, NOW(), NOW())`,
      [productId]
    );

    // No batch rows at all — the real shape of the product that motivated this
    // work (stock 5, zero batches), so the date can only land via an opening batch.
    const plan = resolveExpirationEdits({
      productStock: 5,
      batches: [],
      updates: [],
      untrackedExpiration: '2027-03-01',
    });

    assert.equal(plan.openingBatch?.quantity, 5, 'all 5 units are untracked');

    const result = await applyExpirationEdits(connection, {
      productId,
      plan,
      unitCost: 10,
      sellingPrice: 15,
    });

    assert.ok(result.openingBatchId, 'an opening batch carries the date');

    const [after]: any = await connection.query(
      `SELECT stock, is_perishable, DATE_FORMAT(expiration_date, "%Y-%m-%d") AS exp
       FROM products WHERE id = ?`,
      [productId]
    );

    assert.equal(
      Number(after[0].is_perishable),
      1,
      'dating an unflagged product marks it perishable, so it stays reachable in the UI'
    );
    assert.equal(after[0].exp, '2027-03-01', 'the date reached the product cache');
    assert.equal(
      Number(after[0].stock),
      5,
      'flagging perishable must not move stock either'
    );

    // Clearing every date must NOT unflag: the product is still perishable, the
    // user has simply not recorded a date for the stock currently on hand.
    const clearPlan = resolveExpirationEdits({
      productStock: 5,
      batches: [{ id: String(result.openingBatchId), quantityRemaining: 5 }],
      updates: [{ batchId: String(result.openingBatchId), expirationDate: '' }],
    });
    await applyExpirationEdits(connection, {
      productId,
      plan: clearPlan,
      unitCost: 10,
      sellingPrice: 15,
    });

    const [cleared]: any = await connection.query(
      'SELECT is_perishable, expiration_date FROM products WHERE id = ?',
      [productId]
    );
    assert.equal(cleared[0].expiration_date, null, 'the cache cleared');
    assert.equal(
      Number(cleared[0].is_perishable),
      1,
      'clearing a date leaves the product perishable — it must not vanish from the UI'
    );

    throw new Error('__TEST_ROLLBACK__');
  }).catch((e: any) => {
    if (e.message !== '__TEST_ROLLBACK__') throw e;
  });

  console.log('✓ batch-expiration-write perishable flag');
})().catch((e) => {
  console.error('Test failed:', e);
  process.exit(1);
});
