/**
 * DB-backed license state (cloud deployments).
 * ----------------------------------------------------------------------------
 * A Railway container's filesystem is ephemeral and LICENSE_KEY is read-only to
 * the app, so a hosted POS has nowhere durable to record a renewal or a lock.
 * This single-row table is that place. Desktop installs never touch it.
 *
 * Every read degrades to null rather than throwing: a desktop database may not
 * have the table at all, and licensing must never crash the app.
 */
import { query } from '../mysql';

export interface LicenseState {
  signedLicense: string | null;
  lastValidatedAt: Date | null;
  lockReason: string | null;
  /** Licensed terminal count, delivered by the heartbeat. Null = unlimited. */
  seatLimit: number | null;
}

/** Days the POS keeps working after the last successful license-server contact. */
export const GRACE_WINDOW_DAYS = 7;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * True when the last successful validation is older than the grace window.
 * A null timestamp means "never validated" (fresh bootstrap) and never locks;
 * a future timestamp (clock skew) never locks either.
 */
export function isGraceExpired(lastValidatedAt: Date | null, now: Date = new Date()): boolean {
  if (!lastValidatedAt) return false;
  const age = now.getTime() - lastValidatedAt.getTime();
  if (age < 0) return false;
  return age > GRACE_WINDOW_DAYS * MS_PER_DAY;
}

export async function readLicenseState(): Promise<LicenseState | null> {
  try {
    const rows: any = await query(
      `SELECT signed_license, last_validated_at, lock_reason, seat_limit
         FROM license_state WHERE id = 1`
    );
    const row = rows?.[0];
    if (!row) return null;
    return {
      signedLicense: row.signed_license ?? null,
      lastValidatedAt: row.last_validated_at ? new Date(row.last_validated_at) : null,
      lockReason: row.lock_reason ?? null,
      seatLimit: row.seat_limit ?? null,
    };
  } catch {
    // Table missing (desktop) or DB unreachable — fall back to env/file.
    return null;
  }
}

export async function writeLicenseState(patch: Partial<LicenseState>): Promise<void> {
  const sets: string[] = [];
  const values: any[] = [];
  if ('signedLicense' in patch) { sets.push('signed_license = ?'); values.push(patch.signedLicense); }
  if ('lastValidatedAt' in patch) { sets.push('last_validated_at = ?'); values.push(patch.lastValidatedAt); }
  if ('lockReason' in patch) { sets.push('lock_reason = ?'); values.push(patch.lockReason); }
  if ('seatLimit' in patch) { sets.push('seat_limit = ?'); values.push(patch.seatLimit); }
  if (!sets.length) return;

  try {
    await query(
      `INSERT INTO license_state (id, signed_license, last_validated_at, lock_reason, seat_limit)
       VALUES (1, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE ${sets.join(', ')}`,
      [
        patch.signedLicense ?? null,
        patch.lastValidatedAt ?? null,
        patch.lockReason ?? null,
        patch.seatLimit ?? null,
        ...values,
      ]
    );
  } catch (e) {
    console.error('license_state write failed:', e);
  }
}
