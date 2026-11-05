import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Z-reading's RETURNS figure reported the wrong amount on the wrong day,
// because it read the ORIGINAL SALE's row instead of the return's own row.
//
// A return (app/api/sales/returns) inserts a NEW pos_transactions row with
// transaction_type = 'return' and total_amount = -refundedAmount, reusing the
// original sale's sale_id so the two stay linked. It does NOT create a
// sales_transactions row of its own, and it leaves the original sale's
// st.total untouched. Only a FULL return flips that sale's status to
// 'Returned'.
//
// Z-reading's returns query was:
//     SELECT SUM(st.total) FROM sales_transactions st
//     JOIN pos_transactions pt ON st.id = pt.sale_id
//     WHERE st.status = 'Returned' ... AND st.created_at BETWEEN ...
//
// Three things go wrong at once:
//
//   1. WRONG AMOUNT — st.total is the whole original sale, not the amount
//      actually refunded. Measured live: SI 000010 was a PHP 1,025.00 sale
//      with a PHP 165.00 partial return. This query would report PHP 1,025.00
//      returned, over-reporting the refund more than sixfold.
//
//   2. WRONG DAY — it filters on st.created_at, the date of the ORIGINAL SALE,
//      while the sibling return/void sequence queries in the same route filter
//      on pt.created_at. Live: that sale is 2026-11-03 and its return is
//      2026-11-04, so the refund lands in the wrong Z-reading period.
//
//   3. PARTIAL RETURNS INVISIBLE — a partial return leaves status = 'Paid', so
//      `WHERE st.status = 'Returned'` skips it entirely. Live: the PHP 165.00
//      refund above was reported as 0.00 returns.
//
// The 1+2 combination is also what made a day's totals not add up: joining the
// return row back to its original sales_transactions row pulled that sale's
// full total into the Nov 3 bucket a second time, so the Z-reading basis showed
// PHP 8,810 where real sales were PHP 7,785 — a PHP 1,025 phantom, exactly the
// original sale counted twice.
//
// The fix: sum the return's OWN money from its own row, dated by its own time,
// exactly as X-reading's returns_amount already does:
//     ABS(SUM(CASE WHEN pt.transaction_type = 'return' THEN pt.total_amount ...
//
// Asserted on route source text: the fix lives in SQL and the unit suite has no
// database. Same approach as x-reading-void-source.test.ts.

const read = (rel: string) =>
  fs.readFileSync(path.join(__dirname, '../..', rel), 'utf-8');

// Comments here deliberately quote the old broken query to explain why it was
// wrong, so prose must be stripped before asserting on what the SQL does.
// CRLF files: normalise first or the trailing \r defeats the `$` anchor.
const stripComments = (src: string) =>
  src
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/--.*$/, '').replace(/\/\/.*$/, ''))
    .join('\n');

const zRoute = stripComments(read('app/api/sales/z-reading/route.ts'));
const xRoute = stripComments(read('app/api/sales/x-reading/route.ts'));
const returnsRoute = stripComments(read('app/api/sales/returns/route.ts'));

// ─── the premise this fix rests on ───────────────────────────────────────
// A return is its own pos_transactions row carrying its own negative amount.
// If returns ever start writing their own sales_transactions row, or stop
// storing the refund on the return row, revisit this test.
assert.ok(
  /transaction_type[\s\S]{0,400}'return'/.test(returnsRoute) &&
    /INSERT INTO pos_transactions/.test(returnsRoute),
  "a return inserts its own pos_transactions row typed 'return'",
);
assert.ok(
  !/INSERT INTO sales_transactions/.test(returnsRoute),
  'a return creates no sales_transactions row of its own, so the original ' +
    "sale's st.total is not the refunded amount",
);

// ─── Z-reading must take the refund from the return's own row ────────────
assert.ok(
  /total_returns[\s\S]{0,400}pt\.transaction_type\s*=\s*'return'/.test(zRoute) ||
    /pt\.transaction_type\s*=\s*'return'[\s\S]{0,400}total_returns/.test(zRoute),
  "Z-reading's returns figure is computed from rows typed 'return', not from " +
    "the original sale's status (a partial return leaves status = 'Paid' and " +
    'was therefore invisible)',
);

// The refunded money is pt.total_amount on that row. st.total is the original
// sale and must not be the source of the returns figure.
assert.ok(
  !/total_returns[\s\S]{0,120}SUM\(\s*st\.total\s*\)/.test(zRoute),
  "Z-reading no longer sums st.total for returns — that is the whole original " +
    'sale, not the amount refunded (live: PHP 1,025.00 reported for a ' +
    'PHP 165.00 refund)',
);

// ─── and must date it by the return's own time, not the sale's ───────────
// st.created_at is the original sale's date. The refund belongs to the period
// in which it was given, which is what the sibling void/return sequence
// queries in this same route already use.
assert.ok(
  /total_returns[\s\S]{0,400}pt\.created_at/.test(zRoute) ||
    /returnsSql[\s\S]{0,600}pt\.created_at/.test(zRoute),
  "Z-reading dates a return by the return row's own timestamp, not by " +
    "st.created_at (the original sale's date), so a refund given the day after " +
    'the sale falls in the right Z-reading period',
);

// ─── X-reading is the working reference ──────────────────────────────────
// X-reading has always computed returns correctly, from the return row's own
// negative total_amount. Z-reading must agree with it.
assert.ok(
  /transaction_type\s*=\s*'return'[\s\S]{0,80}pt\.total_amount/.test(xRoute),
  "X-reading (the working reference) sums the return row's own total_amount",
);

console.log('✓ z-reading-returns-source');
