import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  planAllocations,
  invoiceStatusFor,
  type InvoiceState,
} from '../../lib/payment-allocation';

// A customer overpaying through the back-office Add Payment dialog lost the
// excess.
//
// Root cause: app/api/customer-payments tracked the undistributed part of the
// payment in a local `remainingPayment` and then never read it after the
// allocation loop. The full amount was written to customer_payments.amount,
// but nothing was added to customers.credit_balance. Customer Balances nets
// outstanding invoices against credit_balance (app/api/customers/balances),
// so the money was invisible there: Payment History showed the payment as
// "Unallocated" while the customer's balance did not move.
//
// The sibling route app/api/customers/payments — the one the POS
// customer-account dialog posts to — already did this correctly via its
// `creditDelta`. Two endpoints, two behaviours, same user-visible feature.

const inv = (invoiceId: string, total: number, amountPaid = 0): InvoiceState => ({
  invoiceId,
  total,
  amountPaid,
});
const map = (...states: InvoiceState[]) =>
  new Map(states.map((s) => [s.invoiceId, s]));

// ─── the bug: an overpayment must survive as credit ──────────────────────
{
  const plan = planAllocations(1000, [{ invoiceId: 'A', amountAllocated: 800 }], map(inv('A', 800)));
  assert.equal(plan.applied.length, 1, 'the invoice is settled');
  assert.equal(plan.applied[0].appliedAmount, 800, 'it takes exactly what it owed');
  assert.equal(
    plan.unallocated,
    200,
    'the 200 the invoice could not absorb is reported as unallocated so the ' +
      'caller can credit it — this is the money the route used to drop',
  );
}

// Nothing allocated at all: the whole payment is credit. This is the "customer
// has no outstanding invoices" case the dialog explicitly supports.
{
  const plan = planAllocations(500, [], map());
  assert.equal(plan.applied.length, 0, 'nothing is applied');
  assert.equal(plan.unallocated, 500, 'the entire payment becomes account credit');
}

// ─── allocations may never exceed the payment ────────────────────────────
// Guards against the opposite failure: inventing money the customer never
// handed over, which would mark invoices paid for free.
{
  const plan = planAllocations(
    500,
    [
      { invoiceId: 'A', amountAllocated: 400 },
      { invoiceId: 'B', amountAllocated: 400 },
    ],
    map(inv('A', 400), inv('B', 400)),
  );
  const total = plan.applied.reduce((s, a) => s + a.appliedAmount, 0);
  assert.equal(total, 500, 'the applied total is capped at the payment amount');
  assert.equal(plan.applied[0].appliedAmount, 400, 'the first request is met in full');
  assert.equal(plan.applied[1].appliedAmount, 100, 'the second gets only what is left');
  assert.equal(plan.unallocated, 0, 'nothing is left over');
  assert.equal(plan.applied[1].newStatus, 'Partially Paid', 'B is part-paid, not Paid');
}

// ─── an invoice may never be overpaid ────────────────────────────────────
{
  const plan = planAllocations(1000, [{ invoiceId: 'A', amountAllocated: 999 }], map(inv('A', 300, 100)));
  assert.equal(plan.applied[0].appliedAmount, 200, 'capped to the 200 still owed');
  assert.equal(plan.applied[0].newAmountPaid, 300, 'amount_paid lands exactly on total');
  assert.equal(plan.applied[0].newStatus, 'Paid', 'and the invoice reads Paid');
  assert.equal(plan.unallocated, 800, 'the rest is credit, not an overpaid invoice');
}

// The same invoice named twice must be measured against its UPDATED balance,
// not twice against the original. Otherwise two 400s against a 400 invoice
// would both "fit" and the invoice would absorb 800.
{
  const plan = planAllocations(
    1000,
    [
      { invoiceId: 'A', amountAllocated: 400 },
      { invoiceId: 'A', amountAllocated: 400 },
    ],
    map(inv('A', 400)),
  );
  const total = plan.applied.reduce((s, a) => s + a.appliedAmount, 0);
  assert.equal(total, 400, 'a repeated invoice absorbs only what it owed once');
  assert.equal(plan.unallocated, 600, 'the duplicate request falls through to credit');
}

