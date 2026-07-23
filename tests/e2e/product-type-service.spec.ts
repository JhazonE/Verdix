import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { seedSession, DEFAULT_ADMIN } from './helpers/auth';
import { testQuery, resetPosState } from './helpers/db';
import { TEST_USERS } from './fixtures/test-data';

/**
 * Service product type (DB-backed) — mga services (labor, delivery fee, repair)
 * mo-benta nga walay stock tracking, FIFO batches, o stock movements.
 *
 * Ang labing importante nga assertion mao ang #2 sa ubos — ang usa ka service sale
 * dapat dili mohilabot sa stock, apan kinahanglan mo-record gihapon sa cost_at_sale
 * (gikan sa products.cost, batch_source NULL), kay ang profit reporting mo-basa sa
 * maong column ug dili makaila kung service ba o standard good.
 *
 * Naggamit ug parehas nga structure/helpers sa add-product-approval.spec.ts ug
 * product-edit-delete.spec.ts (openRowMenu pattern) ug pos-sale.spec.ts (cashier
 * login → start shift → barcode add → tender), kay ang /pos naay kaugalingong
 * PosLoginForm nga BULAG sa mock-user-session gamit sa ubang protected routes.
 */

const cashier = TEST_USERS.cashier;

async function posLogin(page: Page) {
  await page.goto('/pos');
  await expect(page.getByRole('heading', { name: /cashier login/i })).toBeVisible();
  await page.getByLabel('Username').fill(cashier.username);
  await page.getByLabel('Password').fill(cashier.password);
  await page.getByRole('button', { name: /login to pos/i }).click();
}

async function startShift(page: Page) {
  await expect(page.getByRole('heading', { name: /start new shift/i })).toBeVisible();
  await page.getByRole('button', { name: /start shift/i }).click();
  await expect(page.getByPlaceholder(/scan barcode or enter product sku/i)).toBeVisible();
}

/** I-add ang product pinaagi sa SKU (retry kay async ang product load). */
async function addProductBySku(page: Page, sku: string, name: string) {
  const barcode = page.getByPlaceholder(/scan barcode or enter product sku/i);
  await expect(async () => {
    await barcode.fill(sku);
    await barcode.press('Enter');
    await expect(page.getByText(name).first()).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 15_000 });
}

/** I-checkout pinaagi sa empty-barcode+Enter → TenderDialog → Confirm Payment. */
async function checkoutCash(page: Page) {
  const barcode = page.getByPlaceholder(/scan barcode or enter product sku/i);
  await barcode.click();
  await barcode.press('Enter');
  await expect(page.getByText(/tender payment/i)).toBeVisible();
  await page.getByRole('button', { name: /confirm payment/i }).click();
}

