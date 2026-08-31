import assert from 'node:assert/strict';
import { decideHeartbeatWrite } from '../../lib/licensing/heartbeat-decide';

const now = new Date('2026-08-31T12:00:00Z');

// Active with a renewed token: store it, stamp contact, clear any lock.
assert.deepEqual(
  decideHeartbeatWrite('active', 'VRDX1.renewed', now),
  { signedLicense: 'VRDX1.renewed', lastValidatedAt: now, lockReason: null },
  'active + token stores renewal and clears lock'
);

// Active with no token returned: still a successful contact, still clears lock.
assert.deepEqual(
  decideHeartbeatWrite('active', undefined, now),
  { lastValidatedAt: now, lockReason: null },
  'active without token stamps contact only'
);

// Vendor locks record a reason and are still a successful contact.
for (const status of ['revoked', 'suspended', 'released']) {
  assert.deepEqual(
    decideHeartbeatWrite(status, undefined, now),
    { lastValidatedAt: now, lockReason: status },
    `${status} records a lock reason`
  );
}

// Expired is left to local verification — no lock reason written.
assert.deepEqual(
  decideHeartbeatWrite('expired', undefined, now),
  { lastValidatedAt: now, lockReason: null },
  'expired defers to local expiry check'
);

// Offline / unknown must NOT stamp contact — that is what advances the grace window.
assert.equal(decideHeartbeatWrite('offline', undefined, now), null, 'offline writes nothing');
assert.equal(decideHeartbeatWrite('unknown', undefined, now), null, 'unknown writes nothing');

console.log('license-heartbeat-transitions: all assertions passed');
