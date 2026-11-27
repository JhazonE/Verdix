import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

/**
 * sales_invoices had no shipping column. A back-office invoice added the
 * shipping fee into `total`, but the fee itself was thrown away, so the
 * invoice view and every print rebuilt the grand total as items + 0 + VAT and
 * left the shipping out.
 *
 * Backfill: an invoice created by Add Invoice (id `inv_…`, no sales order) has
 * ALWAYS been stored as items + VAT + shipping (see CreateSaleUseCase; VAT was
 * 0 before vat_amount existed, and nothing edits an invoice's total or lines
 * afterward), so its shipping is exactly what is left over. Invoices made from
 * a sales order are NOT backfilled: their total was copied from the order,
 * which excludes shipping, so the fee was never charged on them and recording
 * it now would show a shipping line their total does not contain.
 */

async function hasColumn(): Promise<boolean> {
  const rows: any = await query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales_invoices' AND COLUMN_NAME = 'shipping'`,
  );
  return Boolean(rows[0]);
}

const migration: Migration = {
  name: '157_add_shipping_to_sales_invoices',
  timestamp: '2026-11-27_10-00-00',

  async up(): Promise<void> {
    if (await hasColumn()) {
      console.log('⏭️  sales_invoices already has shipping, skipping');
      return;
    }
    await query(`ALTER TABLE sales_invoices ADD COLUMN shipping DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER total`);
    console.log('✅ sales_invoices: added shipping');

    const result: any = await query(
      `UPDATE sales_invoices si
         JOIN (
           SELECT sales_invoice_id, SUM(quantity * price) AS items_total
             FROM sales_invoice_items
            GROUP BY sales_invoice_id
         ) t ON t.sales_invoice_id = si.id
          SET si.shipping = ROUND(si.total - t.items_total - COALESCE(si.vat_amount, 0), 2)
        WHERE LEFT(si.id, 4) = 'inv_'
          AND si.sales_order_id IS NULL
          AND si.total - t.items_total - COALESCE(si.vat_amount, 0) >= 0.005`,
    );
    console.log(`✅ sales_invoices: backfilled shipping on ${result?.affectedRows ?? 0} invoice(s)`);
  },

  async down(): Promise<void> {
    if (await hasColumn()) {
      await query(`ALTER TABLE sales_invoices DROP COLUMN shipping`);
    }
    console.log('✅ sales_invoices: dropped shipping');
  },
};

registerMigration(migration);
