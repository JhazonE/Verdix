import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

/**
 * Index for finding a POS sale's sales_invoices mirror.
 *
 * Checkout mirrors every POS sale into sales_invoices (transaction_source
 * 'POS', same reference), so the table grows with the whole sales history.
 * /api/sales/transactions now reads that mirror on every request, to show what
 * a Charge sale still owes: once per page (`reference IN (...)`) and once for
 * the totals (grouped by reference). With no index on reference both were
 * full table scans, paid by Sales Transactions, Sales Summary, Sales by
 * Customer and the Returns report alike.
 */

const INDEX = 'idx_sales_invoices_source_reference';

async function hasIndex(): Promise<boolean> {
  const rows: any = await query(
    `SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales_invoices' AND INDEX_NAME = ?
      LIMIT 1`,
    [INDEX],
  );
  return Boolean(rows[0]);
}

const migration: Migration = {
  name: '156_index_sales_invoices_source_reference',
  timestamp: '2026-11-24_16-00-00',

  async up(): Promise<void> {
    if (await hasIndex()) {
      console.log(`⏭️  sales_invoices already has ${INDEX}, skipping`);
      return;
    }
    await query(`CREATE INDEX ${INDEX} ON sales_invoices (transaction_source, reference)`);
    console.log(`✅ sales_invoices: added ${INDEX}`);
  },

  async down(): Promise<void> {
    if (await hasIndex()) {
      await query(`DROP INDEX ${INDEX} ON sales_invoices`);
    }
    console.log(`✅ sales_invoices: dropped ${INDEX}`);
  },
};

registerMigration(migration);
