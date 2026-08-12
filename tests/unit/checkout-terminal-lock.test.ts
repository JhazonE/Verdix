import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { isTerminalLocked, TERMINAL_LOCKED_MESSAGE } from '../../app/api/pos/checkout/terminal-lock-check';

// Same underlying function checkout/route.ts calls — no local reimplementation
// of the locking logic (a prior batch's checkout-si-or-routing.test.ts
// mirrored route logic locally and missed a real bug in the route itself;
// this test avoids that by (a) using the real exported function everywhere,
// and (b) asserting the route file genuinely imports and calls it, so a
// future edit that silently drops the wiring in route.ts fails this test).

assert.equal(isTerminalLocked(null), false, 'unlocked terminal passes');
assert.equal(isTerminalLocked(new Date()), true, 'locked terminal is rejected');

const routeSource = fs.readFileSync(
  path.join(__dirname, '../../app/api/pos/checkout/route.ts'),
  'utf-8'
);
assert.ok(
  routeSource.includes("from './terminal-lock-check'"),
  'checkout route.ts imports terminal-lock-check.ts',
);
assert.ok(
  routeSource.includes('isTerminalLocked('),
  'checkout route.ts actually calls isTerminalLocked(...), not just imports it',
);
assert.ok(
  routeSource.includes('business_date_locked_at'),
  'checkout route.ts queries the business_date_locked_at column',
);
assert.ok(
  routeSource.includes(TERMINAL_LOCKED_MESSAGE) || routeSource.includes('TERMINAL_LOCKED_MESSAGE'),
  'checkout route.ts surfaces the shared lock message (verbatim or via the exported constant)',
);

console.log('✓ checkout-terminal-lock');
