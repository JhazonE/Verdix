/**
 * True if a terminal's business_date_locked_at value means checkout must
 * be rejected. Locked = a Z-reading was generated for this terminal and the
 * lock has not yet cleared (BIR Annex F checklist item #29: the next sale
 * after a Z-reading must fall on the next business day, not the same one).
 */
export function isTerminalLocked(lockedAt: unknown): boolean {
  return lockedAt !== null && lockedAt !== undefined;
}

export const TERMINAL_LOCKED_MESSAGE =
  "This terminal's business day is closed (Z-Reading already generated). Start a new shift to begin the next business day.";

/**
 * True if a locked terminal is still within the same calendar day its
 * Z-reading was generated. Starting a shift no longer clears the lock by
 * itself (see app/api/pos/shifts/route.ts) — only a calendar-date rollover
 * does, so a same-day shift-start attempt must also be rejected, not just
 * checkout. `lockedAt` and `now` are compared by calendar date only (not
 * elapsed hours), per business decision: the lock always survives until
 * midnight, however soon after the Z-reading that falls.
 */
export function isTerminalLockedSameDay(lockedAt: unknown, now: Date = new Date()): boolean {
  if (!isTerminalLocked(lockedAt)) return false;
  const locked = new Date(lockedAt as string | number | Date);
  return (
    locked.getFullYear() === now.getFullYear() &&
    locked.getMonth() === now.getMonth() &&
    locked.getDate() === now.getDate()
  );
}

export const SHIFT_START_BLOCKED_MESSAGE =
  "This terminal's business day is still closed (Z-Reading generated today). Try again after midnight to start the next business day.";
