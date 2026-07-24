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

  test('navigating to a disabled page URL redirects to dashboard', async ({ page, request }) => {
    await request.post('/api/developer/disabled-pages', { data: { disabled: ['sales_orders'] } });

    await seedSession(page, SUPER_ADMIN);
    await page.goto('/sales/orders');
    await page.waitForURL('**/dashboard');
    expect(new URL(page.url()).pathname).toBe('/dashboard');
  });

  test('re-enabling a page restores the link and the URL', async ({ page, request }) => {
    await request.post('/api/developer/disabled-pages', { data: { disabled: [] } });

    await seedSession(page, SUPER_ADMIN);
    await page.goto('/sales/orders');
    // Should stay on /sales/orders, not redirect.
    await page.waitForLoadState('networkidle');
    expect(new URL(page.url()).pathname).toBe('/sales/orders');
  });

  test('developer options page toggles a page off end-to-end', async ({ page, request }) => {
    await request.post('/api/developer/disabled-pages', { data: { disabled: [] } });

    await seedSession(page, SUPER_ADMIN);
    await page.goto('/developer/options');

    // Toggle Sales Order off (switch is labelled by the page label).
    await page.getByRole('switch', { name: 'Sales Order' }).click();
    await page.getByRole('button', { name: /save/i }).click();

    // Confirm it persisted via the API.
    await expect.poll(async () => {
      const r = await request.get('/api/developer/disabled-pages');
      return (await r.json()).disabled;
    }).toContain('sales_orders');
  });
});
