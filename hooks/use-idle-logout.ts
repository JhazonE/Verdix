'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  EXPIRED_QUERY, IDLE_TIMEOUT_MS, IDLE_WARNING_MS, LAST_ACTIVITY_KEY, SESSION_KEY,
  clearSession, idleState, markActivity, readLastActivity,
} from '@/lib/idle-session';
import { logActivity } from '@/lib/client-activity-logger';

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;
/** Cap localStorage writes from a stream of mousemove events. */
const WRITE_THROTTLE_MS = 2_000;

function hasSession(): boolean {
  try { return !!localStorage.getItem(SESSION_KEY); } catch { return true; }
}

/**
 * Signs the back-office user out after IDLE_TIMEOUT_MS without activity.
 *
 * BACK OFFICE ONLY. On POS and the price-check kiosk (`onExemptPage`) this
 * hook does nothing at all — no listeners, no timer: POS has its own cashier
 * login and an open shift an idle timer must not abandon, and the kiosk is
 * unattended by design.
 *
 * Because POS time is not tracked, the clock restarts when the user navigates
 * from an exempt page into the back office; otherwise an admin returning from
 * an hour of ringing sales would be signed out on arrival. A fresh page load
 * straight onto the back office does NOT restart it, so a machine left idle
 * overnight still expires.
 *
 * Returns the countdown (ms) while the warning is showing, else null.
 */
export function useIdleLogout({ enabled, onExemptPage }: { enabled: boolean; onExemptPage: boolean }) {
  const [warningRemainingMs, setWarningRemainingMs] = useState<number | null>(null);
  const lastWriteRef = useRef(0);
  const expiringRef = useRef(false);
  const cameFromExemptRef = useRef(false);

  useEffect(() => {
    if (onExemptPage) { cameFromExemptRef.current = true; return; }
    if (cameFromExemptRef.current) {
      cameFromExemptRef.current = false;
      markActivity();
    }
  }, [onExemptPage]);

  const touch = useCallback(() => {
    const now = Date.now();
    if (now - lastWriteRef.current < WRITE_THROTTLE_MS) return;
    lastWriteRef.current = now;
    markActivity(now);
  }, []);

  // Record activity — back office only.
  useEffect(() => {
    if (!enabled) return;
    const opts = { capture: true, passive: true } as const;
    ACTIVITY_EVENTS.forEach(e => window.addEventListener(e, touch, opts));
    return () => ACTIVITY_EVENTS.forEach(e => window.removeEventListener(e, touch, opts));
  }, [enabled, touch]);

  const expire = useCallback(async () => {
    if (expiringRef.current) return;
    expiringRef.current = true;
    // Log while the session still exists — the logger reads the user from it.
    // Bounded so an unreachable API cannot hold an unattended screen open.
    await Promise.race([
      logActivity({ action: 'LOGOUT', module: 'USERS', description: 'Session expired due to inactivity' }),
      new Promise(r => setTimeout(r, 1_500)),
    ]);
    // Keep the stale activity stamp: another open tab that finds the session
    // gone can then tell this was an expiry, not a manual sign-out.
    try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
    window.location.replace(`/login?${EXPIRED_QUERY}=1`);
  }, []);

  // Enforce.
  useEffect(() => {
    if (!enabled) { setWarningRemainingMs(null); return; }

    // Sessions created before this feature have no stamp: start their clock
    // now instead of expiring everyone the moment they upgrade.
    if (readLastActivity() === null) markActivity();

    const check = () => {
      if (expiringRef.current) return;
      if (!hasSession()) {
        // Signed out in another tab. If the stamp is stale it was an expiry.
        const last = readLastActivity();
        const expired = last !== null && idleState(last, Date.now()).phase === 'expired';
        clearSession();
        window.location.replace(expired ? `/login?${EXPIRED_QUERY}=1` : '/login');
        expiringRef.current = true;
        return;
      }
      const last = readLastActivity() ?? Date.now();
      const { phase, remainingMs } = idleState(last, Date.now(), IDLE_TIMEOUT_MS, IDLE_WARNING_MS);
      if (phase === 'expired') { setWarningRemainingMs(null); void expire(); }
      else setWarningRemainingMs(phase === 'warning' ? remainingMs : null);
    };

    check(); // immediately — a machine waking from sleep must not show the page first
    const id = window.setInterval(check, 1_000);
    const onStorage = (e: StorageEvent) => {
      if (e.key === SESSION_KEY || e.key === LAST_ACTIVITY_KEY || e.key === null) check();
    };
    window.addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', check);
    };
  }, [enabled, expire]);

  const staySignedIn = useCallback(() => {
    lastWriteRef.current = Date.now();
    markActivity(lastWriteRef.current);
    setWarningRemainingMs(null);
  }, []);

  return { warningRemainingMs, staySignedIn, logoutNow: expire };
}
