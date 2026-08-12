import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

/**
 * Atomic claim table for Sta. Lucia hourly sales submissions.
 *
 * Same reasoning as 106_sta_lucia_submission_claims for the EOD path:
 * external_api_logs permits duplicate success rows, so it cannot be used as
 * a concurrency guard on its own. This table's PRIMARY KEY on hour_start
 * makes the claim atomic — only one concurrent INSERT for the same hour can
 * win, whether the caller is the :05-past-the-hour cron, the catch-up sweep
 * on scheduler start, or a manual retry.
 */
const migration: Migration = {
  name: '111_sta_lucia_hourly_submission_claims',
  timestamp: '2026-08-12_10-00-00',

  async up(): Promise<void> {
    await query(`
      CREATE TABLE IF NOT EXISTS sta_lucia_hourly_submissions (
        hour_start VARCHAR(19) PRIMARY KEY,
        claimed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        succeeded  TINYINT(1) NOT NULL DEFAULT 0
      )
    `);
    console.log('✅ sta_lucia_hourly_submissions ready');
  },

  async down(): Promise<void> {
    await query(`DROP TABLE IF EXISTS sta_lucia_hourly_submissions`);
  }
};

registerMigration(migration);
