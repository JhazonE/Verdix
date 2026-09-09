import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

/**
 * Per-product markup override.
 *
 * Markup was previously resolved only from subcategory/category/brand/supplier
 * (see calculateMarkupPercentage in lib/purchase-utils.ts), so every unit in a
 * product family inherited the same percentage. A 25kg sack and a 500g repack
 * do not carry the same margin in practice.
 *
 * NULL means "inherit" — fall through to the existing chain. 0 is a real value
 * meaning "sell at cost" and does NOT inherit. Keep that distinction: it is
 * what lets the UI show an empty field as inherited.
 */
const migration: Migration = {
  name: '117_add_product_markup_percentage',
  timestamp: '2026-09-09_12-00-00',

  async up(): Promise<void> {
    const existing: any = await query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'products'
         AND COLUMN_NAME = 'markup_percentage'`
    );
    if (existing[0]) {
      console.log('⏭️  products.markup_percentage already exists, skipping');
      return;
    }

    await query(
      `ALTER TABLE products
         ADD COLUMN markup_percentage DECIMAL(6,2) NULL DEFAULT NULL`
    );
    console.log('✅ added products.markup_percentage');
  },

  async down(): Promise<void> {
    await query('ALTER TABLE products DROP COLUMN markup_percentage');
    console.log('✅ dropped products.markup_percentage');
  }
};

registerMigration(migration);
