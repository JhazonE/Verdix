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

    // --- a product with NO cost must snapshot NULL, never 0 ---------------
    // Writing 0 would mean "this was free" and freeze the line at 100% margin
    // forever, because the reports only fall back to products.cost when the
    // snapshot is NULL. The user hit exactly this: filling in a cost after the
    // sale changed nothing in the reports.
    const noCostProductId = 'TEST-SALELEG-PROD-NOCOST';
    const noCostSaleId = 'TEST-SALELEG-SALE-NOCOST';
    await connection.query(
      `INSERT INTO sales_transactions (id, total, created_at, updated_at)
       VALUES (?, 10, NOW(), NOW())`,
      [noCostSaleId]
    );
    // cost IS NULL, and no inventory_batches row exists to price the sale.
    await connection.query(
      `INSERT INTO products (id, name, sku, stock, cost, price, type, unit_of_measure, earns_points, created_at, updated_at)
       VALUES (?, 'No Cost Gadget', 'TEST-SALELEG-SKU-NOCOST', 10, NULL, 10, 'standard', 'Piece', 1, NOW(), NOW())`,
      [noCostProductId]
    );
    await connection.query(
      `INSERT INTO product_selling_units (id, product_id, name, factor, cost, price, is_base, created_at, updated_at)
       VALUES (?, ?, 'Piece', 1, 0, 10, 1, NOW(), NOW())`,
      ['TEST-SALELEG-UNIT-NOCOST', noCostProductId]
    );

    const noCostResult = await processSaleLeg(connection, {
      item: { id: noCostProductId, name: 'No Cost Gadget', quantity: 2, price: 10 },
      saleId: noCostSaleId,
      itemIndex: 0,
      oversellBlock: false,
    });
    assert.equal(
      noCostResult.costAtSale,
      null,
      `an unknown cost must snapshot NULL, got ${noCostResult.costAtSale}`
    );
    const [noCostRows]: any = await connection.query(
      'SELECT cost_at_sale FROM sale_items WHERE id = ?',
      [noCostResult.itemId]
    );
    assert.equal(
      noCostRows[0].cost_at_sale,
      null,
      'the stored column must be NULL so a later cost edit can still reach it'
    );

    // --- a product costed at 0 ON PURPOSE snapshots a real 0 --------------
    // Unknown and zero must stay distinguishable: this one is frozen at 0.
    const freeProductId = 'TEST-SALELEG-PROD-FREE';
    const freeSaleId = 'TEST-SALELEG-SALE-FREE';
    await connection.query(
      `INSERT INTO sales_transactions (id, total, created_at, updated_at)
       VALUES (?, 10, NOW(), NOW())`,
      [freeSaleId]
    );
    await connection.query(
      `INSERT INTO products (id, name, sku, stock, cost, price, type, unit_of_measure, earns_points, created_at, updated_at)
       VALUES (?, 'Free Gadget', 'TEST-SALELEG-SKU-FREE', 10, 0, 10, 'standard', 'Piece', 1, NOW(), NOW())`,
      [freeProductId]
    );
    await connection.query(
      `INSERT INTO product_selling_units (id, product_id, name, factor, cost, price, is_base, created_at, updated_at)
       VALUES (?, ?, 'Piece', 1, 0, 10, 1, NOW(), NOW())`,
      ['TEST-SALELEG-UNIT-FREE', freeProductId]
    );
    const freeResult = await processSaleLeg(connection, {
      item: { id: freeProductId, name: 'Free Gadget', quantity: 1, price: 10 },
      saleId: freeSaleId,
      itemIndex: 0,
      oversellBlock: false,
    });
    assert.equal(
      freeResult.costAtSale,
      0,
      `a deliberate zero cost is a known cost, got ${freeResult.costAtSale}`
    );

    // --- stock entered with NO cost, cost filled in afterwards ---------------
    // The store hit this: a product was created / adjusted in with stock while
    // its cost was still blank, so the auto-created 'adjustment' batch was
    // written at unit_cost 0. The cost was filled in later, but every sale drew
    // from that 0 batch and snapshotted cost_at_sale = 0 — sold with no cost
    // even though the product clearly had one. An uncosted non-purchase batch
    // must price at the product's current cost instead.
    const lateCostProductId = 'TEST-SALELEG-PROD-LATECOST';
    const lateCostSaleId = 'TEST-SALELEG-SALE-LATECOST';
    await connection.query(
      `INSERT INTO sales_transactions (id, total, created_at, updated_at)
       VALUES (?, 20, NOW(), NOW())`,
      [lateCostSaleId]
    );
    await connection.query(
      `INSERT INTO products (id, name, sku, stock, cost, price, type, unit_of_measure, earns_points, created_at, updated_at)
       VALUES (?, 'Late Cost Gadget', 'TEST-SALELEG-SKU-LATECOST', 10, 7, 10, 'standard', 'Piece', 1, NOW(), NOW())`,
      [lateCostProductId]
    );
    await connection.query(
      `INSERT INTO product_selling_units (id, product_id, name, factor, cost, price, is_base, created_at, updated_at)
       VALUES (?, ?, 'Piece', 1, 7, 10, 1, NOW(), NOW())`,
      ['TEST-SALELEG-UNIT-LATECOST', lateCostProductId]
    );
    await connection.query(
      `INSERT INTO inventory_batches (id, product_id, received_date, quantity_in, quantity_remaining, unit_cost, selling_price, source_type, notes, created_at, updated_at)
       VALUES (?, ?, CURDATE(), 10, 10, 0, 10, 'adjustment', 'Initial Stock', NOW(), NOW())`,
      ['TEST-SALELEG-BATCH-LATECOST', lateCostProductId]
    );
    const lateCostResult = await processSaleLeg(connection, {
      item: { id: lateCostProductId, name: 'Late Cost Gadget', quantity: 2, price: 10 },
      saleId: lateCostSaleId,
      itemIndex: 0,
      oversellBlock: false,
    });
    assert.ok(
      Math.abs((lateCostResult.costAtSale ?? -1) - 7) < 1e-6,
      `an uncosted adjustment batch must price at products.cost (7), got ${lateCostResult.costAtSale}`
    );

    // ...but a PURCHASE batch received at 0 (a supplier freebie) is a real,
    // deliberate cost and stays 0.
    const freebieProductId = 'TEST-SALELEG-PROD-FREEBIE';
    const freebieSaleId = 'TEST-SALELEG-SALE-FREEBIE';
    await connection.query(
      `INSERT INTO sales_transactions (id, total, created_at, updated_at)
       VALUES (?, 10, NOW(), NOW())`,
      [freebieSaleId]
    );
    await connection.query(
      `INSERT INTO products (id, name, sku, stock, cost, price, type, unit_of_measure, earns_points, created_at, updated_at)
       VALUES (?, 'Freebie Gadget', 'TEST-SALELEG-SKU-FREEBIE', 10, 7, 10, 'standard', 'Piece', 1, NOW(), NOW())`,
      [freebieProductId]
    );
    await connection.query(
      `INSERT INTO product_selling_units (id, product_id, name, factor, cost, price, is_base, created_at, updated_at)
       VALUES (?, ?, 'Piece', 1, 7, 10, 1, NOW(), NOW())`,
      ['TEST-SALELEG-UNIT-FREEBIE', freebieProductId]
    );
    await connection.query(
      `INSERT INTO inventory_batches (id, product_id, received_date, quantity_in, quantity_remaining, unit_cost, selling_price, source_type, created_at, updated_at)
       VALUES (?, ?, CURDATE(), 10, 10, 0, 10, 'purchase', NOW(), NOW())`,
      ['TEST-SALELEG-BATCH-FREEBIE', freebieProductId]
    );
    const freebieResult = await processSaleLeg(connection, {
      item: { id: freebieProductId, name: 'Freebie Gadget', quantity: 1, price: 10 },
      saleId: freebieSaleId,
      itemIndex: 0,
      oversellBlock: false,
    });
    assert.equal(
      freebieResult.costAtSale,
      0,
      `a purchase batch received at 0 is a known cost, got ${freebieResult.costAtSale}`
    );

    // --- a non-base selling unit with a TYPED cost uses that cost ----------
    // The user's rule: the cost typed against a unit on the Selling Units tab
    // is the cost of sale whenever one is set, whatever the batch charged.
    // A unit with no typed cost still follows FIFO batch cost × factor, and
    // the base unit always follows FIFO.
    const caseProductId = 'TEST-SALELEG-PROD-CASE';
    await connection.query(
      `INSERT INTO products (id, name, sku, stock, cost, price, type, unit_of_measure, earns_points, created_at, updated_at)
       VALUES (?, 'Case Gadget', 'TEST-SALELEG-SKU-CASE', 100, 10, 12, 'standard', 'Piece', 1, NOW(), NOW())`,
      [caseProductId]
    );
    await connection.query(
      `INSERT INTO product_selling_units (id, product_id, name, factor, cost, price, is_base, created_at, updated_at)
       VALUES (?, ?, 'Piece', 1, 10, 12, 1, NOW(), NOW()),
              (?, ?, 'Case', 24, 220, 280, 0, NOW(), NOW()),
              (?, ?, 'Pack', 6, NULL, 70, 0, NOW(), NOW())`,
      ['TEST-SALELEG-UNIT-CASE-PC', caseProductId,
       'TEST-SALELEG-UNIT-CASE-CS', caseProductId,
       'TEST-SALELEG-UNIT-CASE-PK', caseProductId]
    );
    await connection.query(
      `INSERT INTO inventory_batches (id, product_id, received_date, quantity_in, quantity_remaining, unit_cost, selling_price, source_type, created_at, updated_at)
       VALUES (?, ?, CURDATE(), 100, 100, 9.5, 12, 'purchase', NOW(), NOW())`,
      ['TEST-SALELEG-BATCH-CASE', caseProductId]
    );
    const sellUnit = async (n: number, unitId: string, unitName: string, factorN: number) => {
      const sid = `TEST-SALELEG-SALE-CASE-${n}`;
      await connection.query(
        `INSERT INTO sales_transactions (id, total, created_at, updated_at) VALUES (?, 1, NOW(), NOW())`,
        [sid]
      );
      return processSaleLeg(connection, {
        item: { id: caseProductId, name: 'Case Gadget', quantity: 1, price: 1,
                sellingUnitId: unitId, sellingUnitName: unitName, sellingUnitFactor: factorN },
        saleId: sid,
        itemIndex: 0,
        oversellBlock: false,
      });
    };
    const caseSale = await sellUnit(1, 'TEST-SALELEG-UNIT-CASE-CS', 'Case', 24);
    assert.ok(Math.abs((caseSale.costAtSale ?? -1) - 220) < 1e-6,
      `a Case with a typed cost of 220 must cost 220, got ${caseSale.costAtSale}`);
    const packSale = await sellUnit(2, 'TEST-SALELEG-UNIT-CASE-PK', 'Pack', 6);
    assert.ok(Math.abs((packSale.costAtSale ?? -1) - 57) < 1e-6,
      `a Pack with no typed cost must cost batch 9.5 × 6 = 57, got ${packSale.costAtSale}`);
    const pieceSale = await sellUnit(3, 'TEST-SALELEG-UNIT-CASE-PC', 'Piece', 1);
    assert.ok(Math.abs((pieceSale.costAtSale ?? -1) - 9.5) < 1e-6,
      `the base unit follows FIFO (9.5), got ${pieceSale.costAtSale}`);

    throw new Error('__TEST_ROLLBACK__');
  }).catch((e: any) => {
    if (e.message !== '__TEST_ROLLBACK__') throw e;
  });

  console.log('✓ process-sale-leg');
  // No process.exit(0) — see the note in bir-or-number.test.ts. run.ts owns the
  // single exit, after awaiting every test.
})().catch((e) => {
  console.error('Test failed:', e);
  process.exit(1);
});
