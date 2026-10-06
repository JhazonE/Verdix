import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

/**
 * Widens the line-item quantity columns from INT to DECIMAL(15,4).
 *
 * `products.stock` and `stock_movements.quantity_change` were widened to
 * DECIMAL(15,4) back in 078 so a product sold by weight or length could hold a
 * fractional figure, and `pos_transaction_items.quantity` has been
 * DECIMAL(10,2) since 012 — but the document tables that 078 did not cover
 * were left as INT. A cashier selling 10.5 kg therefore got 10.5 on the
 * receipt and in `pos_transaction_items`, while `sale_items` silently stored
 * MySQL's rounding of it. Sales reports read `sale_items`, so the filed sale
 * and the printed receipt disagreed about what was sold.
 *
 * DECIMAL(15,4) matches 078's choice so every quantity column in the system
 * now carries the same precision, and four places is also what the cart's own
 * base-unit conversions round to (`lib/pos-cart-units.ts`).
 *
 * Widening INT -> DECIMAL is lossless: existing whole quantities keep their
 * value exactly. Already-rounded historical rows are NOT recoverable and are
 * left as they are — the original fractional figure was never written down.
 */
const TARGETS: { table: string; column: string }[] = [
  { table: 'sale_items', column: 'quantity' },
  { table: 'sales_invoice_items', column: 'quantity' },
  { table: 'sales_order_items', column: 'quantity' },
  { table: 'purchase_order_items', column: 'quantity' },
];

async function columnType(table: string, column: string): Promise<string | null> {
  const rows: any = await query(
    `SELECT COLUMN_TYPE, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  if (!rows || rows.length === 0) return null;
  return String(rows[0].COLUMN_TYPE);
}

const migration: Migration = {
  name: '135_alter_sale_item_quantity_precision',
  timestamp: '2026-10-05_09-00-00',

  async up(): Promise<void> {
    console.log('--- WIDENING LINE-ITEM QUANTITY COLUMNS TO DECIMAL(15,4) ---');
    for (const { table, column } of TARGETS) {
      const type = await columnType(table, column);
      if (type === null) {
        console.log(`⏭️  ${table}.${column} not present, skipping`);
        continue;
      }
      if (type.startsWith('decimal')) {
        console.log(`⏭️  ${table}.${column} already ${type}, skipping`);
        continue;
      }
      await query(`ALTER TABLE ${table} MODIFY COLUMN ${column} DECIMAL(15, 4) NOT NULL`);
      console.log(`✅ ${table}.${column}: ${type} -> decimal(15,4)`);
    }
  },

  async down(): Promise<void> {
    console.log('--- REVERTING LINE-ITEM QUANTITY COLUMNS TO INT ---');
    for (const { table, column } of TARGETS) {
      const type = await columnType(table, column);
      if (type === null) {
        console.log(`⏭️  ${table}.${column} not present, skipping`);
        continue;
      }
      // Narrowing back to INT ROUNDS every fractional row, destroying exactly
      // the figure this migration exists to preserve. Name the rows that would
      // change rather than discarding them silently.
      const fractional: any = await query(
        `SELECT COUNT(*) AS n FROM ${table} WHERE ${column} <> ROUND(${column})`
      );
      const n = Number(fractional?.[0]?.n ?? 0);
      if (n > 0) {
        console.log(`⚠️  ${table} has ${n} row(s) with a fractional ${column}; reverting to INT will round them irreversibly.`);
      }
      await query(`ALTER TABLE ${table} MODIFY COLUMN ${column} INT NOT NULL`);
      console.log(`✅ ${table}.${column} reverted to INT`);
    }
  }
};

registerMigration(migration);
