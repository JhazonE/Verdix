/**
 * Embedded Ed25519 PUBLIC key for license verification.
 *
 * ⚠️  MAINTAINED BY HAND. keygen lives in the license-server repo and can no
 * longer reach this file since the repos were split, so after every rotation
 * copy the new `keys/public-key.pem` body here yourself (see keygen.ts).
 *
 * This is the public half of the key pair — it can ONLY verify signatures, not
 * create them, so it is safe to ship inside the POS. The matching PRIVATE key
 * lives exclusively in the license-server repo (`keys/private-key.pem`,
 * gitignored) and on Railway as LICENSE_PRIVATE_KEY. It must never be
 * distributed.
 *
 * Rotated 2026-07-28 after the previous key was exposed.
 */
export const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA2dm0VFmJ8t1D3FKrejXY89kZJgL86sNiDNxi5NGKRyU=
-----END PUBLIC KEY-----`;
