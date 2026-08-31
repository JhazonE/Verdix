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

  // 'active', 'expired', and anything else the server answered with.
  const patch: Partial<LicenseState> = { lastValidatedAt: now, lockReason: null };
  if (status === 'active' && signedLicense) patch.signedLicense = signedLicense;
  return patch;
}
