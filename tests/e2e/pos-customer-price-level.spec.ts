import { test, expect, type Page } from '@playwright/test';
import { TEST_USERS, TEST_PRODUCTS } from './fixtures/test-data';
import { resetPosState, testQuery } from './helpers/db';

/**
 * Selecting a customer who carries a price level must re-price the POS cart
 * to that level automatically — both for lines already in the cart and for
 * lines added afterwards — and switching back to walk-in must restore the
 * default-level price.
 */

const cashier = TEST_USERS.cashier;
const product = TEST_PRODUCTS[2]; // Test Instant Noodles @ 15.75
const LEVEL = { id: 'e2e-wholesale-level', name: 'E2E Wholesale' };
const CUSTOMER = { id: 'CUST-E2E-WHOLESALE', name: 'E2E Wholesale Buyer' };
const WHOLESALE_PRICE = '12.00';
const RETAIL_PRICE = product.price.toFixed(2);

async function posLogin(page: Page) {
  await page.goto('/pos');
  await expect(page.getByRole('heading', { name: /cashier login/i })).toBeVisible();
  await page.getByLabel('Username').fill(cashier.username);
  await page.getByLabel('Password').fill(cashier.password);
  await page.getByRole('button', { name: /login to pos/i }).click();
  await expect(page.getByRole('heading', { name: /start new shift/i })).toBeVisible();
  await page.getByRole('button', { name: /start shift/i }).click();
  await expect(page.getByPlaceholder(/scan barcode or enter product sku/i)).toBeVisible();
}

async function addProduct(page: Page) {
  const barcode = page.getByPlaceholder(/scan barcode or enter product sku/i);
  await expect(async () => {
    await barcode.fill(product.sku);
    await barcode.press('Enter');
    await expect(page.getByText(product.name).first()).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 15_000 });
}

async function selectCustomer(page: Page, name: string) {
  await page.getByRole('button', { name: /customer/i }).filter({ hasText: /walk-in|e2e/i }).first().click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  await sheet.getByRole('combobox').first().click();
  await page.getByRole('option', { name }).click();
  await sheet.getByRole('button', { name: /confirm selection/i }).click();
  await expect(sheet).toBeHidden();
}

const cartPrice = (page: Page, value: string) =>
  page.getByRole('table').getByText(new RegExp(value.replace('.', '\\.'))).first();

test.describe('POS customer price level', () => {
  test.beforeAll(async () => {
    await testQuery(
      `INSERT IGNORE INTO price_levels (id, name, calculation_base, is_default, percentage_adjustment)
       VALUES (?, ?, 'retail', 0, 100.00)`,
      [LEVEL.id, LEVEL.name],
    );
    await testQuery(
      `INSERT IGNORE INTO customers (id, name, active, price_level_id) VALUES (?, ?, 1, ?)`,
      [CUSTOMER.id, CUSTOMER.name, LEVEL.id],
    );
    await testQuery(
      `INSERT INTO product_selling_unit_price_levels (selling_unit_id, price_level_id, price, min_quantity)
       SELECT u.id, ?, ?, 0 FROM product_selling_units u WHERE u.product_id = ? AND u.is_base = 1
       ON DUPLICATE KEY UPDATE price = VALUES(price), min_quantity = 0`,
      [LEVEL.id, WHOLESALE_PRICE, product.id],
    );
  });

  test.beforeEach(async () => {
    await resetPosState();
  });

  test('customer selected AFTER adding re-prices the existing line', async ({ page }) => {
    await posLogin(page);
    await addProduct(page);
    await expect(cartPrice(page, RETAIL_PRICE)).toBeVisible();

    await selectCustomer(page, CUSTOMER.name);
    await expect(cartPrice(page, WHOLESALE_PRICE)).toBeVisible();
  });

  test('customer selected BEFORE adding prices the new line at their level', async ({ page }) => {
    await posLogin(page);
    await selectCustomer(page, CUSTOMER.name);
    await addProduct(page);
    await expect(cartPrice(page, WHOLESALE_PRICE)).toBeVisible();
  });
});
