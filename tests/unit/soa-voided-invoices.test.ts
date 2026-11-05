import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildSoaLines, type SoaInvoiceRow, type SoaPaymentRow } from '../../lib/soa-lines';

// A Statement of Account must SHOW a voided invoice, marked as void, while
// counting nothing for it — and the payments that were allocated to it must
// stop counting as credit too.
//
// Why showing it matters: a customer who was handed an invoice and later had
// it cancelled should see that cancellation on their statement. Dropping the
// row silently leaves the customer's own records unexplained — they have a
// document number with no counterpart on the statement.
//
// Why it must count zero: the invoice is not collectable, and neither is the
// payment that was applied to it. Counting the payment as a credit while
// dropping the invoice it paid for would hand the customer a balance
// reduction for a sale that never happened — the statement would understate
// what they owe by the whole payment.
//
// That pairing is the whole point: a voided invoice and its allocated
// payments cancel out TOGETHER, or not at all.

const invoice = (over: Partial<SoaInvoiceRow> = {}): SoaInvoiceRow => ({
  id: 'INV-1',
  reference: 'SI-0001',
  date: '2026-11-01',
  total: 1000,
  amountPaid: 0,
  status: 'Pending',
  description: null,
  dueDate: null,
  ...over,
});

const payment = (over: Partial<SoaPaymentRow> = {}): SoaPaymentRow => ({
  id: 'PAY-1',
  reference: '000001',
  date: '2026-11-02',
  type: 'CASH',
  amount: 1000,
  note: null,
  allocations: [],
  ...over,
});

// ─── a live invoice behaves as before ────────────────────────────────────
{
  const { lines, closingBalance } = buildSoaLines({
    openingBalance: 0,
    invoices: [invoice()],
    payments: [],
  });
  assert.equal(lines.length, 1, 'the invoice appears');
  assert.equal(lines[0].debit, 1000, 'and is charged as a debit');
  assert.equal(closingBalance, 1000, 'so the customer owes it');
  assert.equal(lines[0].voided, false, 'it is not marked void');
}

// ─── a voided invoice is SHOWN but counts zero ───────────────────────────
{
  const { lines, closingBalance } = buildSoaLines({
    openingBalance: 0,
    invoices: [invoice({ status: 'Voided' })],
    payments: [],
  });
  assert.equal(lines.length, 1, 'the voided invoice still appears on the statement');
  assert.equal(
    lines[0].voided,
    true,
    'flagged as void so the statement can mark it rather than leaving the ' +
      "customer with a document number that has no counterpart",
  );
  assert.equal(lines[0].debit, 0, 'but it is charged nothing');
  assert.equal(lines[0].credit, 0, 'and credits nothing');
  assert.equal(
    lines[0].runningBalance,
    0,
    'so the running balance does not move across a voided row',
  );
  assert.equal(closingBalance, 0, 'and the customer owes nothing for it');
  // The face value is still carried for display — the statement shows what
  // the cancelled invoice WAS for, it just does not add it up.
  assert.equal(lines[0].amount, 1000, 'the original amount is kept for display');
}

// 'Returned' is treated the same way: the goods came back.
{
  const { closingBalance, lines } = buildSoaLines({
    openingBalance: 0,
    invoices: [invoice({ status: 'Returned' })],
    payments: [],
  });
  assert.equal(lines[0].voided, true, 'a returned invoice is marked too');
  assert.equal(closingBalance, 0, 'and counts nothing');
}

// ─── the payment allocated to a voided invoice stops counting ────────────
// This is the pairing. Without it, voiding the invoice while keeping the
// payment as a credit would reduce the balance for a sale that never
// happened.
{
  const { lines, closingBalance } = buildSoaLines({
    openingBalance: 0,
    invoices: [invoice({ status: 'Voided', amountPaid: 1000 })],
    payments: [payment({ allocations: [{ invoiceId: 'INV-1', amount: 1000, invoiceRef: 'SI-0001' }] })],
  });
  assert.equal(closingBalance, 0, 'the voided invoice and its payment cancel out together');
  const paymentLine = lines.find((l) => l.type === 'Payment');
  assert.ok(paymentLine, 'the payment is still shown');
  assert.equal(
    paymentLine!.credit,
    0,
    'but credits nothing, because the invoice it paid for was cancelled — ' +
      'counting it would hand the customer a balance reduction for a sale ' +
      'that never happened',
  );
  assert.equal(paymentLine!.voided, true, 'and it is marked as void-related');
}

// A payment split across a LIVE and a VOIDED invoice credits only the live
// part. This is the case a blanket "ignore payments on voided invoices" rule
// would get wrong.
{
  const { closingBalance, lines } = buildSoaLines({
    openingBalance: 0,
    invoices: [
      invoice({ id: 'INV-LIVE', reference: 'SI-LIVE', total: 600, amountPaid: 600 }),
      invoice({ id: 'INV-VOID', reference: 'SI-VOID', status: 'Voided', total: 400, amountPaid: 400 }),
    ],
    payments: [
      payment({
        amount: 1000,
        allocations: [
          { invoiceId: 'INV-LIVE', amount: 600, invoiceRef: 'SI-LIVE' },
          { invoiceId: 'INV-VOID', amount: 400, invoiceRef: 'SI-VOID' },
        ],
      }),
    ],
  });
  // Live invoice 600 debited, 600 credited; voided invoice and its 400 both zero.
  assert.equal(
    closingBalance,
    0,
    'only the live half of a split payment counts, against only the live invoice',
  );
  const credited = lines
    .filter((l) => l.type === 'Payment')
    .reduce((sum, l) => sum + l.credit, 0);
  assert.equal(credited, 600, 'the credit shown is the live allocation only');
}

