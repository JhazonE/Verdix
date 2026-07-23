import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

/**
 * Product type: standard (stocked) vs service (not stocked).
 *
 * Services skip FIFO batches, stock movements, and family sync entirely.
 * Every existing row becomes 'standard' via the column default — products
 * currently faking service behaviour (unit_of_measure = 'Service', or a
 * "Services" category) are deliberately NOT auto-converted, because that
 * heuristic also matches genuinely stocked goods like "Service Kit" and
 * would silently destroy their stock tracking. Conversion is manual.
 *
 * ENUM rather than a boolean so future types (bundle, non_inventory) don't
 * need another migration.
 */
const migration: Migration = {
  name: '101_add_product_type',
  timestamp: '2026-07-23_10-00-00',

  async up(): Promise<void> {
    const [typeCol]: any = await query(`
      SELECT COUNT(*) AS cnt
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'products'
        AND COLUMN_NAME = 'type'
    `);
    if (typeCol?.cnt > 0) {
      console.log('• products.type already exists — skipping');
      return;
    }

    await query(`
      ALTER TABLE products
      ADD COLUMN type ENUM('standard','service') NOT NULL DEFAULT 'standard'
    `);
    console.log('✅ Added products.type');

    // Indexed because every stock screen and low-stock report filters on it.
    await query(`CREATE INDEX idx_products_type ON products (type)`);
    console.log('✅ Added idx_products_type');
  },

  async down(): Promise<void> {
    await query(`DROP INDEX idx_products_type ON products`);
    await query(`ALTER TABLE products DROP COLUMN type`);
    console.log('✅ Dropped products.type');
  }
};

registerMigration(migration);
