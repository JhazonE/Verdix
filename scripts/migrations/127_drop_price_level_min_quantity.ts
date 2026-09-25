import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

/**
 * Drops the tiered/quantity-break pricing columns. The feature they backed
 * (a price level auto-applying once sale quantity crosses a threshold) was
 * removed from lib/pricing.ts; these columns had no remaining reader.
 *
 * price_levels.min_quantity was already dead before this migration — no UI
 * ever exposed it and no pricing logic read it, only actions.ts's
 * addPriceLevel/updatePriceLevel round-tripped it.
 */
const migration: Migration = {
  name: '127_drop_price_level_min_quantity',
  timestamp: new Date().toISOString().replace(/T/, '_').replace(/\..+/, '').replace(/:/g, '-'),

  async up(): Promise<void> {
    const sulpColumn: any = await query(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'product_selling_unit_price_levels' AND TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'min_quantity'"
    );
    if (sulpColumn && sulpColumn.length > 0) {
      await query('ALTER TABLE product_selling_unit_price_levels DROP COLUMN min_quantity');
      console.log('✅ dropped min_quantity from product_selling_unit_price_levels');
    } else {
      console.log('⏭️  product_selling_unit_price_levels.min_quantity already gone, skipping');
    }

    const plColumn: any = await query(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'price_levels' AND TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'min_quantity'"
    );
    if (plColumn && plColumn.length > 0) {
      await query('ALTER TABLE price_levels DROP COLUMN min_quantity');
      console.log('✅ dropped min_quantity from price_levels');
    } else {
      console.log('⏭️  price_levels.min_quantity already gone, skipping');
    }
  },

  async down(): Promise<void> {
    // Re-adds both columns empty/defaulted — this does not restore any
    // historical values that existed before up() ran.
    const sulpColumn: any = await query(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'product_selling_unit_price_levels' AND TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'min_quantity'"
    );
    if (!sulpColumn || sulpColumn.length === 0) {
      await query('ALTER TABLE product_selling_unit_price_levels ADD COLUMN min_quantity INT DEFAULT 0');
      console.log('✅ re-added product_selling_unit_price_levels.min_quantity (empty)');
    }

    const plColumn: any = await query(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'price_levels' AND TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'min_quantity'"
    );
    if (!plColumn || plColumn.length === 0) {
      await query('ALTER TABLE price_levels ADD COLUMN min_quantity INT DEFAULT 0');
      console.log('✅ re-added price_levels.min_quantity (empty)');
    }
  }
};

registerMigration(migration);
