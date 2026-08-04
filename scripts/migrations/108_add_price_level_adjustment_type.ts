import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

const migration: Migration = {
  name: '108_add_price_level_adjustment_type',
  timestamp: '2026-08-04_09-00-00',

  async up(): Promise<void> {
    const rows: any = await query(`
      SELECT COUNT(*) as cnt
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'price_levels'
        AND COLUMN_NAME = 'adjustment_type'
    `);
    const exists = rows[0]?.cnt > 0;
    if (!exists) {
      await query(`
        ALTER TABLE price_levels
        ADD COLUMN adjustment_type ENUM('percentage', 'fixed') NOT NULL DEFAULT 'percentage'
      `);
      console.log('✅ adjustment_type column added to price_levels');
    } else {
      console.log('⏭️  adjustment_type column already exists, skipping');
    }
  },

  async down(): Promise<void> {
    const rows: any = await query(`
      SELECT COUNT(*) as cnt
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'price_levels'
        AND COLUMN_NAME = 'adjustment_type'
    `);
    const exists = rows[0]?.cnt > 0;
    if (exists) {
      await query(`ALTER TABLE price_levels DROP COLUMN adjustment_type`);
      console.log('✅ adjustment_type column dropped from price_levels');
    }
  }
};

registerMigration(migration);
