import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

/**
 * A POS sale can now be voided from two places: the POS terminal, or the back
 * office (Sales → Invoices, which voids the sale's linked invoice and the sale
 * together). The Voided Sales report shows which, so the sale records it.
 *
 * NULL on rows voided before this column existed; the report treats NULL as
 * 'POS', which is where every void of a sales_transactions row came from then.
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
  name: '153_add_void_source_to_sales_transactions',
  timestamp: '2026-11-23_10-00-00',

  async up(): Promise<void> {
    if (await hasColumn('sales_transactions', 'void_source')) {
      console.log('⏭️  sales_transactions already has void_source, skipping');
      return;
    }
    await query(`ALTER TABLE sales_transactions ADD COLUMN void_source VARCHAR(20) DEFAULT NULL`);
    console.log('✅ sales_transactions: added void_source');
  },

  async down(): Promise<void> {
    if (await hasColumn('sales_transactions', 'void_source')) {
      await query(`ALTER TABLE sales_transactions DROP COLUMN void_source`);
    }
    console.log('✅ sales_transactions: dropped void_source');
  },
};

registerMigration(migration);
