import { test, expect } from '@playwright/test';
import { testQuery, resetPosState } from './helpers/db';

/**
 * POST /api/pos/checkout — API-level regression test, no POS UI involved.
 *
 * Exists because a refactor (commit 17a70fd) left an ambiguous
 * `markup_percentage` column in checkout's loyalty query (both `products` and
 * `categories` carry that column), so EVERY checkout threw ER_NON_UNIQ_ERROR
 * inside withTransaction and rolled back with a 500. The UI-driven checkout
 * specs could not see it because they were already failing earlier, in the
 * unrelated addProductBySku helper. This spec posts a realistic cart straight
 * at the route so a broken checkout can never hide behind a broken UI helper
 * again.
 */

const TERMINAL_ID = 'test-terminal-1';
const ADMIN_UID = 'test-admin-uid';
const PRODUCT_ID = 'SEEDED-CHECKOUT-PRODUCT';
const CATEGORY_NAME = 'SEEDED-CHECKOUT-CATEGORY';

async function cleanup() {
  await testQuery('DELETE FROM payment_details WHERE transaction_id IN (SELECT id FROM pos_transactions WHERE shift_id = ?)', ['shift-checkout-api']);
  await testQuery('DELETE FROM inventory_batches WHERE product_id = ?', [PRODUCT_ID]);
  await testQuery('DELETE FROM product_selling_units WHERE product_id = ?', [PRODUCT_ID]);
  await testQuery('DELETE FROM products WHERE id = ?', [PRODUCT_ID]);
  await testQuery('DELETE FROM categories WHERE name = ?', [CATEGORY_NAME]);
}

test.describe('POST /api/pos/checkout', () => {
  test.beforeEach(async () => {
    await resetPosState();
    await cleanup();
  });

  test.afterEach(async () => {
    await cleanup();
  });

  test('a plain cash sale commits: 200, sale_items row written, stock deducted', async ({ request }) => {
    // The product sits in a real category so the loyalty query's
    // products ⋈ categories join is exercised with BOTH markup_percentage
    // columns populated — the exact shape that made the bare column ambiguous.
    await testQuery(
      'INSERT INTO categories (id, name, markup_percentage) VALUES (?, ?, 10)',
      ['cat-seeded-checkout', CATEGORY_NAME]
    );
    await testQuery(
      `INSERT INTO products (id, name, price, cost, stock, sku, availability, type, category, markup_percentage)
       VALUES (?, 'Checkout Test Product', 40, 25, 10, 'SKU-SEEDED-CHECKOUT', 'Available', 'standard', ?, 20)`,
      [PRODUCT_ID, CATEGORY_NAME]
    );
    await testQuery(
      `INSERT INTO product_selling_units (id, product_id, name, factor, cost, price, is_base)
       VALUES ('psu-base-seeded-checkout', ?, 'Piece', 1, 25, 40, 1)`,
      [PRODUCT_ID]
    );
    await testQuery(
      `INSERT INTO inventory_batches
         (id, product_id, received_date, quantity_in, quantity_remaining, unit_cost, selling_price, source_type)
       VALUES ('batch-seeded-checkout', ?, CURDATE(), 10, 10, 25, 40, 'purchase')`,
      [PRODUCT_ID]
    );
    await testQuery(
      `INSERT INTO shifts (id, user_id, terminal_id, status, start_time, starting_cash)
       VALUES ('shift-checkout-api', ?, ?, 'active', NOW(), 0)`,
      [ADMIN_UID, TERMINAL_ID]
    );

    const res = await request.post('/api/pos/checkout', {
      data: {
        items: [{ id: PRODUCT_ID, name: 'Checkout Test Product', quantity: 2, price: 40, discount: 0 }],
        customer: { id: 'walk-in' },
        paymentMethod: 'Cash',
        totalDue: 80,
        subtotal: 80,
        userId: ADMIN_UID,
        shiftId: 'shift-checkout-api',
        terminalId: TERMINAL_ID,
        amountTendered: 100,
        change: 20,
        payments: [{ method: 'Cash', amount: 100 }],
      },
    });

    const body = await res.json();
    expect(body.error, 'checkout returned an error').toBeUndefined();
    expect(res.status()).toBe(200);
    expect(body.success).toBe(true);

    const saleItems: any[] = await testQuery(
      'SELECT product_id, quantity FROM sale_items WHERE sale_id = ?',
      [body.data.saleId]
    );
    expect(saleItems).toHaveLength(1);
    expect(saleItems[0].product_id).toBe(PRODUCT_ID);
    expect(Number(saleItems[0].quantity)).toBe(2);

    const product: any[] = await testQuery('SELECT stock FROM products WHERE id = ?', [PRODUCT_ID]);
    expect(Number(product[0].stock)).toBe(8);
  });
});
