import { test, expect } from '@playwright/test';
import { seedSession, DEFAULT_ADMIN } from './helpers/auth';
import { testQuery } from './helpers/db';
import { INVENTORY_PRODUCT, PERISHABLE_PRODUCT } from './fixtures/test-data';

/**
 * Expiration date sa stock adjustment — i-drive ang Adjust Stock dialog ug ang
 * bulk endpoint batok sa verdix_test.
 *
 * Ang mga assert mo-adto sa DATABASE, dili lang sa UI, kay ang batch INSERT naa
 * sulod sa silent try/catch (pre-migration guard) — kung maguba ang write,
 * mogawas gihapon ang success toast bisan walay na-save. DB read ra ang
 * makapamatuod nga tinuod nga na-persist.
 */

/**
 * Kuhaa ang batch nga gimugna sa usa ka test.
 *
 * NOTE: ang inventory_batches.id kay RANDOM nga 6-digit string (generateBatchId),
 * ug ang created_at second-precision ra — mao nga "ORDER BY created_at DESC, id
 * DESC" DILI kasaligan kung duha ka batch ang nahimo sulod sa parehas ka segundo
 * (mahitabo permi sa CI kay paspas ra kaayo ang mga request). Ang matag batch
 * gikan sa auto-batch code kay naay notes nga `Auto-batch for adjustment:
 * ${reason}` — mao nga i-filter na lang base sa reason string aron eksakto gyud
 * ang batch nga gikuha, dili basta ang "pinakabag-o".
 */
