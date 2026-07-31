import { test, expect } from '@playwright/test';
import { testQuery } from './helpers/db';

/**
 * Sta. Lucia sales submission against verdix_test.
 *
 * NOTE: do NOT import from `lib/` here — the test process points at the dev
 * `verdix` database while the test server runs against `verdix_test`. All
 * database access goes through testQuery.
 */

const API_ID = 'sta_lucia_e2e_api';
const Z_NUMBER = 'Z-E2E-0001';
const MOCK_BASE = 'http://127.0.0.1:3100/api/dev/mock-sta-lucia';

async function seedApi(endpoint: string) {
  await testQuery('DELETE FROM external_apis WHERE id = ?', [API_ID]);
  await testQuery(
    `INSERT INTO external_apis
       (id, name, description, enabled, api_endpoint, auth_type, allowed_methods,
        timeout, retry_attempts, retry_delay, sync_mode, on_error_action, role,
        provider, login_email, login_password)
     VALUES (?, 'Sta Lucia E2E', '', 1, ?, 'none', 'send_only',
             10000, 1, 500, 'realtime', 'log_only', 'general',
             'sta_lucia', 'tenant@example.com', 'secret')`,
    [API_ID, endpoint],
  );
}

async function seedZReading() {
  await testQuery('DELETE FROM z_readings WHERE reading_number = ?', [Z_NUMBER]);
  await testQuery(
    `INSERT INTO z_readings
       (reading_number, report_date, terminal_id, cashier_name, gross_sales, returns,
        discounts, net_sales, vat_amount, payment_methods, transaction_count,
        starting_cash, cash_sales, cash_in_drawer, vatable_sales, vat_exempt,
        zero_rated, non_vat)
     VALUES (?, '2026-07-31 18:30:00', 'terminal_default_01', 'Admin', 1700, 0,
             170, 1530, 108, ?, 42,
             0, 200, 200, 900, 100,
             0, 200)`,
    [Z_NUMBER, JSON.stringify([
      { name: 'CASH', amount: 200 },
      { name: 'GCash', amount: 800 },
      { name: 'Credit Card', amount: 530 },
    ])],
  );
}

test.describe('Sta Lucia sales submission', () => {
  test.beforeEach(async () => {
    await testQuery(
      `DELETE FROM external_api_logs WHERE transaction_type = 'STA_LUCIA_SALES' AND transaction_id = ?`,
      [Z_NUMBER],
    );
    await testQuery('DELETE FROM external_api_sessions WHERE api_id = ?', [API_ID]);
    // The atomic claim row MUST be cleared too. A successful send in one test
    // leaves succeeded=1, which would make every later test skip its send and
    // fail for the wrong reason.
    await testQuery('DELETE FROM sta_lucia_submissions WHERE z_reading_id = ?', [Z_NUMBER]);
    await seedZReading();
  });

  test.afterAll(async () => {
    await testQuery('DELETE FROM external_apis WHERE id = ?', [API_ID]);
    await testQuery('DELETE FROM z_readings WHERE reading_number = ?', [Z_NUMBER]);
    await testQuery('DELETE FROM sta_lucia_submissions WHERE z_reading_id = ?', [Z_NUMBER]);
  });

  test('sends a correctly mapped payload and logs success', async ({ request }) => {
    await seedApi(MOCK_BASE);

    const res = await request.post('/api/integrations/sta-lucia/send', {
      data: { apiId: API_ID, zReadingId: Z_NUMBER },
    });
    expect(res.ok()).toBe(true);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.skipped).toBeFalsy();

    // The mapping is the part worth asserting: tender split, percentage string,
    // and the VAT breakdown.
    expect(body.payload).toMatchObject({
      credit: 1330,
      debit: 200,
      gross_sales: 1700,
      net_sales: 1530,
      total_discounts: '10%',
      vat_sales: 900,
      vat_amount: 108,
      vat_exempt_sales: 100,
      non_vat_sales: 200,
      other_taxes: 0,
      number_of_transactions: 42,
      date_time: '2026-07-31 18:30:00',
    });

    // The mock echoes what it received, which proves it arrived intact.
    expect(body.response?.received?.credit).toBe(1330);
    expect(body.response?.success).toBe(true);

    const logs = await testQuery(
      `SELECT status, endpoint, payload FROM external_api_logs
       WHERE transaction_type = 'STA_LUCIA_SALES' AND transaction_id = ?`,
      [Z_NUMBER],
    );
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe('success');
    expect(logs[0].endpoint).toBe(`${MOCK_BASE}/api/get-sales`);
    expect(JSON.parse(logs[0].payload).total_discounts).toBe('10%');
  });

  test('a session is cached after the first send', async ({ request }) => {
    await seedApi(MOCK_BASE);
    await request.post('/api/integrations/sta-lucia/send', {
      data: { apiId: API_ID, zReadingId: Z_NUMBER },
    });

    const sessions = await testQuery(
      'SELECT token, owner_token FROM external_api_sessions WHERE api_id = ?',
      [API_ID],
    );
    expect(sessions).toHaveLength(1);
    expect(sessions[0].owner_token).toBe('MOCK_OWNER_xclkvbnjaoshjfasd');
  });

  test('the same Z-reading is never submitted twice', async ({ request }) => {
    await seedApi(MOCK_BASE);

    await request.post('/api/integrations/sta-lucia/send', {
      data: { apiId: API_ID, zReadingId: Z_NUMBER },
    });
    const second = await request.post('/api/integrations/sta-lucia/send', {
      data: { apiId: API_ID, zReadingId: Z_NUMBER },
    });

    const body = await second.json();
    expect(body.success).toBe(true);
    expect(body.skipped).toBe(true);

    const logs = await testQuery(
      `SELECT id FROM external_api_logs
       WHERE transaction_type = 'STA_LUCIA_SALES' AND transaction_id = ?`,
      [Z_NUMBER],
    );
    expect(logs).toHaveLength(1);
  });

  test('a failed send is logged as failed and leaves no session', async ({ request }) => {
    await seedApi('http://127.0.0.1:9');

    const res = await request.post('/api/integrations/sta-lucia/send', {
      data: { apiId: API_ID, zReadingId: Z_NUMBER },
    });
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBeTruthy();

    const logs = await testQuery(
      `SELECT status FROM external_api_logs
       WHERE transaction_type = 'STA_LUCIA_SALES' AND transaction_id = ?`,
      [Z_NUMBER],
    );
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe('failed');

    const sessions = await testQuery(
      'SELECT api_id FROM external_api_sessions WHERE api_id = ?',
      [API_ID],
    );
    expect(sessions).toHaveLength(0);
  });
});
