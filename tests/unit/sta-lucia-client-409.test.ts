import assert from 'node:assert/strict';
import http from 'node:http';
import { sendSales, login, type StaLuciaApiConfig } from '../../lib/integrations/sta-lucia/client';

// In-memory session store stub: client.ts persists sessions via
// lib/integrations/sta-lucia/session.ts, which calls into lib/mysql.ts's
// query(). This test never calls login() through sendSales's ensureSession
// path with a real DB — instead it pre-seeds the config's own login so the
// first call in each test performs a real login against the local mock,
// then a database IS required. To keep this test DB-free, we instead assert
// against sendSales's behavior on the response status alone by stubbing
// getSession/saveSession is not an available seam, so this test hits the
// real dev DB via lib/mysql.ts (same as every other test in tests/unit that
// touches lib/integrations/sta-lucia). It uses api id 'sta_lucia_409_test'
// and cleans up after itself.
import { query } from '../../lib/mysql';

async function withMockServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer(handler);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('failed to bind mock server');
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}

async function run() {
  const API_ID = 'sta_lucia_409_test';
  await query('DELETE FROM external_api_sessions WHERE api_id = ?', [API_ID]);
  await query('DELETE FROM external_apis WHERE id = ?', [API_ID]);
  await query(
    `INSERT INTO external_apis
       (id, name, description, enabled, api_endpoint, auth_type, allowed_methods,
        timeout, retry_attempts, retry_delay, sync_mode, on_error_action, role,
        provider, login_email, login_password)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [API_ID, 'Test API', '', 1, 'http://placeholder', 'none', 'send_only',
     10000, 1, 500, 'realtime', 'log_only', 'general',
     'sta_lucia', 'tenant@example.com', 'secret']
  );

  const mock = await withMockServer((req, res) => {
    if (req.url === '/api/login') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 1, token: 'tok', owner_token: 'owner' }));
      return;
    }
    if (req.url === '/api/get-sales') {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, message: 'Duplicate hourly sale' }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  try {
    const cfg: StaLuciaApiConfig = {
      id: API_ID,
      apiEndpoint: mock.url,
      loginEmail: 'tenant@example.com',
      loginPassword: 'secret',
      timeout: 5000,
      onErrorAction: 'log_only',
    };

    const result = await sendSales(cfg, {
      credit: 0, debit: 0, gross_sales: 0, date_time: '2026-08-12 13:00:00',
      total_discounts: '0%', vat_exempt_sales: 0, vat_sales: 0, non_vat_sales: 0,
      vat_amount: 0, other_taxes: 0, net_sales: 0, sale_type: true,
    });

    assert.equal(result.success, true, '409 must be reported as success');
    assert.equal(result.duplicate, true, '409 must be flagged as a duplicate, not a fresh success');
    assert.equal(result.status, 409, 'status is passed through');
  } finally {
    await mock.close();
    await query('DELETE FROM external_api_sessions WHERE api_id = ?', [API_ID]);
    await query('DELETE FROM external_apis WHERE id = ?', [API_ID]);
  }

  console.log('sta-lucia-client-409: all assertions passed');
}

run().catch(err => { console.error(err); process.exit(1); });
