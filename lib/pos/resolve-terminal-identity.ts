/**
 * Resolves which POS terminal THIS machine is.
 *
 * This decides the `terminal_id` written on every sale, shift and Z-reading, so
 * a wrong answer misfiles BIR records under another till. It is a pure function
 * so the precedence rules can be tested without a browser or a DB.
 *
 * Precedence is deliberate:
 *
 *   1. A stored choice (Connection Settings / Terminals page wrote
 *      `pos_terminal_id` for this machine) — an operator bound this till on
 *      purpose, so an IP that happens to match another row must not relabel it.
 *   2. An IP match — only a first-run convenience, and only when nothing is
 *      stored. Persisted so the next boot takes rule 1.
 *   3. Nothing. Block and ask.
 *
 * Rule 3 is the point. This used to fall back to `terminals[0]`, which looked
 * harmless but was the whole bug: under Electron each terminal runs its own
 * local server, so the client IP is always loopback and NO terminal ever
 * matched by IP. Every till therefore fell through to the same first row and
 * filed its Z-readings as that one terminal, which is why per-terminal
 * Z-readings went missing in the back office. The list was also ordered
 * `created_at DESC`, so registering a new terminal silently moved every
 * unbound machine's identity.
 *
 * Guessing is never correct here: blocking costs one prompt, a misattributed
 * Z-reading is a filed tax document that cannot be corrected safely.
 */

export interface TerminalOption {
  id: string;
  ipAddress?: string | null;
  terminalDescription?: string | null;
  name?: string | null;
}

export interface ResolveTerminalIdentityInput {
  /** Active terminals as returned by GET /api/pos-terminals?activeOnly=true. */
  terminals: TerminalOption[];
  /** Client IP as seen by the server; loopback on Electron. */
  clientIp?: string | null;
  /** `pos_terminal_id` from this machine's localStorage, if any. */
  storedId?: string | null;
}

export type TerminalIdentitySource = 'stored' | 'ip' | 'unresolved' | 'no-terminals';

export interface ResolvedTerminalIdentity {
  /** The terminal to operate as, or null when it could not be determined. */
  terminalId: string | null;
  terminal: TerminalOption | null;
  source: TerminalIdentitySource;
  /** True when the POS must not trade until the operator picks a terminal. */
  blocked: boolean;
  /** True when the caller should write terminalId to localStorage. */
  persist: boolean;
}

export function resolveTerminalIdentity(
  input: ResolveTerminalIdentityInput,
): ResolvedTerminalIdentity {
  const terminals = input.terminals ?? [];

  // Nothing registered yet. Reported separately from 'unresolved' because the
  // operator has to go and register a terminal, not choose between existing ones.
  if (terminals.length === 0) {
    return { terminalId: null, terminal: null, source: 'no-terminals', blocked: true, persist: false };
  }

  // 1. A deliberate, machine-local binding outranks any inference.
  // A stored id that no longer resolves is stale (terminal deleted or
  // deactivated), not authoritative — fall through rather than trust it.
  const storedId = input.storedId?.trim() || null;
  if (storedId) {
    const stored = terminals.find(t => t.id === storedId);
    if (stored) {
      return { terminalId: stored.id, terminal: stored, source: 'stored', blocked: false, persist: false };
    }
  }

  // 2. IP match, as a first-run convenience only. Compared against a trimmed
  // address so a stray space in the Terminals page does not defeat it.
  const clientIp = input.clientIp?.trim() || null;
  if (clientIp) {
    const byIp = terminals.find(t => (t.ipAddress ?? '').trim() === clientIp);
    if (byIp) {
      return { terminalId: byIp.id, terminal: byIp, source: 'ip', blocked: false, persist: true };
    }
  }

  // 3. Unknown. Block — never guess, and never persist a guess.
  // Note this includes the single-terminal case on purpose: auto-assigning the
  // only terminal today means the second till inherits its identity tomorrow.
  return { terminalId: null, terminal: null, source: 'unresolved', blocked: true, persist: false };
}
