import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Z-reading's "Less Withdrawal:" line was a hardcoded literal string in BOTH
// renderers — `enc.line(row('Less Withdrawal:', '0.00'))` in the printed
// report and `<span>0.00</span>` in the preview — and the route never queried
// cash_transfers at all. So the filed BIR report claimed no cash was ever
// withdrawn from the drawer, no matter how many pickups the cashiers recorded.
//
// This is the same bug already fixed in X-reading (see
// x-reading-cash-transfers.test.ts), but it matters more here: the Z-reading is
// the LOCKED report used for BIR tax filing, and its stored z_readings row is
// what gets re-printed later. Two consequences:
//
//   1. The figure must be PERSISTED on the z_readings row (cash_pickup /
//      cash_deposit columns), not merely recomputed on read. A filed report
//      must keep reporting what it reported when it was filed — recomputing
//      from cash_transfers at read time would let a later edit rewrite a
//      filed report, exactly the mistake cost_at_sale 0-vs-NULL taught.
//   2. cashInDrawer must account for drawer movements, or OVER/SHORT is wrong
//      on every period containing a pickup.
//
// The working reference is app/api/pos/shifts/route.ts, which has always
// aggregated this table correctly for the End Shift dialog.
//
// Z-reading is scoped by DATE RANGE + TERMINAL (not by shift like X-reading),
// so the aggregate has to use that same scope, and must follow the route's
// own `startDate ? ' AND ... > ?'` / `<= ?` convention — a half-open window.
// Using BETWEEN or a closed lower bound would double count the boundary
// transfer into two consecutive Z-readings.
//
// This asserts on route source text because the fix lives in SQL, not in a
// pure function: the unit suite has no DB, and a generator-level test cannot
// catch a value pinned to a literal. Same approach as
// x-reading-void-source.test.ts.

const read = (rel: string) =>
  fs.readFileSync(path.join(__dirname, '../..', rel), 'utf-8');

const zRouteRaw = read('app/api/sales/z-reading/route.ts');
const shiftsRoute = read('app/api/pos/shifts/route.ts');
const preview = read('app/(app)/sales/z-reading/z-reading-preview.tsx');
const generator = read('lib/z-reading-generator.ts');
const types = read('lib/types.ts');
const migration = read('scripts/migrations/051_create_cash_transfers_table.ts');

