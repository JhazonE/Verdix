import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// The back-office "Sales by Date" report counted voided sales as revenue.
//
// Root cause: its WHERE clause was
//     WHERE pt.transaction_type = 'sale' AND pt.payment_status = 'completed'
// with no reference to sales_transactions.status at all. Voiding a sale never
// retypes or deletes its pos_transactions row — app/api/pos/void-transaction
// only flips sales_transactions.status to 'Voided' (see
// x-reading-void-source.test.ts, which pins that premise) — so a voided sale
// keeps transaction_type = 'sale' and sailed straight through this filter.
//
// Measured on the live database before the fix: 2026-11-04 had exactly one
// transaction, SI 000011 for PHP 145.00, voided. Sales by Date reported
// PHP 145.00 of revenue for that day; the X-reading and Z-reading for the same
// day both correctly reported 0.00. That is the mismatch users hit.
//
// The route also omitted `is_training = 0`, so training-mode sales — explicitly
// excluded from X-reading, Z-reading and bir-summary, and given no BIR number
// at checkout precisely because they are not real sales — would be reported as
// revenue too. Zero training rows exist today, which is why this had not been
// noticed yet; the first training session would have inflated the report.
//
// Asserted on route source text rather than by calling the route: the fix lives
// in SQL and the unit suite has no database, so a generator-level test cannot
// catch a query returning the wrong number. Same approach as
// x-reading-void-source.test.ts and checkout-terminal-lock.test.ts.

const read = (rel: string) =>
  fs.readFileSync(path.join(__dirname, '../..', rel), 'utf-8');

// Comments in these routes deliberately quote the old broken predicate to
// explain why it was wrong; matching that prose would pass on unfixed code and
// fail on fixed code. Strip comments before asserting on what the SQL does.
// These files are CRLF, so normalise first or the trailing \r defeats the
// `$`-anchored strip and the comments survive.
const stripComments = (src: string) =>
  src
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/--.*$/, '').replace(/\/\/.*$/, ''))
    .join('\n');

const byDate = stripComments(read('app/api/sales/by-date/route.ts'));
const xRoute = stripComments(read('app/api/sales/x-reading/route.ts'));

// ─── voided sales must not be reported as revenue ────────────────────────
// The status set must match the one the readings use, so the three reports
// cannot disagree about what counts as a sale.
assert.ok(
  /st\.status[\s\S]{0,40}NOT\s+IN/i.test(byDate),
  'Sales by Date excludes sales by sales_transactions.status, the column the ' +
    'void endpoint actually writes (it previously filtered on transaction_type ' +
    "and payment_status only, so a voided sale still counted as revenue)",
);

for (const status of ['Void', 'Voided', 'Cancelled', 'Returned']) {
  assert.ok(
    new RegExp(`'${status}'`).test(byDate),
    `Sales by Date's excluded-status set covers '${status}', matching the set ` +
      'X-reading and Z-reading use',
  );
}

// Excluding by status requires the join that supplies it. Without this the
// predicate above could only have been written against a column that is not
// in scope, which would fail at runtime rather than return a wrong number.
assert.ok(
  /JOIN\s+sales_transactions\s+st/i.test(byDate),
  'Sales by Date joins sales_transactions to reach the status column',
);

// ─── training-mode sales must not be reported as revenue ─────────────────
assert.ok(
  /pt\.is_training\s*=\s*0/.test(byDate),
  'Sales by Date excludes training-mode transactions, as X-reading, Z-reading ' +
    'and bir-summary all do — a training sale is not revenue and is issued no ' +
    'BIR number at checkout',
);

// ─── the reference the fix is matched against ────────────────────────────
// If X-reading ever stops excluding these, this report should not be the only
// one still doing it; these assertions keep the two from drifting apart again.
assert.ok(
  /st\.status[\s\S]{0,40}NOT\s+IN/i.test(xRoute) && /is_training\s*=\s*0/.test(xRoute),
  'X-reading (the working reference) excludes voided and training sales',
);

console.log('✓ sales-by-date-excludes-voids');
