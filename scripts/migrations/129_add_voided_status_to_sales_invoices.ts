import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

/**
 * sales_invoices.status never got 'Voided' added to its ENUM. Migration 047
 * added it to sales_transactions only; migration 055 then rewrote
 * sales_invoices' ENUM list from scratch without carrying it over. Every
 * void attempt from the Sales Invoices page fails with "Data truncated for
 * column 'status'" because MySQL rejects the UPDATE ... SET status = 'Voided'
 * — the invoice's stock reversal is rolled back with it, so the invoice is
 * left unvoided with no visible error beyond a generic toast.
 */
const migration: Migration = {
  name: '129_add_voided_status_to_sales_invoices',
  timestamp: '2026-09-28_09-00-00',

  async up(): Promise<void> {
    await query(`
      ALTER TABLE sales_invoices
      MODIFY COLUMN status ENUM('Paid', 'Pending', 'Failed', 'Shipped', 'Delivered', 'Returned', 'Partially Paid', 'Voided')
      DEFAULT 'Pending'
    `);
    console.log('✅ sales_invoices status ENUM updated to include Voided');
  },

  async down(): Promise<void> {
    await query(`
      ALTER TABLE sales_invoices
      MODIFY COLUMN status ENUM('Paid', 'Pending', 'Failed', 'Shipped', 'Delivered', 'Returned', 'Partially Paid')
      DEFAULT 'Pending'
    `);
    console.log('✅ sales_invoices status ENUM reverted (rows with Voided may fail if any exist)');
  }
};

registerMigration(migration);
