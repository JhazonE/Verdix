import { test, expect } from '@playwright/test';
import { testQuery } from './helpers/db';
import { seedSession, DEFAULT_ADMIN } from './helpers/auth';

const SUPER_ADMIN = { ...DEFAULT_ADMIN, permissions: ['super_admin'] };

test.describe('developer page toggles — sidebar', () => {
  test.afterEach(async () => {
    await testQuery('DELETE FROM disabled_pages').catch(() => {});
  });

  test('disabling sales_orders hides the Sales Order link', async ({ page, request }) => {
    await request.post('/api/developer/disabled-pages', { data: { disabled: ['sales_orders'] } });

    await seedSession(page, SUPER_ADMIN);
    await page.goto('/dashboard');
    // Open the Sales section so its sub-links render.
    await page.getByRole('button', { name: 'Sales' }).click();

    await expect(page.getByRole('link', { name: 'Sales Invoice/Delivery' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sales Order' })).toHaveCount(0);
  });
});
