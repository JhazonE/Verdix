import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/mysql';
import { getExternalApiConfig } from '@/lib/external-api-config';
import { v4 as uuidv4 } from 'uuid';

const INIT_TABLE = `
  CREATE TABLE IF NOT EXISTS external_apis (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    enabled TINYINT(1) NOT NULL DEFAULT 0,
    api_endpoint VARCHAR(500) NOT NULL,
    auth_type ENUM('api_key','bearer_token','none') NOT NULL DEFAULT 'none',
    api_key VARCHAR(500),
    bearer_token VARCHAR(500),
    allowed_methods ENUM('send_only','receive_only','full_access') NOT NULL DEFAULT 'full_access',
    timeout INT NOT NULL DEFAULT 30000,
    retry_attempts INT NOT NULL DEFAULT 3,
    retry_delay INT NOT NULL DEFAULT 2000,
    sync_mode ENUM('realtime','batch') NOT NULL DEFAULT 'realtime',
    on_error_action ENUM('retry','queue','log_only') NOT NULL DEFAULT 'log_only',
    provider ENUM('generic','sta_lucia') NOT NULL DEFAULT 'generic',
    login_email VARCHAR(255),
    login_password VARCHAR(500),
    role ENUM('general','cloud_sync') NOT NULL DEFAULT 'general',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )
`;

const ADDITIVE_COLUMNS: Array<[string, string]> = [
  ['role',           `ENUM('general','cloud_sync') NOT NULL DEFAULT 'general'`],
  ['provider',       `ENUM('generic','sta_lucia') NOT NULL DEFAULT 'generic'`],
  ['login_email',    `VARCHAR(255) NULL`],
  ['login_password', `VARCHAR(500) NULL`],
];

async function ensureTable() {
  await query(INIT_TABLE, []);

  const cols = await query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'external_apis'`,
    []
  ) as any[];
  const have = new Set(cols.map((c: any) => c.COLUMN_NAME));

  for (const [name, ddl] of ADDITIVE_COLUMNS) {
    if (!have.has(name)) {
      await query(`ALTER TABLE external_apis ADD COLUMN ${name} ${ddl}`, []);
    }
  }

  await query(`
    CREATE TABLE IF NOT EXISTS external_api_sessions (
      api_id      VARCHAR(36) PRIMARY KEY,
      token       TEXT,
      owner_token VARCHAR(500),
      obtained_at TIMESTAMP NULL DEFAULT NULL,
      CONSTRAINT fk_eas_api FOREIGN KEY (api_id)
        REFERENCES external_apis(id) ON DELETE CASCADE
    )
  `, []);
}

function rowToApi(row: any) {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    enabled: Boolean(row.enabled),
    apiEndpoint: row.api_endpoint,
    authType: row.auth_type,
    apiKey: row.api_key ?? '',
    bearerToken: row.bearer_token ?? '',
    allowedMethods: row.allowed_methods,
    timeout: row.timeout,
    retryAttempts: row.retry_attempts,
    retryDelay: row.retry_delay,
    syncMode: row.sync_mode,
    onErrorAction: row.on_error_action,
    role: row.role ?? 'general',
    provider: row.provider ?? 'generic',
    loginEmail: row.login_email ?? '',
    loginPassword: row.login_password ?? '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * GET /api/settings/external-api
 * List all external APIs
 */
export async function GET() {
  try {
    await ensureTable();
    const rows = await query('SELECT * FROM external_apis ORDER BY created_at ASC', []);
    return NextResponse.json({ success: true, apis: (rows as any[]).map(rowToApi) });
  } catch (error) {
    console.error('Error fetching external APIs:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch APIs' }, { status: 500 });
  }
}

/**
 * POST /api/settings/external-api
 * Create a new external API entry
 */
export async function POST(request: NextRequest) {
  try {
    await ensureTable();
    const body = await request.json();
    const {
      name, description, enabled, apiEndpoint, authType,
      apiKey, bearerToken, allowedMethods,
      timeout, retryAttempts, retryDelay, syncMode, onErrorAction, role,
      provider, loginEmail, loginPassword,
    } = body;

    if (!name?.trim()) {
      return NextResponse.json({ success: false, error: 'Name is required' }, { status: 400 });
    }
    if (!apiEndpoint?.trim()) {
      return NextResponse.json({ success: false, error: 'API Endpoint is required' }, { status: 400 });
    }

    const id = uuidv4();
    await query(
      `INSERT INTO external_apis
        (id, name, description, enabled, api_endpoint, auth_type, api_key, bearer_token,
         allowed_methods, timeout, retry_attempts, retry_delay, sync_mode, on_error_action, role,
         provider, login_email, login_password)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id, name.trim(), description ?? '', enabled ? 1 : 0, apiEndpoint.trim(),
        authType ?? 'none', apiKey ?? '', bearerToken ?? '',
        allowedMethods ?? 'full_access',
        timeout ?? 30000, retryAttempts ?? 3, retryDelay ?? 2000,
        syncMode ?? 'realtime', onErrorAction ?? 'log_only',
        role === 'cloud_sync' ? 'cloud_sync' : 'general',
        provider === 'sta_lucia' ? 'sta_lucia' : 'generic',
        loginEmail ?? '', loginPassword ?? '',
      ]
    );

    const [row] = await query('SELECT * FROM external_apis WHERE id = ?', [id]) as any[];
    return NextResponse.json({ success: true, api: rowToApi(row) }, { status: 201 });
  } catch (error) {
    console.error('Error creating external API:', error);
    return NextResponse.json({ success: false, error: 'Failed to create API' }, { status: 500 });
  }
}

/**
 * PUT /api/settings/external-api (legacy test connection — kept for backward compat)
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { apiEndpoint, authType, apiKey, bearerToken, timeout } = body;

    if (!apiEndpoint) {
      return NextResponse.json({ success: false, error: 'API endpoint is required' }, { status: 400 });
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authType === 'api_key' && apiKey) headers['X-API-Key'] = apiKey;
    else if (authType === 'bearer_token' && bearerToken) headers['Authorization'] = `Bearer ${bearerToken}`;

    const response = await fetch(`${apiEndpoint}/test`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ test: true, timestamp: new Date().toISOString() }),
      signal: AbortSignal.timeout(timeout || 30000),
    });

    const responseData = await response.json().catch(() => ({}));

    if (response.ok) {
      return NextResponse.json({ success: true, message: 'Connection successful', response: responseData });
    } else {
      return NextResponse.json({ success: false, error: `Connection failed: ${response.status} ${response.statusText}` });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: `Connection test failed: ${msg}` });
  }
}
