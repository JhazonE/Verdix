import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// X-reading's WITHDRAWAL line (and its "Less Withdrawal:" counterpart in the
// TRANSACTION SUMMARY) always printed 0.00 even when the cashier had recorded
// real cash pickups during the shift. Root cause: the X-reading GET never
// queried cash_transfers at all — it returned two hardcoded literals in the
// response object:
//     cashDeposit: 0,
//     cashPickup: 0,
// Every consumer downstream was already correct and ready for the real value:
// x-reading-preview.tsx renders `data.cashPickup` twice, and
// lib/x-reading-generator.ts prints it on the WITHDRAWAL and
// "Less Withdrawal:" lines. They were all faithfully displaying a constant.
//
// The working reference is app/api/pos/shifts/route.ts, which has always
// aggregated the same table correctly for the End Shift dialog:
//     SUM(CASE WHEN type = 'deposit' THEN amount ELSE 0 END) as total_deposits,
//     SUM(CASE WHEN type = 'pickup'  THEN amount ELSE 0 END) as total_pickups
//   FROM cash_transfers WHERE shift_id = ?
// That divergence is why End Shift showed "Cash Pickups (Out)" correctly while
// the X-reading of the very same shift reported 0.00.
//
// This asserts on route source text because the fix lives in SQL, not in a
// pure function: the unit suite has no DB, and a generator-level test cannot
// catch a response field pinned to a literal. Same approach as
// x-reading-void-source.test.ts, which fixed the structurally-identical VOID
// bug in this same file.

const read = (rel: string) =>
  fs.readFileSync(path.join(__dirname, '../..', rel), 'utf-8');

const xRouteRaw = read('app/api/sales/x-reading/route.ts');
const shiftsRoute = read('app/api/pos/shifts/route.ts');
const preview = read('app/(app)/sales/x-reading/x-reading-preview.tsx');
const generator = read('lib/x-reading-generator.ts');
const migration = read('scripts/migrations/051_create_cash_transfers_table.ts');

// Assertions about what the query *does* must look at executable SQL only.
// This route's comments deliberately quote the old broken literals to explain
// why they were wrong, and matching that prose would fail the very fix it
// documents. Strip `-- ...` SQL comments and `// ...` TS comments first.
// Note: these files are CRLF, so normalise before the `$`-anchored strip or
// the trailing \r defeats it and the comments survive, silently turning these
// assertions into prose matches. Block comments span lines, so they go first.
const stripComments = (src: string) =>
  src
    .replace(/\r\n/g, '\n')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '') // JSX {/* ... */}
    .replace(/\/\*[\s\S]*?\*\//g, '') // /* ... */
    .split('\n')
    .map((line) => line.replace(/--.*$/, '').replace(/\/\/.*$/, ''))
    .join('\n');

const xRoute = stripComments(xRouteRaw);

// ─── the premise this fix rests on ───────────────────────────────────────
// Pickups live in cash_transfers, keyed by shift, typed by an ENUM whose
// 'pickup' member is what the POS Cash Transfer dialog writes. If that schema
// changes, the aggregate below changes with it.
assert.ok(
  /CREATE TABLE IF NOT EXISTS cash_transfers/.test(migration) &&
    /type\s+ENUM\('deposit',\s*'pickup'\)/.test(migration) &&
    /shift_id\s+VARCHAR/.test(migration),
  'cash_transfers is still a shift-keyed table with a deposit/pickup ENUM — ' +
    'the premise for aggregating pickups per shift',
);

// ─── the working reference still works that way ──────────────────────────
assert.ok(
  /FROM\s+cash_transfers/.test(stripComments(shiftsRoute)) &&
    /type\s*=\s*'pickup'/.test(stripComments(shiftsRoute)),
  'the End Shift route (the working reference) aggregates pickups from cash_transfers',
);

// ─── X-reading must no longer pin the figures to a literal ───────────────
assert.ok(
  !/cashPickup:\s*0\s*,/.test(xRoute),
  'X-reading no longer returns cashPickup as the hardcoded literal 0, which ' +
    'made the WITHDRAWAL line structurally always 0.00',
);
assert.ok(
  !/cashDeposit:\s*0\s*,/.test(xRoute),
  'X-reading no longer returns cashDeposit as the hardcoded literal 0',
);

// ─── X-reading must read them from the table that is actually written ────
assert.ok(
  /FROM\s+cash_transfers/.test(xRoute),
  'X-reading reads cash movements from cash_transfers, the table the POS Cash ' +
    'Transfer dialog actually writes',
);
assert.ok(
  /type\s*=\s*'pickup'/.test(xRoute) && /type\s*=\s*'deposit'/.test(xRoute),
  'X-reading separates pickups from deposits by the same ENUM values the End ' +
    'Shift route uses, so the two reports cannot disagree about a shift',
);

// The figure must stay scoped to the shift being reported. A shift-scoped
// report that summed every pickup in the database would be worse than 0.00.
assert.ok(
  /cash_transfers[\s\S]{0,400}?shift_id\s+IN\s*\(/.test(xRoute),
  'the cash_transfers aggregate is scoped to the reported shifts by shift_id',
);

// ─── and it must not reintroduce the per-shift query fan-out ─────────────
// This route previously issued two queries per shift inside a
// Promise.all(shifts.map(...)), which saturated the 25-connection pool on the
// back-office page (which sends no `limit`) and hung forever with no error.
// The cash_transfers read must be one grouped query like payments/membership,
// not a per-shift one inside the map.
const cashTransfersBlock = xRoute.slice(xRoute.indexOf('FROM cash_transfers'));
assert.ok(
  /GROUP BY\s+shift_id/.test(cashTransfersBlock.slice(0, 400)),
  'the cash_transfers read is a single GROUP BY shift_id query, not one per ' +
    'shift — a per-shift fan-out is what previously saturated the pool',
);
assert.ok(
  !/shifts\.map\([\s\S]{0,600}?FROM\s+cash_transfers/.test(xRoute),
  'the cash_transfers query is not issued inside the per-shift map',
);

// ─── the consumers were always correct; keep them wired ─────────────────
assert.ok(
  /data\.cashPickup/.test(preview),
  'the X-reading preview still renders cashPickup (WITHDRAWAL / Less Withdrawal)',
);
assert.ok(
  /cashPickup/.test(generator),
  'the printed X-reading still prints cashPickup on the WITHDRAWAL line',
);

console.log('✓ x-reading-cash-transfers');