test.describe('Service product type', () => {
  const SERVICE_SKU = 'E2E-SVC-001';
  const SERVICE_NAME = 'E2E Test Service';

  test.beforeEach(async ({ page }) => {
    await testQuery('DELETE FROM sale_items WHERE product_name = ?', [SERVICE_NAME]);
    await testQuery('DELETE FROM products WHERE sku = ?', [SERVICE_SKU]);
    await resetPosState();
  });

  test('creating a service hides all stock fields and the Conversion tab', async ({ page }) => {
    await seedSession(page, DEFAULT_ADMIN);
    await page.goto('/products');
    await page.getByRole('button', { name: 'Add Product' }).first().click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Add New Product')).toBeVisible();

    await dialog.getByRole('button', { name: 'Service', exact: true }).click();

    // 5 tabs → 4: Conversion disappears from both the tablist and its panel.
    await expect(dialog.getByRole('tab', { name: 'Conversion' })).toBeHidden();

    await dialog.getByRole('tab', { name: 'Inventory' }).click();
    await expect(dialog.getByLabel('Initial Stock')).toBeHidden();
    await expect(dialog.getByLabel('Reorder Point')).toBeHidden();
    await expect(dialog.getByLabel('Supplier (Optional)')).toBeHidden();
    await expect(dialog.getByLabel('Warehouse (Optional)')).toBeHidden();
    await expect(dialog.getByLabel('Shelf Locations (Optional)')).toBeHidden();
    // Ang Department nag-grupo sa mga stocked nga produkto para sa markup ug
    // reporting — walay kalabotan sa serbisyo, mao nga tago sad.
    await expect(dialog.getByLabel('Department', { exact: true })).toBeHidden();
    // Confirmed visible fields for a Service on the Inventory tab.
    await expect(dialog.getByLabel('VAT Status', { exact: true })).toBeVisible();
    await expect(dialog.getByLabel('Availability', { exact: true })).toBeVisible();
    await expect(dialog.getByLabel('Base Unit of Measure', { exact: true })).toBeVisible();
    await expect(dialog.getByLabel('Cost (required)')).toBeVisible();

    // The Perishable toggle lives on the Loyalty tab, not Inventory — also hidden for services.
    await dialog.getByRole('tab', { name: 'Loyalty' }).click();
    await expect(dialog.getByText('Perishable', { exact: true })).toBeHidden();
  });

  test('selling a service leaves stock untouched but records cost_at_sale with no batch_source', async ({ page }) => {
    await testQuery(
      `INSERT INTO products (id, name, description, category, brand, sku, stock, price, cost, unit_of_measure, type)
       VALUES (?, ?, 'E2E service', 'IT Services', 'Generic', ?, 0, 500, 200, 'Service', 'service')`,
      [SERVICE_SKU, SERVICE_NAME, SERVICE_SKU]
    );

    await posLogin(page);
    await startShift(page);
    await addProductBySku(page, SERVICE_SKU, SERVICE_NAME);
    await checkoutCash(page);

    await expect(page.getByText(/saved successfully/i)).toBeVisible({ timeout: 15000 });

    const stock: any = await testQuery('SELECT stock FROM products WHERE sku = ?', [SERVICE_SKU]);
    expect(Number(stock[0].stock)).toBe(0);

    const movements: any = await testQuery(
      'SELECT COUNT(*) c FROM stock_movements WHERE product_id = ?',
      [SERVICE_SKU]
    );
    expect(Number(movements[0].c)).toBe(0);

    const items: any = await testQuery(
      'SELECT cost_at_sale, batch_source FROM sale_items WHERE product_name = ? ORDER BY created_at DESC LIMIT 1',
      [SERVICE_NAME]
    );
    expect(items.length).toBe(1);
    expect(Number(items[0].cost_at_sale)).toBe(200);
    expect(items[0].batch_source).toBeNull();
  });

  test('a service with no batches never trips the oversell block', async ({ page }) => {
    // pos_settings is a single-row settings table (no key/value rows) — flip the
    // real column the checkout route reads via getBatchCostingSettings().
    await testQuery('UPDATE pos_settings SET batch_costing_oversell_block = 1');

    await testQuery(
      `INSERT INTO products (id, name, description, category, brand, sku, stock, price, cost, unit_of_measure, type)
       VALUES (?, ?, 'E2E service', 'IT Services', 'Generic', ?, 0, 500, 200, 'Service', 'service')`,
      [SERVICE_SKU, SERVICE_NAME, SERVICE_SKU]
    );

    try {
      await posLogin(page);
      await startShift(page);
      await addProductBySku(page, SERVICE_SKU, SERVICE_NAME);
      await checkoutCash(page);

      // A batch-exhaustion rejection surfaces as a "Stock Alert" destructive toast
      // (use-tender.ts) — must never appear for a service line.
      await expect(page.getByText('Stock Alert')).toBeHidden();
      await expect(page.getByText(/saved successfully/i)).toBeVisible({ timeout: 15000 });
    } finally {
      // Must reset — a left-on oversell block would break other specs' sales.
      await testQuery('UPDATE pos_settings SET batch_costing_oversell_block = 0');
    }
  });

  test('services are absent from the low-stock report', async ({ page }) => {
    await testQuery(
      `INSERT INTO products (id, name, description, category, brand, sku, stock, reorder_point, price, cost, unit_of_measure, type)
       VALUES (?, ?, 'E2E service', 'IT Services', 'Generic', ?, 0, 10, 500, 200, 'Service', 'service')`,
      [SERVICE_SKU, SERVICE_NAME, SERVICE_SKU]
    );

    await seedSession(page, DEFAULT_ADMIN);
    await page.goto('/reports/low-stock');
    await expect(page.getByRole('heading', { name: 'Low Stock Report' })).toBeVisible();
    // The API excludes p.type <> 'standard' outright, regardless of stock/reorder point.
    await expect(page.getByText(SERVICE_NAME)).toBeHidden();
  });

  test('a service reads as Available, never Out of Stock', async ({ page }) => {
    // Stock 0 is the normal, permanent state of a service. The stock ladder
    // would call that "Out of Stock", which reads as a problem to fix.
    await testQuery(
      `INSERT INTO products (id, name, description, category, brand, sku, stock, reorder_point, price, cost, unit_of_measure, type)
       VALUES (?, ?, 'E2E service', 'IT Services', 'Generic', ?, 0, 0, 500, 200, 'Service', 'service')`,
      [SERVICE_SKU, SERVICE_NAME, SERVICE_SKU]
    );

    await seedSession(page, DEFAULT_ADMIN);
    await page.goto('/inventory');

    // Scope to the card by its heading, then walk up to the card element —
    // filtering on `div` alone matches inner wrappers that exclude the badge.
    const card = page
      .getByRole('heading', { name: SERVICE_NAME })
      .locator('xpath=ancestor::div[contains(@class,"relative")][1]');
    await expect(card.getByText('Available', { exact: true })).toBeVisible();
    await expect(card.getByText('Out of Stock')).toBeHidden();
  });

  test('type is read-only in Edit Product', async ({ page }) => {
    await testQuery(
      `INSERT INTO products (id, name, description, category, brand, sku, stock, price, cost, unit_of_measure, type)
       VALUES (?, ?, 'E2E service', 'IT Services', 'Generic', ?, 0, 500, 200, 'Service', 'service')`,
      [SERVICE_SKU, SERVICE_NAME, SERVICE_SKU]
    );

    await seedSession(page, DEFAULT_ADMIN);
    await page.goto('/products');
    await page.getByPlaceholder('Search products...').fill(SERVICE_SKU);

    const row = page.getByRole('row', { name: new RegExp(SERVICE_NAME) });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Open menu' }).click();
    await page.getByRole('menuitem', { name: 'Edit Product' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Edit Product')).toBeVisible();

    // Basic Info is the default tab — the type Badge is read-only, no toggle control.
    await expect(dialog.getByText('Service', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Cannot be changed after creation.', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Standard', exact: true })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Service', exact: true })).toHaveCount(0);
  });
});
