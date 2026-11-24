import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

/**
 * Who authorised a return. With "Require authorization for returns" on, the
 * POS asks for the configured return credentials before a return or exchange,
 * but nothing kept who approved it, so the Merchandise Credit report's
 * "Override By" column had nothing to show.
 *
 * Both columns sit on the RETURN row (transaction_type = 'return'):
 *  - approved_by_user_id: the approving user's uid, when the approval was a
 *    real user login. NULL when it was the fixed return credentials, which
 *    belong to no user account.
 *  - approved_by_name: the approver's name AS IT WAS at approval, so renaming
 *    a user later cannot change who a filed return says approved it.
 * Both NULL means no approval was recorded: return auth was off, the return
 * predates this column, or only a password was configured (any username then
 * passes, so the one typed identifies no one).
 */

async function hasColumn(table: string, column: string): Promise<boolean> {
  const rows: any = await query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column],
  );
  return Boolean(rows[0]);
}

const migration: Migration = {
  name: '154_add_return_approver_to_pos_transactions',
  timestamp: '2026-11-24_10-00-00',

  async up(): Promise<void> {
    if (!(await hasColumn('pos_transactions', 'approved_by_user_id'))) {
      await query(`ALTER TABLE pos_transactions ADD COLUMN approved_by_user_id VARCHAR(50) DEFAULT NULL`);
      console.log('✅ pos_transactions: added approved_by_user_id');
    }
    if (!(await hasColumn('pos_transactions', 'approved_by_name'))) {
      await query(`ALTER TABLE pos_transactions ADD COLUMN approved_by_name VARCHAR(100) DEFAULT NULL`);
      console.log('✅ pos_transactions: added approved_by_name');
    }
  },

  async down(): Promise<void> {
    if (await hasColumn('pos_transactions', 'approved_by_name')) {
      await query(`ALTER TABLE pos_transactions DROP COLUMN approved_by_name`);
    }
    if (await hasColumn('pos_transactions', 'approved_by_user_id')) {
      await query(`ALTER TABLE pos_transactions DROP COLUMN approved_by_user_id`);
    }
    console.log('✅ pos_transactions: dropped return approver columns');
  },
};

registerMigration(migration);
