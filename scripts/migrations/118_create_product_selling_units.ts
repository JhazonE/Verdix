import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

/**
 * Selling units: the ways one product can be sold.
 *
 * Packaging used to be encoded in product names ("… 1cs 60s") or modelled as
 * separate child products with their own stock, which meant selling a case did
 * not reduce the piece count. Here, `products.stock` stays the single stock
 * figure in BASE units and a selling unit only says how many base units one of
 * it is worth. Nothing to synchronise, so nothing can fall out of sync.
 *
 * barcode is UNIQUE: a scan must resolve to exactly one selling unit.
 */
const migration: Migration = {
  name: '118_create_product_selling_units',
  timestamp: '2026-09-10_12-00-00',

  async up(): Promise<void> {
    const existing: any = await query(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_selling_units'`
    );
    if (existing[0]) {
      console.log('⏭️  product_selling_units already exists, skipping');
      return;
    }

    await query(`
      CREATE TABLE product_selling_units (
        id          VARCHAR(100) NOT NULL PRIMARY KEY,
        product_id  VARCHAR(50)  NOT NULL,
        name        VARCHAR(100) NOT NULL,
        barcode     VARCHAR(100) NULL,
        factor      DECIMAL(12,4) NOT NULL,
        cost        DECIMAL(12,4) NULL,
        price       DECIMAL(12,4) NOT NULL,
        is_base     TINYINT(1) NOT NULL DEFAULT 0,
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_selling_unit_barcode (barcode),
        UNIQUE KEY uniq_product_unit_name (product_id, name),
        KEY idx_selling_unit_product (product_id),
        CONSTRAINT fk_selling_unit_product
          FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
      )
    `);
    console.log('✅ created product_selling_units');
  },

  async down(): Promise<void> {
    await query('DROP TABLE IF EXISTS product_selling_units');
    console.log('✅ dropped product_selling_units');
  }
};

registerMigration(migration);