// Assertions about what the query *does* must look at executable code only.
// These files' comments deliberately quote the old broken literals to explain
// why they were wrong, and matching that prose would fail the very fix it
// documents. Strip `-- ...` SQL and `// ...` TS comments first.
// Note: these files are CRLF, so normalise before the `$`-anchored strip or
// the trailing \r defeats it and the comments survive, silently turning these
// assertions into prose matches. Block/JSX comments span lines, so go first.
const stripComments = (src: string) =>
  src
    .replace(/\r\n/g, '\n')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '') // JSX {/* ... */}
    .replace(/\/\*[\s\S]*?\*\//g, '') // /* ... */
    .split('\n')
    .map((line) => line.replace(/--.*$/, '').replace(/\/\/.*$/, ''))
    .join('\n');

const zRoute = stripComments(zRouteRaw);
const gen = stripComments(generator);
const prev = stripComments(preview);

// ─── the premise this fix rests on ───────────────────────────────────────
assert.ok(
  /CREATE TABLE IF NOT EXISTS cash_transfers/.test(migration) &&
    /type\s+ENUM\('deposit',\s*'pickup'\)/.test(migration) &&
    /terminal_id\s+VARCHAR/.test(migration) &&
    /transaction_time\s+TIMESTAMP/.test(migration),
  'cash_transfers is still a terminal-stamped, time-stamped table with a ' +
    'deposit/pickup ENUM — the premise for aggregating pickups over a ' +
    "Z-reading's date range and terminal",
);
assert.ok(
  /FROM\s+cash_transfers/.test(stripComments(shiftsRoute)) &&
    /type\s*=\s*'pickup'/.test(stripComments(shiftsRoute)),
  'the End Shift route (the working reference) aggregates pickups from cash_transfers',
);

// ─── neither renderer may hardcode the withdrawal figure ─────────────────
assert.ok(
  !/'Less Withdrawal:',\s*'0\.00'/.test(gen),
  "the printed Z-reading no longer pins 'Less Withdrawal:' to the literal " +
    "string '0.00' — it was reporting on the filed BIR report that no cash " +
    'had ever been withdrawn from the drawer',
);
assert.ok(
  /Less Withdrawal/.test(gen) && /cashPickup/.test(gen),
  "the printed Z-reading renders cashPickup on its 'Less Withdrawal:' line",
);
assert.ok(
  !/Less Withdrawal:?\s*<\/span>\s*<span>\s*0\.00\s*<\/span>/.test(prev),
  'the Z-reading preview no longer renders a hardcoded 0.00 withdrawal',
);
assert.ok(
  /Less Withdrawal[\s\S]{0,120}?cashPickup/.test(prev),
  "the Z-reading preview renders cashPickup on its 'Less Withdrawal:' line",
);

// ─── SHORT/OVER was hardcoded too, in both renderers ────────────────────
// The route had been supplying `variance` (shifts.cash_difference, summed over
// the window) on all three of its paths all along, while both renderers
// printed the literal '0.00' — so a real cash discrepancy never reached the
// filed BIR report. This is the same figure the cashInDrawer fix below
// corrects, so it belongs with it: an expected-cash figure that ignored
// pickups would have made this line wrong even once it was wired up.
assert.ok(
  !/'SHORT\/OVER:',\s*'0\.00'/.test(gen),
  "the printed Z-reading no longer pins 'SHORT/OVER:' to the literal '0.00'",
);
assert.ok(
  /SHORT\/OVER[\s\S]{0,120}?variance/.test(gen),
  "the printed Z-reading renders the variance on its 'SHORT/OVER:' line",
);
assert.ok(
  !/SHORT\/OVER:?\s*<\/span>\s*<span>\s*0\.00\s*<\/span>/.test(prev),
  'the Z-reading preview no longer renders a hardcoded 0.00 SHORT/OVER',
);
assert.ok(
  /SHORT\/OVER[\s\S]{0,120}?variance/.test(prev),
  "the Z-reading preview renders the variance on its 'SHORT/OVER:' line",
);
assert.ok(
  /export interface ZReadingData[\s\S]{0,2200}?variance\??:\s*number/.test(types),
  'ZReadingData declares variance, the field the route was already sending',
);

// ─── the route must read the table that is actually written ──────────────
assert.ok(
  /FROM\s+cash_transfers/.test(zRoute),
  'Z-reading reads cash movements from cash_transfers, the table the POS Cash ' +
    'Transfer dialog actually writes',
);
assert.ok(
  /type\s*=\s*'pickup'/.test(zRoute) && /type\s*=\s*'deposit'/.test(zRoute),
  'Z-reading separates pickups from deposits by the same ENUM values the End ' +
    'Shift route and X-reading use, so the reports cannot disagree',
);

// Both the GET (preview) and POST (commit/file) paths compute the report, and
// a figure that appeared only on the preview but not on the filed row — or
// vice versa — would mean the printed report disagreed with the BIR record.
const cashTransferReads = (zRoute.match(/FROM\s+cash_transfers/g) || []).length;
assert.ok(
  cashTransferReads >= 2,
  'BOTH the GET (preview) and POST (commit) paths aggregate cash_transfers — ' +
    `found ${cashTransferReads}; a figure present on only one path means the ` +
    'printed Z-reading and the filed z_readings row disagree',
);

// ─── scope: the same date-range + terminal window as the rest of the report
// Z-reading windows are half-open (`> startDate` .. `<= endDate`) so a
// transfer on the boundary lands in exactly one reading, never two.
// One path builds its WHERE clause by concatenation BEFORE the query literal
// (`transferWhere += ' AND terminal_id = ?'`) and the other inlines it after
// FROM, so a window that only looks forward from `FROM cash_transfers` misses
// the first one's predicates entirely and fails on correct code. Window around
// each occurrence instead — behind as well as ahead.
const transferWindows = (() => {
  const out: string[] = [];
  const needle = /FROM\s+cash_transfers/g;
  let m: RegExpExecArray | null;
  while ((m = needle.exec(zRoute)) !== null) {
    out.push(zRoute.slice(Math.max(0, m.index - 900), m.index + 400));
  }
  return out;
})();

for (const [i, block] of transferWindows.entries()) {
  assert.ok(
    /terminal_id\s*=\s*\?/.test(block),
    `cash_transfers aggregate #${i + 1} is scoped to the terminal being reported`,
  );
  assert.ok(
    /transaction_time\s*>\s*\?/.test(block) && /transaction_time\s*<=\s*\?/.test(block),
    `cash_transfers aggregate #${i + 1} uses the half-open ` +
      '(> startDate, <= endDate) window the rest of the Z-reading uses, so a ' +
      'boundary transfer is not counted into two consecutive readings',
  );
}

// ─── the filed row must PERSIST the figure, not recompute it on read ─────
assert.ok(
  /\{\s*name:\s*'cash_pickup'/.test(zRoute) && /\{\s*name:\s*'cash_deposit'/.test(zRoute),
  'ensureZReadingsSchema adds cash_pickup/cash_deposit columns, so a filed ' +
    'Z-reading keeps the figure it was filed with',
);
assert.ok(
  /INSERT INTO z_readings[\s\S]{0,1200}?cash_pickup/.test(zRoute),
  'the z_readings INSERT persists cash_pickup on the filed row',
);
assert.ok(
  /cashPickup:\s*safeParseFloat\(row\.cash_pickup\)/.test(zRoute),
  'the stored-row read path reports the PERSISTED cash_pickup from the filed ' +
    'row, never a fresh recomputation — a filed report must keep reporting ' +
    'what it reported when it was filed',
);

// ─── OVER/SHORT must account for drawer movements ────────────────────────
// A pickup takes cash OUT of the drawer. Omitting it from expected cash makes
// every period with a pickup report a phantom SHORT for exactly that amount.
const drawerFormulas = zRoute.match(/const\s+cashInDrawer\s*=\s*[^;]+;/g) || [];
assert.ok(
  drawerFormulas.length >= 2,
  `both the GET and POST paths compute cashInDrawer — found ${drawerFormulas.length}`,
);
for (const [i, formula] of drawerFormulas.entries()) {
  assert.ok(
    /cashPickup/.test(formula) && /-/.test(formula),
    `cashInDrawer formula #${i + 1} subtracts cashPickup (${formula.trim()}), ` +
      'so a recorded pickup does not read as a phantom SHORT',
  );
  assert.ok(
    /cashDeposit/.test(formula),
    `cashInDrawer formula #${i + 1} adds cashDeposit (${formula.trim()})`,
  );
}

// ─── the type must carry the field ───────────────────────────────────────
assert.ok(
  /export interface ZReadingData[\s\S]{0,2000}?cashPickup\??:\s*number/.test(types),
  'ZReadingData declares cashPickup, so both renderers type-check against it',
);

console.log('✓ z-reading-cash-transfers');
