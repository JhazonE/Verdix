import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

/**
 * Sta. Lucia Tenant Management System integration schema.
 *
 * `provider` discriminates rows in external_apis so a Sta Lucia config can
 * carry tenant-account credentials instead of an API key.
 *
 * The session token lives in its own table rather than as columns on
 * external_apis because that table's `updated_at` is ON UPDATE
 * CURRENT_TIMESTAMP — a rotating token stored there would make the
 * configuration appear edited on every refresh.
 */
const migration: Migration = {
  name: '105_sta_lucia_integration',
  timestamp: '2026-07-31_09-00-00',

  async up(): Promise<void> {
    const cols: any = await query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'external_apis'
    `);
    const have = new Set((cols as any[]).map(c => c.COLUMN_NAME));

    if (!have.has('provider')) {
      await query(`ALTER TABLE external_apis
        ADD COLUMN provider ENUM('generic','sta_lucia') NOT NULL DEFAULT 'generic'`);
      console.log('✅ Added external_apis.provider');
    }
    if (!have.has('login_email')) {
      await query(`ALTER TABLE external_apis ADD COLUMN login_email VARCHAR(255) NULL`);
      console.log('✅ Added external_apis.login_email');
    }
    if (!have.has('login_password')) {
      await query(`ALTER TABLE external_apis ADD COLUMN login_password VARCHAR(500) NULL`);
      console.log('✅ Added external_apis.login_password');
    }

    await query(`
      CREATE TABLE IF NOT EXISTS external_api_sessions (
        api_id      VARCHAR(36) PRIMARY KEY,
        token       TEXT,
        owner_token VARCHAR(500),
        obtained_at TIMESTAMP NULL DEFAULT NULL,
        CONSTRAINT fk_eas_api FOREIGN KEY (api_id)
          REFERENCES external_apis(id) ON DELETE CASCADE
      )
    `);
    console.log('✅ external_api_sessions ready');
  },

  async down(): Promise<void> {
    await query(`DROP TABLE IF EXISTS external_api_sessions`);

    const cols: any = await query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'external_apis'
    `);
    const have = new Set((cols as any[]).map(c => c.COLUMN_NAME));

    for (const col of ['login_password', 'login_email', 'provider']) {
      if (have.has(col)) {
        await query(`ALTER TABLE external_apis DROP COLUMN ${col}`);
        console.log(`✅ Dropped external_apis.${col}`);
      }
    }
  }
};

registerMigration(migration);
