import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

/**
 * Unique index on sales_orders.reference.
 *
 * SO numbers used to be generated client-side with Math.random() over a
 * 1,000,000 range, so a collision was ~50% likely by around 1,200 orders — and
 * nothing would have rejected it, because the only unique key on the table is
 * the primary key `id`. They are now allocated from the shared
 * `transaction_references.sales_order` counter, and this index is the guard
 * that keeps a duplicate from ever being written again.
 *
 * The column stays nullable: the index is applied only if the existing data is
 * already free of duplicates. If it is not, the migration reports the offending
 * references and leaves the index off rather than failing the whole run — the
 * duplicates need a human decision about which order keeps which number.
 */
const migration: Migration = {
  name: '102_unique_sales_order_reference',
  timestamp: '2026-07-23_16-00-00',

  async up(): Promise<void> {
    const [existing]: any = await query(`
      SELECT COUNT(*) AS cnt
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'sales_orders'
        AND INDEX_NAME = 'idx_sales_orders_reference_unique'
    `);
    if (existing?.cnt > 0) {
      console.log('• idx_sales_orders_reference_unique already exists — skipping');
      return;
    }

    const dupes: any = await query(`
      SELECT reference, COUNT(*) AS cnt
      FROM sales_orders
      WHERE reference IS NOT NULL
      GROUP BY reference
      HAVING cnt > 1
    `);

    if (Array.isArray(dupes) && dupes.length > 0) {
      console.warn('⚠️  Duplicate sales_orders.reference values found — unique index NOT added:');
      for (const row of dupes) {
        console.warn(`   ${row.reference} (${row.cnt} rows)`);
      }
      console.warn('   Resolve these by hand, then re-run this migration.');
      return;
    }

    await query(`
      CREATE UNIQUE INDEX idx_sales_orders_reference_unique
      ON sales_orders (reference)
    `);
    console.log('✅ Added idx_sales_orders_reference_unique');
  },

  async down(): Promise<void> {
    const [existing]: any = await query(`
      SELECT COUNT(*) AS cnt
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'sales_orders'
        AND INDEX_NAME = 'idx_sales_orders_reference_unique'
    `);
    if (!existing?.cnt) {
      console.log('• idx_sales_orders_reference_unique not present — skipping');
      return;
    }

    await query(`DROP INDEX idx_sales_orders_reference_unique ON sales_orders`);
    console.log('✅ Dropped idx_sales_orders_reference_unique');
  }
};

registerMigration(migration);
