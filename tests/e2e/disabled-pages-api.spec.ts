import { test, expect } from '@playwright/test';
import { testQuery } from './helpers/db';

// Mirrors SEED_MARKER in the route: the reserved row that records that
// DEFAULT_HIDDEN_KEYS has already been applied to this database.
const SEED_MARKER = '__defaults_seeded__';

// Reset to "configured, nothing hidden". KEEPING the marker is the point: a
// cleanup that deleted it too would leave the next test looking like a fresh
// install, and the route would seed the default-hidden pages underneath it.
async function resetToShowEverything() {
  await testQuery(`
    CREATE TABLE IF NOT EXISTS disabled_pages (
      page_key VARCHAR(100) NOT NULL PRIMARY KEY,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `).catch(() => {});
  await testQuery('DELETE FROM disabled_pages').catch(() => {});
  await testQuery('INSERT IGNORE INTO disabled_pages (page_key) VALUES (?)', [SEED_MARKER])
    .catch(() => {});
}

test.describe('disabled-pages API', () => {
  test.afterEach(async () => {
    await resetToShowEverything();
  });

  test('GET returns empty list when nothing disabled', async ({ request }) => {
    await resetToShowEverything();
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

  test('a fresh install starts with repackaging and approvals hidden', async ({ request }) => {
    // Simulate an install that has never had the table — the route creates and
    // seeds it on first request.
    await testQuery('DROP TABLE IF EXISTS disabled_pages');

    const res = await request.get('/api/developer/disabled-pages');
    const body = await res.json();
    expect(body.success).toBe(true);
    expect([...body.disabled].sort()).toEqual([
      'approvals',
      'approvals_settings',
      'inventory_repackaging',
    ]);
  });

  test('re-enabling a default-hidden page survives later reads', async ({ request }) => {
    await testQuery('DROP TABLE IF EXISTS disabled_pages');
    await request.get('/api/developer/disabled-pages'); // creates + seeds

    // Admin switches Repackaging back on; Save posts the full authoritative set.
    await request.post('/api/developer/disabled-pages', {
      data: { disabled: ['approvals', 'approvals_settings'] },
    });

    // A later read must NOT re-seed inventory_repackaging — an absent row here
    // is a deliberate choice, not an unconfigured install.
    const get = await request.get('/api/developer/disabled-pages');
    expect([...(await get.json()).disabled].sort()).toEqual(['approvals', 'approvals_settings']);
  });

  test('showing every page survives later reads', async ({ request }) => {
    await testQuery('DROP TABLE IF EXISTS disabled_pages');
    await request.get('/api/developer/disabled-pages'); // creates + seeds

    await request.post('/api/developer/disabled-pages', { data: { disabled: [] } });

    // Two reads: the first would re-seed if the marker had been wiped by POST.
    expect((await (await request.get('/api/developer/disabled-pages')).json()).disabled).toEqual([]);
    expect((await (await request.get('/api/developer/disabled-pages')).json()).disabled).toEqual([]);
  });

  test('an upgraded install with an empty table still gets the defaults', async ({ request }) => {
    // The real shape of every install that predates this feature: the table was
    // created by an earlier version, so it exists and is empty but was never
    // seeded. The marker is absent, so the route must self-heal here rather than
    // depending on migration 146 having run.
    await testQuery('DROP TABLE IF EXISTS disabled_pages');
    await testQuery(`
      CREATE TABLE disabled_pages (
        page_key VARCHAR(100) NOT NULL PRIMARY KEY,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    const body = await (await request.get('/api/developer/disabled-pages')).json();
    expect([...body.disabled].sort()).toEqual([
      'approvals',
      'approvals_settings',
      'inventory_repackaging',
    ]);
  });

  test('the seed marker is never exposed and cannot be set by a caller', async ({ request }) => {
    await testQuery('DROP TABLE IF EXISTS disabled_pages');
    await request.get('/api/developer/disabled-pages'); // creates + seeds

    // Present in the table...
    const raw = await testQuery('SELECT page_key FROM disabled_pages WHERE page_key = ?', [SEED_MARKER]);
    expect(raw.length).toBe(1);

    // ...but never in a response, and not settable as if it were a page.
    await request.post('/api/developer/disabled-pages', {
      data: { disabled: [SEED_MARKER, 'reports'] },
    });
    const body = await (await request.get('/api/developer/disabled-pages')).json();
    expect(body.disabled).toEqual(['reports']);
  });
});
