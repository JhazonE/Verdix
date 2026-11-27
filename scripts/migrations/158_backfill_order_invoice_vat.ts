import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

/**
 * An invoice created from a sales order (POST /api/sales/invoices) copied the
 * order's total, which includes VAT, but not the order's vat_amount or the
 * per-line `vatable` flags. The invoice view and prints rebuild GRAND TOTAL as
 * items + shipping + vat_amount, so they showed VAT 0.00 and a grand total
 * short by the VAT the customer was actually charged.
 *
 * This copies both across for invoices already created. It never changes a
 * total: it only records the VAT component the total already contains.
 * Back-office invoices are not part of the VAT/BIR reports (by-tax-type is POS
 * only), so no tax figure moves either.
 *
 * Guards:
 *  - vat_amount is copied only when the invoice still has 0 and its total
 *    equals the order's total plus the invoice's shipping, i.e. the invoice
 *    really is that order's items + VAT (+ shipping) and nothing else.
 *  - a line's `vatable` is copied only on an invoice that passes the same
 *    total check (so a line never shows VAT its header does not), and only
 *    when its (product, selling unit) pair appears exactly once in the order,
 *    so the matching order line is certain.
 */

const migration: Migration = {
  name: '158_backfill_order_invoice_vat',
  timestamp: '2026-11-27_14-00-00',

  async up(): Promise<void> {
    const headers: any = await query(
      `UPDATE sales_invoices si
         JOIN sales_orders so ON so.id = si.sales_order_id
          SET si.vat_amount = so.vat_amount
        WHERE COALESCE(si.vat_amount, 0) = 0
          AND COALESCE(so.vat_amount, 0) > 0
          AND ABS(si.total - (so.total + COALESCE(si.shipping, 0))) < 0.005`,
    );
    console.log(`✅ sales_invoices: copied VAT from the order onto ${headers?.affectedRows ?? 0} invoice(s)`);

    const lines: any = await query(
      `UPDATE sales_invoice_items sii
         JOIN sales_invoices si ON si.id = sii.sales_invoice_id
         JOIN sales_orders so ON so.id = si.sales_order_id
         JOIN sales_order_items soi
           ON soi.sales_order_id = si.sales_order_id
          AND soi.product_id = sii.product_id
          AND soi.selling_unit_id <=> sii.selling_unit_id
          SET sii.vatable = soi.vatable
        WHERE ABS(si.total - (so.total + COALESCE(si.shipping, 0))) < 0.005
          AND sii.vatable = 0
          AND soi.vatable = 1
          AND (SELECT COUNT(*) FROM sales_order_items x
                WHERE x.sales_order_id = soi.sales_order_id
                  AND x.product_id = soi.product_id
                  AND x.selling_unit_id <=> soi.selling_unit_id) = 1`,
    );
    console.log(`✅ sales_invoice_items: copied the VAT flag onto ${lines?.affectedRows ?? 0} line(s)`);
  },

  async down(): Promise<void> {
    // Data-only backfill of values that were always true; nothing to undo.
    console.log('⏭️  158_backfill_order_invoice_vat: no-op down');
  },
};

registerMigration(migration);
