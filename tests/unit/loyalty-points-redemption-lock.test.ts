import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Two tills redeeming a customer's loyalty points at the same moment could
// each redeem the FULL balance, driving the points negative — the customer
// gets more discount than they ever earned, which is money given away.
//
// Root cause: the balance was read WITHOUT `FOR UPDATE`
//     SELECT id, current_points FROM customer_loyalty WHERE customer_id = ?
// then checked in JS (`if (currentPoints < pointsToDeduct) throw`), then
// deducted relatively (`current_points = current_points - ?`).
//
// The relative UPDATE is itself safe — it cannot lose a concurrent write —
// but it is not a guard. Nothing serialises the READ the check is based on,
// so both transactions read the same balance, both pass the check, and both
// deduct. Reproduced against this database on a temp table of the real
// schema shape:
//
//   till A reads 100.000 -> passes check for 80
//   till B reads 100.000 -> passes check for 80
//   FINAL points: -60.000   (160 redeemed out of 100)
//
// `customer_loyalty.current_points` is decimal(15,3) and SIGNED, so MySQL
// stores the negative happily — there is no column constraint to catch it.
//
// This project runs one server per physical terminal against a shared
// database, so two tills serving the same customer is an ordinary event, not
// a contrived one. (A customer handing their card to two cashiers at once is
// unusual; a double-tap or a retried request is not.)
//
// Earning points needs no such lock: it is purely additive, and the relative
// UPDATE already makes it safe. Only redemption validates against a balance.

const route = fs
  .readFileSync(path.join(__dirname, '../..', 'app/api/pos/checkout/route.ts'), 'utf-8')
  .replace(/\r\n/g, '\n');

const stripComments = (src: string) =>
  src
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');

const code = stripComments(route);

// ─── the redemption read must take a row lock ────────────────────────────
// Find every read of customer_loyalty that feeds a redemption check, and
// require the lock. Asserted by locating the reads rather than with one big
// windowed regex, which breaks on correct code when a comment grows.
const loyaltyReads = code
  .split('\n')
  .map((line, i) => ({ line, i }))
  .filter(({ line }) => /SELECT[^']*current_points[^']*FROM customer_loyalty/i.test(line));

assert.ok(
  loyaltyReads.length > 0,
  'the checkout route reads customer_loyalty.current_points',
);

// The redemption path is the one whose read is followed by an insufficiency
// check. Every such read must be locked.
for (const { line, i } of loyaltyReads) {
  const following = code.split('\n').slice(i, i + 25).join('\n');
  const isRedemptionRead = /Insufficient points/i.test(following);
  if (!isRedemptionRead) continue;

  assert.ok(
    /FOR UPDATE/i.test(line) || /FOR UPDATE/i.test(code.split('\n')[i + 1] || ''),
    'the loyalty balance a redemption is validated against is read FOR ' +
      'UPDATE, so a second till cannot read the same balance and redeem it ' +
      `again. Unlocked read at line ${i + 1}: ${JSON.stringify(line.trim())}`,
  );
}

// ─── the deduction stays relative AND re-guarded in SQL ──────────────────
// Defence in depth: even with the lock, the UPDATE itself refuses to go
// negative, so any future caller that forgets to lock cannot overdraw.
assert.ok(
  /current_points = current_points - \?/.test(code),
  'the deduction remains relative (current_points - ?) rather than writing a ' +
    'JS-computed absolute value, which would clobber a concurrent write',
);
assert.ok(
  /current_points >= \?/.test(code),
  'the deducting UPDATE carries its own `current_points >= ?` guard, so the ' +
    'database refuses an overdraw even if a caller skips the lock — the ' +
    'column is signed decimal(15,3) and has no constraint of its own',
);
// A guarded UPDATE that matches no row must be detected, or the sale would
// proceed having silently redeemed nothing.
assert.ok(
  /affectedRows/.test(code),
  'the route checks affectedRows on the guarded deduction: an UPDATE that ' +
    'matched no row means the balance moved under us, and the sale must fail ' +
    'rather than quietly redeem nothing while still discounting the customer',
);

// ─── earning is deliberately NOT locked ──────────────────────────────────
// Points earned are additive; a lock there would only add contention.
assert.ok(
  /current_points = current_points \+ \?/.test(code),
  'earning points is an additive relative UPDATE, which is already safe ' +
    'without a lock',
);

// ─── the back-office adjustment must be safe too ─────────────────────────
// app/api/customer-loyalty/adjust-points had the same shape: read, check in
// JS, then write. It writes an ABSOLUTE value, which is worse — it discards
// a concurrent change entirely rather than merely allowing an overdraw.
const adjust = stripComments(
  fs
    .readFileSync(
      path.join(__dirname, '../..', 'app/api/customer-loyalty/adjust-points/route.ts'),
      'utf-8',
    )
    .replace(/\r\n/g, '\n'),
);

assert.ok(
  !/UPDATE customer_loyalty SET current_points = \?/.test(adjust),
  'the points adjustment no longer writes a JS-computed ABSOLUTE balance, ' +
    'which silently discards any points earned or redeemed between its read ' +
    'and its write',
);
assert.ok(
  /current_points = current_points [-+]/.test(adjust),
  'it applies a relative delta instead, so a concurrent sale is preserved',
);
assert.ok(
  /withTransaction|FOR UPDATE/.test(adjust),
  'and it reads the balance under a transaction/lock, since it validates ' +
    'against it (points may not go negative)',
);

console.log('✓ loyalty-points-redemption-lock');
