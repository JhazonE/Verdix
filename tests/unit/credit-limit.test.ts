import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { checkCreditLimit, creditLimitMessage } from '../../lib/credit-limit';

// `customers.credit_limit` was stored, imported, exported and displayed (the
// POS customer-account dialog shows it beside account credit) but NOTHING
// enforced it. A grep of every reader found display, import/export and
// repository mapping only — no comparison against a balance anywhere. A
// customer could charge indefinitely past their limit with no warning.
//
// The semantics of 0 are the decisive design question, and the live data
// settles it: every customer in the database has credit_limit = 0. Reading 0
// strictly as "no credit allowed" would have blocked EVERY Charge-to-Account
// sale in the store the moment enforcement shipped. So 0 — and NULL — mean
// unlimited, and the ceiling starts applying once a real figure is set.

// ─── 0 and NULL mean unlimited ───────────────────────────────────────────
// This is the upgrade-safety property. If it ever regresses, every charge
// sale in a store that has not set limits starts failing.
for (const limit of [0, null, undefined, '0', '0.00']) {
  const d = checkCreditLimit({
    creditLimit: limit as any,
    currentBalance: 999999,
    chargeAmount: 999999,
  });
  assert.equal(
    d.allowed,
    true,
    `a credit limit of ${JSON.stringify(limit)} imposes no ceiling — every ` +
      'customer in the live database has 0, so treating it as "no credit" ' +
      'would block all charge sales on upgrade',
  );
  assert.equal(d.unlimited, true, 'and the decision says so explicitly');
  assert.equal(d.exceededBy, 0, 'nothing can be exceeded when nothing is set');
}

// A negative limit (a bad import) must not become a ceiling of -500 that
// refuses everything.
{
  const d = checkCreditLimit({ creditLimit: -500, currentBalance: 0, chargeAmount: 100 });
  assert.equal(d.allowed, true, 'a negative limit is treated as unset, not as a ceiling');
  assert.equal(d.unlimited, true, 'and reported as unlimited');
}

// ─── a real limit is enforced ────────────────────────────────────────────
{
  const d = checkCreditLimit({ creditLimit: 5000, currentBalance: 4000, chargeAmount: 500 });
  assert.equal(d.allowed, true, 'a charge landing under the limit is allowed');
  assert.equal(d.projectedBalance, 4500, 'the projected balance includes the charge');
  assert.equal(d.remainingCredit, 1000, 'headroom is the limit less the CURRENT balance');
  assert.equal(d.exceededBy, 0, 'nothing is exceeded');
}
{
  const d = checkCreditLimit({ creditLimit: 5000, currentBalance: 4000, chargeAmount: 1500 });
  assert.equal(d.allowed, false, 'a charge past the limit is refused');
  assert.equal(d.projectedBalance, 5500, 'the projection is balance + charge');
  assert.equal(d.exceededBy, 500, 'and the breach is quantified for the cashier');
}
// Landing exactly ON the limit is allowed: the limit is a ceiling the
// customer may reach, not one they must stay below.
{
  const d = checkCreditLimit({ creditLimit: 5000, currentBalance: 4000, chargeAmount: 1000 });
  assert.equal(d.allowed, true, 'a charge landing exactly on the limit is allowed');
  assert.equal(d.exceededBy, 0, 'exactly on the limit is not a breach');
}
// Already over the limit (e.g. the limit was lowered after the fact): any
// further charge is refused, and headroom is 0, never negative.
{
  const d = checkCreditLimit({ creditLimit: 1000, currentBalance: 3000, chargeAmount: 1 });
  assert.equal(d.allowed, false, 'a customer already over their limit cannot charge more');
  assert.equal(d.remainingCredit, 0, 'headroom is floored at 0, not reported as negative');
}

// ─── account credit offsets the charge ───────────────────────────────────
// Credit the customer has already paid in is not new exposure. The checkout
// route applies it to the same invoice in the same transaction, so the limit
// check must see the same net figure or it would refuse a charge the customer
// has in fact already funded.
{
  const d = checkCreditLimit({
    creditLimit: 5000,
    currentBalance: 4000,
    chargeAmount: 1500,
    creditApplied: 1000,
  });
  assert.equal(
    d.allowed,
    true,
    'account credit applied to this charge reduces what counts against the ' +
      'limit — 1500 charged with 1000 of credit is 500 of new exposure',
  );
  assert.equal(d.projectedBalance, 4500, 'the projection nets off the credit applied');
}
// Credit cannot offset more than the charge and must never create headroom.
{
  const d = checkCreditLimit({
    creditLimit: 5000,
    currentBalance: 4900,
    chargeAmount: 100,
    creditApplied: 9999,
  });
  assert.equal(d.projectedBalance, 4900, 'excess credit does not reduce the EXISTING balance');
  assert.equal(d.allowed, true, 'and the charge is allowed');
}

// ─── centavo arithmetic ──────────────────────────────────────────────────
// Float drift must not refuse a charge that lands exactly on the limit.
{
  const d = checkCreditLimit({ creditLimit: 0.3, currentBalance: 0.1, chargeAmount: 0.2 });
  assert.equal(d.exceededBy, 0, 'float drift does not manufacture a breach');
  assert.equal(d.allowed, true, 'so a charge landing on the limit still passes');
}

