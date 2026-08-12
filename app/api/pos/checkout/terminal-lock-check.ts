/**
 * True if a terminal's business_date_locked_at value means checkout must
 * be rejected. Locked = a Z-reading was generated for this terminal and no
 * new shift has started on it since (BIR Annex F checklist item #29: the
 * next sale after a Z-reading must fall on the next business day, not the
 * same one).
 */
export function isTerminalLocked(lockedAt: unknown): boolean {
  return lockedAt !== null && lockedAt !== undefined;
}

export const TERMINAL_LOCKED_MESSAGE =
  "This terminal's business day is closed (Z-Reading already generated). Start a new shift to begin the next business day.";