// ─── rows that cannot take money leave it as credit, not nowhere ─────────
// Previously an unknown invoice id hit `continue` with the money already
// conceptually spent; it must stay in the remainder instead.
{
  const plan = planAllocations(300, [{ invoiceId: 'GHOST', amountAllocated: 300 }], map());
  assert.equal(plan.applied.length, 0, 'an unknown invoice takes nothing');
  assert.equal(
    plan.unallocated,
    300,
    'and its money stays in the remainder so it becomes credit rather than ' +
      'vanishing',
  );
}
{
  const plan = planAllocations(300, [{ invoiceId: 'A', amountAllocated: 300 }], map(inv('A', 500, 500)));
  assert.equal(plan.applied.length, 0, 'an already-settled invoice takes nothing');
  assert.equal(plan.unallocated, 300, 'its money becomes credit');
}

// ─── junk input must not create money ────────────────────────────────────
for (const bad of [0, -100, NaN]) {
  const plan = planAllocations(bad as number, [{ invoiceId: 'A', amountAllocated: 50 }], map(inv('A', 500)));
  assert.equal(plan.applied.length, 0, `a payment of ${bad} allocates nothing`);
  assert.equal(plan.unallocated, 0, `a payment of ${bad} creates no credit`);
}
{
  const plan = planAllocations(
    500,
    [
      { invoiceId: 'A', amountAllocated: -200 },
      { invoiceId: 'A', amountAllocated: 100 },
    ],
    map(inv('A', 500)),
  );
  assert.equal(plan.applied.length, 1, 'a negative allocation is skipped, not subtracted');
  assert.equal(plan.applied[0].appliedAmount, 100, 'only the valid request applies');
  assert.equal(plan.unallocated, 400, 'the balance of the payment is credit');
}

// ─── centavo arithmetic ──────────────────────────────────────────────────
// 0.1 + 0.2 drift must not leave a fraction of a centavo as phantom credit,
// which would show the payment as perpetually "Partial" in Payment History.
{
  const plan = planAllocations(
    0.3,
    [
      { invoiceId: 'A', amountAllocated: 0.1 },
      { invoiceId: 'B', amountAllocated: 0.2 },
    ],
    map(inv('A', 0.1), inv('B', 0.2)),
  );
  assert.equal(plan.unallocated, 0, 'float drift does not leave phantom credit');
}

// ─── invoiceStatusFor ────────────────────────────────────────────────────
assert.equal(invoiceStatusFor(0, 500), 'Pending', 'nothing paid is Pending');
assert.equal(invoiceStatusFor(200, 500), 'Partially Paid', 'part paid is Partially Paid');
assert.equal(invoiceStatusFor(500, 500), 'Paid', 'paid in full is Paid');
assert.equal(invoiceStatusFor(600, 500), 'Paid', 'over total still reads Paid');
// 'Partial' is NOT the enum member; writing it is truncated and under
// STRICT_TRANS_TABLES aborts the whole payment transaction.
assert.notEqual(
  invoiceStatusFor(200, 500),
  'Partial',
  "the status is 'Partially Paid', the exact enum member the column declares",
);

// ─── the route actually credits the remainder ────────────────────────────
// A plan that reports `unallocated` is useless if the route still ignores it.
const routeSrc = fs
  .readFileSync(
    path.join(__dirname, '../..', 'app/api/customer-payments/route.ts'),
    'utf-8',
  )
  .replace(/\r\n/g, '\n');

assert.ok(
  /from ['"]@\/lib\/payment-allocation['"]/.test(routeSrc),
  'app/api/customer-payments takes its allocation arithmetic from ' +
    'lib/payment-allocation rather than an inline loop',
);
assert.ok(
  /credit_balance/.test(routeSrc),
  'app/api/customer-payments writes customers.credit_balance — without this ' +
    'the unallocated remainder is recorded as a payment but never reduces ' +
    'what the customer owes, which is the original bug',
);
assert.ok(
  /unallocated/.test(routeSrc),
  'the route reads the plan\'s unallocated remainder instead of discarding it',
);
assert.ok(
  /ensureCustomerCreditColumn/.test(routeSrc),
  'the route ensures the credit_balance column exists before writing it, as ' +
    'the sibling customers/payments route does — the column is added by ' +
    'lib/ensure-customer-credit, not by a migration',
);

console.log('✓ payment-allocation');
