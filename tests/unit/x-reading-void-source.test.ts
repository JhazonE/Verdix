import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// X-reading's VOID line always printed 0.00 even when the shift genuinely had
// voided sales. Root cause: the X-reading GET derived void_amount from
//     SUM(CASE WHEN pt.transaction_type = 'void' THEN pt.total_amount ELSE 0 END)
// but nothing in this codebase ever writes a pos_transactions row with
// transaction_type = 'void'. Voiding a sale (app/api/pos/void-transaction)
// only flips sales_transactions.status to 'Voided' — it inserts no new
// pos_transactions row and rewrites no existing one's type. So that CASE never
// matched and the sum was structurally always 0.
//
// Z-reading (app/api/sales/z-reading/route.ts) already reads voids from the
// column that is actually written — st.status IN ('Void','Voided','Cancelled')
// — which is why Z-reading showed the right figure while X-reading did not.
// X-reading must use that same source of truth.
//
// This asserts on route source text because the fix lives in SQL, not in a
// pure function: the unit suite has no DB, and a generator-level test cannot
// catch a query that returns the wrong number. Same approach as
// checkout-terminal-lock.test.ts.

const read = (rel: string) =>
  fs.readFileSync(path.join(__dirname, '../..', rel), 'utf-8');

const xRouteRaw = read('app/api/sales/x-reading/route.ts');
const zRoute = read('app/api/sales/z-reading/route.ts');
const voidRoute = read('app/api/pos/void-transaction/route.ts');

// Assertions about what the query *does* must look at executable SQL only.
// Comments in these routes deliberately name the old broken predicate to
// explain why it was wrong, and matching that prose would fail the fix it
// documents. Strip `-- ...` SQL comments and `// ...` TS comments first.
// Note: these files are CRLF, so normalise first — otherwise the trailing \r
// left on each line defeats the `$`-anchored comment strip and the comments
// survive, silently turning these assertions into prose matches. Block and
// JSX comments span lines, so they must go before the line-based pass.
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
// If voiding ever starts writing a real 'void' pos_transactions row, the
// status-based approach would double count and this test should be revisited.
assert.ok(
  !/transaction_type\s*['"`)\s]*,?\s*['"]void['"]/.test(voidRoute) &&
    !voidRoute.includes('INSERT INTO pos_transactions'),
  'void-transaction still records a void purely as a sales_transactions.status flip, ' +
    'inserting no pos_transactions row — the premise for reading voids from st.status',
);
assert.ok(
  voidRoute.includes('status = "Voided"') || voidRoute.includes("status = 'Voided'"),
  'void-transaction sets sales_transactions.status to Voided',
);

// ─── X-reading must not read voids from the never-written column ─────────
assert.ok(
  !/transaction_type\s*=\s*['"]void['"]/.test(xRoute),
  "X-reading no longer derives void_amount from pt.transaction_type = 'void', " +
    'a value nothing ever writes (it made the VOID line structurally always 0.00)',
);

// ─── X-reading must read voids from the same source Z-reading uses ───────
const VOID_STATUS_PREDICATE = /st\.status\s+IN\s*\(\s*'Void'\s*,\s*'Voided'\s*,\s*'Cancelled'\s*\)/;

assert.ok(
  VOID_STATUS_PREDICATE.test(zRoute),
  'Z-reading (the working reference) matches voids by sales_transactions.status',
);
assert.ok(
  VOID_STATUS_PREDICATE.test(xRoute),
  'X-reading matches voids by the same st.status set as Z-reading, so the two ' +
    'reports can never disagree about what counts as a void',
);

// The void figure must still be the voided sale's own total, and must stay
// scoped to the shift being reported — a shift-scoped report that summed
// every void in the database would be worse than printing 0.00.
assert.ok(
  /void_amount/.test(xRoute) && /shift_id/.test(xRoute),
  'X-reading still computes a per-shift void_amount',
);

// ─── voids must not leak into the sales figures ──────────────────────────
// A voided sale keeps its original pos_transactions row (type 'sale'), so
// every sales aggregate has to exclude voided statuses explicitly or a void
// would still be counted as revenue while also being reported as a void.
assert.ok(
  /transaction_type\s*=\s*'sale'\s+AND\s+[\s\S]{0,200}?status/i.test(xRoute) ||
    xRoute.includes('NOT_VOIDED') ||
    /st\.status\s+NOT\s+IN/.test(xRoute),
  'X-reading sales aggregates exclude voided sales, so a void is not counted ' +
    'as revenue and as a void at the same time',
);

console.log('✓ x-reading-void-source');
