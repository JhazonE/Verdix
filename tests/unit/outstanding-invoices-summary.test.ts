import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// The Outstanding Invoices tab's summary cards described only the page on
// screen, and summed the wrong column.
//
// Two defects, both in app/(app)/customer/payment/page.tsx:
//
//   1. `analytics` was a useMemo reducing over `invoices` — the CURRENT PAGE
//      (10 rows by default), because this tab paginates server-side. The card
//      nevertheless read "Total Outstanding ... Across N invoices" as though
//      it described the whole filtered set. Same defect class as commit
//      ac720c01 ("stop six reports describing only their first page of
//      data"), which this tab was not part of.
//
//   2. It accumulated `Number(inv.total)` — the invoice's face value — not the
//      unpaid remainder. Measured in MySQL on a two-invoice fixture
//      (1000 with 900 paid, plus 500 unpaid): SUM(total) = 1500 while the
//      real exposure SUM(total - amount_paid) = 600. The card overstated
//      outstanding debt by the amount already collected.
//
// Fixed by computing the summary in the endpoint, over every matching row,
// rather than shipping all rows to the client to reduce. Asserted on source
// text because the fix is SQL plus wiring and this suite has no database.

const read = (rel: string) =>
  fs.readFileSync(path.join(__dirname, '../..', rel), 'utf-8').replace(/\r\n/g, '\n');

const stripComments = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');

const routeRaw = read('app/api/customers/invoices/outstanding/route.ts');
const route = stripComments(routeRaw);
const pageRaw = read('app/(app)/customer/payment/page.tsx');
const page = stripComments(pageRaw);

// ─── the endpoint aggregates the whole filtered set ──────────────────────
assert.ok(
  /summarySql/.test(route),
  'the outstanding-invoices endpoint builds a summary query',
);
// The summary must wrap the SAME filtered subquery the count uses, so the
// totals and the row set cannot describe different populations.
assert.ok(
  /FROM\s*\(\$\{sql\}\)\s*AS\s+sub/i.test(route),
  "the summary aggregates over the filtered query itself (FROM (${sql}) AS sub), " +
    'so applying a filter narrows the totals and the rows together',
);
// The crucial column choice: the unpaid remainder, not the face value.
assert.ok(
  /SUM\(sub\.total\s*-\s*COALESCE\(sub\.amount_paid,\s*0\)\)/i.test(route),
  'totalOutstanding sums the UNPAID REMAINDER (total - amount_paid), not ' +
    'each invoice total — a 1000 invoice with 900 paid is 100 of exposure, ' +
    'not 1000',
);
assert.ok(
  /COALESCE\(SUM/i.test(route),
  'the sums are COALESCEd so an empty result set returns 0, not NULL',
);
// A NULL due_date must not count as overdue.
assert.ok(
  /due_date\s+IS\s+NOT\s+NULL/i.test(route),
  'overdue totals require a due date to exist, rather than treating a NULL ' +
    'as due now',
);
assert.ok(
  /due_date\s*<\s*CURDATE\(\)/i.test(route),
  'overdue is "due before today", the same test the row badges apply',
);
assert.ok(
  /summary,/.test(route),
  'the endpoint returns the summary alongside the page of rows',
);

// ─── the page consumes it instead of reducing over the page ──────────────
assert.ok(
  /result\.summary/.test(page),
  "the page reads the endpoint's summary",
);
// The regression to prevent: going back to reducing over the fetched rows.
assert.ok(
  !/invoices\.forEach/.test(page),
  'the page no longer reduces its summary over the `invoices` array, which ' +
    'holds only the current page',
);
assert.ok(
  !/totalCount:\s*invoices\.length/.test(page),
  '"Across N invoices" no longer counts the rows in hand',
);

// ─── changing a filter returns to page 1 ─────────────────────────────────
// Asking for page 5 of a result set the new filter cut to one page returns an
// empty array, so the table reads "no rows" while matches exist.
const resetEffects = page.match(/currentPage:\s*1\s*\}\s*\)\s*\)\s*;?\s*\n\s*\}\s*,\s*\[/g) || [];
assert.ok(
  /prev\.currentPage === 1 \? prev : \{ \.\.\.prev, currentPage: 1 \}/.test(page),
  'a filter change resets the page to 1 (guarded so it does not refetch when ' +
    'already on page 1)',
);
// Both tabs paginate server-side and both had the bug.
assert.ok(
  resetEffects.length >= 2 ||
    (page.match(/currentPage: 1 \}\)\)/g) || []).length >= 2,
  'both the Outstanding Invoices and Payment History tabs reset to page 1 on ' +
    'a filter change — fixing one and leaving the other is the same bug',
);

// ─── the badges and the cards must agree about "overdue" ─────────────────
assert.ok(
  /if \(!sale\.dueDate\) return/.test(page),
  'the row badge states outright that an invoice with no due date is not ' +
    'overdue, matching the endpoint, instead of substituting new Date() and ' +
    'letting a clock race decide',
);

console.log('✓ outstanding-invoices-summary');
