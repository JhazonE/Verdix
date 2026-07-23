import { test, expect } from '@playwright/test';
import { testQuery } from './helpers/db';
import { SO_CUSTOMER, SO_PRODUCT, SO_SERVICE } from './fixtures/test-data';

/**
 * Sales Order flow (DB-backed) batok sa verdix_test.
 *
 * Coverage:
 *  1. SO number gikan sa shared counter — sequential, DILI random, ug ang
 *     reference nga gipadala sa client gi-ignore.
 *  2. Delivery mo-deduct sa stock sa mga stocked nga produkto.
 *  3. Ang SO nga naay SERBISYO ma-deliver — kini ang regression sa bug diin
 *     ang stock check mo-block sa tibuok order tungod kay ang serbisyo naa
 *     sa stock 0.
 *  4. Mixed order: per-line ang guard, dili per-order.
 *  5. Delete sa delivered nga order mo-uli sa stock — apan dili mo-imbento
 *     ug stock para sa serbisyo.
 *
 * API-level ang tanan: ang in-dialog nga ProductSelector kay custom scan-input
 * nga dili lig-on i-drive sa e2e, parehas sa purchase-order.spec.ts.
 */

/** Mohimo ug SO ug mo-return sa id niini. */
async function createOrder(request: any, items: any[], extra: Record<string, any> = {}) {
  const res = await request.post('/api/sales/orders', {
    data: {
      customer: { id: SO_CUSTOMER.id, name: SO_CUSTOMER.name },
      orderDate: '2026-07-23',
      deliveryDate: '2026-07-23',
      paymentMethod: 'CASH',
      status: 'Pending',
      items,
      ...extra,
    },
  });
  const body = await res.json();
  expect(body.success, `create failed: ${JSON.stringify(body)}`).toBe(true);
  return body.data.id as string;
}

/** Kasamtangang stock sa usa ka produkto isip number. */
async function stockOf(productId: string): Promise<number> {
  const rows: any = await testQuery('SELECT stock FROM products WHERE id = ?', [productId]);
  return Number(rows[0].stock);
}

function line(p: { id: string; name: string; price: number }, quantity: number) {
  return { product: { id: p.id, name: p.name }, quantity, price: p.price };
}

