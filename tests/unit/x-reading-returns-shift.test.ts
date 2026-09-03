import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// X-reading's returns figure was always 0.00 for a second, distinct reason
// from the void bug (see x-reading-void-source.test.ts):
//
//   app/api/sales/returns/route.ts inserted its pos_transactions row WITHOUT a
//   shift_id column at all, so every return row carries shift_id = NULL. The
//   X-reading subquery is GROUP BY pt.shift_id, so those rows collapse into a
//   NULL group that joins to no shift and is silently discarded. Verified on
//   the live DB: all 7 'return' rows had shift_id NULL, totalling -1254.15,
//   attributed to no shift whatsoever.
//
// A return is a Merchandise Credit (see ReturnSuccessView / mc_number): the
// customer gets a credit slip, NOT cash from the drawer. So the returned value
// must be reported on its own RETURNS line and must never be mixed into the
// REFUND line or into cash reconciliation.
//
// Source-text assertions because the fix is in SQL and in an INSERT column
// list, neither of which a DB-less unit suite can execute. Same approach as
// checkout-terminal-lock.test.ts.

const read = (rel: string) =>
  fs.readFileSync(path.join(__dirname, '../..', rel), 'utf-8');

// Assertions here describe what the code DOES, so they must see executable
// code only — these files carry comments that deliberately name the removed
// REFUND line and the old broken predicates to explain why they went away,
// and matching that prose would fail the very fix it documents.
//
// Three things to strip, all of which have burned this test already:
//   - CRLF: these files are CRLF, and a trailing \r defeats a `$` anchor, so
//     normalise FIRST or the line comments survive.
//   - `/* */` and JSX `{/* */}` blocks, which span lines — a line-based strip
//     misses them entirely.
//   - `--` (SQL) and `//` (TS) line comments.
const stripComments = (src: string) =>
  src
    .replace(/\r\n/g, '\n')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '') // JSX {/* ... */}
    .replace(/\/\*[\s\S]*?\*\//g, '') // /* ... */
    .split('\n')
    .map((line) => line.replace(/--.*$/, '').replace(/\/\/.*$/, ''))
    .join('\n');

const returnsRoute = stripComments(read('app/api/sales/returns/route.ts'));
const returnsHook = stripComments(
  read('app/(app)/pos/return-sales/use-return-sales.ts'),
);
const xRoute = stripComments(read('app/api/sales/x-reading/route.ts'));
const generator = stripComments(read('lib/x-reading-generator.ts'));
const preview = stripComments(
  read('app/(app)/sales/x-reading/x-reading-preview.tsx'),
);

// ─── 1. the return must be attributed to a shift ─────────────────────────
const insertMatch = returnsRoute.match(
  /INSERT INTO pos_transactions\s*\(([\s\S]*?)\)\s*VALUES/,
);
assert.ok(insertMatch, 'returns route still inserts a pos_transactions row');
const insertColumns = insertMatch![1];

assert.ok(
  /\bshift_id\b/.test(insertColumns),
  'returns route records shift_id on its pos_transactions row — without it the ' +
    'row lands in a NULL group and the X-reading (GROUP BY shift_id) drops it entirely',
);

// The shift has to actually reach the server, not just be a column.
assert.ok(
  /shiftId/.test(returnsRoute),
  'returns route reads a shiftId from the request body',
);
assert.ok(
  /shiftId/.test(returnsHook),
  'the POS return caller sends the active shift id with the return',
);
assert.ok(
  /pos_current_shift_id/.test(returnsHook),
  'the caller sources the shift from pos_current_shift_id, the same key ' +
    'use-pos.ts writes the active shift to',
);

// ─── 2. the X-reading must report returns as a positive amount ───────────
// The stored total_amount is deliberately negative (money owed back to the
// customer). A report line printed as "RETURNS  -1,254.15" would read as a
// negative return; the magnitude belongs on the line, matching how VOID is
// printed as a positive figure.
assert.ok(
  /returns_amount/.test(xRoute),
  'X-reading still computes a per-shift returns_amount',
);
assert.ok(
  /ABS\s*\(/i.test(xRoute),
  'X-reading normalises the stored-negative return total to a positive ' +
    'reported figure, so RETURNS prints like VOID rather than as a negative',
);

// ─── 3. returns must reach the printed output ────────────────────────────
// Computing the figure is useless if neither print path renders it — the
// receipt previously had VOID and REFUND lines but no RETURNS line at all.
assert.ok(
  /RETURNS/.test(generator),
  'the ESC/POS X-reading generator prints a RETURNS line',
);
assert.ok(
  /RETURNS/.test(preview),
  'the on-screen X-reading preview shows a RETURNS line',
);

// ─── 4. returns must stay distinct from any refund concept ───────────────
// A Merchandise Credit is not cash out of the drawer, so the returned value
// must never be folded into a refund figure.
assert.ok(
  /VOID/.test(generator),
  'the VOID line survives alongside the new RETURNS line',
);
assert.ok(
  !/refund_amount[\s\S]{0,80}transaction_type\s*=\s*'return'/.test(xRoute),
  'returns are not folded into the refund figure — a Merchandise Credit is ' +
    'store credit, not cash returned',
);

// ─── 5. the dead REFUND line is gone from the printed X-reading ──────────
// This system has no refund feature at all: nothing ever writes
// transaction_type = 'refund' (only 'sale' and 'return' are written; the one
// route that takes a variable type has no callers), the DB held zero refund
// rows, and all 36 saved x_readings had refund_amount 0. Z-reading — the
// legally-filed report — prints no REFUND line either. A line that can only
// ever read 0.00 makes a cashier or auditor doubt the report rather than
// inform them, so it was removed from both print paths.
//
// The refund_amount COLUMN and the POST write path are deliberately kept, so
// no stored data shape changes and the line can be restored verbatim if a
// real refund feature is ever built.
assert.ok(
  !/REFUND/.test(generator),
  'the ESC/POS X-reading no longer prints a permanently-0.00 REFUND line',
);
assert.ok(
  !/REFUND/.test(preview),
  'the on-screen X-reading no longer shows a permanently-0.00 REFUND line',
);
assert.ok(
  /refund_amount/.test(xRoute),
  'the refund_amount column is still written by the POST path, so removing ' +
    'the display changes no stored data and stays reversible',
);

console.log('✓ x-reading-returns-shift');