async function batchByReason(productId: string, reason: string) {
  const rows = await testQuery(
    `SELECT id, quantity_in, DATE_FORMAT(expiration_date, '%Y-%m-%d') AS expiration_date
     FROM inventory_batches
     WHERE product_id = ? AND notes = ?
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [productId, `Auto-batch for adjustment: ${reason}`],
  );
  return rows[0] || null;
}

test.describe('Adjustment expiration dates', () => {
  test('perishable product: makabutang ug expiry pinaagi sa Adjust Stock dialog', async ({ page }) => {
    await seedSession(page, DEFAULT_ADMIN);
    await page.goto('/inventory');

    await page.getByPlaceholder(/search products by name or sku/i).fill(PERISHABLE_PRODUCT.sku);

    await page.getByRole('button', { name: 'Actions' }).first().click();
    await page.getByRole('menuitem', { name: 'Adjust Stock' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Adjust Stock')).toBeVisible();

    await dialog.getByLabel(/quantity to add/i).fill('5');

    // Ang expiry field motungha ra para sa perishable nga product sa Add mode.
    const expiryInput = dialog.getByLabel(/expiration date/i);
    await expect(expiryInput).toBeVisible();
    await expiryInput.fill('2027-06-30');

    await dialog.getByRole('combobox').click();
    await page.getByRole('option', { name: 'New Shipment' }).click();

    await dialog.getByRole('button', { name: 'Confirm Adjustment' }).click();
    await expect(dialog).toBeHidden();

    await expect(async () => {
      const batch = await batchByReason(PERISHABLE_PRODUCT.id, 'New Shipment');
      expect(batch, 'naay batch nga na-create').toBeTruthy();
      expect(batch.expiration_date).toBe('2027-06-30');
    }).toPass({ timeout: 10_000 });
  });

  test('non-perishable product: walay expiry field sa dialog', async ({ page }) => {
    await seedSession(page, DEFAULT_ADMIN);
    await page.goto('/inventory');

    await page.getByPlaceholder(/search products by name or sku/i).fill(INVENTORY_PRODUCT.sku);

    await page.getByRole('button', { name: 'Actions' }).first().click();
    await page.getByRole('menuitem', { name: 'Adjust Stock' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Adjust Stock')).toBeVisible();

    // Dili gyud motungha ang expiry field para sa dili-perishable.
    await expect(dialog.getByLabel(/expiration date/i)).toHaveCount(0);
  });

  test('perishable + Remove mode: gitago ang expiry field', async ({ page }) => {
    await seedSession(page, DEFAULT_ADMIN);
    await page.goto('/inventory');

    await page.getByPlaceholder(/search products by name or sku/i).fill(PERISHABLE_PRODUCT.sku);

    await page.getByRole('button', { name: 'Actions' }).first().click();
    await page.getByRole('menuitem', { name: 'Adjust Stock' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel(/expiration date/i)).toBeVisible();

    await dialog.getByRole('tab', { name: /remove stock/i }).click();
    await expect(dialog.getByLabel(/expiration date/i)).toHaveCount(0);
  });

  test('bulk endpoint: gi-save ang expiry sa batch', async ({ request }) => {
    const res = await request.post('/api/inventory/adjust/bulk', {
      data: {
        adjustments: [{
          productId: PERISHABLE_PRODUCT.id,
          quantity: 7,
          reason: 'E2E bulk expiry',
          expirationDate: '2027-09-15',
        }],
        adjustmentType: 'add',
        userId: 'test-admin-uid',
      },
    });
    expect(res.ok()).toBeTruthy();

    await expect(async () => {
      const batch = await batchByReason(PERISHABLE_PRODUCT.id, 'E2E bulk expiry');
      expect(batch).toBeTruthy();
      expect(batch.expiration_date).toBe('2027-09-15');
    }).toPass({ timeout: 10_000 });
  });

  test('blank nga expiry: NULL ang batch, walay error', async ({ request }) => {
    const res = await request.post('/api/inventory/adjust/bulk', {
      data: {
        adjustments: [{
          productId: PERISHABLE_PRODUCT.id,
          quantity: 3,
          reason: 'E2E walay expiry',
          expirationDate: null,
        }],
        adjustmentType: 'add',
        userId: 'test-admin-uid',
      },
    });
    expect(res.ok()).toBeTruthy();

    await expect(async () => {
      const batch = await batchByReason(PERISHABLE_PRODUCT.id, 'E2E walay expiry');
      expect(batch).toBeTruthy();
      expect(batch.expiration_date).toBeNull();
    }).toPass({ timeout: 10_000 });
  });

  test('products.expiration_date cache: ang pinakaduol nga petsa ang gigamit', async ({ request }) => {
    // Duha ka batch: ang ulahi nga gi-add mas sayo mo-expire → siya dapat ang cache.
    for (const date of ['2028-01-31', '2027-02-28']) {
      const res = await request.post('/api/inventory/adjust/bulk', {
        data: {
          adjustments: [{
            productId: PERISHABLE_PRODUCT.id,
            quantity: 2,
            reason: 'E2E cache',
            expirationDate: date,
          }],
          adjustmentType: 'add',
          userId: 'test-admin-uid',
        },
      });
      expect(res.ok()).toBeTruthy();
    }

    await expect(async () => {
      const rows = await testQuery(
        `SELECT DATE_FORMAT(expiration_date, '%Y-%m-%d') AS expiration_date FROM products WHERE id = ?`,
        [PERISHABLE_PRODUCT.id],
      );
      expect(rows[0]?.expiration_date).toBe('2027-02-28');
    }).toPass({ timeout: 10_000 });
  });

  test('expiring-soon report: makita ang duol na mo-expire nga batch', async ({ request }) => {
    const res = await request.post('/api/inventory/adjust/bulk', {
      data: {
        adjustments: [{
          productId: PERISHABLE_PRODUCT.id,
          quantity: 4,
          reason: 'E2E report',
          expirationDate: '2027-12-31',
        }],
        adjustmentType: 'add',
        userId: 'test-admin-uid',
      },
    });
    expect(res.ok()).toBeTruthy();

    // I-pull ang petsa palapit aron mosulod sa 30-day window.
    await testQuery(
      `UPDATE inventory_batches SET expiration_date = DATE_ADD(CURDATE(), INTERVAL 5 DAY)
       WHERE product_id = ? AND expiration_date = '2027-12-31'`,
      [PERISHABLE_PRODUCT.id],
    );

    const report = await request.get('/api/reports/expiring-soon?days=30');
    expect(report.ok()).toBeTruthy();
    const body = await report.json();
    expect(body.success).toBeTruthy();
    expect(body.items.some((i: any) => i.productId === PERISHABLE_PRODUCT.id)).toBeTruthy();
  });
});