// ─── the refusal message names the figures ───────────────────────────────
{
  const d = checkCreditLimit({ creditLimit: 5000, currentBalance: 4000, chargeAmount: 1500 });
  const msg = creditLimitMessage(d, 'Juan Dela Cruz');
  for (const fragment of ['Juan Dela Cruz', '5,000.00', '500.00', '5,500.00']) {
    assert.ok(
      msg.includes(fragment),
      `the refusal states ${fragment} so the cashier can explain it at the ` +
        'till without opening the back office',
    );
  }
  assert.ok(/supervisor/i.test(msg), 'and says an override is possible');
}

// ─── checkout enforces it, and only for charges ──────────────────────────
const route = fs
  .readFileSync(path.join(__dirname, '../..', 'app/api/pos/checkout/route.ts'), 'utf-8')
  .replace(/\r\n/g, '\n');

assert.ok(
  /from ['"]@\/lib\/credit-limit['"]/.test(route),
  'the checkout route takes its credit-limit decision from lib/credit-limit',
);
assert.ok(
  /checkCreditLimit\(/.test(route),
  'and actually calls it — storing a limit nobody checks is the original bug',
);
// The override must be explicit, so a charge is never silently let through.
assert.ok(
  /creditLimitOverride/.test(route),
  'a refused charge can be approved with an explicit supervisor override ' +
    'flag rather than being blocked outright at the till',
);
// Enforcement belongs inside the charge branch: a cash sale creates no debt.
//
// Asserted structurally rather than with a windowed regex between `isCharge`
// and `checkCreditLimit` — the explanatory comment between them is long, so a
// character-count window fails on CORRECT code (the brittleness that
// source-assertion tests in this suite have been bitten by before). Instead:
// find the line that calls the check, then walk back for the nearest
// enclosing `if` and require it to test isCharge.
{
  const lines = route.split('\n');
  const callIndex = lines.findIndex((l) => /checkCreditLimit\(/.test(l));
  assert.ok(callIndex > 0, 'the checkout route calls checkCreditLimit');

  // Collect every `if` at a SHALLOWER indent than the call, walking outwards:
  // those are the conditions the call sits inside. The isCharge guard is an
  // outer one (an inner `if` narrows on the customer row being found), so
  // checking only the nearest would fail on correct code.
  const callIndent = lines[callIndex].match(/^\s*/)![0].length;
  const enclosing: string[] = [];
  let depth = callIndent;
  for (let i = callIndex - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.trim()) continue;
    const indent = line.match(/^\s*/)![0].length;
    if (indent < depth && /^\s*if \(/.test(line)) {
      enclosing.push(line);
      depth = indent;
    }
  }

  const chargeGuard = enclosing.find((l) => /isCharge/.test(l));
  assert.ok(
    chargeGuard,
    'the credit-limit check sits inside a condition testing isCharge, so a ' +
      'cash or card sale — which creates no receivable — can never be ' +
      `refused for a credit limit. Enclosing guards: ${JSON.stringify(enclosing)}`,
  );
  // A walk-in has no account to charge against.
  assert.ok(
    enclosing.some((l) => /walk-in/.test(l)),
    'and excludes the walk-in pseudo-customer, which has no account',
  );
}

// The refusal must roll the transaction back rather than return early, or the
// sale's rows (and the SI number already taken) would be left behind.
// Verified against the live counter: incrementing si_number inside a
// transaction and rolling back restored 000011 → 000011, so refusing this way
// does not gap the BIR sequence.
assert.ok(
  /throw error;/.test(route),
  'an over-limit charge THROWS so withTransaction rolls back — returning a ' +
    'response early would commit the partial sale and consume the SI number',
);

// ─── the override must never be supplied by accident ────────────────────
// handleConfirmPayment's FIRST parameter is now creditLimitOverride, so
// `onClick={handleConfirmPayment}` hands React's click event straight into
// it. A click event is truthy, which would approve every over-limit charge
// automatically — the enforcement would be dead on arrival.
{
  const dialog = fs
    .readFileSync(
      path.join(__dirname, '../..', 'app/(app)/pos/tender/TenderDialog.tsx'),
      'utf-8',
    )
    .replace(/\r\n/g, '\n');

  assert.ok(
    !/onClick=\{handleConfirmPayment\}/.test(dialog),
    'handleConfirmPayment is never passed directly as an event handler — its ' +
      'first argument is creditLimitOverride and a click event is truthy, so ' +
      'that would silently approve every charge. Wrap it: ' +
      '() => handleConfirmPayment()',
  );
  // The override is only ever reached through the supervisor dialog.
  assert.ok(
    /handleConfirmPayment\(true\)/.test(dialog),
    'the only call passing the override is the supervisor-approval success ' +
      'path',
  );
  assert.ok(
    /AdminAuthDialog/.test(dialog),
    'and that approval goes through AdminAuthDialog, which verifies an ' +
      'admin/manager role against /auth/login rather than trusting the till',
  );
}

const tender = fs
  .readFileSync(path.join(__dirname, '../..', 'app/(app)/pos/tender/use-tender.ts'), 'utf-8')
  .replace(/\r\n/g, '\n');

assert.ok(
  /creditLimitOverride\?: boolean/.test(tender),
  'the override is an explicit boolean parameter, not an implicit truthy value',
);
assert.ok(
  /CREDIT_LIMIT_EXCEEDED/.test(tender),
  'the till recognises the refusal code so it can offer the override instead ' +
    'of showing a generic checkout failure with no way through',
);

console.log('✓ credit-limit');
