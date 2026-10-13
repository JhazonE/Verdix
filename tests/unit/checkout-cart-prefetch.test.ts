/**
 * Covers the cart prefetch that POS checkout uses to avoid one DB round trip
 * per cart line against a cloud database.
 *
 * The existing process-sale-leg test only exercises the FALLBACK path (it
 * passes no `prefetched`), so these cases pin the optimised path: that a
 * prefetched sale leg produces byte-identical results to an unprefetched one,
 * and that a prefetch MISS still falls back rather than throwing.
 */
import assert from 'node:assert/strict';
import { withTransaction } from '../../lib/mysql';
import { getBaseUnitsForProducts, getBaseUnit } from '../../lib/selling-units';
import { processSaleLeg } from '../../lib/pos/process-sale-leg';

(async () => {
  await withTransaction(async (connection) => {
    const mk = async (suffix: string, factor: number) => {
      const productId = `TEST-PREFETCH-PROD-${suffix}`;
      await connection.query(
        `INSERT INTO products (id, name, sku, stock, cost, price, type, unit_of_measure, category, earns_points, created_at, updated_at)
         VALUES (?, ?, ?, 100, 5, 8, 'standard', 'Piece', NULL, 1, NOW(), NOW())`,
        [productId, `Prefetch Gadget ${suffix}`, `TEST-PREFETCH-SKU-${suffix}`]
      );
      await connection.query(
        `INSERT INTO product_selling_units (id, product_id, name, factor, cost, price, is_base, created_at, updated_at)
         VALUES (?, ?, ?, ?, 5, 8, 1, NOW(), NOW())`,
        [`TEST-PREFETCH-UNIT-${suffix}`, productId, `Unit${suffix}`, factor]
      );
      await connection.query(
        `INSERT INTO inventory_batches (id, product_id, received_date, quantity_in, quantity_remaining, unit_cost, selling_price, source_type, created_at, updated_at)
         VALUES (?, ?, CURDATE(), 100, 100, 5, 8, 'purchase', NOW(), NOW())`,
        [`TEST-PREFETCH-BATCH-${suffix}`, productId]
      );
      return productId;
    };

    const pidA = await mk('A', 1);
    const pidB = await mk('B', 6);

    // --- the batched helper returns what getBaseUnit returns, per product ---
    const units = await getBaseUnitsForProducts([pidA, pidB], connection);
    assert.equal(units.size, 2, 'both products resolved in one round trip');

    const singleA = await getBaseUnit(pidA, connection);
    assert.deepEqual(
      units.get(pidA),
      singleA,
      'batched lookup must equal the single-row lookup it replaces'
    );
    assert.equal(units.get(pidB)!.factor, 6, 'non-base factor survives batching');

    // Duplicate ids must not produce duplicate work or duplicate keys.
    const deduped = await getBaseUnitsForProducts([pidA, pidA, pidA], connection);
    assert.equal(deduped.size, 1, 'repeated ids collapse to one entry');

    // An unknown product is simply absent — the same signal getBaseUnit's
    // null return gives. It must NOT throw here.
    const missing = await getBaseUnitsForProducts(['TEST-PREFETCH-NOPE'], connection);
    assert.equal(missing.size, 0, 'unknown product is absent, not an error');
    assert.equal((await getBaseUnitsForProducts([], connection)).size, 0, 'empty input is safe');

    // --- a prefetched sale leg matches an unprefetched one ---
    const [prodRows]: any = await connection.query(
      `SELECT p.id, p.parent_id, p.unit_of_measure, p.name, p.stock, p.type, p.cost,
              c.markup_percentage, p.category, p.earns_points
       FROM products p LEFT JOIN categories c ON p.category = c.name
       WHERE p.id IN (?, ?)`,
      [pidA, pidB]
    );
    const products = new Map<string, any>(prodRows.map((r: any) => [String(r.id), r]));

    const saleId = 'TEST-PREFETCH-SALE-1';
    await connection.query(
      `INSERT INTO sales_transactions (id, total, created_at, updated_at) VALUES (?, 16, NOW(), NOW())`,
      [saleId]
    );

    const withPrefetch = await processSaleLeg(connection, {
      item: { id: pidB, name: 'Prefetch Gadget B', quantity: 2, price: 8 },
      saleId,
      itemIndex: 0,
      oversellBlock: false,
      prefetched: { products, baseUnits: units },
    });

    const withoutPrefetch = await processSaleLeg(connection, {
      item: { id: pidB, name: 'Prefetch Gadget B', quantity: 2, price: 8 },
      saleId,
      itemIndex: 1,
      oversellBlock: false,
    });

    assert.equal(withPrefetch.unitId, withoutPrefetch.unitId, 'same unit resolved');
    assert.equal(withPrefetch.factor, 6, 'prefetched factor is the unit factor, not 1');
    assert.equal(withPrefetch.factor, withoutPrefetch.factor, 'same factor');
    assert.equal(withPrefetch.isServiceItem, withoutPrefetch.isServiceItem, 'same service flag');
    assert.ok(
      Math.abs((withPrefetch.costAtSale ?? -1) - (withoutPrefetch.costAtSale ?? -2)) < 1e-6,
      `costAtSale must match: ${withPrefetch.costAtSale} vs ${withoutPrefetch.costAtSale}`
    );
    // factor 6 × 2 sold = 12 base units deducted per leg, 24 total.
    const [stockRows]: any = await connection.query('SELECT stock FROM products WHERE id = ?', [pidB]);
    assert.equal(Number(stockRows[0].stock), 100 - 24, 'both legs deducted in base units');

    // --- a prefetch MISS must fall back, not throw ---
    // This is the dangerous case: concluding "no base unit" from an empty
    // cache would throw on a perfectly valid product.
    const missLeg = await processSaleLeg(connection, {
      item: { id: pidA, name: 'Prefetch Gadget A', quantity: 1, price: 8 },
      saleId,
      itemIndex: 2,
      oversellBlock: false,
      prefetched: { products: new Map(), baseUnits: new Map() },
    });
    assert.equal(missLeg.unitId, `TEST-PREFETCH-UNIT-A`, 'cache miss fell back to a real lookup');
    assert.equal(missLeg.factor, 1, 'fallback resolved the true factor');

    // A product with genuinely no base unit must STILL throw, even though the
    // prefetch path now sits in front of that check.
    const brokenId = 'TEST-PREFETCH-PROD-BROKEN';
    await connection.query(
      `INSERT INTO products (id, name, sku, stock, cost, price, type, unit_of_measure, created_at, updated_at)
       VALUES (?, 'Broken Prefetch', 'TEST-PREFETCH-SKU-BROKEN', 0, 1, 1, 'standard', 'Piece', NOW(), NOW())`,
      [brokenId]
    );
    await assert.rejects(
      () => processSaleLeg(connection, {
        item: { id: brokenId, name: 'Broken Prefetch', quantity: 1, price: 1 },
        saleId,
        itemIndex: 3,
        oversellBlock: false,
        prefetched: { products: new Map(), baseUnits: new Map() },
      }),
      /has no base selling unit/,
      'a real missing base unit must still fail loudly'
    );

    console.log('✓ checkout-cart-prefetch');
    throw new Error('__TEST_ROLLBACK__');
  }).catch((e: any) => {
    if (e.message !== '__TEST_ROLLBACK__') throw e;
  });
})();
