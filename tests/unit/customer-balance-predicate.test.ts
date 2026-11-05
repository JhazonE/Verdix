import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  VOID_INVOICE_STATUSES,
  OPEN_INVOICE_SQL,
  COUNTABLE_INVOICE_SQL,
  isVoidInvoiceStatus,
  isOpenInvoice,
} from '../../lib/customer-balance';

// Three customer-facing money figures disagreed with each other because each
// query authored its own idea of which invoices are real debt.
//
// Root cause: there was no shared definition. `sales_invoices.status` is
//   enum('Paid','Pending','Failed','Shipped','Delivered','Returned',
//        'Partially Paid','Voided')
// and the void endpoint (app/api/sales/invoices/[id]/void/route.ts:76) writes
// exactly 'Voided'. But:
//
//   1. app/api/customers/balances/route.ts filtered only `status != 'Paid'`,
//      so a voided or returned invoice stayed on the customer's balance
//      forever. Verified against the live schema: of the statuses 'Voided',
//      'Returned', 'Pending' and 'Partially Paid', that predicate admits ALL
//      FOUR as debt.
//
//   2. app/api/reports/soa/route.ts filtered `status != 'Void'` — a value the
//      enum does not contain. Verified in MySQL: for status 'Voided', the
//      expression (status != 'Void') is 1, i.e. the row PASSES. The filter
//      that was meant to drop voided invoices never dropped a single one, in
//      both the opening-balance subquery and the in-range transaction list.
//      So the statement handed to a customer overstated what they owe.
//
//   3. app/api/customers/[id]/route.ts used BOTH spellings in one query:
//      credit_sales/total_payment excluded voided+returned via
//      `LOWER(status) NOT IN ('voided','returned')`, while `balance` used
//      `status != 'Paid'`. Verified in MySQL on a two-invoice fixture
//      (1000 Voided + 500 Pending): credit_sales = 500 but the balance basis
//      = 1500. The same screen could not reconcile with itself.
//
// The fix is one module both the SQL and any JS reader take their definition
// from, so the 'Void'/'Voided' typo cannot come back in one call site only.

// ─── the status set ──────────────────────────────────────────────────────
// 'Voided' is the value the void endpoint actually writes; it is the one that
// MUST be present. 'Void' and 'Cancelled' are tolerated spellings so legacy
// rows and the sales-report predicate agree with this one.
assert.ok(
  VOID_INVOICE_STATUSES.includes('Voided'),
  "the cancelled-invoice set contains 'Voided', the value " +
    'app/api/sales/invoices/[id]/void/route.ts writes — filtering on the ' +
    "enum-absent 'Void' alone is the original SOA bug",
);
assert.ok(
  VOID_INVOICE_STATUSES.includes('Returned'),
  "the cancelled-invoice set contains 'Returned' — a returned invoice is not " +
    'collectable debt, and the customer-detail route already excluded it from ' +
    'credit_sales while still counting it in balance',
);

// ─── isVoidInvoiceStatus: the JS-side reader ─────────────────────────────
for (const status of ['Voided', 'voided', 'VOIDED', 'Returned', 'returned']) {
  assert.equal(
    isVoidInvoiceStatus(status),
    true,
    `'${status}' is recognised as cancelled regardless of case — the detail ` +
      'route compared with LOWER() while others compared exact-case, which is ' +
      'how the two halves of one query came to disagree',
  );
}
for (const status of ['Paid', 'Pending', 'Partially Paid', 'Delivered', 'Shipped']) {
  assert.equal(
    isVoidInvoiceStatus(status),
    false,
    `'${status}' is a live invoice status and must not be treated as cancelled`,
  );
}
// Defensive: these routes read straight from the DB, where the column is
// nullable in older rows.
assert.equal(isVoidInvoiceStatus(null), false, 'a NULL status is not cancelled');
assert.equal(isVoidInvoiceStatus(undefined), false, 'a missing status is not cancelled');

// ─── isOpenInvoice: what lands on a balance ──────────────────────────────
// This is the whole bug in one assertion: a voided invoice owes nothing, no
// matter how much of its total went unpaid.
assert.equal(
  isOpenInvoice({ status: 'Voided', total: 1000, amount_paid: 0 }),
  false,
  'a VOIDED invoice is not open debt even with nothing paid against it — ' +
    'this is the case that kept customers owing money on cancelled invoices',
);
assert.equal(
  isOpenInvoice({ status: 'Returned', total: 1000, amount_paid: 0 }),
  false,
  'a RETURNED invoice is not open debt',
);
assert.equal(
  isOpenInvoice({ status: 'Pending', total: 1000, amount_paid: 0 }),
  true,
  'an unpaid Pending invoice is open debt',
);
assert.equal(
  isOpenInvoice({ status: 'Partially Paid', total: 1000, amount_paid: 400 }),
  true,
  'a part-paid invoice is still open for its remainder',
);
assert.equal(
  isOpenInvoice({ status: 'Paid', total: 1000, amount_paid: 1000 }),
  false,
  'a fully Paid invoice is not open',
);
// Status and amount must BOTH be respected: the old balances route required
// `status != 'Paid' AND amount_paid < total`, and dropping either half is a
// different wrong answer.
assert.equal(
  isOpenInvoice({ status: 'Pending', total: 1000, amount_paid: 1000 }),
  false,
  'an invoice settled in full is not open even if its status was never ' +
    'advanced to Paid — amount is checked as well as status',
);
assert.equal(
  isOpenInvoice({ status: 'Pending', total: 1000, amount_paid: null }),
  true,
  'a NULL amount_paid counts as nothing paid, not as a missing row',
);

