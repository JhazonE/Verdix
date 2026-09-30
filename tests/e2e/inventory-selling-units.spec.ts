import { test, expect } from '@playwright/test';
import { seedSession, DEFAULT_ADMIN } from './helpers/auth';
import { testQuery } from './helpers/db';
import { PO_CASE_PRODUCT } from './fixtures/test-data';

/**
 * Selling units on the inventory surfaces: Stock Levels, Stock Counts and
 * Repackaging. PO_CASE_PRODUCT carries a base Piece unit and a Case of 24.
 * `products.stock` stays in base units throughout; the DB is the source of truth
 * for every assertion.
 */
const PRODUCT = PO_CASE_PRODUCT;

async function setStock(qty: number) {
  await testQuery('UPDATE products SET stock = ? WHERE id = ?', [qty, PRODUCT.id]);
}

async function getStock(): Promise<number> {
  const rows = await testQuery('SELECT stock FROM products WHERE id = ?', [PRODUCT.id]);
  return Number(rows[0].stock);
}

test.describe('Inventory selling units', () => {
  test.beforeEach(async () => {
    await setStock(50);
  });

  test('Stock Levels shows stock as a Case + Piece mix and expands per unit', async ({ page }) => {
    await seedSession(page, DEFAULT_ADMIN);
    await page.goto('/inventory');
    await page.getByPlaceholder(/search products by name or barcode/i).fill(PRODUCT.name);

    // 50 pieces with a Case of 24 = 2 Case + 2 Piece.
    await expect(page.getByText('2 Case + 2 Piece').first()).toBeVisible();

    // Table view expands to one row per unit; the grid view has no expander, so
    // only assert the expansion when the toggle is present.
    const expander = page.locator('button:has(svg.lucide-chevron-down)').first();
    if (await expander.isVisible().catch(() => false)) {
      await expander.click();
      await expect(page.getByTestId('selling-unit-row')).toHaveCount(2);
    }
  });

  test('Stock count takes a quantity per unit and stores base units', async ({ page, request }) => {
    const res = await request.post('/api/inventory/stock-counts', {
      data: { name: `units-count-${Date.now()}`, notes: 'e2e selling units', createdBy: 'e2e' },
    });
    expect(res.ok()).toBeTruthy();
    const { data } = await res.json();

    await seedSession(page, DEFAULT_ADMIN);
    await page.goto(`/inventory/stock-counts/${data.id}`);
    await page
      .getByPlaceholder(/scan barcode or search name/i)
      .fill(PRODUCT.name);
    await page.getByPlaceholder(/scan barcode or search name/i).press('Enter');

    // 1 Case + 5 Piece = 29 base units. Scope to a visible row: desktop table and
    // mobile cards both render, one of them hidden by CSS.
    await page.getByLabel('Case count').first().fill('1');
    await page.getByLabel('Piece count').first().fill('5');
    await page.getByRole('button', { name: /^save$/i }).first().click();

    await expect(async () => {
      const rows = await testQuery(
        'SELECT counted_quantity, variance, snapshot_quantity FROM stock_count_items WHERE stock_count_id = ? AND product_id = ?',
        [data.id, PRODUCT.id],
      );
      expect(Number(rows[0].counted_quantity)).toBe(29);
      expect(Number(rows[0].variance)).toBe(29 - Number(rows[0].snapshot_quantity));
    }).toPass({ timeout: 10_000 });
  });

  test('Repackage 1 Case into Pieces with a shortfall writes it off and logs the units', async ({ page }) => {
    await seedSession(page, DEFAULT_ADMIN);
    await page.goto('/inventory/repackaging');

    await page.getByPlaceholder(/search by name or barcode/i).fill(PRODUCT.name);
    await page.getByRole('button', { name: new RegExp(PRODUCT.name) }).first().click();

    // Defaults: from the largest unit (Case) into the smallest (Piece), quantity 1.
    await expect(page.getByText(/Expected:/)).toContainText('24 Piece');

    // Only 22 pieces actually came out of the case: 2 are written off.
    await page.getByLabel(/actually obtained/i).fill('22');
    await expect(page.getByTestId('shortfall-note')).toContainText('2 base unit');

    await page.getByRole('button', { name: 'Confirm Repackaging' }).click();

    await expect(async () => {
      const logs = await testQuery(
        `SELECT source_selling_unit_name, target_selling_unit_name, source_qty, target_qty_produced, shortfall_base_qty
         FROM repackaging_logs WHERE source_product_id = ? ORDER BY created_at DESC LIMIT 1`,
        [PRODUCT.id],
      );
      expect(logs[0].source_selling_unit_name).toBe('Case');
      expect(logs[0].target_selling_unit_name).toBe('Piece');
      expect(Number(logs[0].source_qty)).toBe(1);
      expect(Number(logs[0].target_qty_produced)).toBe(22);
      expect(Number(logs[0].shortfall_base_qty)).toBe(2);
    }).toPass({ timeout: 10_000 });

    // Converting Case -> Piece moves nothing; only the 2-piece shortfall leaves stock.
    expect(await getStock()).toBe(48);

    const movements = await testQuery(
      `SELECT quantity_change FROM stock_movements
       WHERE product_id = ? AND reference_type = 'adjustment' AND notes LIKE 'Repackaging shortfall%'
       ORDER BY created_at DESC LIMIT 1`,
      [PRODUCT.id],
    );
    expect(Number(movements[0].quantity_change)).toBe(-2);
  });

  test('Repackage with no shortfall leaves stock untouched', async ({ page }) => {
    await seedSession(page, DEFAULT_ADMIN);
    await page.goto('/inventory/repackaging');

    await page.getByPlaceholder(/search by name or barcode/i).fill(PRODUCT.name);
    await page.getByRole('button', { name: new RegExp(PRODUCT.name) }).first().click();
    await page.getByRole('button', { name: 'Confirm Repackaging' }).click();

    await expect(async () => {
      const logs = await testQuery(
        `SELECT shortfall_base_qty FROM repackaging_logs
         WHERE source_product_id = ? ORDER BY created_at DESC LIMIT 1`,
        [PRODUCT.id],
      );
      expect(Number(logs[0].shortfall_base_qty)).toBe(0);
    }).toPass({ timeout: 10_000 });

    expect(await getStock()).toBe(50);
  });
});
