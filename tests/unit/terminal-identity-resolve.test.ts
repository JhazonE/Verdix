import assert from 'node:assert/strict';
import { resolveTerminalIdentity } from '../../lib/pos/resolve-terminal-identity';

// Terminal identity decides which terminal_id a Z-reading (a BIR record) is
// filed under. It used to be resolved by IP match with a silent fallback to
// terminalsData[0] — on Electron every terminal sees a loopback client IP, so
// every terminal fell through to the SAME first row and all of their
// Z-readings were filed as one terminal. These assertions pin the two rules
// that fix it: a stored choice outranks an IP guess, and nothing is ever
// guessed on the operator's behalf.

const T1 = { id: 'terminal_aaa', ipAddress: '192.168.1.11', terminalDescription: 'COUNTER 1' };
const T2 = { id: 'terminal_bbb', ipAddress: '192.168.1.12', terminalDescription: 'COUNTER 2' };
const T3 = { id: 'terminal_ccc', ipAddress: '192.168.1.13', terminalDescription: 'COUNTER 3' };
const ALL = [T1, T2, T3];

// (a) A stored choice wins over a conflicting IP match. The operator bound
// this machine deliberately via Connection Settings; an IP that happens to
// match another row must not silently relabel the till.
{
  const r = resolveTerminalIdentity({ terminals: ALL, clientIp: T1.ipAddress, storedId: T2.id });
  assert.equal(r.terminalId, T2.id, 'stored choice outranks IP match');
  assert.equal(r.source, 'stored');
  assert.equal(r.blocked, false, 'a resolved terminal never blocks');
}

// (b) With no stored choice, an IP match is an acceptable first-run guess and
// is persisted so later boots take branch (a).
{
  const r = resolveTerminalIdentity({ terminals: ALL, clientIp: T3.ipAddress, storedId: null });
  assert.equal(r.terminalId, T3.id, 'IP match used when nothing is stored');
  assert.equal(r.source, 'ip');
  assert.equal(r.persist, true, 'a first-run IP match is remembered');
}

// (c) THE BUG. Loopback IP (every Electron terminal) and no stored choice must
// NOT resolve to terminalsData[0]. It must block and ask.
{
  const r = resolveTerminalIdentity({ terminals: ALL, clientIp: '127.0.0.1', storedId: null });
  assert.equal(r.terminalId, null, 'no terminal is guessed when identity is unknown');
  assert.equal(r.blocked, true, 'POS blocks until the operator picks a terminal');
  assert.notEqual(r.terminalId, T1.id, 'must not silently fall back to the first terminal');
  assert.equal(r.source, 'unresolved');
  assert.equal(r.persist, false, 'nothing is written when nothing was chosen');
}

// (d) The fallback used ORDER BY created_at DESC, so adding a terminal moved
// every unbound machine's identity. Order must not affect the outcome at all.
{
  const a = resolveTerminalIdentity({ terminals: ALL, clientIp: '::1', storedId: null });
  const b = resolveTerminalIdentity({ terminals: [...ALL].reverse(), clientIp: '::1', storedId: null });
  assert.equal(a.terminalId, b.terminalId, 'list order cannot change identity');
  assert.equal(a.blocked, true);
  assert.equal(b.blocked, true);
}

// (e) A stored id that no longer exists (terminal deleted or deactivated) is
// stale, not authoritative. Fall through to IP, else block — never guess.
{
  const r = resolveTerminalIdentity({ terminals: ALL, clientIp: T2.ipAddress, storedId: 'terminal_deleted' });
  assert.equal(r.terminalId, T2.id, 'stale stored id falls through to IP match');
  assert.equal(r.source, 'ip');
}
{
  const r = resolveTerminalIdentity({ terminals: ALL, clientIp: '127.0.0.1', storedId: 'terminal_deleted' });
  assert.equal(r.terminalId, null, 'stale stored id with no IP match blocks');
  assert.equal(r.blocked, true);
}

// (f) No terminals registered at all: block, and say so distinctly — the
// operator must register one, not pick one.
{
  const r = resolveTerminalIdentity({ terminals: [], clientIp: '127.0.0.1', storedId: null });
  assert.equal(r.terminalId, null);
  assert.equal(r.blocked, true);
  assert.equal(r.source, 'no-terminals', 'empty registry is reported distinctly');
}

// (g) A single registered terminal is still not a license to auto-assign it.
// One terminal today becomes two tomorrow, and the second till would inherit
// the first one's identity. Blocking once is cheap; a misfiled Z-reading is not.
{
  const r = resolveTerminalIdentity({ terminals: [T1], clientIp: '127.0.0.1', storedId: null });
  assert.equal(r.terminalId, null, 'a lone terminal is not auto-assigned');
  assert.equal(r.blocked, true);
}

console.log('terminal-identity-resolve: all assertions passed');
