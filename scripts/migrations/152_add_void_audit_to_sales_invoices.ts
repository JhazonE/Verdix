import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

/**
 * A back-office void (Sales → Invoices → Void) marked the invoice Voided and
 * recorded nothing else — no time, no user. The Voided Sales report needs both
 * to list it beside POS voids (which carry voided_by_name on
 * sales_transactions), so the invoice now records them too.
 *
 * Existing Voided rows are backfilled with updated_at as their void time, the
 * best evidence available; who voided them was never stored and stays NULL.
 */

async function hasColumn(table: string, column: string): Promise<boolean> {
  const rows: any = await query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column],
  );
  return Boolean(rows[0]);
}

const COLUMNS: Array<[string, string]> = [
  ['voided_at', 'DATETIME DEFAULT NULL'],
  ['voided_by_user_id', 'VARCHAR(100) DEFAULT NULL'],
  ['voided_by_name', 'VARCHAR(255) DEFAULT NULL'],
];

const migration: Migration = {
  name: '152_add_void_audit_to_sales_invoices',
  timestamp: '2026-11-23_09-00-00',

  async up(): Promise<void> {
    for (const [name, def] of COLUMNS) {
      if (await hasColumn('sales_invoices', name)) {
        console.log(`⏭️  sales_invoices already has ${name}, skipping`);
        continue;
      }
      await query(`ALTER TABLE sales_invoices ADD COLUMN ${name} ${def}`);
      console.log(`✅ sales_invoices: added ${name}`);
    }
    await query(
      `UPDATE sales_invoices SET voided_at = updated_at WHERE status = 'Voided' AND voided_at IS NULL`
    );
  },

  async down(): Promise<void> {
    for (const [name] of COLUMNS) {
      if (await hasColumn('sales_invoices', name)) {
        await query(`ALTER TABLE sales_invoices DROP COLUMN ${name}`);
      }
    }
    console.log('✅ sales_invoices: dropped void audit columns');
  },
};

registerMigration(migration);
