import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

/**
 * Price levels move from per-PRODUCT to per-SELLING-UNIT.
 *
 * A product can now be sold as a Piece, a Box of 12, a Case of 60 — each with
 * its own price. A single product-level Wholesale price cannot express that a
 * Case's bulk price is not just 60x the Piece's Wholesale price.
 *
 * Every price a user has set today is preserved, attached to that product's
 * BASE unit — the unit those prices always described before selling units
 * existed. A unit created after this migration starts with zero price-level
 * rows; nothing here invents a price for it.
 */
const migration: Migration = {
  name: '121_create_selling_unit_price_levels',
  timestamp: '2026-09-11_10-00-00',

  async up(): Promise<void> {
    const existing: any = await query(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_selling_unit_price_levels'`
    );
    if (!existing[0]) {
      await query(`
        CREATE TABLE product_selling_unit_price_levels (
          selling_unit_id  VARCHAR(100)  NOT NULL,
          price_level_id   VARCHAR(50)   NOT NULL,
          price            DECIMAL(10,2) NOT NULL,
          min_quantity     INT           DEFAULT 0,
          created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (selling_unit_id, price_level_id),
          CONSTRAINT fk_sulp_selling_unit
            FOREIGN KEY (selling_unit_id) REFERENCES product_selling_units(id) ON DELETE CASCADE
        )
      `);
      console.log('✅ created product_selling_unit_price_levels');
    } else {
      console.log('⏭️  product_selling_unit_price_levels already exists, skipping create');
    }

    // Data migration: every existing product_price_levels row attaches to
    // that product's BASE unit. Re-runnable: a row already present for a
    // given (selling_unit_id, price_level_id) is skipped, never duplicated,
    // because that pair is the primary key.
    const oldTable: any = await query(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_price_levels'`
    );
    if (oldTable[0]) {
      const result: any = await query(`
        INSERT IGNORE INTO product_selling_unit_price_levels
          (selling_unit_id, price_level_id, price, min_quantity)
        SELECT u.id, ppl.price_level_id, ppl.price, ppl.min_quantity
        FROM product_price_levels ppl
        JOIN product_selling_units u
          ON u.product_id = ppl.product_id AND u.is_base = 1
      `);
      console.log(`✅ migrated ${result.affectedRows} price-level row(s) onto base units`);

      await query('DROP TABLE product_price_levels');
      console.log('✅ dropped product_price_levels');
    } else {
      console.log('⏭️  product_price_levels already gone, nothing to migrate or drop');
    }
  },

  async down(): Promise<void> {
    // Not reversible: product_price_levels is dropped by up(), and rebuilding
    // it from product_selling_unit_price_levels would require picking one
    // selling unit's price per product when a product now has several — a
    // decision this migration has no basis to make automatically.
    console.log('⏭️  121_create_selling_unit_price_levels is not reversible past the point product_price_levels is dropped');
    const existing: any = await query(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_selling_unit_price_levels'`
    );
    if (existing[0]) {
      await query('DROP TABLE product_selling_unit_price_levels');
      console.log('✅ dropped product_selling_unit_price_levels');
    }
  }
};

registerMigration(migration);
