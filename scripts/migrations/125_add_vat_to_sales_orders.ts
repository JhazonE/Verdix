import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

/**
 * Mirrors 124_add_vat_to_sales_invoices for Sales Orders: the New Sales
 * Order form now computes VAT per line the same way the invoice form does
 * (12% on a VAT-exclusive price, per a checkbox that defaults from the
 * product's own vatStatus but staff can override), and needs the same two
 * columns to persist it instead of only folding it into the saved total.
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
  name: '125_add_vat_to_sales_orders',
  timestamp: '2026-09-18_11-00-00',

  async up(): Promise<void> {
    if (!(await hasColumn('sales_order_items', 'vatable'))) {
      await query(`
        ALTER TABLE sales_order_items
          ADD COLUMN vatable TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Whether this line charged 12% VAT'
      `);
      console.log('✅ sales_order_items: added vatable');
    } else {
      console.log('⏭️  sales_order_items already has vatable, skipping');
    }

    if (!(await hasColumn('sales_orders', 'vat_amount'))) {
      await query(`
        ALTER TABLE sales_orders
          ADD COLUMN vat_amount DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '12% VAT summed across vatable lines'
      `);
      console.log('✅ sales_orders: added vat_amount');
    } else {
      console.log('⏭️  sales_orders already has vat_amount, skipping');
    }
  },

  async down(): Promise<void> {
    if (await hasColumn('sales_order_items', 'vatable')) {
      await query(`ALTER TABLE sales_order_items DROP COLUMN vatable`);
    }
    if (await hasColumn('sales_orders', 'vat_amount')) {
      await query(`ALTER TABLE sales_orders DROP COLUMN vat_amount`);
    }
    console.log('✅ sales_orders/sales_order_items: dropped VAT columns');
  }
};

registerMigration(migration);
