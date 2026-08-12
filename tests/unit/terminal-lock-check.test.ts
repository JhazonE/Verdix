import assert from 'node:assert/strict';
import { isTerminalLocked } from '../../app/api/pos/checkout/terminal-lock-check';

// A terminal is locked whenever business_date_locked_at is non-null —
// regardless of exact type (Date object, ISO string, etc. depending on
// how mysql2 deserializes a TIMESTAMP column) — and unlocked when it's
// null/undefined.

assert.equal(isTerminalLocked(null), false, 'null (unlocked) is not locked');
assert.equal(isTerminalLocked(undefined), false, 'undefined (no row / no data) is not locked');
assert.equal(isTerminalLocked(new Date('2026-08-11T10:00:00Z')), true, 'a Date value is locked');
assert.equal(isTerminalLocked('2026-08-11 10:00:00'), true, 'a string timestamp value is locked');

console.log('✓ terminal-lock-check');
