import { NextResponse } from 'next/server';
import {
  readLicensePayloadAsync,
  evaluateLicenseKey,
  saveLicenseKey,
  removeLicenseKey,
} from '@/lib/licensing/verify';
import { HOSTED_MACHINE_ID, normalizeMachineId } from '@/lib/licensing/core';
import { writeLicenseState } from '@/lib/licensing/state-store';
import { decideHeartbeatWrite } from '@/lib/licensing/heartbeat-decide';
import { countActiveTerminals } from '@/lib/licensing/terminal-count';

export const dynamic = 'force-dynamic';

const LICENSE_SERVER_URL = (process.env.LICENSE_SERVER_URL || 'http://localhost:4100').replace(/\/$/, '');

// POST /api/license/heartbeat — periodic re-validation against the license
// server. Enforces revocation/suspension and pulls renewals.
//
// Cloud (hosted) installs persist the result to the license_state table, which
// survives a redeploy; desktop installs keep using license.dat. Offline-safe on
// both: a network failure never locks immediately — only an explicit negative
// answer, or (cloud only) 7 days without any answer, does.
export async function POST() {
  try {
    const payload = await readLicensePayloadAsync();
    if (!payload) {
      return NextResponse.json({ success: true, status: 'unlicensed', changed: false });
    }

    // Cloud mode is detected from the signed payload's sentinel machine id.
    const hosted = normalizeMachineId(payload.machineId) === normalizeMachineId(HOSTED_MACHINE_ID);
    const terminalCount = hosted ? await countActiveTerminals() : undefined;

    let resp: Response;
    try {
      resp = await fetch(LICENSE_SERVER_URL + '/api/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          licenseId: payload.lid,
          machineId: payload.machineId,
          appVersion: process.env.npm_package_version || '1.0',
          ...(terminalCount !== undefined ? { terminalCount } : {}),
        }),
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      // Offline / unreachable → keep working on the cached license. Nothing is
      // written, so the grace window advances.
      return NextResponse.json({ success: true, status: 'offline', changed: false });
    }

    const json = await resp.json().catch(() => ({} as any));
    if (!resp.ok || !json?.success) {
      return NextResponse.json({ success: true, status: 'unknown', changed: false });
    }

    const status: string = json.status;

    if (hosted) {
      // Cloud: the DB row is authoritative. Never touch license.dat here — the
      // container filesystem does not survive a redeploy.
      const patch = decideHeartbeatWrite(status, json.signedLicense);
      if (patch) await writeLicenseState(patch);
      // The seat limit lives only on the server side of the contract, so cache
      // whatever it reported for Task 5's terminal-creation guard to read.
      if (typeof json.seatLimit === 'number' || json.seatLimit === null) {
        await writeLicenseState({ seatLimit: json.seatLimit });
      }
      const changed = status !== 'active' && status !== 'seat-exceeded';
      return NextResponse.json({
        success: true,
        status,
        changed,
        // Task 7's client reads this to poll hourly instead of daily.
        hosted: true,
        ...(json.seatLimit !== undefined ? { seatLimit: json.seatLimit, terminalCount } : {}),
      });
    }

    // Desktop: unchanged file-based behaviour.
    if (status === 'active') {
      if (json.signedLicense) {
        const info = evaluateLicenseKey(json.signedLicense);
        if (info.status === 'active' || info.status === 'expired') saveLicenseKey(json.signedLicense);
      }
      return NextResponse.json({ success: true, status: 'active', changed: false });
    }

    if (status === 'revoked' || status === 'suspended' || status === 'released') {
      removeLicenseKey();
      return NextResponse.json({ success: true, status, changed: true });
    }

    return NextResponse.json({ success: true, status, changed: false });
  } catch (error) {
    console.error('Heartbeat error:', error);
    return NextResponse.json({ success: false, error: 'Heartbeat failed' }, { status: 500 });
  }
}
