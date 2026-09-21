import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

/**
 * The New Sales Invoice form computes VAT per line (12% on top of a
 * VAT-exclusive price, per a checkbox that defaults from the product's own
 * vatStatus but staff can override) and had been folding it straight into
 * the saved total with nothing recorded per line — fine for billing, but it
 * meant the printed invoice could never show a correct VAT breakdown after
 * the fact, especially once an invoice mixes VATable and exempt lines.
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
  name: '124_add_vat_to_sales_invoices',
  timestamp: '2026-09-18_09-00-00',

  async up(): Promise<void> {
    if (!(await hasColumn('sales_invoice_items', 'vatable'))) {
      await query(`
        ALTER TABLE sales_invoice_items
          ADD COLUMN vatable TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Whether this line charged 12% VAT'
      `);
      console.log('✅ sales_invoice_items: added vatable');
    } else {
      console.log('⏭️  sales_invoice_items already has vatable, skipping');
    }

    if (!(await hasColumn('sales_invoices', 'vat_amount'))) {
      await query(`
        ALTER TABLE sales_invoices
          ADD COLUMN vat_amount DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '12% VAT summed across vatable lines'
      `);
      console.log('✅ sales_invoices: added vat_amount');
    } else {
      console.log('⏭️  sales_invoices already has vat_amount, skipping');
    }
  },

  async down(): Promise<void> {
    if (await hasColumn('sales_invoice_items', 'vatable')) {
      await query(`ALTER TABLE sales_invoice_items DROP COLUMN vatable`);
    }
    if (await hasColumn('sales_invoices', 'vat_amount')) {
      await query(`ALTER TABLE sales_invoices DROP COLUMN vat_amount`);
    }
    console.log('✅ sales_invoices/sales_invoice_items: dropped VAT columns');
  }
};

registerMigration(migration);
