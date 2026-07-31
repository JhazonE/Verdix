import { query } from '@/lib/mysql';
import type { StaLuciaSession } from './types';

/**
 * Cached tenant session for one configured API.
 *
 * The source PDF gives no token TTL ("valid for the session"), so tokens are
 * cached indefinitely and refreshed reactively when the server answers 401.
 */
export async function getSession(apiId: string): Promise<StaLuciaSession | null> {
  const rows = await query(
    'SELECT token, owner_token FROM external_api_sessions WHERE api_id = ?',
    [apiId],
  ) as any[];

  const row = rows?.[0];
  if (!row?.token || !row?.owner_token) return null;

  return { token: row.token, ownerToken: row.owner_token };
}

export async function saveSession(apiId: string, session: StaLuciaSession): Promise<void> {
  await query(
    `INSERT INTO external_api_sessions (api_id, token, owner_token, obtained_at)
     VALUES (?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE
       token = VALUES(token),
       owner_token = VALUES(owner_token),
       obtained_at = VALUES(obtained_at)`,
    [apiId, session.token, session.ownerToken],
  );
}

export async function clearSession(apiId: string): Promise<void> {
  await query('DELETE FROM external_api_sessions WHERE api_id = ?', [apiId]);
}
