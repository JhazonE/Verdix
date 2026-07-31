import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/mysql';

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
 * PUT /api/settings/external-api/[id]
 * Update an existing external API entry
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();

    // Handle test connection action
    if (body.action === 'test') {
      const { apiEndpoint, authType, apiKey, bearerToken, timeout } = body;
      if (!apiEndpoint) {
        return NextResponse.json({ success: false, error: 'API endpoint is required' }, { status: 400 });
      }

      const base = (apiEndpoint as string).replace(/\/$/, '');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authType === 'api_key' && apiKey) headers['X-API-Key'] = apiKey;
      else if (authType === 'bearer_token' && bearerToken) headers['Authorization'] = `Bearer ${bearerToken}`;

      try {
        const response = await fetch(`${base}/test`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ test: true, timestamp: new Date().toISOString() }),
          signal: AbortSignal.timeout(timeout || 30000),
        });
        const responseData = await response.json().catch(() => ({}));
        if (response.ok) {
          return NextResponse.json({ success: true, message: 'Connection successful', response: responseData });
        } else {
          return NextResponse.json({ success: false, error: `Server responded with ${response.status}: ${response.statusText}` });
        }
      } catch (fetchError) {
        const msg = fetchError instanceof Error ? fetchError.message : 'Unknown error';
        return NextResponse.json({ success: false, error: `Could not reach endpoint: ${msg}` });
      }
    }

    // Normal update
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

    await query(
      `UPDATE external_apis SET
        name = ?, description = ?, enabled = ?, api_endpoint = ?, auth_type = ?,
        api_key = ?, bearer_token = ?, allowed_methods = ?,
        timeout = ?, retry_attempts = ?, retry_delay = ?, sync_mode = ?, on_error_action = ?,
        role = ?, provider = ?, login_email = ?, login_password = ?
       WHERE id = ?`,
      [
        name.trim(), description ?? '', enabled ? 1 : 0, apiEndpoint.trim(),
        authType ?? 'none', apiKey ?? '', bearerToken ?? '',
        allowedMethods ?? 'full_access',
        timeout ?? 30000, retryAttempts ?? 3, retryDelay ?? 2000,
        syncMode ?? 'realtime', onErrorAction ?? 'log_only',
        role === 'cloud_sync' ? 'cloud_sync' : 'general',
        provider === 'sta_lucia' ? 'sta_lucia' : 'generic',
        loginEmail ?? '', loginPassword ?? '',
        id,
      ]
    );

    const rows = await query('SELECT * FROM external_apis WHERE id = ?', [id]) as any[];
    if (!rows.length) {
      return NextResponse.json({ success: false, error: 'API not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, api: rowToApi(rows[0]) });
  } catch (error) {
    console.error('Error updating external API:', error);
    return NextResponse.json({ success: false, error: 'Failed to update API' }, { status: 500 });
  }
}

/**
 * DELETE /api/settings/external-api/[id]
 * Delete an external API entry
 */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await query('DELETE FROM external_apis WHERE id = ?', [id]);
    return NextResponse.json({ success: true, message: 'API deleted successfully' });
  } catch (error) {
    console.error('Error deleting external API:', error);
    return NextResponse.json({ success: false, error: 'Failed to delete API' }, { status: 500 });
  }
}
