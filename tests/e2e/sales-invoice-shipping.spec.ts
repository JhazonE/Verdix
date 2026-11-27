import { test, expect } from '@playwright/test';
import { testQuery } from './helpers/db';
import { SO_CUSTOMER, SO_PRODUCT } from './fixtures/test-data';

/**
 * Shipping fee sa back-office Sales Invoices (DB-backed) batok sa verdix_test.
 *
 * Regression: ang sales_invoices walay shipping column. Ang Add Invoice
 * mo-dugang sa shipping sa `total` apan ang shipping mismo wala ma-save, mao
 * nga ang view/print mo-pakita ug SHIPPING 0.00 ug GRAND TOTAL nga kulang. Ug
 * ang invoice gikan sa Sales Order mo-kopya sa total sa order — nga WALAY
 * shipping — mao nga ang shipping wala gyud ma-charge.
 */

const line = (quantity: number) => ({
  product: { id: SO_PRODUCT.id, name: SO_PRODUCT.name },
  quantity,
  price: SO_PRODUCT.price,
  vatable: false,
});

test.describe('Sales invoice shipping', () => {
  test('Add Invoice: ang shipping ma-save ug ma-uli sa GET /api/sales', async ({ request }) => {
    const res = await request.post('/api/sales', {
      data: {
        customer: { id: SO_CUSTOMER.id, name: SO_CUSTOMER.name },
        invoiceDate: '2026-11-27',
        dueDate: '2026-11-27',
        paymentMethod: 'Charge',
        items: [line(2)],
        shipping: 50,
      },
    });
    const body = await res.json();
    expect(body.success, `create failed: ${JSON.stringify(body)}`).toBe(true);
    const id = body.data.id as string;

    const rows: any = await testQuery('SELECT total, shipping FROM sales_invoices WHERE id = ?', [id]);
    expect(Number(rows[0].total)).toBe(2 * SO_PRODUCT.price + 50);
    expect(Number(rows[0].shipping)).toBe(50);

    const list = await (await request.get('/api/sales')).json();
    const inv = list.data.find((s: any) => s.id === id);
    expect(inv.shipping).toBe(50);
    expect(inv.total).toBe(2 * SO_PRODUCT.price + 50);
  });

  test('Invoice gikan sa Sales Order: ang shipping sa order ma-charge', async ({ request }) => {
    const orderRes = await request.post('/api/sales/orders', {
      data: {
        customer: { id: SO_CUSTOMER.id, name: SO_CUSTOMER.name },
        orderDate: '2026-11-27',
        deliveryDate: '2026-11-27',
        paymentMethod: 'CASH',
        status: 'Pending',
        items: [line(1)],
        shipping: 75,
      },
    });
    const orderBody = await orderRes.json();
    expect(orderBody.success, `order failed: ${JSON.stringify(orderBody)}`).toBe(true);
    const orderId = orderBody.data.id as string;

    const deliver = await (await request.post(`/api/sales/orders/${orderId}/deliver`, { data: {} })).json();
    expect(deliver.success, `deliver failed: ${JSON.stringify(deliver)}`).toBe(true);

    const invRes = await (await request.post('/api/sales/invoices', { data: { orderId } })).json();
    expect(invRes.success, `invoice failed: ${JSON.stringify(invRes)}`).toBe(true);

    const order: any = await testQuery('SELECT total FROM sales_orders WHERE id = ?', [orderId]);
    const rows: any = await testQuery(
      'SELECT total, shipping FROM sales_invoices WHERE sales_order_id = ?',
      [orderId],
    );
    expect(Number(rows[0].shipping)).toBe(75);
    expect(Number(rows[0].total)).toBe(Number(order[0].total) + 75);
    expect(invRes.data.total).toBe(Number(order[0].total) + 75);
  });
});
