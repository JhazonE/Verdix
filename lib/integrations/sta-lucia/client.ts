import type { StaLuciaSalesPayload, StaLuciaSession, StaLuciaLoginResponse } from './types';
import { getSession, saveSession, clearSession } from './session';

export interface StaLuciaApiConfig {
  id: string;
  /** Domain base, e.g. https://sta-lucia-malls.com — paths are appended. */
  apiEndpoint: string;
  loginEmail: string;
  loginPassword: string;
  timeout: number;
  /** Only 'retry' opts a failed submission into the automatic sweep. */
  onErrorAction: 'retry' | 'queue' | 'log_only';
}

export interface SendResult {
  success: boolean;
  status?: number;
  response?: unknown;
  error?: string;
}

function url(cfg: StaLuciaApiConfig, path: string): string {
  return `${cfg.apiEndpoint.replace(/\/+$/, '')}${path}`;
}

function authHeaders(session: StaLuciaSession): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Authorization': `Bearer ${session.token}`,
    'X-CUSTOM-TOKEN': session.ownerToken,
  };
}

/**
 * Authenticate with the tenant account and cache the resulting session.
 *
 * `status: 0` means the tenant account is inactive. That arrives with HTTP 200,
 * so it must be checked explicitly or an inactive account would look like a
 * successful login with an empty token.
 */
export async function login(cfg: StaLuciaApiConfig): Promise<StaLuciaSession> {
  if (!cfg.loginEmail || !cfg.loginPassword) {
    throw new Error('Sta Lucia tenant email and password are required');
  }

  const res = await fetch(url(cfg, '/api/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ email: cfg.loginEmail, password: cfg.loginPassword }),
    signal: AbortSignal.timeout(cfg.timeout || 30000),
  });

  const data = await res.json().catch(() => ({})) as Partial<StaLuciaLoginResponse> & { message?: string };

  if (!res.ok) {
    throw new Error(`Login failed (${res.status}): ${data.message ?? res.statusText}`);
  }
  if (data.status === 0 || data.status === false) {
    throw new Error(`Login rejected: tenant account is inactive${data.message ? ` — ${data.message}` : ''}`);
  }
  if (!data.token || !data.owner_token) {
    throw new Error('Login response did not contain token and owner_token');
  }

  const session: StaLuciaSession = { token: data.token, ownerToken: data.owner_token };
  await saveSession(cfg.id, session);
  return session;
}

/** Return the cached session, logging in if there is none. */
async function ensureSession(cfg: StaLuciaApiConfig): Promise<StaLuciaSession> {
  return (await getSession(cfg.id)) ?? (await login(cfg));
}

/**
 * Submit a daily sales record.
 *
 * On 401 the cached token is discarded, a fresh login is performed, and the
 * send is retried exactly once. A second 401 is reported as a failure rather
 * than looping.
 */
export async function sendSales(
  cfg: StaLuciaApiConfig,
  payload: StaLuciaSalesPayload,
): Promise<SendResult> {
  try {
    let session = await ensureSession(cfg);

    let res = await fetch(url(cfg, '/api/get-sales'), {
      method: 'POST',
      headers: authHeaders(session),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(cfg.timeout || 30000),
    });

    if (res.status === 401) {
      await clearSession(cfg.id);
      session = await login(cfg);
      res = await fetch(url(cfg, '/api/get-sales'), {
        method: 'POST',
        headers: authHeaders(session),
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(cfg.timeout || 30000),
      });
    }

    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      return {
        success: false,
        status: res.status,
        response: body,
        error: `Sales submission failed (${res.status}): ${(body as any)?.message ?? res.statusText}`,
      };
    }

    return { success: true, status: res.status, response: body };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

/** Read back consolidated transactions. Exposed for the test route; no UI consumes it yet. */
export async function getTransactions(cfg: StaLuciaApiConfig): Promise<SendResult> {
  try {
    const session = await ensureSession(cfg);
    const res = await fetch(url(cfg, '/api/get-transactions'), {
      method: 'GET',
      headers: authHeaders(session),
      signal: AbortSignal.timeout(cfg.timeout || 30000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { success: false, status: res.status, response: body, error: `HTTP ${res.status}` };
    }
    return { success: true, status: res.status, response: body };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

/** End the session. Always clears the local cache, even if the call fails. */
export async function logout(cfg: StaLuciaApiConfig): Promise<SendResult> {
  try {
    const session = await getSession(cfg.id);
    if (!session) return { success: true, response: { message: 'No active session' } };

    const res = await fetch(url(cfg, '/api/logout'), {
      method: 'POST',
      headers: authHeaders(session),
      signal: AbortSignal.timeout(cfg.timeout || 30000),
    });
    const body = await res.json().catch(() => ({}));
    await clearSession(cfg.id);

    if (!res.ok) {
      return { success: false, status: res.status, response: body, error: `HTTP ${res.status}` };
    }
    return { success: true, status: res.status, response: body };
  } catch (e) {
    await clearSession(cfg.id).catch(() => {});
    return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
}
