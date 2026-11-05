import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// X-reading filed a shift's sales under the date the SHIFT OPENED rather than
// the date each sale was actually rung up, so its daily figures did not match
// the back-office sales reports.
//
// Root cause: the route dated every shift by s.start_time —
//     SELECT s.start_time as report_date, ...
//     ... AND DATE(s.start_time) >= ?   /  <= ?
// — and the per-shift sales subquery grouped by shift_id alone, with no date
// dimension. A shift that stays open across midnight therefore attributes all
// of its sales, however many days they span, to its opening date.
//
// Measured on the live database: SHIFT-1792543969257-dwhy3 opened 2026-10-21
// and was not closed until 2026-10-30, taking six sales totalling PHP 5,790.00
// across that window. X-reading X-20261030-001 filed the whole PHP 5,790.00 as
// 2026-10-21. The back-office reports — correctly dating each sale by
// pt.transaction_time — split the same money as PHP 800.00 on 2026-10-22 and
// PHP 4,990.00 on 2026-10-30. Nothing was lost, but no single day agreed, and
// for BIR filing the revenue sits on the wrong days.
//
// Long-open shifts are not an edge case here: a cashier who forgets to end a
// shift produces one, and on this data four of five shifts were same-day while
// the fifth spanned nine days.
//
// The fix: date a sale by pt.transaction_time, the moment of the sale, which is
// what every back-office report already uses. A date filter on an X-reading
// must select the sales that fall in the range, not the shifts that opened in
// it.
//
// Asserted on route source text: the fix lives in SQL and the unit suite has no
// database. Same approach as x-reading-void-source.test.ts.

const read = (rel: string) =>
  fs.readFileSync(path.join(__dirname, '../..', rel), 'utf-8');

// Comments in this route deliberately quote the old s.start_time filter to
// explain why it was wrong; strip prose before asserting on the SQL.
// CRLF files: normalise first or the trailing \r defeats the `$` anchor.
const stripComments = (src: string) =>
  src
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/--.*$/, '').replace(/\/\/.*$/, ''))
    .join('\n');

const xRoute = stripComments(read('app/api/sales/x-reading/route.ts'));
const byDate = stripComments(read('app/api/sales/by-date/route.ts'));

// ─── a date range must select sales, not shift openings ──────────────────
assert.ok(
  !/DATE\(\s*s\.start_time\s*\)\s*(>=|<=)/.test(xRoute),
  "X-reading's date range no longer filters on DATE(s.start_time) — a shift " +
    'left open across midnight attributed every later sale to its opening date ' +
    '(live: nine days and PHP 5,790.00 filed as a single 2026-10-21 figure)',
);

assert.ok(
  /pt\.transaction_time/.test(xRoute),
  'X-reading dates a sale by pt.transaction_time, the moment of the sale, as ' +
    'every back-office sales report already does',
);

// The date range must reach the sales themselves. Filtering only the outer
// shift row cannot narrow which sales within a shift are counted.
//
// The bound is expressed against the subquery's sale_date column — derived from
// DATE(pt.transaction_time) in the aggregate below — because an outer WHERE
// cannot repeat the inner expression. COALESCE to the shift's opening date so a
// shift that took no sales (sale_date IS NULL) is still reachable by date
// rather than dropping out of every dated query.
assert.ok(
  /sales\.sale_date[\s\S]{0,80}(>=|<=)/.test(xRoute),
  "X-reading's startDate/endDate bounds apply to the sales' own date, so a " +
    'range selects the sales that happened in it rather than the shifts that ' +
    'opened in it',
);
assert.ok(
  /sale_date[\s\S]{0,120}DATE\(\s*pt\.transaction_time\s*\)|DATE\(\s*pt\.transaction_time\s*\)\s*(as|AS)\s*sale_date/.test(
    xRoute,
  ),
  'that sale_date is DATE(pt.transaction_time), the moment of the sale',
);
assert.ok(
  /COALESCE\(\s*DATE\(\s*sales\.sale_date\s*\)\s*,\s*DATE\(\s*s\.start_time\s*\)\s*\)\s*(>=|<=)/.test(
    xRoute,
  ),
  'a shift that took no sales stays reachable by its opening date, instead of ' +
    'being dropped by every dated query',
);

// ─── and the figures must be grouped by that same date ───────────────────
// Grouping by shift_id alone collapses a multi-day shift into one row, which is
// what made the per-day figures unobtainable regardless of the filter above.
assert.ok(
  /GROUP BY[\s\S]{0,120}pt\.transaction_time/.test(xRoute),
  'the per-shift sales aggregate carries a date dimension, so a shift spanning ' +
    'two days reports each day separately instead of collapsing to its ' +
    'opening date',
);

// ─── the reference the fix is matched against ────────────────────────────
assert.ok(
  /DATE\(\s*pt\.transaction_time\s*\)/.test(byDate),
  'Sales by Date (the back-office reference X-reading must agree with) dates a ' +
    'sale by pt.transaction_time',
);

// ─── the other fixes in this area must stay in place ─────────────────────
// Re-dating must not quietly drop the void and training exclusions that
// x-reading-void-source.test.ts established.
assert.ok(
  /st\.status[\s\S]{0,40}NOT\s+IN/i.test(xRoute) && /is_training\s*=\s*0/.test(xRoute),
  'X-reading still excludes voided and training sales from its revenue figures',
);

console.log('✓ x-reading-date-attribution');
