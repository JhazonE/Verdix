/**
 * Crash-safe storage for the desktop license.dat (server-only).
 * ----------------------------------------------------------------------------
 * Why this exists: desktop installs were dropping back to the activation
 * screen after a restart while the licence server still answered "active" for
 * them. The heartbeat rewrote license.dat with a plain writeFileSync on every
 * page load, and a power cut (or a POS switched off at the wall) mid-write left
 * an empty or NUL-filled file behind — which reads as "unlicensed"/"invalid".
 *
 * Three defences:
 *   1. Writes go to `<file>.tmp`, are fsync'd, then renamed over the real file,
 *      so the real file is always either the old key or the new one.
 *   2. Every write also refreshes `<file>.bak`; a read whose main file is
 *      missing/damaged falls back to it (only if the caller says it is usable).
 *   3. sameLicenseTerms lets the heartbeat skip a rewrite when the server only
 *      re-signed the same licence (just the `issued` timestamp moved).
 */
import fs from 'fs';
import path from 'path';

function atomicWrite(target: string, contents: string): void {
  const tmp = target + '.tmp';
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, contents, 0, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, target);
}

function readTrimmed(p: string): string | null {
  try {
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, 'utf8').trim();
    return raw || null;
  } catch {
    return null;
  }
}

export function writeLicenseFile(file: string, key: string): void {
  const value = key.trim();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  atomicWrite(file, value);
  // The backup is best-effort: the main file is already safely in place.
  try {
    atomicWrite(file + '.bak', value);
  } catch {
    /* ignore */
  }
}

/**
 * Returns the stored key, preferring the main file and falling back to the
 * backup when the main one is missing or fails `isUsable` (e.g. a bad
 * signature from a torn write).
 *
 * With no usable backup, a non-empty main file is still returned so the caller
 * reports it as "invalid" (as before this module existed) — unless it contains
 * NUL bytes, which only a torn write produces; that reads as "unlicensed".
 */
export function readLicenseFile(file: string, isUsable: (key: string) => boolean): string | null {
  const main = readTrimmed(file);
  if (main && isUsable(main)) return main;

  const bak = readTrimmed(file + '.bak');
  if (bak && isUsable(bak)) return bak;

  return main && !main.includes('\0') ? main : null;
}

export function deleteLicenseFile(file: string): void {
  for (const p of [file, file + '.bak', file + '.tmp']) {
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch {
      /* ignore */
    }
  }
}

function decodePayload(key: string | null): Record<string, unknown> | null {
  if (!key) return null;
  const parts = key.trim().split('.');
  if (parts.length !== 3) return null;
  try {
    const p = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return p && typeof p === 'object' ? p : null;
  } catch {
    return null;
  }
}

/**
 * True when two keys carry the same licence terms, ignoring only `issued`
 * (which changes on every re-signing). Expiry, features, edition, machine and
 * licence id all count, so a genuine renewal is always persisted.
 */
export function sameLicenseTerms(currentKey: string | null, nextKey: string | null): boolean {
  const a = decodePayload(currentKey);
  const b = decodePayload(nextKey);
  if (!a || !b) return false;
  const strip = ({ issued: _issued, ...rest }: Record<string, unknown>) => rest;
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}
