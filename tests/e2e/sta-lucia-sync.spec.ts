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

async function seedApi(endpoint: string, onErrorAction: 'log_only' | 'retry' | 'queue' = 'log_only') {
  await testQuery('DELETE FROM external_apis WHERE id = ?', [API_ID]);
  await testQuery(
    `INSERT INTO external_apis
       (id, name, description, enabled, api_endpoint, auth_type, allowed_methods,
        timeout, retry_attempts, retry_delay, sync_mode, on_error_action, role,
        provider, login_email, login_password)
     VALUES (?, 'Sta Lucia E2E', '', 1, ?, 'none', 'send_only',
             10000, 1, 500, 'realtime', ?, 'general',
             'sta_lucia', 'tenant@example.com', 'secret')`,
    [API_ID, endpoint, onErrorAction],
  );
}

/**
 * Insert the kind of row a failed submission leaves behind, so the sweep has
 * something to pick up. `next_retry_at` is NULL on purpose — that is what the
 * sweep's `next_retry_at IS NULL OR next_retry_at <= NOW()` reads as "due now",
 * and it is the exact condition that made the pre-fix logger clone the row.
 */
async function seedFailedLog(id: string, endpoint: string) {
  await testQuery(
    `INSERT INTO external_api_logs
       (id, transaction_type, transaction_id, endpoint, payload, response,
        status, error_message, retry_count, next_retry_at)
     VALUES (?, 'STA_LUCIA_SALES', ?, ?, '{}', NULL, 'failed', 'seeded failure', 0, NULL)`,
    [id, Z_NUMBER, `${endpoint}/api/get-sales`],
  );
}

async function staLuciaLogs() {
  return await testQuery(
    `SELECT id, status, retry_count, next_retry_at FROM external_api_logs
      WHERE transaction_type = 'STA_LUCIA_SALES' AND transaction_id = ?
      ORDER BY created_at ASC`,
    [Z_NUMBER],
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

  test('the retry sweep resends a failed row to success without cloning it', async ({ request }) => {
    // on_error_action='retry' is what opts a config into the automatic sweep.
    // The seeded E2E config is 'log_only', so before this test the entire
    // sweep path had no coverage at all.
    await seedApi(MOCK_BASE, 'retry');
    await seedFailedLog('log_e2e_sweep_ok', MOCK_BASE);

    const sweep = await request.post('/api/dev/run-sync-queue');
    expect(sweep.ok()).toBe(true);

    const logs = await staLuciaLogs();

    // The row must have been REUSED, not appended to. This is the assertion
    // that catches the clone bug: the pre-fix logger always INSERTed, so a
    // successful sweep left the original row flipped to success PLUS a second
    // freshly inserted success row for the same Z-reading.
    expect(logs).toHaveLength(1);
    expect(logs[0].id).toBe('log_e2e_sweep_ok');
    expect(logs[0].status).toBe('success');
    expect(logs[0].next_retry_at).toBeNull();
  });

  test('repeated failing sweeps update one row instead of cloning it', async ({ request }) => {
    // Port 9 (discard) is closed, so every attempt fails fast. Left unfixed,
    // each pass would insert a NEW row with next_retry_at = NULL — immediately
    // due — so the due-set grows without bound and the sweep saturates its
    // LIMIT 10 with live HTTP attempts at the mall.
    await seedApi('http://127.0.0.1:9', 'retry');
    await seedFailedLog('log_e2e_sweep_fail', 'http://127.0.0.1:9');

    const retryCounts: number[] = [];

    for (let pass = 0; pass < 3; pass++) {
      // Re-arm the row as due. The sweep pushes next_retry_at 15 minutes out
      // after each failure, which is the correct backoff but would otherwise
      // make passes 2 and 3 no-ops and hide the regression this guards.
      await testQuery(
        `UPDATE external_api_logs SET next_retry_at = NULL
          WHERE transaction_type = 'STA_LUCIA_SALES' AND transaction_id = ?`,
        [Z_NUMBER],
      );

      const sweep = await request.post('/api/dev/run-sync-queue');
      expect(sweep.ok()).toBe(true);

      const logs = await staLuciaLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].id).toBe('log_e2e_sweep_fail');
      expect(logs[0].status).toBe('failed');
      retryCounts.push(Number(logs[0].retry_count));
    }

    // One row throughout, but the attempt counter genuinely advances — proving
    // the row is being updated rather than left alone.
    expect(retryCounts).toEqual([1, 2, 3]);
  });

  test('the Sync Logs retry button resubmits a failed Sta Lucia row', async ({ request }) => {
    // 'queue' means "a human retries this from the Sync Logs tab", so the
    // automatic sweep must NOT touch it — the button is the only recovery
    // path, and it returned 400 "Unsupported transaction type" before this fix.
    await seedApi(MOCK_BASE, 'queue');
    await seedFailedLog('log_e2e_button', MOCK_BASE);

    const swept = await request.post('/api/dev/run-sync-queue');
    expect(swept.ok()).toBe(true);
    expect((await staLuciaLogs())[0].status).toBe('failed');

    const res = await request.post('/api/external-api/logs/log_e2e_button/retry');
    expect(res.ok()).toBe(true);
    expect((await res.json()).success).toBe(true);

    const logs = await staLuciaLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe('success');
  });

  test('a deleted Z-reading is abandoned instead of retried forever', async ({ request }) => {
    await seedApi(MOCK_BASE, 'retry');
    await seedFailedLog('log_e2e_orphan', MOCK_BASE);
    await testQuery('DELETE FROM z_readings WHERE reading_number = ?', [Z_NUMBER]);

    await request.post('/api/dev/run-sync-queue');

    const logs = await staLuciaLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe('abandoned');
    expect(logs[0].next_retry_at).toBeNull();

    // 'abandoned' is outside the sweep's (pending|failed) WHERE clause, so a
    // later pass leaves it alone rather than re-resolving the dead reference.
    await request.post('/api/dev/run-sync-queue');
    expect((await staLuciaLogs())[0].status).toBe('abandoned');
  });
});
