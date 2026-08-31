import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

const migration: Migration = {
  name: '115_create_license_state',
  timestamp: '2026-08-31_10-00-00',

  async up(): Promise<void> {
    const rows: any = await query(`
      SELECT COUNT(*) as cnt
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'license_state'
    `);
    if (rows[0]?.cnt > 0) {
      console.log('⏭️  license_state already exists, skipping');
      return;
    }
    await query(`
      CREATE TABLE license_state (
        id INT PRIMARY KEY,
        signed_license TEXT NULL,
        last_validated_at DATETIME NULL,
        lock_reason VARCHAR(32) NULL,
        seat_limit INT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ license_state table created');
  },

  async down(): Promise<void> {
    await query(`DROP TABLE IF EXISTS license_state`);
    console.log('✅ license_state table dropped');
  }
};

registerMigration(migration);
