import assert from 'node:assert/strict';
import { encryptGcm, decryptGcm, deriveKey } from '../../lib/crypto/aes-gcm';

const key = deriveKey('secret', 'machine-123');

// round-trip
const blob = encryptGcm('hello-password', key);
assert.equal(decryptGcm(blob, key), 'hello-password', 'round-trips plaintext');

// ciphertext is not plaintext
assert.ok(!blob.includes('hello-password'), 'ciphertext hides plaintext');

// wrong key → null (not throw)
assert.equal(decryptGcm(blob, deriveKey('secret', 'other-machine')), null, 'wrong key returns null');

// tampered blob → null. Flip one bit in the decoded bytes so the blob is
// guaranteed to change. (This used to overwrite the first base64 character
// with 'A', which changed nothing whenever the random IV already encoded to
// an 'A' there — about 1 run in 64 — and the test failed at random.)
// One flip in each region: iv[0..12) | authTag[12..28) | ciphertext[28..).
const raw = Buffer.from(blob, 'base64');
for (const [region, offset] of [['iv', 0], ['auth tag', 12], ['ciphertext', 28]] as const) {
  const t = Buffer.from(raw);
  t[offset] ^= 0x01;
  const tampered = t.toString('base64');
  assert.notEqual(tampered, blob, `tampering the ${region} must change the blob`);
  assert.equal(decryptGcm(tampered, key), null, `tampered ${region} returns null`);
}

// malformed input → null
assert.equal(decryptGcm('not-base64!!', key), null, 'garbage returns null');

// deriveKey is deterministic and 32 bytes
assert.equal(deriveKey('a', 'b').length, 32, 'key is 32 bytes');
assert.deepEqual(deriveKey('a', 'b'), deriveKey('a', 'b'), 'deriveKey deterministic');

console.log('aes-gcm: all assertions passed');
