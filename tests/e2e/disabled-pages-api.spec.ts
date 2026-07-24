import { test, expect } from '@playwright/test';
import { testQuery } from './helpers/db';

test.describe('disabled-pages API', () => {
  test.afterEach(async () => {
    await testQuery('DELETE FROM disabled_pages');
  });

  test('GET returns empty list when nothing disabled', async ({ request }) => {
    await testQuery('DELETE FROM disabled_pages').catch(() => {});
    const res = await request.get('/api/developer/disabled-pages');
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.disabled)).toBe(true);
    expect(body.disabled).toEqual([]);
  });

  test('POST persists valid keys and GET returns them', async ({ request }) => {
    const res = await request.post('/api/developer/disabled-pages', {
      data: { disabled: ['sales_orders', 'sales_invoices'] },
    });
    expect((await res.json()).success).toBe(true);

    const get = await request.get('/api/developer/disabled-pages');
    const body = await get.json();
    expect(body.disabled.sort()).toEqual(['sales_invoices', 'sales_orders']);
  });

  test('POST rejects protected and unknown keys', async ({ request }) => {
    await request.post('/api/developer/disabled-pages', {
      data: { disabled: ['settings', 'dashboard', 'not_a_real_key', 'sales_orders'] },
    });
    const get = await request.get('/api/developer/disabled-pages');
    const body = await get.json();
    expect(body.disabled).toEqual(['sales_orders']);
  });

  test('POST replaces the full set', async ({ request }) => {
    await request.post('/api/developer/disabled-pages', { data: { disabled: ['sales_orders'] } });
    await request.post('/api/developer/disabled-pages', { data: { disabled: ['reports'] } });
    const get = await request.get('/api/developer/disabled-pages');
    expect((await get.json()).disabled).toEqual(['reports']);
  });
});
