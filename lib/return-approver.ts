import { query } from '@/lib/mysql';

/**
 * Who authorised a return or exchange, written on its RETURN row in
 * `pos_transactions` (migration 154). See that migration for what NULL means.
 */
export interface ReturnApprover {
  userId: string | null;
  name: string | null;
}

let available: boolean | null = null;

/**
 * Makes sure the approver columns exist, for a terminal that has not run
 * migration 154 yet. Call it BEFORE opening the return's transaction:
 * ALTER TABLE commits implicitly, so it must never run inside one.
 *
 * Returns false (and logs) when the columns cannot be added. The return then
 * goes ahead without its approver; a missing audit field must not stop a
 * cashier from issuing a refund.
 */
export async function ensureReturnApproverColumns(): Promise<boolean> {
  if (available) return true;
  try {
    const cols = (await query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pos_transactions'
          AND COLUMN_NAME IN ('approved_by_user_id', 'approved_by_name')`
    )) as any[];
    const have = new Set((cols || []).map((c: any) => c.COLUMN_NAME));
    if (!have.has('approved_by_user_id')) {
      await query('ALTER TABLE pos_transactions ADD COLUMN approved_by_user_id VARCHAR(50) DEFAULT NULL');
    }
    if (!have.has('approved_by_name')) {
      await query('ALTER TABLE pos_transactions ADD COLUMN approved_by_name VARCHAR(100) DEFAULT NULL');
    }
    available = true;
  } catch (error) {
    console.error('Error ensuring pos_transactions approver columns:', error);
    available = false;
  }
  return available;
}

const clip = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
};

/**
 * Reads the approver a return request carries.
 *
 * A user id is kept only if it names a real user, and that user's CURRENT
 * display name is what gets recorded, so the record does not rest on a name
 * the client typed. Without a user id (the fixed return credentials, which
 * belong to no account) the client's name is kept as sent; it is the
 * configured return username, which the POS has just checked.
 *
 * Not proof against a forged request: like every API route here, this trusts
 * the client (see the api-routes-no-server-auth note). It records what the
 * POS verified; it does not verify it again.
 */
export async function resolveReturnApprover(
  conn: { query: (sql: string, params?: any[]) => Promise<any> },
  body: { approvedByUserId?: unknown; approvedByName?: unknown },
): Promise<ReturnApprover> {
  const userId = clip(body.approvedByUserId, 50);
  let name = clip(body.approvedByName, 100);
  if (userId) {
    const [rows]: any = await conn.query(
      'SELECT uid, display_name, username FROM users WHERE uid = ? LIMIT 1',
      [userId],
    );
    const user = rows?.[0];
    if (user) {
      return { userId: user.uid, name: clip(user.display_name || user.username, 100) ?? name };
    }
  }
  return { userId: null, name };
}

/** Writes the approver onto a return row; does nothing when there is none. */
export async function writeReturnApprover(
  conn: { query: (sql: string, params?: any[]) => Promise<any> },
  posTransactionId: string,
  approver: ReturnApprover,
): Promise<void> {
  if (!approver.userId && !approver.name) return;
  await conn.query(
    'UPDATE pos_transactions SET approved_by_user_id = ?, approved_by_name = ? WHERE id = ?',
    [approver.userId, approver.name, posTransactionId],
  );
}
