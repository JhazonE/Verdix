import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

const migration: Migration = {
  name: '113_add_z_reading_lockout_toggle',
  timestamp: '2026-08-14_10-00-00',

  async up(): Promise<void> {
    const rows: any = await query(`
      SELECT COUNT(*) as cnt
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'pos_settings'
        AND COLUMN_NAME = 'enforce_z_reading_lockout'
    `);
    const exists = rows[0]?.cnt > 0;
    if (!exists) {
      await query(`
        ALTER TABLE pos_settings
        ADD COLUMN enforce_z_reading_lockout BOOLEAN NOT NULL DEFAULT TRUE
      `);
      console.log('✅ enforce_z_reading_lockout column added to pos_settings');
    } else {
      console.log('⏭️  enforce_z_reading_lockout column already exists, skipping');
    }
  },

  async down(): Promise<void> {
    const rows: any = await query(`
      SELECT COUNT(*) as cnt
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'pos_settings'
        AND COLUMN_NAME = 'enforce_z_reading_lockout'
    `);
    const exists = rows[0]?.cnt > 0;
    if (exists) {
      await query(`ALTER TABLE pos_settings DROP COLUMN enforce_z_reading_lockout`);
      console.log('✅ enforce_z_reading_lockout column dropped from pos_settings');
    }
  }
};

registerMigration(migration);
