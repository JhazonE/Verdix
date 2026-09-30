import assert from 'node:assert/strict';
import { withTransaction } from '../../lib/mysql';
import { processSaleLeg } from '../../lib/pos/process-sale-leg';

(async () => {
  await withTransaction(async (connection) => {
    const productId = 'TEST-SALELEG-PROD-1';
    const saleId = 'TEST-SALELEG-SALE-1';

    // sale_items.sale_id has an FK to sales_transactions(id); seed a minimal
    // parent row so the INSERT inside processSaleLeg doesn't hit ER_NO_REFERENCED_ROW_2.
    await connection.query(
      `INSERT INTO sales_transactions (id, total, created_at, updated_at)
       VALUES (?, 16, NOW(), NOW())`,
      [saleId]
    );

    // products.type is ENUM('standard','service') — not 'good'.
    await connection.query(
      `INSERT INTO products (id, name, sku, stock, cost, price, type, unit_of_measure, category, earns_points, created_at, updated_at)
       VALUES (?, 'Test Sale Leg Gadget', 'TEST-SALELEG-SKU-1', 10, 5, 8, 'standard', 'Piece', NULL, 1, NOW(), NOW())`,
      [productId]
    );
    await connection.query(
      `INSERT INTO product_selling_units (id, product_id, name, factor, cost, price, is_base, created_at, updated_at)
       VALUES (?, ?, 'Piece', 1, 5, 8, 1, NOW(), NOW())`,
      ['TEST-SALELEG-UNIT-1', productId]
    );
    await connection.query(
      `INSERT INTO inventory_batches (id, product_id, received_date, quantity_in, quantity_remaining, unit_cost, selling_price, source_type, created_at, updated_at)
       VALUES (?, ?, CURDATE(), 5, 5, 5, 8, 'purchase', NOW(), NOW())`,
      ['TEST-SALELEG-BATCH-1', productId]
    );

    const result = await processSaleLeg(connection, {
      item: { id: productId, name: 'Test Sale Leg Gadget', quantity: 2, price: 8 },
      saleId,
      itemIndex: 0,
      oversellBlock: false,
    });

    assert.equal(result.itemId, 'TEST-SALELEG-SALE-1-ITEM-1');
    assert.equal(result.unitId, 'TEST-SALELEG-UNIT-1');
    assert.equal(result.factor, 1);
    assert.equal(result.isServiceItem, false);
    assert.ok(Math.abs((result.costAtSale ?? 0) - 5) < 1e-6, `costAtSale should be 5, got ${result.costAtSale}`);

    const [stockRows]: any = await connection.query('SELECT stock FROM products WHERE id = ?', [productId]);
    assert.equal(Number(stockRows[0].stock), 8, 'selling 2 units deducts them from stock (10 - 2)');

    const [batchRows]: any = await connection.query('SELECT quantity_remaining FROM inventory_batches WHERE id = ?', ['TEST-SALELEG-BATCH-1']);
    assert.equal(Number(batchRows[0].quantity_remaining), 3, 'FIFO batch deduction removed 2 units from the batch (5 - 2)');

    // A product with no base selling unit configured must fail loudly rather
    // than silently deduct nothing.
    const brokenProductId = 'TEST-SALELEG-PROD-BROKEN';
    const brokenSaleId = 'TEST-SALELEG-SALE-2';
    await connection.query(
      `INSERT INTO sales_transactions (id, total, created_at, updated_at)
       VALUES (?, 1, NOW(), NOW())`,
      [brokenSaleId]
    );
    await connection.query(
      `INSERT INTO products (id, name, sku, stock, cost, price, type, unit_of_measure, created_at, updated_at)
       VALUES (?, 'Broken Product', 'TEST-SALELEG-SKU-BROKEN', 0, 1, 1, 'standard', 'Piece', NOW(), NOW())`,
      [brokenProductId]
    );
    await assert.rejects(
      () => processSaleLeg(connection, {
        item: { id: brokenProductId, name: 'Broken Product', quantity: 1, price: 1 },
        saleId: brokenSaleId,
        itemIndex: 0,
        oversellBlock: false,
      }),
      /has no base selling unit/
    );

    throw new Error('__TEST_ROLLBACK__');
  }).catch((e: any) => {
    if (e.message !== '__TEST_ROLLBACK__') throw e;
  });

  console.log('✓ process-sale-leg');
  process.exit(0);
})().catch((e) => {
  console.error('Test failed:', e);
  process.exit(1);
});
