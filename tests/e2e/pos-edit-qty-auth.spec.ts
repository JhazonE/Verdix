import { test, expect } from '@playwright/test';
import { TEST_USERS, TEST_PRODUCTS } from './fixtures/test-data';
import { resetPosState, testQuery } from './helpers/db';

/**
 * Edit Quantity Authentication (POS Settings → Security Settings).
 *
 * Gi-test: kung naka-enable ang `enable_edit_qty_auth`, ang pag-usab sa quantity
 * sa cart — pinaagi sa qty button/F6 o sa +/- keyboard shortcuts — mangayo una ug
 * admin credentials sa AdminAuthDialog. Kung disabled (default), direkta ra.
 */

const cashier = TEST_USERS.cashier;
const product = TEST_PRODUCTS[0];

async function posLogin(page: import('@playwright/test').Page) {
  await page.goto('/pos');
  await expect(page.getByRole('heading', { name: /cashier login/i })).toBeVisible();
  await page.getByLabel('Username').fill(cashier.username);
  await page.getByLabel('Password').fill(cashier.password);
  await page.getByRole('button', { name: /login to pos/i }).click();
}

async function startShift(page: import('@playwright/test').Page) {
  await expect(page.getByRole('heading', { name: /start new shift/i })).toBeVisible();
  await page.getByRole('button', { name: /start shift/i }).click();
  await expect(page.getByPlaceholder(/scan barcode or enter product sku/i)).toBeVisible();
}

async function addProductBySku(page: import('@playwright/test').Page, sku: string, name: string) {
  const barcode = page.getByPlaceholder(/scan barcode or enter product sku/i);
  await expect(async () => {
    await barcode.fill(sku);
    await barcode.press('Enter');
    await expect(page.getByText(name).first()).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 15_000 });
}

async function setEditQtyAuth(enabled: boolean, username = 'qtyauth', password = 'secret123') {
  await testQuery(
    `UPDATE pos_settings SET enable_edit_qty_auth = ?, edit_qty_auth_username = ?, edit_qty_auth_password = ? WHERE id = 'pos_settings_1'`,
    [enabled ? 1 : 0, username, password],
  );
}

test.describe('POS Edit Quantity Authentication', () => {
  test.beforeEach(async ({ request }) => {
    // GET /api/pos-settings self-migrates missing columns (incl. enable_edit_qty_auth)
    // before we try to UPDATE them directly.
    await request.get('/api/pos-settings');
    await resetPosState();
    await setEditQtyAuth(false);
  });

  test.afterAll(async () => {
    await setEditQtyAuth(false);
  });

  test('disabled (default) → qty button edits directly, walay auth prompt', async ({ page }) => {
    await posLogin(page);
    await startShift(page);
    await addProductBySku(page, product.sku, product.name);

    await page.getByTitle(/edit quantity \(f6\)/i).click();
    await expect(page.locator('input[id^="pos-qty-"]')).toBeVisible();
    await expect(page.getByText(/edit quantity authorization/i)).not.toBeVisible();
  });

  test('enabled → qty button opens auth dialog; correct creds unlocks the input', async ({ page }) => {
    await setEditQtyAuth(true, 'qtyauth', 'secret123');
    await posLogin(page);
    await startShift(page);
    await addProductBySku(page, product.sku, product.name);

    await page.getByTitle(/edit quantity \(f6\)/i).click();
    await expect(page.getByText(/edit quantity authorization/i)).toBeVisible();

    await page.getByLabel('Username').fill('qtyauth');
    await page.getByLabel('Password').fill('secret123');
    await page.getByRole('button', { name: /authenticate/i }).click();

    await expect(page.getByText(/edit quantity authorization/i)).not.toBeVisible();
    await expect(page.locator('input[id^="pos-qty-"]')).toBeVisible();
  });

  test('enabled → wrong credentials rejected, qty input stays locked', async ({ page }) => {
    await setEditQtyAuth(true, 'qtyauth', 'secret123');
    await posLogin(page);
    await startShift(page);
    await addProductBySku(page, product.sku, product.name);

    await page.getByTitle(/edit quantity \(f6\)/i).click();
    await page.getByLabel('Username').fill('qtyauth');
    await page.getByLabel('Password').fill('wrongpass');
    await page.getByRole('button', { name: /authenticate/i }).click();

    await expect(page.getByText(/edit quantity authorization/i)).toBeVisible();
    await expect(page.locator('input[id^="pos-qty-"]')).not.toBeVisible();
  });

  test('enabled → "+" shortcut prompts for auth and applies the +1 on success', async ({ page }) => {
    await setEditQtyAuth(true, 'qtyauth', 'secret123');
    await posLogin(page);
    await startShift(page);
    await addProductBySku(page, product.sku, product.name);

    // Select the row via its leading indicator cell (no inner button there) —
    // name/price/qty cells are all clickable edit triggers themselves.
    await page.locator('td .rounded-full').first().click();

    await page.keyboard.press('+');
    await expect(page.getByText(/edit quantity authorization/i)).toBeVisible();

    await page.getByLabel('Username').fill('qtyauth');
    await page.getByLabel('Password').fill('secret123');
    await page.getByRole('button', { name: /authenticate/i }).click();

    await expect(page.getByText(/edit quantity authorization/i)).not.toBeVisible();
    // Qty was 1 → should now be 2.
    await expect(page.getByTitle(/edit quantity \(f6\)/i)).toHaveText('2');
  });
});
