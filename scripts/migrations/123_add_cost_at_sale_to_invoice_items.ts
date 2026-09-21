import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

/**
 * sales_invoice_items never had cost_at_sale/batch_source — only the POS
 * table sale_items did. CreateSaleUseCase (the Sales Invoice write path) was
 * running `UPDATE sale_items SET cost_at_sale = ... WHERE id = ?` with an id
 * that only ever existed in sales_invoice_items, so the update silently
 * matched zero rows. Fixing that target requires these columns to exist here.
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
  name: '123_add_cost_at_sale_to_invoice_items',
  timestamp: '2026-09-17_10-00-00',

  async up(): Promise<void> {
    if (await hasColumn('sales_invoice_items', 'cost_at_sale')) {
      console.log('⏭️  sales_invoice_items already has cost_at_sale, skipping');
      return;
    }
    await query(`
      ALTER TABLE sales_invoice_items
        ADD COLUMN cost_at_sale DECIMAL(14,4) DEFAULT NULL COMMENT 'Weighted avg cost from batch sources',
        ADD COLUMN batch_source JSON DEFAULT NULL COMMENT 'Array of batch splits'
    `);
    console.log('✅ sales_invoice_items: added cost_at_sale and batch_source');
  },

  async down(): Promise<void> {
    if (!(await hasColumn('sales_invoice_items', 'cost_at_sale'))) return;
    await query(`
      ALTER TABLE sales_invoice_items
        DROP COLUMN cost_at_sale,
        DROP COLUMN batch_source
    `);
    console.log('✅ sales_invoice_items: dropped cost_at_sale and batch_source');
  }
};

registerMigration(migration);
