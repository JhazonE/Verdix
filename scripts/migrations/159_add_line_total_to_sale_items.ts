import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

/**
 * sale_items recorded only a per-UNIT discounted price, rounded to two
 * decimals by its column. Every revenue reader then summed price × quantity,
 * which multiplies that rounding by the quantity: ₱12.99 at 20% off is 10.392
 * a unit, stored 10.39, so five of them read as 51.95 when the line charged
 * 51.96. Sales by Product, Top Products, Hourly, Monthly Category and the
 * other sale_items-based reports therefore sat a few centavos off Sales by
 * Date and the Z-reading.
 *
 * `line_total` records the amount actually charged for the line. NULL means
 * "not recorded" and readers fall back to price × quantity
 * (lib/sale-item-revenue.ts), so the column is safe to add before backfill.
 *
 * Backfill: pos_transaction_items already holds each line's line_total and
 * points back at its sale_items row through sale_item_id. Only a sale_items row
 * with EXACTLY ONE such pos line is copied — an ambiguous match is left NULL
 * (falls back to price × quantity, i.e. unchanged) rather than guessed.
 */

async function hasColumn(): Promise<boolean> {
  const rows: any = await query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sale_items' AND COLUMN_NAME = 'line_total'`,
  );
  return Boolean(rows[0]);
}

const migration: Migration = {
  name: '159_add_line_total_to_sale_items',
  timestamp: '2026-11-27_14-00-00',

  async up(): Promise<void> {
    if (!(await hasColumn())) {
      await query(`ALTER TABLE sale_items ADD COLUMN line_total DECIMAL(12,2) NULL AFTER price`);
      console.log('✅ sale_items: added line_total');
    } else {
      console.log('⏭️  sale_items already has line_total');
    }

    const result: any = await query(
      `UPDATE sale_items si
         JOIN (
           SELECT sale_item_id, MIN(line_total) AS line_total
             FROM pos_transaction_items
            WHERE sale_item_id IS NOT NULL
            GROUP BY sale_item_id
           HAVING COUNT(*) = 1
         ) pti ON pti.sale_item_id = si.id
          SET si.line_total = pti.line_total
        WHERE si.line_total IS NULL`,
    );
    console.log(`✅ sale_items: backfilled line_total on ${result?.affectedRows ?? 0} row(s)`);
  },

  async down(): Promise<void> {
    if (await hasColumn()) {
      await query(`ALTER TABLE sale_items DROP COLUMN line_total`);
    }
    console.log('✅ sale_items: dropped line_total');
  },
};

registerMigration(migration);
