import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  calculateVoidRefund,
  realPaymentSql,
  NON_PAYMENT_TYPES,
  type VoidRefundInput,
} from '../../lib/void-refund';

// Voiding an invoice reversed stock and flipped the status, but did nothing
// about money the customer had already handed over. The SOA fix (28447a2f)
// made the statement honest — the voided invoice and its payments both stop
// counting — but the money itself was left stranded: paid for a sale that no
// longer exists, with no way to return it.
//
// This returns it as ACCOUNT CREDIT, matching what app/api/sales/exchanges
// already does when an exchange leaves the customer owed ("balance < 0
// credits their account").
//
// Cash refunds are deliberately NOT built here. Verified: nothing in this
// codebase writes transaction_type = 'refund' — lib/x-reading-generator says
// so explicitly and prints no REFUND line because the figure could only ever
// be 0.00. A cash refund has to move the drawer, alter the cashier's
// expected cash, and appear on the X- and Z-readings that are filed for BIR.
// That is a separate piece of work, not a line in a void handler.
//
// THE TRAP this module exists to avoid: the refund is NOT `amount_paid`.
// At checkout, available account credit is auto-applied to a charge invoice
// (app/api/pos/checkout) and RAISES amount_paid — but writes no
// payment_allocations row. Refunding amount_paid would therefore hand back
// credit the customer had already SPENT, inventing money. The refundable
// figure is the sum of real payment allocations only.

const input = (over: Partial<VoidRefundInput> = {}): VoidRefundInput => ({
  invoiceTotal: 1000,
  amountPaid: 0,
  allocations: [],
  ...over,
});

// ─── an unpaid charge refunds nothing ────────────────────────────────────
{
  const r = calculateVoidRefund(input({ amountPaid: 0 }));
  assert.equal(r.refundAmount, 0, 'voiding an unpaid invoice refunds nothing');
  assert.equal(r.shouldRefund, false, 'and performs no credit write at all');
}

// ─── a real payment is refunded ──────────────────────────────────────────
{
  const r = calculateVoidRefund(
    input({ amountPaid: 1000, allocations: [{ paymentId: 'P1', amount: 1000 }] }),
  );
  assert.equal(r.refundAmount, 1000, 'money actually received comes back');
  assert.equal(r.shouldRefund, true, 'so the account is credited');
}
{
  const r = calculateVoidRefund(
    input({ amountPaid: 400, allocations: [{ paymentId: 'P1', amount: 400 }] }),
  );
  assert.equal(r.refundAmount, 400, 'a part-payment is refunded in part');
}
// Several payments against one invoice add up.
{
  const r = calculateVoidRefund(
    input({
      amountPaid: 900,
      allocations: [
        { paymentId: 'P1', amount: 400 },
        { paymentId: 'P2', amount: 500 },
      ],
    }),
  );
  assert.equal(r.refundAmount, 900, 'every payment allocated to the invoice is refunded');
}

// ─── THE TRAP: auto-applied account credit is not refundable ─────────────
// amount_paid = 1000 but no allocation exists, because checkout applied the
// customer's own credit. Refunding it would give back credit they spent.
{
  const r = calculateVoidRefund(input({ amountPaid: 1000, allocations: [] }));
  assert.equal(
    r.refundAmount,
    0,
    'amount_paid with NO payment allocation behind it is account credit ' +
      'auto-applied at checkout, not money received — refunding it would ' +
      'hand back credit the customer had already spent, inventing money',
  );
  assert.equal(
    r.creditAutoApplied,
    1000,
    'the auto-applied portion is reported separately so the void handler can ' +
      'restore it correctly rather than treating it as a refund',
  );
}
// The mixed case: part credit, part real cash.
{
  const r = calculateVoidRefund(
    input({ amountPaid: 1000, allocations: [{ paymentId: 'P1', amount: 600 }] }),
  );
  assert.equal(r.refundAmount, 600, 'only the really-paid part is refunded');
  assert.equal(r.creditAutoApplied, 400, 'and the credit-funded part is identified as such');
  assert.equal(
    r.refundAmount + r.creditAutoApplied,
    1000,
    'together they account for the whole of amount_paid, so nothing is lost ' +
      'or double-counted',
  );
}

// ─── the total restored equals what left the account ─────────────────────
// Both halves go back to credit_balance — the auto-applied credit because it
// was never spent on a real sale, the cash because the sale is cancelled —
// so a void is value-neutral for the customer.
{
  const r = calculateVoidRefund(
    input({ amountPaid: 1000, allocations: [{ paymentId: 'P1', amount: 600 }] }),
  );
  assert.equal(
    r.totalCreditRestored,
    1000,
    'the customer is made whole: cash paid plus credit consumed both return ' +
      'to their account balance',
  );
}

// ─── allocations may not exceed amount_paid ──────────────────────────────
// A stale or duplicated allocation row must not refund more than the invoice
// ever received.
{
  const r = calculateVoidRefund(
    input({ amountPaid: 500, allocations: [{ paymentId: 'P1', amount: 900 }] }),
  );
  assert.equal(
    r.refundAmount,
    500,
    'the refund is capped at what the invoice actually recorded as paid, so a ' +
      'bad allocation row cannot overpay the customer',
  );
  assert.equal(r.creditAutoApplied, 0, 'and nothing is attributed to credit');
}

