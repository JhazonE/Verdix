import { test, expect } from '@playwright/test';
import { testQuery, resetPosState } from './helpers/db';
import { seedSession, DEFAULT_ADMIN } from './helpers/auth';

/**
 * POST /api/sales/exchanges — API-level tests hitting the route directly via
 * request.post (no POS UI involved). Product/sale fixtures are seeded per
 * test with testQuery, following the pattern in tests/e2e/sta-lucia-hourly-sync.spec.ts
 * and the base fixtures in tests/e2e/setup/prepare-test-db.ts.
 *
 * Notable schema facts (verified against the live `verdix` dev DB, which
 * `verdix_test` is schema-cloned from):
 *  - pos_transactions.sale_id is NOT NULL with an FK to sales_transactions(id)
 *    ON DELETE CASCADE, so every leg's pos_transactions row needs a real
 *    sales_transactions row to point at.
 *  - pos_transactions.transaction_type is ENUM('sale','void','return','refund','membership')
 *    — no 'exchange' value exists; the route uses 'return' and 'sale' only.
 *  - product_selling_units has NO auto-seed trigger — prepare-test-db.ts seeds
 *    a base unit for every product that existed AT PREPARE TIME via a one-off
 *    INSERT...SELECT. Products created inside a test (SEEDED-PRODUCT-A/B/C)
 *    need their own product_selling_units row inserted explicitly, or
 *    processSaleLeg's getBaseUnit() lookup fails.
 *  - inventory_batches requires product_id, received_date, quantity_in,
 *    quantity_remaining, unit_cost, selling_price (all NOT NULL).
 */

const TERMINAL_ID = 'test-terminal-1'; // TEST_TERMINAL.id from tests/e2e/fixtures/test-data.ts
const ADMIN_UID = DEFAULT_ADMIN.uid; // 'test-admin-uid', matches TEST_USERS.admin.uid

async function seedActiveShift(id: string) {
  await testQuery(
    `INSERT INTO shifts (id, user_id, terminal_id, status, start_time)
     VALUES (?, ?, ?, 'active', NOW())`,
    [id, ADMIN_UID, TERMINAL_ID]
  );
}

async function seedProductWithBaseUnit(opts: {
  id: string;
  name: string;
  price: number;
  cost: number;
  stock: number;
}) {
  await testQuery(
    `INSERT INTO products (id, name, price, cost, stock, sku, availability, type)
     VALUES (?, ?, ?, ?, ?, ?, 'Available', 'standard')`,
    [opts.id, opts.name, opts.price, opts.cost, opts.stock, `SKU-${opts.id}`]
  );
  await testQuery(
    `INSERT INTO product_selling_units (id, product_id, name, factor, cost, price, is_base)
     VALUES (?, ?, 'Piece', 1, ?, ?, 1)`,
    [`psu-base-${opts.id}`, opts.id, opts.cost, opts.price]
  );
}

async function seedBatch(opts: { id: string; productId: string; qty: number; unitCost: number; sellingPrice: number }) {
  await testQuery(
    `INSERT INTO inventory_batches
       (id, product_id, received_date, quantity_in, quantity_remaining, unit_cost, selling_price, source_type)
     VALUES (?, ?, CURDATE(), ?, ?, ?, ?, 'purchase')`,
    [opts.id, opts.productId, opts.qty, opts.qty, opts.unitCost, opts.sellingPrice]
  );
}

// resetPosState() only clears transactional tables (shifts/sales/pos_transactions);
// it does not touch products/product_selling_units/inventory_batches, so each
// test seeds its own product ids and must clean them up itself or a second
// test run collides on the products.PRIMARY key.
const SEEDED_PRODUCT_IDS = ['SEEDED-PRODUCT-A', 'SEEDED-PRODUCT-B', 'SEEDED-PRODUCT-C'];

