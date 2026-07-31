/**
 * API Sync Logger
 * Logs all external API sync operations for audit trail
 */

import { query } from '../mysql';

export type ApiSyncLog = {
  id?: string;
  transactionType: string;
  transactionId: string;
  endpoint: string;
  payload: string;
  response: string | null;
  /**
   * 'abandoned' is terminal: the sweep in lib/scheduler.ts selects only
   * pending/failed, so a row parked here is never retried again (used when a
   * retry provably cannot ever succeed, e.g. the record it references was
   * deleted). Nothing writes it through logApiSync — see applySyncResult.
   */
  status: 'success' | 'failed' | 'pending' | 'abandoned';
  errorMessage?: string;
  retryCount: number;
  nextRetryAt?: string | null;
  lastRetryAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

/**
 * Log an API sync operation directly to the database
 */
export async function logApiSync(log: Omit<ApiSyncLog, 'id' | 'createdAt' | 'updatedAt'>): Promise<void> {
  try {
    // Ang 'pending' kay usa ka QUEUE ENTRY, dili usa ka historical event. Kung
    // naa nay pending row para niini nga transaction, i-update — ayaw i-insert
    // ug duplicate. Kung wala kini, ang matag retry sweep sa scheduler mo-clone
    // sa row, ug ang table mo-tubo nga walay katapusan.
    if (log.status === 'pending') {
      const existing = await query(
        `SELECT id, retry_count FROM external_api_logs
          WHERE transaction_type = ? AND transaction_id = ? AND status = 'pending'
          ORDER BY created_at DESC LIMIT 1`,
        [log.transactionType, log.transactionId],
      );

      if (existing.length > 0) {
        await query(
          `UPDATE external_api_logs
              SET endpoint = ?,
                  payload = ?,
                  error_message = ?,
                  retry_count = retry_count + 1,
                  next_retry_at = ?,
                  last_retry_at = ?
            WHERE id = ?`,
          [
            log.endpoint,
            log.payload,
            log.errorMessage || null,
            log.nextRetryAt || null,
            log.lastRetryAt || null,
            existing[0].id,
          ],
        );
        return;
      }
    }

    // Bag-o nga pending, o usa ka success/failed nga historical event.
    const logId = `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const insertQuery = `
      INSERT INTO external_api_logs (
        id, transaction_type, transaction_id, endpoint, payload,
        response, status, error_message, retry_count, next_retry_at, last_retry_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    await query(insertQuery, [
      logId,
      log.transactionType,
      log.transactionId,
      log.endpoint,
      log.payload,
      log.response,
      log.status,
      log.errorMessage || null,
      log.retryCount || 0,
      log.nextRetryAt || null,
      log.lastRetryAt || null,
    ]);
  } catch (error) {
    console.error('Failed to log API sync:', error);
    console.log('API Sync Log (Fallback):', log);
  }
}

/**
 * Get API sync logs directly from the database
 */
export async function getApiSyncLogs(filters?: {
  status?: 'success' | 'failed' | 'pending';
  transactionType?: string;
  limit?: number;
  offset?: number;
}): Promise<ApiSyncLog[]> {
  try {
    let sql = `SELECT * FROM external_api_logs WHERE 1=1`;
    const params: any[] = [];

    if (filters?.status) {
      sql += ' AND status = ?';
      params.push(filters.status);
    }
    if (filters?.transactionType) {
      sql += ' AND transaction_type = ?';
      params.push(filters.transactionType);
    }

    const limit = filters?.limit || 50;
    const offset = filters?.offset || 0;
    
    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const logs: any = await query(sql, params);
    
    return logs.map((log: any) => ({
      id: log.id,
      transactionType: log.transaction_type,
      transactionId: log.transaction_id,
      endpoint: log.endpoint,
      payload: log.payload,
      response: log.response,
      status: log.status,
      errorMessage: log.error_message,
      retryCount: log.retry_count,
      nextRetryAt: log.next_retry_at,
      lastRetryAt: log.last_retry_at,
      createdAt: log.created_at,
      updatedAt: log.updated_at
    }));
  } catch (error) {
    console.error('Error fetching API sync logs:', error);
    return [];
  }
}

/**
 * Empty stub for retryFailedSync - will need implementation if utilized in the future
 */
export async function retryFailedSync(logId: string): Promise<{ success: boolean; error?: string }> {
  return { success: false, error: 'Not implemented as a direct DB call yet.' };
}
