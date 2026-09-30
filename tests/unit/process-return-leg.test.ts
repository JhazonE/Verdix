import assert from 'node:assert/strict';
import { withTransaction } from '../../lib/mysql';
import { processReturnLeg } from '../../lib/pos/process-return-leg';

(async () => {
  await withTransaction(async (connection) => {
    const productId = 'TEST-RETLEG-PROD-1';
    const saleId = 'TEST-RETLEG-SALE-1';

    await connection.query(
      `INSERT INTO products (id, name, sku, stock, cost, price, type, unit_of_measure, created_at, updated_at)
       VALUES (?, 'Test Return Leg Widget', 'TEST-RETLEG-SKU-1', 10, 5, 10, 'standard', 'Piece', NOW(), NOW())`,
      [productId]
    );
    // sale_items.sale_id is a FK into sales_transactions — seed a minimal
    // parent row so the insert inside processReturnLeg satisfies it.
    await connection.query(
      `INSERT INTO sales_transactions (id, total, created_at, updated_at)
       VALUES (?, 20, NOW(), NOW())`,
      [saleId]
    );
    await connection.query(
      `INSERT INTO product_selling_units (id, product_id, name, factor, cost, price, is_base, created_at, updated_at)
       VALUES (?, ?, 'Piece', 1, 5, 10, 1, NOW(), NOW())`,
      ['TEST-RETLEG-UNIT-1', productId]
    );
    // No sale_items row is seeded for this saleId/productId — this exercises
    // the "no recorded selling unit" branch, which must fall back to the
    // product's base unit rather than defaulting to factor 1 blindly.

    const result = await processReturnLeg(connection, {
      saleId,
      item: { productId, productName: 'Test Return Leg Widget', quantity: 2, price: 10 },
      posTransId: 'TEST-RETLEG-PT-1',
      itemIndex: 0,
    });

    assert.equal(result.unitId, 'TEST-RETLEG-UNIT-1', 'falls back to the product base unit');
    assert.equal(result.unitName, 'Piece');
    assert.equal(result.factor, 1);
    assert.equal(result.saleItemId, 'TEST-RETLEG-PT-1-ITEM-1');

    const [stockRows]: any = await connection.query('SELECT stock FROM products WHERE id = ?', [productId]);
    assert.equal(Number(stockRows[0].stock), 12, 'returning 2 units adds them back to stock (10 + 2)');

    // Unknown selling unit named by the caller must throw, not silently
    // fall back to the base unit (that would restore the wrong quantity
    // under a unit name that never existed).
    await assert.rejects(
      () => processReturnLeg(connection, {
        saleId,
        item: { productId, productName: 'Test Return Leg Widget', quantity: 1, price: 10, sellingUnitId: 'GHOST-UNIT' },
        posTransId: 'TEST-RETLEG-PT-2',
        itemIndex: 0,
      }),
      /Unknown selling unit GHOST-UNIT/,
      'rejects a selling unit id that does not belong to this product'
    );

    throw new Error('__TEST_ROLLBACK__');
  }).catch((e: any) => {
    if (e.message !== '__TEST_ROLLBACK__') throw e;
  });

  console.log('✓ process-return-leg');
  process.exit(0);
})().catch((e) => {
  console.error('Test failed:', e);
  process.exit(1);
});