async function cleanupSeededProducts() {
  for (const id of SEEDED_PRODUCT_IDS) {
    await testQuery('DELETE FROM inventory_batches WHERE product_id = ?', [id]);
    await testQuery('DELETE FROM product_selling_units WHERE product_id = ?', [id]);
    await testQuery('DELETE FROM products WHERE id = ?', [id]);
  }
}

test.describe('POST /api/sales/exchanges', () => {
  test.beforeEach(async () => {
    await resetPosState();
    await cleanupSeededProducts();
  });

  test.afterEach(async () => {
    await cleanupSeededProducts();
  });

  test('even exchange (balance = 0) returns old item to stock and sells new item via FIFO batch', async ({ request, page }) => {
    // Product A: what the customer originally bought and is returning.
    await seedProductWithBaseUnit({ id: 'SEEDED-PRODUCT-A', name: 'Product A', price: 50, cost: 30, stock: 9 });
    // Product B: the replacement item being sold, with a batch to deduct from.
    await seedProductWithBaseUnit({ id: 'SEEDED-PRODUCT-B', name: 'Product B', price: 50, cost: 30, stock: 10 });
    await seedBatch({ id: 'batch-b-1', productId: 'SEEDED-PRODUCT-B', qty: 10, unitCost: 30, sellingPrice: 50 });

    // The original completed sale of Product A being exchanged against.
    await testQuery(
      `INSERT INTO sales_transactions (id, reference, receipt_number, total, payment_method, status, transaction_source, date, created_at, updated_at)
       VALUES ('SEEDED-SALE-1', 'REF-SEEDED-1', 'RCPT-SEEDED-1', 50, 'Cash', 'Paid', 'POS', CURDATE(), NOW(), NOW())`
    );
    await testQuery(
      `INSERT INTO sale_items (id, sale_id, product_id, product_name, quantity, price, selling_unit_id, selling_unit_name, selling_unit_factor, created_at)
       VALUES ('sale-item-seeded-1', 'SEEDED-SALE-1', 'SEEDED-PRODUCT-A', 'Product A', 1, 50, 'psu-base-SEEDED-PRODUCT-A', 'Piece', 1, NOW())`
    );

    await seedActiveShift('shift-exchange-1');

    await seedSession(page, DEFAULT_ADMIN);

    const res = await request.post('/api/sales/exchanges', {
      data: {
        saleId: 'SEEDED-SALE-1',
        returnItem: { productId: 'SEEDED-PRODUCT-A', productName: 'Product A', quantity: 1, price: 50 },
        newItem: { productId: 'SEEDED-PRODUCT-B', productName: 'Product B', quantity: 1, price: 50 },
        userId: ADMIN_UID,
        terminalId: TERMINAL_ID,
      },
    });

    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.balance).toBe(0);
    expect(body.data.mcNumber).toMatch(/^MC-\d{6}$/);
    expect(body.data.siNumber).toMatch(/^\d{6}$/);

    const rows: any[] = await testQuery(
      'SELECT transaction_type, exchange_group_id FROM pos_transactions WHERE exchange_group_id = ?',
      [body.data.exchangeGroupId]
    );
    expect(rows).toHaveLength(2);
    expect(rows.map(r => r.transaction_type).sort()).toEqual(['return', 'sale']);

    // Stock actually moved: A +1 (returned), B -1 (sold via FIFO batch).
    const productA: any[] = await testQuery('SELECT stock FROM products WHERE id = ?', ['SEEDED-PRODUCT-A']);
    const productB: any[] = await testQuery('SELECT stock FROM products WHERE id = ?', ['SEEDED-PRODUCT-B']);
    expect(Number(productA[0].stock)).toBe(10);
    expect(Number(productB[0].stock)).toBe(9);
  });

  test('rolls back entirely when the replacement item has no batch stock and oversell is blocked', async ({ request, page }) => {
    await testQuery('UPDATE pos_settings SET batch_costing_oversell_block = 1');

    await seedProductWithBaseUnit({ id: 'SEEDED-PRODUCT-A', name: 'Product A', price: 50, cost: 30, stock: 9 });
    // Product B has a batch row but with ZERO remaining — any sale must be blocked.
    await seedProductWithBaseUnit({ id: 'SEEDED-PRODUCT-B', name: 'Product B', price: 50, cost: 30, stock: 10 });
    await seedBatch({ id: 'batch-b-empty', productId: 'SEEDED-PRODUCT-B', qty: 0, unitCost: 30, sellingPrice: 50 });

    await testQuery(
      `INSERT INTO sales_transactions (id, reference, receipt_number, total, payment_method, status, transaction_source, date, created_at, updated_at)
       VALUES ('SEEDED-SALE-1', 'REF-SEEDED-1', 'RCPT-SEEDED-1', 50, 'Cash', 'Paid', 'POS', CURDATE(), NOW(), NOW())`
    );
    await testQuery(
      `INSERT INTO sale_items (id, sale_id, product_id, product_name, quantity, price, selling_unit_id, selling_unit_name, selling_unit_factor, created_at)
       VALUES ('sale-item-seeded-1', 'SEEDED-SALE-1', 'SEEDED-PRODUCT-A', 'Product A', 1, 50, 'psu-base-SEEDED-PRODUCT-A', 'Piece', 1, NOW())`
    );

    await seedActiveShift('shift-exchange-2');

    await seedSession(page, DEFAULT_ADMIN);

    const before: any[] = await testQuery('SELECT stock FROM products WHERE id = ?', ['SEEDED-PRODUCT-A']);
    const refBefore: any[] = await testQuery('SELECT si_number, mc_number FROM transaction_references WHERE id = 1');

    const res = await request.post('/api/sales/exchanges', {
      data: {
        saleId: 'SEEDED-SALE-1',
        returnItem: { productId: 'SEEDED-PRODUCT-A', productName: 'Product A', quantity: 1, price: 50 },
        newItem: { productId: 'SEEDED-PRODUCT-B', productName: 'Product B', quantity: 100, price: 50 },
        userId: ADMIN_UID,
        terminalId: TERMINAL_ID,
      },
    });

    expect(res.ok()).toBe(false);
    const body = await res.json();
    expect(body.success).toBe(false);

    const after: any[] = await testQuery('SELECT stock FROM products WHERE id = ?', ['SEEDED-PRODUCT-A']);
    expect(after[0].stock).toBe(before[0].stock); // return leg rolled back too

    const rows: any[] = await testQuery("SELECT * FROM pos_transactions WHERE sale_id = 'SEEDED-SALE-1' AND transaction_type = 'return'");
    expect(rows).toHaveLength(0); // nothing committed

    // getNextSINumber/getNextMCNumber ran on the same connection as the
    // failed transaction, so a rollback must leave the shared counters
    // exactly where they were — a real filed SI/MC sequence must never show
    // a gap for a transaction that never actually happened.
    const refAfter: any[] = await testQuery('SELECT si_number, mc_number FROM transaction_references WHERE id = 1');
    expect(refAfter[0].si_number).toBe(refBefore[0].si_number);
    expect(refAfter[0].mc_number).toBe(refBefore[0].mc_number);
  });

  test('exchanging the same product for a different selling unit resolves each leg independently', async ({ request, page }) => {
    // SEEDED-PRODUCT-C: base "Piece" unit (factor 1) + "Case" unit (factor 12).
    // stock = 24 (2 cases worth), batch stock covers the 3-piece sale leg.
    await testQuery(
      `INSERT INTO products (id, name, price, cost, stock, sku, availability, type)
       VALUES ('SEEDED-PRODUCT-C', 'Product C', 50, 30, 24, 'SKU-SEEDED-PRODUCT-C', 'Available', 'standard')`
    );
    await testQuery(
      `INSERT INTO product_selling_units (id, product_id, name, factor, cost, price, is_base)
       VALUES ('SEEDED-UNIT-PIECE', 'SEEDED-PRODUCT-C', 'Piece', 1, 30, 50, 1)`
    );
    await testQuery(
      `INSERT INTO product_selling_units (id, product_id, name, factor, cost, price, is_base)
       VALUES ('SEEDED-UNIT-CASE', 'SEEDED-PRODUCT-C', 'Case', 12, 360, 600, 0)`
    );
    await seedBatch({ id: 'batch-c-1', productId: 'SEEDED-PRODUCT-C', qty: 24, unitCost: 30, sellingPrice: 50 });

    // A sale that sold 1 Case (12 base units) of Product C.
    await testQuery(
      `INSERT INTO sales_transactions (id, reference, receipt_number, total, payment_method, status, transaction_source, date, created_at, updated_at)
       VALUES ('SEEDED-SALE-CASE', 'REF-SEEDED-CASE', 'RCPT-SEEDED-CASE', 600, 'Cash', 'Paid', 'POS', CURDATE(), NOW(), NOW())`
    );
    await testQuery(
      `INSERT INTO sale_items (id, sale_id, product_id, product_name, quantity, price, selling_unit_id, selling_unit_name, selling_unit_factor, created_at)
       VALUES ('sale-item-seeded-case', 'SEEDED-SALE-CASE', 'SEEDED-PRODUCT-C', 'Product C', 1, 600, 'SEEDED-UNIT-CASE', 'Case', 12, NOW())`
    );

    await seedActiveShift('shift-exchange-3');

    // 1 Case returned (600) vs 3 Piece sold (150) is a downsell — balance -450
    // — which the route's server-side backstop requires a customerId for.
    await testQuery("DELETE FROM customers WHERE id = 'SEEDED-CUSTOMER-1'");
    await testQuery("INSERT INTO customers (id, name) VALUES ('SEEDED-CUSTOMER-1', 'Seeded Customer')");

    await seedSession(page, DEFAULT_ADMIN);

    const before: any[] = await testQuery('SELECT stock FROM products WHERE id = ?', ['SEEDED-PRODUCT-C']);

    const res = await request.post('/api/sales/exchanges', {
      data: {
        saleId: 'SEEDED-SALE-CASE',
        returnItem: {
          productId: 'SEEDED-PRODUCT-C', productName: 'Product C', quantity: 1, price: 600,
          sellingUnitId: 'SEEDED-UNIT-CASE', sellingUnitName: 'Case', sellingUnitFactor: 12,
        },
        newItem: {
          productId: 'SEEDED-PRODUCT-C', productName: 'Product C', quantity: 3, price: 50,
          sellingUnitId: 'SEEDED-UNIT-PIECE', sellingUnitName: 'Piece', sellingUnitFactor: 1,
        },
        userId: ADMIN_UID,
        terminalId: TERMINAL_ID,
        customerId: 'SEEDED-CUSTOMER-1',
      },
    });

    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.balance).toBe(-450); // 150 (3 Piece) - 600 (1 Case) = -450, a downsell credit
    // Returning 1 Case (12 base units) adds 12 back; selling 3 Piece (3 base
    // units) deducts 3. Net change: +12 - 3 = +9. Each leg must apply its OWN
    // factor — a bug that nets the quantities before converting would instead
    // compute (1 - 3) * some-shared-factor and get this wrong.
    const after: any[] = await testQuery('SELECT stock FROM products WHERE id = ?', ['SEEDED-PRODUCT-C']);
    expect(Number(after[0].stock)).toBe(Number(before[0].stock) + 9);

    // The downsell balance was credited to the customer's account, not just
    // computed and discarded.
    const customer: any[] = await testQuery('SELECT credit_balance FROM customers WHERE id = ?', ['SEEDED-CUSTOMER-1']);
    expect(Number(customer[0].credit_balance)).toBe(450);

    await testQuery("DELETE FROM customers WHERE id = 'SEEDED-CUSTOMER-1'");
  });
});
