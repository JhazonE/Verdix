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

  /**
   * Duha ka produkto sa PAREHONG PAMILYA sulod sa usa ka count.
   *
   * Kung ma-apply ang variance sa una, mo-cascade ang family-sync ngadto sa
   * tanang sakop — apil ang ikaduha nga item nga wala pa ma-proseso. Kung
   * basahon ang live stock sa sulod sa loop, makita sa ikaduha kanang bag-ong
   * gisulat nga stock, samtang ang iyang movement sums mo-exclude niini (kay
   * gi-tag man sa reference_id niining count). Mo-trigger dayon ang fallback
   * bisan himsog ang log, ug mo-imbento ug variance sa linya nga husto man ang
   * pagkaihap.
   *
   * Ang pag-ihap sa parent ug child nga magkauban kay MAO ang normal — walay
   * family filter ang count query.
   */
  test('parehong pamilya sa usa ka count: walay phantom variance', async ({ request }) => {
    const PARENT = 'test-perishable-family-parent';
    const CHILD = 'test-perishable-family-child';
    const FACTOR = 12; // 1 Box = 12 Piece

    const stockOf = async (id: string) =>
      Number((await testQuery('SELECT stock FROM products WHERE id = ?', [id]))[0].stock);

    await testQuery('UPDATE products SET stock = 10 WHERE id = ?', [PARENT]);
    await testQuery('UPDATE products SET stock = 120 WHERE id = ?', [CHILD]);

    const res = await request.post(BASE, {
      data: { name: `variance-family-${Date.now()}`, notes: 'e2e family', createdBy: 'e2e' },
    });
    expect(res.ok()).toBeTruthy();
    const { data } = await res.json();

    const rows = await testQuery(
      'SELECT id, product_id, snapshot_quantity FROM stock_count_items WHERE stock_count_id = ? AND product_id IN (?, ?)',
      [data.id, PARENT, CHILD]
    );
    expect(rows.length, 'apil ang parent ug child sa count').toBe(2);

    const parentRow = rows.find((r: any) => r.product_id === PARENT);
    const childRow = rows.find((r: any) => r.product_id === CHILD);

    // Ang CHILD kulang ug 12 Piece (= 1 Box) — tinuod ni nga variance, mao nga
    // modagan gyud ang family-sync ug mo-cascade sa PARENT (-1 Box).
    //
    // Ang PARENT giihap nga EKSAKTO sa iyang snapshot: sa panahon nga giihap siya,
    // 10 gyud ang naa. Busa dili siya angay ug kaugalingong adjustment.
    //
    // Ang child mao ang UNA sa items array (walay ORDER BY ang itemsQuery, ug
    // mao ni ang storage order), busa ang iyang cascade mo-igo sa parent nga wala
    // pa ma-proseso. Kung basahon ang live stock sulod sa mutation loop, makita
    // sa parent ang 9 nga gisulat sa cascade samtang ang iyang movement sums
    // mo-exclude niini (gi-tag man sa reference_id niining count) — motungha ang
    // fallback ug mo-imbento ug +1 nga phantom variance, nga mo-cascade balik.
    const put = await request.put(`${BASE}/${data.id}/items`, {
      data: {
        items: [
          { id: childRow.id, counted_quantity: Number(childRow.snapshot_quantity) - FACTOR },
          { id: parentRow.id, counted_quantity: Number(parentRow.snapshot_quantity) },
        ],
      },
    });
    expect(put.ok()).toBeTruthy();

    await complete(request, data.id);

    // Ang -12 Piece ra ang angay ma-apply, ug ang cascade niini (-1 Box) sa parent.
    expect(await stockOf(CHILD), 'ang -12 Piece ra').toBe(120 - FACTOR);
    expect(await stockOf(PARENT), 'cascade ra sa -12 Piece, walay phantom').toBe(9);
  });
});
