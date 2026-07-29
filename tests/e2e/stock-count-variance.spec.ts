import { test, expect } from '@playwright/test';
import { testQuery } from './helpers/db';
import { TEST_PRODUCTS } from './fixtures/test-data';

/**
 * Stock count variance — kinahanglan dili doblehon ang pagkuha sa stock kung
 * naay POS sale sulod sa count window.
 *
 * Ang mga assert moadto sa DATABASE. Ang completion mo-report ug success bisan
 * sayop ang gi-apply nga variance, mao nga ang products.stock ra ang tinuod nga
 * makapamatuod.
 */

const PRODUCT = TEST_PRODUCTS[0];
const BASE = '/api/inventory/stock-counts';

/** Ibalik ang product sa usa ka kahibalo nga stock level. */
async function setStock(qty: number) {
  await testQuery('UPDATE products SET stock = ? WHERE id = ?', [qty, PRODUCT.id]);
}

async function getStock(): Promise<number> {
  const rows = await testQuery('SELECT stock FROM products WHERE id = ?', [PRODUCT.id]);
  return Number(rows[0].stock);
}

/**
 * I-simulate ang POS sale: i-deduct ang stock UG isulat ang movement row, sama sa
 * updateStockAndRecordMovement. Ang movement row mao ang gibase sa baseline —
 * kung kalimtan, mo-trigger ang fallback ug dili matestingan ang tinuod nga logic.
 */
async function simulateSale(qty: number) {
  const before = await getStock();
  await testQuery('UPDATE products SET stock = stock - ? WHERE id = ?', [qty, PRODUCT.id]);
  await testQuery(
    `INSERT INTO stock_movements
       (id, product_id, product_name, movement_type, quantity_change, previous_stock, new_stock, reference_id, reference_type, notes)
     VALUES (UUID(), ?, ?, 'sale', ?, ?, ?, ?, 'sale', 'E2E simulated sale')`,
    [PRODUCT.id, PRODUCT.name, -qty, before, before - qty, `e2e-sale-${Date.now()}`]
  );
}

/** Mugna ug count, unya ibalik ang item row para sa gi-target nga product. */
async function createCount(request: any, name: string) {
  const res = await request.post(BASE, {
    data: { name, notes: 'e2e variance', createdBy: 'e2e' },
  });
  expect(res.ok()).toBeTruthy();
  const { data } = await res.json();
  const rows = await testQuery(
    'SELECT id, snapshot_quantity FROM stock_count_items WHERE stock_count_id = ? AND product_id = ?',
    [data.id, PRODUCT.id]
  );
  expect(rows.length, 'naa ang target product sa count').toBe(1);
  return { countId: data.id, itemId: rows[0].id, snapshot: Number(rows[0].snapshot_quantity) };
}

async function saveCount(request: any, countId: string, itemId: string, qty: number) {
  const res = await request.put(`${BASE}/${countId}/items`, {
    data: { items: [{ id: itemId, counted_quantity: qty }] },
  });
  expect(res.ok()).toBeTruthy();
}

async function complete(request: any, countId: string) {
  const res = await request.post(`${BASE}/${countId}/complete`, {
    data: { completedBy: 'e2e' },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.success).toBeTruthy();
  // Kung naka-on ang approval, dili pa ma-apply ang stock — dili valid ang test.
  expect(body.pendingApproval, 'kinahanglan direct completion').toBeFalsy();
  return body;
}

test.describe('Stock count variance', () => {
  test.beforeEach(async () => {
    await setStock(100);
  });

  test('POS sale sulod sa count: dili ni variance', async ({ request }) => {
    const { countId, itemId, snapshot } = await createCount(request, `variance-sale-${Date.now()}`);
    expect(snapshot).toBe(100);

    // Nakabaligya ug 10 human sa snapshot.
    await simulateSale(10);
    expect(await getStock()).toBe(90);

    // Giihap sa tawo ang shelf: 90 — sakto na, walay nawala.
    await saveCount(request, countId, itemId, 90);
    await complete(request, countId);

    // Kung mo-double-deduct, mahimo ni 80.
    expect(await getStock(), 'walay double deduction').toBe(90);
  });

  test('tinuod nga kulang uban sa sale: ang kulang ra ang gi-apply', async ({ request }) => {
    const { countId, itemId } = await createCount(request, `variance-short-${Date.now()}`);

    await simulateSale(10); // 90
    // Giihap: 87 — tulo ang tinuod nga nawala.
    await saveCount(request, countId, itemId, 87);
    await complete(request, countId);

    // -3 lang, dili -13.
    expect(await getStock(), 'ang kulang ra').toBe(87);
  });

  test('walay movement: normal nga variance mo-apply gihapon', async ({ request }) => {
    const { countId, itemId } = await createCount(request, `variance-plain-${Date.now()}`);

    await saveCount(request, countId, itemId, 95);
    await complete(request, countId);

    expect(await getStock(), 'regression: normal nga variance').toBe(95);
  });

  test('sale HUMAN maihap: dili mabalik ang stock', async ({ request }) => {
    const { countId, itemId } = await createCount(request, `variance-late-${Date.now()}`);

    // Giihap ang 100 (walay problema sa shelf).
    await saveCount(request, countId, itemId, 100);
    // Unya pa nakabaligya ug 5 — apil na ni sa live stock.
    await simulateSale(5);
    expect(await getStock()).toBe(95);

    await complete(request, countId);

    // Kung i-set ang absolute 100, mabalik ang nabaligya. Delta lang dapat.
    expect(await getStock(), 'ang ulahi nga sale nagpabilin').toBe(95);
  });
});
