import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  writeLicenseFile,
  readLicenseFile,
  deleteLicenseFile,
  sameLicenseTerms,
} from '../../lib/licensing/license-file';

// Regression: desktop installs fell back to the activation screen after a
// restart although the licence server still answered "active" for them. The
// heartbeat rewrote license.dat on every page load with a plain writeFileSync,
// so a power cut mid-write left an empty / NUL-filled file behind.

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vrdx-lic-'));
const file = path.join(dir, 'Verdix', 'license.dat');
const GOOD = 'VRDX1.good.sig';
const NEWER = 'VRDX1.newer.sig';
const usable = (k: string) => k.startsWith('VRDX1.') && !k.includes('\0');

// 1. Round trip; the write leaves a backup and no temp file behind.
writeLicenseFile(file, GOOD);
assert.equal(readLicenseFile(file, usable), GOOD, 'round trip');
assert.equal(fs.readFileSync(file + '.bak', 'utf8'), GOOD, 'backup written');
assert.equal(fs.existsSync(file + '.tmp'), false, 'no temp file left');

// 2. Main file truncated to zero bytes (classic power-loss result) → backup.
fs.writeFileSync(file, '');
assert.equal(readLicenseFile(file, usable), GOOD, 'empty main falls back to backup');

// 3. Main file NUL-filled (NTFS metadata committed, data not) → backup.
fs.writeFileSync(file, Buffer.alloc(300, 0));
assert.equal(readLicenseFile(file, usable), GOOD, 'NUL-filled main falls back to backup');

// 4. Main file deleted outright → backup.
fs.unlinkSync(file);
assert.equal(readLicenseFile(file, usable), GOOD, 'missing main falls back to backup');

// 5. A later save replaces both copies.
writeLicenseFile(file, NEWER);
assert.equal(readLicenseFile(file, usable), NEWER, 'newer key read');
assert.equal(fs.readFileSync(file + '.bak', 'utf8'), NEWER, 'backup follows newer key');

// 6. Deleting (revoke / release / deactivate) removes the backup too, or the
//    fallback would silently resurrect a licence the vendor took away.
deleteLicenseFile(file);
assert.equal(readLicenseFile(file, usable), null, 'delete removes both copies');
assert.equal(fs.existsSync(file + '.bak'), false, 'backup deleted');

// 7. No usable backup: a non-empty bad key is still surfaced (→ "invalid"),
//    but a NUL-filled torn write reads as nothing (→ "unlicensed").
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, 'garbage');
assert.equal(readLicenseFile(file, usable), 'garbage', 'bad key surfaced as-is for "invalid"');
fs.writeFileSync(file, Buffer.alloc(300, 0));
assert.equal(readLicenseFile(file, usable), null, 'NUL-filled main + no backup → null');
fs.unlinkSync(file);
assert.equal(readLicenseFile(file, usable), null, 'nothing on disk → null');

// 8. sameLicenseTerms ignores only the per-signing `issued` timestamp.
const tok = (p: object) => `VRDX1.${Buffer.from(JSON.stringify(p)).toString('base64url')}.sig`;
const base = { v: 1, lid: 'L1', product: 'verdix-pos', customer: 'C', edition: 'standard',
  machineId: 'M1', issued: '2026-11-01T00:00:00Z', expires: null, features: [] };
assert.equal(sameLicenseTerms(tok(base), tok({ ...base, issued: '2026-11-19T00:00:00Z' })), true,
  'only issued differs → same terms');
assert.equal(sameLicenseTerms(tok(base), tok({ ...base, expires: '2027-01-01T00:00:00Z' })), false,
  'renewed expiry → different terms');
assert.equal(sameLicenseTerms(tok(base), tok({ ...base, features: ['cloud'] })), false,
  'new feature → different terms');
assert.equal(sameLicenseTerms(null, tok(base)), false, 'no current key → different');
assert.equal(sameLicenseTerms('garbage', tok(base)), false, 'unparseable current key → different');

fs.rmSync(dir, { recursive: true, force: true });
console.log('license-file-durability: all assertions passed');
