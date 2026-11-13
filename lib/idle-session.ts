/**
 * Back-office idle timeout ("session expired").
 *
 * A user who leaves the back office untouched for IDLE_TIMEOUT_MS is signed
 * out. The last minute is a visible warning they can dismiss by doing
 * anything.
 *
 * Activity is a TIMESTAMP in localStorage, not a running setTimeout, for two
 * reasons:
 *  - It is shared by every tab and window on this origin, so working in one
 *    tab keeps the others alive, and they all expire together.
 *  - A timer pauses while the machine sleeps; a timestamp does not. A terminal
 *    left on the dashboard overnight is expired the moment it wakes.
 *
 * Pure helpers only — the React side lives in hooks/use-idle-logout.ts.
 */

export const IDLE_TIMEOUT_MS = 15 * 60_000;
export const IDLE_WARNING_MS = 60_000;

/** localStorage key holding the epoch-ms of the last user activity. */
export const LAST_ACTIVITY_KEY = 'session-last-activity';
/** localStorage key holding the signed-in back-office user. */
export const SESSION_KEY = 'mock-user-session';
/** Query flag the login page reads to explain why the user is there. */
export const EXPIRED_QUERY = 'expired';

export type IdlePhase = 'active' | 'warning' | 'expired';

export function idleState(
  lastActivity: number,
  now: number,
  timeoutMs: number = IDLE_TIMEOUT_MS,
  warningMs: number = IDLE_WARNING_MS,
): { phase: IdlePhase; remainingMs: number } {
  // A future timestamp means the clock moved backwards; treat it as "just
  // now" rather than granting more than a full timeout.
  const elapsed = Math.max(0, now - lastActivity);
  const remainingMs = Math.max(0, timeoutMs - elapsed);
  if (remainingMs === 0) return { phase: 'expired', remainingMs: 0 };
  if (remainingMs <= warningMs) return { phase: 'warning', remainingMs };
  return { phase: 'active', remainingMs };
}

export function parseLastActivity(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/* ---------------------------- browser helpers ---------------------------- */
// Every localStorage access is guarded: it throws in some locked-down
// browser modes, and a broken idle timer must never break the app.

export function readLastActivity(): number | null {
  try { return parseLastActivity(localStorage.getItem(LAST_ACTIVITY_KEY)); } catch { return null; }
}

export function markActivity(now: number = Date.now()): void {
  try { localStorage.setItem(LAST_ACTIVITY_KEY, String(now)); } catch { /* ignore */ }
}

/** Remove the back-office session. Used by both manual and idle sign-out. */
export function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(LAST_ACTIVITY_KEY);
  } catch { /* ignore */ }
}