test.describe('Sales order', () => {
  test('SO number kay sequential gikan sa counter, ug ang client reference gi-ignore', async ({ request }) => {
    const before: any = await testQuery(
      'SELECT sales_order FROM transaction_references WHERE id = 1',
    );
    const startVal = Number(before[0].sales_order);

    // Tinuyo nga nagpadala ug bakak nga reference: ang server dapat mo-ignore.
    const firstId = await createOrder(request, [line(SO_PRODUCT, 1)], {
      reference: 'SO-999999-CLIENT-FAKE',
    });
    const secondId = await createOrder(request, [line(SO_PRODUCT, 1)]);

    const rows: any = await testQuery(
      'SELECT id, reference FROM sales_orders WHERE id IN (?, ?)',
      [firstId, secondId],
    );
    const byId = Object.fromEntries(rows.map((r: any) => [r.id, r.reference]));

    const expectedFirst = `SO-${String(startVal + 1).padStart(6, '0')}`;
    const expectedSecond = `SO-${String(startVal + 2).padStart(6, '0')}`;

    expect(byId[firstId]).toBe(expectedFirst);
    expect(byId[secondId]).toBe(expectedSecond);
    // Ang bakak nga client reference wala gyud gigamit.
    expect(byId[firstId]).not.toContain('CLIENT-FAKE');
  });

  test('delivery mo-deduct sa stock sa stocked nga produkto', async ({ request }) => {
    const before = await stockOf(SO_PRODUCT.id);

    const orderId = await createOrder(request, [line(SO_PRODUCT, 4)]);
    const res = await request.post(`/api/sales/orders/${orderId}/deliver`, { data: {} });
    const body = await res.json();
    expect(body.success, `deliver failed: ${JSON.stringify(body)}`).toBe(true);

    expect(await stockOf(SO_PRODUCT.id)).toBe(before - 4);

    const status: any = await testQuery('SELECT status FROM sales_orders WHERE id = ?', [orderId]);
    expect(status[0].status).toBe('Delivered');
  });

  test('ang SO nga naay serbisyo ma-deliver ug dili mo-lihok sa stock', async ({ request }) => {
    // REGRESSION: kaniadto ni mo-fail ug "Insufficient stock for product: ...
    // Current stock: 0.0000, Requested: 1" — ang serbisyo kanunay naa sa 0,
    // mao nga na-block ang tibuok delivery.
    const orderId = await createOrder(request, [line(SO_SERVICE, 2)]);

    const res = await request.post(`/api/sales/orders/${orderId}/deliver`, { data: {} });
    const body = await res.json();
    expect(body.success, `deliver failed: ${JSON.stringify(body)}`).toBe(true);

    expect(await stockOf(SO_SERVICE.id)).toBe(0);

    const movements: any = await testQuery(
      'SELECT COUNT(*) c FROM stock_movements WHERE product_id = ?',
      [SO_SERVICE.id],
    );
    expect(Number(movements[0].c)).toBe(0);
  });

  test('mixed order: ang serbisyo gi-skip, ang stocked nga produkto mo-deduct gihapon', async ({ request }) => {
    // Kini ang nagpamatuod nga PER-LINE ang guard, dili per-order.
    const before = await stockOf(SO_PRODUCT.id);

    const orderId = await createOrder(request, [
      line(SO_SERVICE, 3),
      line(SO_PRODUCT, 2),
    ]);
    const res = await request.post(`/api/sales/orders/${orderId}/deliver`, { data: {} });
    expect((await res.json()).success).toBe(true);

    expect(await stockOf(SO_SERVICE.id)).toBe(0);
    expect(await stockOf(SO_PRODUCT.id)).toBe(before - 2);
  });

  test('delete sa delivered nga order mo-uli sa stock', async ({ request }) => {
    const before = await stockOf(SO_PRODUCT.id);

    const orderId = await createOrder(request, [line(SO_PRODUCT, 5)]);
    await request.post(`/api/sales/orders/${orderId}/deliver`, { data: {} });
    expect(await stockOf(SO_PRODUCT.id)).toBe(before - 5);

    const res = await request.delete(`/api/sales/orders/${orderId}`);
    expect((await res.json()).success).toBe(true);

    // Balik sa orihinal: ang reversal mo-uli sa eksaktong gi-deduct.
    expect(await stockOf(SO_PRODUCT.id)).toBe(before);
  });

  test('delete sa delivered nga service order dili mo-imbento ug stock', async ({ request }) => {
    const orderId = await createOrder(request, [line(SO_SERVICE, 4)]);

    // Kinahanglan i-assert nga MILAMPUS ang delivery: kung mo-fail ni, walay
    // na-deduct, mao nga ang delete wala gyuy gi-reverse ug ang test mopasar
    // nga wala nasulayan ang restore path.
    const deliverRes = await request.post(`/api/sales/orders/${orderId}/deliver`, { data: {} });
    const deliverBody = await deliverRes.json();
    expect(deliverBody.success, `deliver failed: ${JSON.stringify(deliverBody)}`).toBe(true);

    const statusAfterDeliver: any = await testQuery(
      'SELECT status FROM sales_orders WHERE id = ?',
      [orderId],
    );
    expect(statusAfterDeliver[0].status).toBe('Delivered');

    const res = await request.delete(`/api/sales/orders/${orderId}`);
    expect((await res.json()).success).toBe(true);

    // Kung ang reversal wala mo-skip sa serbisyo, mahimo ning 4.
    expect(await stockOf(SO_SERVICE.id)).toBe(0);
  });
});
