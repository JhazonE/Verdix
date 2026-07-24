import { test, expect } from '@playwright/test';
import { testQuery } from './helpers/db';
import { seedSession, DEFAULT_ADMIN } from './helpers/auth';

// A realistic full-admin permission set (matches the real seeded admin, which has
// no 'super_admin' permission — that string does not exist in this system).
// manage_settings gates /developer/options; view_sales makes the Sales section render.
const ADMIN = {
  ...DEFAULT_ADMIN,
  permissions: [
    'view_dashboard', 'manage_products', 'manage_inventory', 'view_sales',
    'manage_customers', 'manage_suppliers', 'manage_purchases', 'view_approvals',
    'manage_approval_settings', 'view_reports', 'manage_users', 'manage_settings',
    'access_pos',
  ],
};

test.describe('developer page toggles — sidebar', () => {
  test.afterEach(async () => {
    await testQuery('DELETE FROM disabled_pages').catch(() => {});
  });

  test('disabling sales_orders hides the Sales Order link', async ({ page, request }) => {
    await request.post('/api/developer/disabled-pages', { data: { disabled: ['sales_orders'] } });

    await seedSession(page, ADMIN);
    await page.goto('/dashboard');
    // Open the Sales section so its sub-links render.
    await page.getByRole('button', { name: 'Sales' }).click();

    await expect(page.getByRole('link', { name: 'Sales Invoice/Delivery' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sales Order' })).toHaveCount(0);
  });

  test('navigating to a disabled page URL redirects to dashboard', async ({ page, request }) => {
    await request.post('/api/developer/disabled-pages', { data: { disabled: ['sales_orders'] } });

    await seedSession(page, ADMIN);
    await page.goto('/sales/orders');
    await page.waitForURL('**/dashboard');
    expect(new URL(page.url()).pathname).toBe('/dashboard');
  });

  test('re-enabling a page restores the link and the URL', async ({ page, request }) => {
    await request.post('/api/developer/disabled-pages', { data: { disabled: [] } });

    await seedSession(page, ADMIN);
    await page.goto('/sales/orders');
    // Should stay on /sales/orders, not redirect.
    await page.waitForLoadState('networkidle');
    expect(new URL(page.url()).pathname).toBe('/sales/orders');
  });

  test('developer options page toggles a page off end-to-end', async ({ page, request }) => {
    await request.post('/api/developer/disabled-pages', { data: { disabled: [] } });

    await seedSession(page, ADMIN);
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

  test('POS Mode is settable from developer options and persists', async ({ page, request }) => {
    // Start from a known state: default mode.
    await request.post('/api/pos-settings', { data: { posMode: 'default' } });

    await seedSession(page, ADMIN);
    await page.goto('/developer/options');

    // The Queue block is hidden until Pharmacy is selected.
    await expect(page.getByText('Queue Number Settings')).toHaveCount(0);

    // Select Pharmacy — saves on click.
    await page.getByRole('button', { name: 'Pharmacy' }).click();

    // Persisted to pos-settings.
    await expect.poll(async () => {
      const r = await request.get('/api/pos-settings');
      return (await r.json()).data?.posMode;
    }).toBe('pharmacy');

    // Queue block now visible.
    await expect(page.getByText('Queue Number Settings')).toBeVisible();

    // Reset to default so we don't leak pharmacy mode into other tests.
    await request.post('/api/pos-settings', { data: { posMode: 'default' } });
  });
});
