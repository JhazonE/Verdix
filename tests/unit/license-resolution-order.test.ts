import assert from 'node:assert/strict';
import { resolveLicenseKey } from '../../lib/licensing/verify';

// (a) DB row wins over the env bootstrap seed.
process.env.LICENSE_KEY = 'VRDX1.env-token';
assert.equal(
  resolveLicenseKey({
    signedLicense: 'VRDX1.db-token', lastValidatedAt: null, lockReason: null, seatLimit: null,
  }),
  'VRDX1.db-token',
  'DB signed_license wins over env'
);

// (b) No DB row at all → env bootstrap seed is used.
assert.equal(resolveLicenseKey(null), 'VRDX1.env-token', 'null state falls back to env');

// (c) A row that exists but has no token yet → env bootstrap seed is used.
assert.equal(
  resolveLicenseKey({
    signedLicense: null, lastValidatedAt: null, lockReason: null, seatLimit: null,
  }),
  'VRDX1.env-token',
  'empty signed_license falls back to env'
);

delete process.env.LICENSE_KEY;

// (d) With neither DB nor env, resolution yields nothing (no license.dat in CI).
process.env.LICENSE_FILE = '/nonexistent/path/license.dat';
assert.equal(resolveLicenseKey(null), null, 'no DB, no env, no file → null');
delete process.env.LICENSE_FILE;

console.log('license-resolution-order: all assertions passed');
