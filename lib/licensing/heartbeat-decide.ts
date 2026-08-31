/**
 * Pure heartbeat transition logic.
 * ----------------------------------------------------------------------------
 * Split from the route so the rules can be tested without a DB or a network.
 *
 * The critical rule: only an ANSWER from the server stamps last_validated_at.
 * A network failure must leave the timestamp alone, because that is exactly
 * what lets the grace window advance and eventually lock.
 */
import type { LicenseState } from './state-store';

const VENDOR_LOCKS = new Set(['revoked', 'suspended', 'released']);

export function decideHeartbeatWrite(
  status: string,
  signedLicense: string | undefined,
  now: Date = new Date()
): Partial<LicenseState> | null {
  // No answer from the server — write nothing so the grace window advances.
  if (status === 'offline' || status === 'unknown') return null;

  if (VENDOR_LOCKS.has(status)) {
    return { lastValidatedAt: now, lockReason: status };
  }

  // 'active', 'expired', 'seat-exceeded', and anything else the server
  // answered with. 'seat-exceeded' still carries a valid renewed token — the
  // server deliberately keeps signing licenses over the seat limit rather than
  // withholding one, so checkout is never blocked by a seat count. Dropping
  // that token here would silently stop renewals while last_validated_at kept
  // advancing, eventually expiring a store the vendor had already renewed.
  const patch: Partial<LicenseState> = { lastValidatedAt: now, lockReason: null };
  if ((status === 'active' || status === 'seat-exceeded') && signedLicense) {
    patch.signedLicense = signedLicense;
  }
  return patch;
}
