import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

/**
 * Atomic claim table for Sta. Lucia Z-reading submissions.
 *
 * `external_api_logs` deliberately permits duplicate success rows (see
 * 095_dedupe_external_api_logs), so it cannot be used as a concurrency guard:
 * a SELECT-then-INSERT idempotency check against that table is a
 * check-then-act race — two concurrent sends for the same Z-reading (e.g. the
 * finalize hook firing at the same moment as a manual "Send Z-Reading" click)
 * can both pass the check before either writes its log row, submitting the
 * same day's sales to the mall twice.
 *
 * This table's PRIMARY KEY on z_reading_id makes the claim atomic: only one
 * concurrent INSERT can win, and the loser gets ER_DUP_ENTRY.
 */
const migration: Migration = {
  name: '106_sta_lucia_submission_claims',
  timestamp: '2026-07-31_11-00-00',

  async up(): Promise<void> {
    await query(`
      CREATE TABLE IF NOT EXISTS sta_lucia_submissions (
        z_reading_id VARCHAR(50) PRIMARY KEY,
        claimed_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        succeeded    TINYINT(1) NOT NULL DEFAULT 0
      )
    `);
    console.log('✅ sta_lucia_submissions ready');
  },

  async down(): Promise<void> {
    await query(`DROP TABLE IF EXISTS sta_lucia_submissions`);
  }
};

registerMigration(migration);