// ─── the SQL fragments ───────────────────────────────────────────────────
// These are what the routes interpolate. They must name the real column and
// must not reintroduce the enum-absent 'Void' as their only void spelling.
for (const [name, frag] of [
  ['OPEN_INVOICE_SQL', OPEN_INVOICE_SQL],
  ['COUNTABLE_INVOICE_SQL', COUNTABLE_INVOICE_SQL],
] as const) {
  // Case-insensitive: the fragments compare LOWER(status) against lowercase
  // literals, so the assertion is that the STATUS IS NAMED, not how it is
  // cased. What must never happen is 'Void' being the only void spelling.
  assert.ok(
    /'voided'/i.test(frag),
    `${name} excludes 'Voided' explicitly — the spelling the void endpoint writes`,
  );
  assert.ok(
    /'returned'/i.test(frag),
    `${name} excludes 'Returned'`,
  );
  assert.ok(
    /\bstatus\b/.test(frag),
    `${name} filters on the status column`,
  );
}
// Only the open-invoice predicate should care about how much is still owed;
// the countable one is about which invoices exist at all (used for credit_sales
// totals), so folding amount_paid into it would silently drop paid invoices
// from a customer's sales history.
assert.ok(
  /amount_paid/.test(OPEN_INVOICE_SQL),
  'OPEN_INVOICE_SQL requires an unpaid remainder, not merely a non-Paid status',
);
// Verified in MySQL: (NULL < 1000) is NULL, not TRUE. Without COALESCE a row
// with a NULL amount_paid falls out of the predicate although it is wholly
// unpaid — the outstanding-invoices route had exactly that bare comparison.
assert.ok(
  /COALESCE\(\s*\w*\.?amount_paid\s*,\s*0\s*\)/i.test(OPEN_INVOICE_SQL),
  'OPEN_INVOICE_SQL wraps amount_paid in COALESCE so a NULL reads as nothing ' +
    'paid rather than making the whole comparison NULL',
);
assert.ok(
  !/amount_paid/.test(COUNTABLE_INVOICE_SQL),
  'COUNTABLE_INVOICE_SQL is about which invoices are real, not which are ' +
    'unpaid — it feeds credit_sales, which must include fully paid invoices',
);

// ─── the call sites actually use it ──────────────────────────────────────
// A shared predicate that one route still bypasses is the bug again. Assert on
// source text because the fix lives in SQL strings and this suite has no DB.
const read = (rel: string) =>
  fs.readFileSync(path.join(__dirname, '../..', rel), 'utf-8').replace(/\r\n/g, '\n');

const callSites = [
  'app/api/customers/balances/route.ts',
  'app/api/customers/[id]/route.ts',
  'app/api/reports/soa/route.ts',
  // The outstanding-invoice list had the same `status != 'Paid'` bug. It
  // matters twice: it is both the Outstanding Invoices tab and the source of
  // the Add Payment dialog's allocation rows, so a voided invoice showing up
  // here let a cashier allocate a real payment against a cancelled invoice.
  'app/api/customers/invoices/outstanding/route.ts',
];

for (const rel of callSites) {
  const src = read(rel);
  assert.ok(
    /from ['"]@\/lib\/customer-balance['"]/.test(src),
    `${rel} imports its invoice predicate from lib/customer-balance instead of ` +
      'spelling its own — three hand-written predicates is what let the ' +
      "'Void'/'Voided' typo survive in one of them",
  );
  // The specific regression: a bare `!= 'Void'` with no 'Voided' anywhere.
  // Comments in these files quote the old predicate to explain it, so strip
  // them first or the prose defeats the assertion.
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, '').replace(/--.*$/, ''))
    .join('\n');
  assert.ok(
    !/!=\s*'Void'/.test(code),
    `${rel} no longer compares against 'Void', a value absent from the ` +
      'sales_invoices status enum — that comparison is always true for a ' +
      "genuinely voided invoice ('Voided'), so it excluded nothing",
  );
}

console.log('✓ customer-balance-predicate');
