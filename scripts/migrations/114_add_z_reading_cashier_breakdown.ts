import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

const migration: Migration = {
  name: '114_add_z_reading_cashier_breakdown',
  timestamp: '2026-08-24_10-00-00',

  async up(): Promise<void> {
    const rows: any = await query(`
      SELECT COUNT(*) as cnt
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'z_readings'
        AND COLUMN_NAME = 'cashier_breakdown'
    `);
    const exists = rows[0]?.cnt > 0;
    if (!exists) {
      await query(`
        ALTER TABLE z_readings
        ADD COLUMN cashier_breakdown JSON
      `);
      console.log('✅ cashier_breakdown column added to z_readings');
    } else {
      console.log('⏭️  cashier_breakdown column already exists, skipping');
    }
  },

  async down(): Promise<void> {
    const rows: any = await query(`
      SELECT COUNT(*) as cnt
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'z_readings'
        AND COLUMN_NAME = 'cashier_breakdown'
    `);
    const exists = rows[0]?.cnt > 0;
    if (exists) {
      await query(`ALTER TABLE z_readings DROP COLUMN cashier_breakdown`);
      console.log('✅ cashier_breakdown column dropped from z_readings');
    }
  }
};

registerMigration(migration);
