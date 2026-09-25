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
 *
 * IMPORTANT — this is a data-meaning change, not just a schema cleanup: any
 * existing row with min_quantity > 1 was a genuine bulk-tier override (e.g.
 * "12+ units, any customer, ₱200 each"). Once the column is dropped, that
 * same row becomes an unconditional override for its price level from
 * quantity 1 — a real pricing change, not a no-op. up() logs every such row
 * before dropping the column so whoever runs this against a store's real
 * data can review what changes for their price levels; it does not attempt
 * to auto-fix or delete them, since only a person with pricing context can
 * decide whether that's acceptable for a given level/product.
 */
const migration: Migration = {
  name: '128_drop_price_level_min_quantity',
  timestamp: '2026-09-25_16-30-00',

  async up(): Promise<void> {
    const sulpColumn: any = await query(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'product_selling_unit_price_levels' AND TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'min_quantity'"
    );
    if (sulpColumn && sulpColumn.length > 0) {
      const tieredRows: any = await query(
        'SELECT selling_unit_id, price_level_id, price, min_quantity FROM product_selling_unit_price_levels WHERE min_quantity > 1'
      );
      if (tieredRows && tieredRows.length > 0) {
        console.log(`⚠️  ${tieredRows.length} row(s) had a real quantity tier (min_quantity > 1) — dropping the column turns each into an UNCONDITIONAL price for its level, applying from quantity 1 instead of only at the tier threshold. Review before relying on the new price:`);
        for (const row of tieredRows) {
          console.log(`   selling_unit_id=${row.selling_unit_id} price_level_id=${row.price_level_id} price=${row.price} (was tiered at min_quantity=${row.min_quantity})`);
        }
      }
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