// ─── junk input creates no money ─────────────────────────────────────────
for (const bad of [null, undefined, NaN, -500]) {
  const r = calculateVoidRefund(input({ amountPaid: bad as any, allocations: [{ paymentId: 'P1', amount: 100 }] }));
  assert.equal(r.refundAmount, 0, `amount_paid of ${bad} refunds nothing`);
  assert.equal(r.shouldRefund, false, `and writes nothing`);
}
{
  const r = calculateVoidRefund(
    input({ amountPaid: 500, allocations: [{ paymentId: 'P1', amount: -100 }, { paymentId: 'P2', amount: 200 }] }),
  );
  assert.equal(r.refundAmount, 200, 'a negative allocation is ignored, not subtracted');
}

// ─── centavo arithmetic ──────────────────────────────────────────────────
{
  const r = calculateVoidRefund(
    input({
      amountPaid: 0.3,
      allocations: [{ paymentId: 'P1', amount: 0.1 }, { paymentId: 'P2', amount: 0.2 }],
    }),
  );
  assert.equal(r.refundAmount, 0.3, 'float drift does not shave a centavo off the refund');
  assert.equal(r.creditAutoApplied, 0, 'nor invent a fractional credit remainder');
}

// ─── the void route performs it ──────────────────────────────────────────
const route = fs
  .readFileSync(
    path.join(__dirname, '../..', 'app/api/sales/invoices/[id]/void/route.ts'),
    'utf-8',
  )
  .replace(/\r\n/g, '\n');

assert.ok(
  /from ['"]@\/lib\/void-refund['"]/.test(route),
  'the void route takes its refund figure from lib/void-refund rather than ' +
    'reading amount_paid directly',
);
assert.ok(
  /credit_balance/.test(route),
  'and credits customers.credit_balance, the same account an exchange credits ' +
    'when it leaves the customer owed',
);
assert.ok(
  /payment_allocations/.test(route),
  'it reads payment_allocations to tell money received from credit applied',
);
// Must be inside the existing transaction, so a failed void cannot leave a
// credit behind.
assert.ok(
  /withTransaction/.test(route),
  'the refund happens inside the void transaction, so a void that fails ' +
    'cannot leave the customer credited for a sale still standing',
);
// The customer row must be locked before its balance is changed.
assert.ok(
  /FOR UPDATE/.test(route),
  'the customer row is locked before credit_balance is updated, matching the ' +
    'rule the checkout and loyalty paths follow',
);
// An audit trail: a silent balance change is unexplainable at the counter.
assert.ok(
  /customer_payments|point_history|refund/i.test(route),
  'the refund is recorded, not just applied, so the credit on the account can ' +
    'be explained to the customer',
);

// ─── the refund record must not re-enter the balance ────────────────────
// This is the subtle half. The voided invoice already contributes 0, so a
// refund row that also counts is a double count. Measured: recording it as a
// NEGATIVE ordinary payment made the SOA close at +1000 on a fully-refunded
// 1000 invoice — the customer appeared to owe money they did not owe.
//
// The fix follows the convention already in place for CHARGE: record the row
// so the credit can be explained, and exclude it from every balance reader.

assert.ok(
  NON_PAYMENT_TYPES.includes('CHARGE' as any),
  "the non-payment set keeps 'CHARGE', the long-standing exclusion",
);
assert.ok(
  NON_PAYMENT_TYPES.includes('REFUND' as any),
  "and adds 'REFUND', so a void refund is recorded without being counted as " +
    'a payment — the voided invoice already accounts for the money',
);

// Case-insensitive, since payment_type is free text written by several paths.
// Verified in MySQL: Cash and GCash count; Charge, REFUND and Refund do not.
{
  const sql = realPaymentSql('cp');
  assert.ok(/UPPER\(cp\.payment_type\)/.test(sql), 'the comparison upper-cases the column');
  assert.ok(/NOT IN/.test(sql), 'and excludes the non-payment set');
  assert.ok(/'REFUND'/.test(sql), "naming 'REFUND' explicitly");
}

// A positive amount, not a negative one: the exclusion does the work, so the
// sign does not have to, and a negative row would read as money owed if any
// reader were ever added that forgot the filter.
assert.ok(
  /'REFUND'/.test(route),
  "the void route writes payment_type 'REFUND', the type every balance reader " +
    'excludes',
);
assert.ok(
  !/-refund\.totalCreditRestored/.test(route),
  'the refund row carries a POSITIVE amount — a negative ordinary payment ' +
    'double-counted against the already-zeroed invoice and made the SOA show ' +
    'a phantom debt',
);

// Both readers must apply it, or the row leaks into one set of books.
for (const rel of [
  'app/api/reports/soa/route.ts',
  'app/api/customers/payments/route.ts',
]) {
  const src = fs
    .readFileSync(path.join(__dirname, '../..', rel), 'utf-8')
    .replace(/\r\n/g, '\n');
  assert.ok(
    /realPaymentSql/.test(src),
    `${rel} filters customer_payments through realPaymentSql, so a refund row ` +
      'cannot be counted as a payment in one report and not another',
  );
  assert.ok(
    !/!=\s*'CHARGE'/.test(src),
    `${rel} no longer hand-writes its own CHARGE-only exclusion, which would ` +
      'silently let REFUND rows through',
  );
}

console.log('✓ void-invoice-refund');
