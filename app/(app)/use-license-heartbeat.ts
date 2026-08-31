'use client';

import { useEffect, useRef } from 'react';

// Desktop installs are offline-tolerant and only need a daily check. Cloud
// installs poll hourly so a revocation takes effect within the hour.
const DESKTOP_INTERVAL = 24 * 60 * 60 * 1000;
const CLOUD_INTERVAL = 60 * 60 * 1000;

/**
 * Periodically pings the license server to pull renewals and enforce
 * revocations. Offline-safe: a network failure never locks immediately.
 *
 * On a lock the page reloads so LicenseGate re-runs its status check and
 * renders the activation screen. (It does NOT navigate to /activate — that
 * route is dead code; LicenseGate owns the activation UI.)
 */
export function useLicenseHeartbeat() {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let interval = DESKTOP_INTERVAL;

    async function beat() {
      try {
        const res = await fetch('/api/license/heartbeat', { method: 'POST' });
        if (!res.ok) return;
        const json = await res.json().catch(() => ({}));

        if (json?.hosted) interval = CLOUD_INTERVAL;
        if (json?.changed) window.location.reload();
      } catch {
        // Network unreachable — keep working on the cached license.
      }
    }

    beat();
    timerRef.current = setInterval(beat, interval);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);
}