// ─── an UNALLOCATED payment still counts ─────────────────────────────────
// A payment on account was money genuinely handed over and is not tied to
// any cancelled sale, so voiding something else must not swallow it.
{
  const { closingBalance } = buildSoaLines({
    openingBalance: 0,
    invoices: [invoice({ status: 'Voided' })],
    payments: [payment({ amount: 500, allocations: [] })],
  });
  assert.equal(
    closingBalance,
    -500,
    'an unallocated payment remains a credit even alongside a voided ' +
      'invoice — it is money on account, not payment for the cancelled sale',
  );
}

// A partly-allocated payment: the voided part drops, the remainder stays.
{
  const { closingBalance } = buildSoaLines({
    openingBalance: 0,
    invoices: [invoice({ status: 'Voided', total: 400, amountPaid: 400 })],
    payments: [
      payment({
        amount: 1000,
        allocations: [{ invoiceId: 'INV-1', amount: 400, invoiceRef: 'SI-0001' }],
      }),
    ],
  });
  assert.equal(
    closingBalance,
    -600,
    'the 400 applied to the voided invoice stops counting, while the 600 ' +
      'unallocated remainder stays as account credit',
  );
}

// ─── the opening balance follows the same rules ──────────────────────────
// A voided invoice before the period, and its payment, must BOTH be excluded
// from the brought-forward figure, or the statement opens with a phantom
// credit.
{
  const { closingBalance } = buildSoaLines({
    openingBalance: 0,
    invoices: [],
    payments: [],
  });
  assert.equal(closingBalance, 0, 'an empty statement opens and closes at zero');
}

// ─── running balance accumulates in order ────────────────────────────────
{
  const { lines } = buildSoaLines({
    openingBalance: 100,
    invoices: [
      invoice({ id: 'A', date: '2026-11-01', total: 200 }),
      invoice({ id: 'B', date: '2026-11-03', total: 300, status: 'Voided' }),
      invoice({ id: 'C', date: '2026-11-05', total: 50 }),
    ],
    payments: [],
  });
  assert.deepEqual(
    lines.map((l) => l.runningBalance),
    [300, 300, 350],
    'the voided row leaves the running balance unchanged while still ' +
      'occupying its place in the chronology',
  );
}

// ─── the route uses the shared builder and excludes voids from opening ───
const route = fs
  .readFileSync(path.join(__dirname, '../..', 'app/api/reports/soa/route.ts'), 'utf-8')
  .replace(/\r\n/g, '\n');

assert.ok(
  /from ['"]@\/lib\/soa-lines['"]/.test(route),
  'the SOA route builds its lines with lib/soa-lines rather than inline math',
);
// The in-range invoice query must now INCLUDE voided rows, since they are
// displayed; it is the arithmetic that excludes them.
assert.ok(
  /includeVoided|all statuses|voided invoices are DISPLAYED/i.test(route),
  'the in-range invoice query deliberately includes voided invoices so they ' +
    'can be shown, and the builder is what zeroes their effect',
);
// The opening balance, which has no rows to display, still excludes them.
assert.ok(
  /countableInvoiceSql/.test(route),
  "the opening balance still excludes cancelled invoices — there is no row to " +
    'show for a period that has already closed',
);
assert.ok(
  /payment_allocations/.test(route),
  'the opening balance nets payments against their allocations so a payment ' +
    'for a voided invoice is not brought forward as a credit',
);

// ─── the statement MARKS the voided rows ─────────────────────────────────
// Counting zero is only half the decision: the row has to be visibly void,
// on screen AND on the printed statement the customer is handed.
{
  const page = fs
    .readFileSync(
      path.join(__dirname, '../..', 'app/(app)/customer/payment/page.tsx'),
      'utf-8',
    )
    .replace(/\r\n/g, '\n');

  assert.ok(
    /inv\.voided/.test(page),
    'the statement reads the voided flag off each invoice row',
  );
  // Both renderers: the React view and the print HTML.
  assert.ok(
    (page.match(/Voided — not collectable|Voided &mdash; not collectable/g) || []).length >= 2,
    'both the on-screen card and the printed statement say the invoice is ' +
      'voided and not collectable, instead of showing a peso balance for it',
  );
  assert.ok(
    /VOID/.test(page),
    'the printed statement badges the invoice VOID',
  );
  // The face value must still be shown: `debit` is 0 for a voided row, so
  // rendering debit would print ₱0.00 and lose what the invoice was for.
  assert.ok(
    /isVoided \? inv\.amount : inv\.debit/.test(page),
    'a voided invoice displays its ORIGINAL amount, not its zeroed debit — ' +
      'otherwise the statement shows ₱0.00 and the customer cannot reconcile ' +
      'the document number they hold',
  );
  // The payment under it is struck through, not counted.
  assert.ok(
    /p\.voided/.test(page),
    'a payment allocated to a voided invoice is marked rather than shown as ' +
      'money off the balance',
  );
  // And it must not be counted among the charges it contributes nothing to.
  assert.ok(
    /chargedCount/.test(page),
    'the "New Charges (N invoices)" count excludes voided invoices, which ' +
      'are listed but charge nothing',
  );
}

console.log('✓ soa-voided-invoices');
